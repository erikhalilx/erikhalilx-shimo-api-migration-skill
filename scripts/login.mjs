#!/usr/bin/env node
/**
 * login.mjs — Shimo interactive login.
 *
 * Opens a non-headless browser. The user completes captcha/login manually.
 * Session and cookies are stored under the configured cache directory and must never be committed.
 */

import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';

let loginOptions = {
  cacheDir: path.join(process.cwd(), '.cache', 'shimo-api-migration'),
};

export function configureLogin(options = {}) {
  loginOptions = { ...loginOptions, ...options };
}

function getShimoCacheDir() {
  return path.join(loginOptions.cacheDir || path.join(process.cwd(), '.cache', 'shimo-api-migration'), 'shimo');
}

export function getShimoSessionDir() {
  return path.join(getShimoCacheDir(), 'browser-session');
}

function getCookiePath() {
  return path.join(getShimoCacheDir(), 'cookies.json');
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ===== CHECK LOGIN STATUS =====
export async function checkLoginStatus(page) {
  try {
    const resp = await page.evaluate(async () => {
      const r = await fetch('/lizard-api/users/me', { credentials: 'include' });
      const data = await r.json().catch(() => null);
      return { status: r.status, data };
    });
    return resp.status === 200 && resp.data?.id > 0 ? resp.data : null;
  } catch {
    return null;
  }
}

// ===== IS SESSION VALID =====
export async function isSessionValid(options = {}) {
  configureLogin(options);
  const sessionDir = getShimoSessionDir();
  if (!fs.existsSync(sessionDir)) return false;

  try {
    const context = await chromium.launchPersistentContext(sessionDir, {
      headless: true,
      args: ['--no-sandbox', '--disable-blink-features=AutomationControlled'],
    });
    const page = context.pages()[0] || await context.newPage();
    await page.goto('https://shimo.im/recent', { waitUntil: 'domcontentloaded', timeout: 15000 });
    await sleep(2000);
    const user = await checkLoginStatus(page);
    await context.close();
    return user !== null;
  } catch {
    return false;
  }
}

// ===== INTERACTIVE LOGIN =====
export async function interactiveLogin(account = '', password = '', options = {}) {
  configureLogin(options);
  const cacheDir = getShimoCacheDir();
  const sessionDir = getShimoSessionDir();
  const cookiePath = getCookiePath();
  fs.mkdirSync(cacheDir, { recursive: true });

  fs.rmSync(sessionDir, { recursive: true, force: true });
  fs.rmSync(cookiePath, { force: true });

  console.log('══════════════════════════════════════════════════════');
  console.log('  Shimo interactive login');
  console.log('  A browser window will open. Please complete login/captcha manually.');
  console.log('══════════════════════════════════════════════════════\n');

  const context = await chromium.launchPersistentContext(sessionDir, {
    headless: false,
    viewport: { width: 1280, height: 800 },
    args: ['--no-sandbox', '--disable-blink-features=AutomationControlled'],
  });

  const page = context.pages()[0] || await context.newPage();
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => false });
  });

  try {
    console.log('1. Opening login page...');
    await page.goto('https://shimo.im/login', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await sleep(2000);

    if (account && password) {
      console.log('2. Filling account/password...');
      try {
        await page.locator('input[name="account"]').fill(account, { timeout: 5000 });
        await sleep(300);
        await page.locator('input[name="password"]').fill(password, { timeout: 5000 });
        await sleep(300);
        console.log('   ✅ Credentials filled');
      } catch {
        console.log('   ⚠️ Autofill failed. Please fill manually in the browser.');
      }

      try {
        const loginBtn = page.locator('button[type="submit"]').first();
        if (await loginBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
          await loginBtn.click({ timeout: 5000 });
          await sleep(2000);
        }
      } catch {}

      try {
        const agreeBtn = page.locator('button:has-text("同意")').first();
        if (await agreeBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
          await agreeBtn.click({ force: true });
          await sleep(1000);
          await page.locator('button[type="submit"]').click({ force: true }).catch(() => {});
          await sleep(2000);
        }
      } catch {}
    }

    console.log('\n══════════════════════════════════════════════════════');
    console.log('  If captcha appears, complete it manually in the browser.');
    console.log('  The script will detect login status automatically.');
    console.log('══════════════════════════════════════════════════════\n');

    let loggedIn = false;
    let userInfo = null;
    const maxWaitSeconds = 180;

    for (let i = 0; i < maxWaitSeconds; i++) {
      await sleep(2000);
      const url = page.url();
      if (!url.includes('login') && !url.includes('account') && url.includes('shimo.im')) {
        const status = await checkLoginStatus(page);
        if (status) {
          loggedIn = true;
          userInfo = status;
          break;
        }
      }
      if (i % 5 === 0) {
        const status = await checkLoginStatus(page);
        if (status) {
          loggedIn = true;
          userInfo = status;
          break;
        }
      }
    }

    if (!loggedIn) {
      console.log('\n❌ Login timeout');
      await context.close();
      return { success: false, error: 'login timeout' };
    }

    const cookies = await context.cookies();
    fs.writeFileSync(cookiePath, JSON.stringify(cookies, null, 2));

    console.log('\n══════════════════════════════════════════════════════');
    console.log('  ✅ Login successful');
    console.log(`  User: ${userInfo.name || userInfo.email || userInfo.mobile || 'ID:' + userInfo.id}`);
    console.log(`  Session saved: ${sessionDir}`);
    console.log('══════════════════════════════════════════════════════\n');

    await sleep(2000);
    await context.close();
    return { success: true, user: userInfo };
  } catch (e) {
    console.error('\n❌ Error:', e.message);
    await context.close().catch(() => {});
    return { success: false, error: e.message };
  }
}

if (process.argv[1]?.endsWith('login.mjs')) {
  const args = process.argv.slice(2);
  let account = '';
  let password = '';
  let cacheDir = path.join(process.cwd(), '.cache', 'shimo-api-migration');
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--account' && args[i + 1]) account = args[++i];
    if (args[i] === '--password' && args[i + 1]) password = args[++i];
    if (args[i] === '--cache-dir' && args[i + 1]) cacheDir = args[++i];
  }
  interactiveLogin(account, password, { cacheDir }).then(result => {
    process.exit(result.success ? 0 : 1);
  });
}
