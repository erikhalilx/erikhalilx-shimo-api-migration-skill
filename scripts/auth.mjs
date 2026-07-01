#!/usr/bin/env node
/**
 * auth.mjs — Feishu OAuth user_access_token helper.
 *
 * Files and folders are created by the currently authorized user.
 * Token cache is stored under the configured cache directory and must never be committed.
 */

import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';

const REDIRECT_PORT = 10700;
export const REDIRECT_URI = `http://localhost:${REDIRECT_PORT}/callback`;

const OAUTH_SCOPES = [
  'offline_access',
  'drive:drive',
  'docx:document',
].join(' ');

let authOptions = {
  cacheDir: path.join(process.cwd(), '.cache', 'shimo-api-migration'),
};

export function configureAuth(options = {}) {
  authOptions = { ...authOptions, ...options };
}

function getFeishuCacheDir() {
  return path.join(authOptions.cacheDir || path.join(process.cwd(), '.cache', 'shimo-api-migration'), 'feishu');
}

function getTokenCachePath() {
  return path.join(getFeishuCacheDir(), 'user-token.json');
}

function getOAuthSessionDir() {
  return path.join(getFeishuCacheDir(), 'oauth-session');
}

// ===== GET USER ACCESS TOKEN =====
export async function getUserAccessToken(appId, appSecret) {
  const cached = loadCachedToken();
  if (cached?.refresh_token) {
    const refreshed = await tryRefresh(appId, appSecret, cached);
    if (refreshed) return refreshed;
  }
  if (cached && !isExpired(cached)) return cached.access_token;

  console.log('   需要飞书用户授权...');
  const code = await getAuthCode(appId);
  if (!code) throw new Error('OAuth authorization failed: no code returned');

  const tokens = await exchangeCode(appId, appSecret, code);
  saveToken(tokens);
  console.log('   ✅ Feishu user_access_token acquired');
  return tokens.access_token;
}

// ===== GET AUTH CODE VIA PLAYWRIGHT =====
async function getAuthCode(appId) {
  const state = Math.random().toString(36).substring(2);
  const authUrl = `https://accounts.feishu.cn/open-apis/authen/v1/authorize?` +
    `client_id=${appId}&redirect_uri=${encodeURIComponent(REDIRECT_URI)}&` +
    `scope=${encodeURIComponent(OAUTH_SCOPES)}&state=${state}`;

  console.log('   打开飞书授权页...');
  fs.mkdirSync(getFeishuCacheDir(), { recursive: true });

  const context = await chromium.launchPersistentContext(getOAuthSessionDir(), {
    headless: false,
    viewport: { width: 900, height: 760 },
  });
  const page = context.pages()[0] || await context.newPage();

  let capturedCode = null;
  await context.route(`http://localhost:${REDIRECT_PORT}/**`, async (route) => {
    const url = route.request().url();
    try {
      const urlObj = new URL(url);
      capturedCode = urlObj.searchParams.get('code');
    } catch {}
    await route.fulfill({
      status: 200,
      contentType: 'text/html; charset=utf-8',
      body: '<h1>Authorization complete</h1><p>You can close this window and return to the terminal.</p>',
    });
  });

  try {
    await page.goto(authUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await new Promise(r => setTimeout(r, 2000));

    const allowSelectors = [
      'button:has-text("允许")',
      'button:has-text("授权")',
      'button:has-text("Allow")',
      'button:has-text("同意")',
      'button[type="submit"]',
      '[class*="confirm"]',
      '[class*="allow"]',
    ];

    for (const sel of allowSelectors) {
      try {
        const btn = page.locator(sel).first();
        if (await btn.isVisible({ timeout: 2000 }).catch(() => false)) {
          console.log('   自动点击授权按钮...');
          await btn.click();
          break;
        }
      } catch {}
    }

    const maxWait = 120000;
    for (let i = 0; i < maxWait / 1000; i++) {
      await new Promise(r => setTimeout(r, 1000));
      if (capturedCode) return capturedCode;
      const url = page.url();
      if (url.includes('localhost') || url.includes('127.0.0.1')) {
        const urlObj = new URL(url);
        const code = urlObj.searchParams.get('code');
        if (code) return code;
      }
      if (i > 0 && i % 15 === 0) console.log(`   等待授权中... (${i}s)`);
    }
    return null;
  } finally {
    await context.close().catch(() => {});
  }
}

async function exchangeCode(appId, appSecret, code) {
  const resp = await fetch('https://open.feishu.cn/open-apis/authen/v2/oauth/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify({
      grant_type: 'authorization_code',
      client_id: appId,
      client_secret: appSecret,
      code,
      redirect_uri: REDIRECT_URI,
    }),
  });

  const data = await resp.json();
  if (data.code !== 0) {
    throw new Error(`Token exchange failed (${data.code}): ${data.error || data.msg || data.error_description || JSON.stringify(data)}`);
  }
  return normalizeToken(data);
}

async function tryRefresh(appId, appSecret, cached) {
  if (!cached?.refresh_token) return null;
  if (Date.now() > cached.refresh_expires_at) return null;

  try {
    const resp = await fetch('https://open.feishu.cn/open-apis/authen/v2/oauth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify({
        grant_type: 'refresh_token',
        client_id: appId,
        client_secret: appSecret,
        refresh_token: cached.refresh_token,
      }),
    });
    const data = await resp.json();
    if (data.code !== 0) {
      console.log(`   ⚠️ Token refresh failed (${data.code}): ${data.error_description || data.error || data.msg || ''}`);
      return null;
    }
    const refreshed = normalizeToken(data);
    saveToken(refreshed);
    console.log('   ✅ Feishu user_access_token refreshed');
    return refreshed.access_token;
  } catch (e) {
    console.log(`   ⚠️ Token refresh error: ${e.message}`);
    return null;
  }
}

function normalizeToken(data) {
  return {
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    expires_at: Date.now() + (data.expires_in || 7200) * 1000,
    refresh_expires_at: Date.now() + (data.refresh_token_expires_in || 604800) * 1000,
    scope: data.scope,
  };
}

function loadCachedToken() {
  const tokenPath = getTokenCachePath();
  if (!fs.existsSync(tokenPath)) return null;
  try {
    return JSON.parse(fs.readFileSync(tokenPath, 'utf-8'));
  } catch {
    return null;
  }
}

function saveToken(tokens) {
  fs.mkdirSync(getFeishuCacheDir(), { recursive: true });
  fs.writeFileSync(getTokenCachePath(), JSON.stringify(tokens, null, 2));
}

function isExpired(tokens) {
  return Date.now() > tokens.expires_at - 60000;
}
