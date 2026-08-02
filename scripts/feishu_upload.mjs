#!/usr/bin/env node
/**
 * feishu_upload.mjs — Feishu upload/import/doc helper using OAuth user_access_token.
 */

import fs from 'fs';
import path from 'path';
import { spawnSync } from 'child_process';
import { getUserAccessToken, configureAuth } from './auth.mjs';

const BASE_URL = 'https://open.feishu.cn/open-apis';
const SMALL_FILE_LIMIT = 20 * 1024 * 1024;
const BLOCK_SIZE = 4 * 1024 * 1024;

let appId = null;
let appSecret = null;
let backend = 'oauth';
let larkCliPath = process.env.LARK_CLI_PATH || 'lark-cli';

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
export function sanitizeName(name) { return String(name || 'untitled').replace(/[\/\\:*?"<>|]/g, '_').trim() || 'untitled'; }

export function initFeishu(config) {
  backend = config.backend || config.feishu_backend || config.feishu?.backend || 'oauth';
  larkCliPath = config.larkCliPath || config.lark_cli_path || process.env.LARK_CLI_PATH || 'lark-cli';
  appId = config.feishu?.app_id || config.app_id;
  appSecret = config.feishu?.app_secret || config.app_secret;
  if (backend !== 'lark-cli' && (!appId || !appSecret)) throw new Error('Missing Feishu app credentials');
  if (config.cacheDir || config.cache_dir) configureAuth({ cacheDir: config.cacheDir || config.cache_dir });
}

function runLarkCli(args, { timeout = 180000, cwd = process.cwd() } = {}) {
  const cliArgs = [...args, '--as', 'user', '--json'];
  const isNodeScript = /\.(?:cjs|mjs|js)$/i.test(larkCliPath);
  const command = isNodeScript ? process.execPath : larkCliPath;
  const commandArgs = isNodeScript ? [larkCliPath, ...cliArgs] : cliArgs;
  const result = spawnSync(command, commandArgs, {
    cwd,
    encoding: 'utf8',
    timeout,
    env: { ...process.env, LARK_CLI_NO_PROXY_WARN: '1' },
    maxBuffer: 50 * 1024 * 1024,
  });
  if (result.error) throw result.error;
  const stdout = String(result.stdout || '').trim();
  let parsed = null;
  try { parsed = JSON.parse(stdout); } catch {}
  if (result.status !== 0 || !parsed?.ok || parsed?.data?.error) {
    const detail = parsed?.error?.message || parsed?.data?.error || parsed?.message || String(result.stderr || '').trim() || stdout || `exit ${result.status}`;
    throw new Error(`lark-cli failed: ${detail}`);
  }
  return parsed.data || {};
}

function cliUrl(type, token) {
  if (!token) return '';
  if (type === 'docx') return `https://my.feishu.cn/docx/${token}`;
  if (type === 'sheet') return `https://my.feishu.cn/sheets/${token}`;
  if (type === 'slides') return `https://my.feishu.cn/slides/${token}`;
  if (type === 'folder') return `https://my.feishu.cn/drive/folder/${token}`;
  return `https://my.feishu.cn/drive/file/${token}`;
}

function firstDefined(...values) {
  return values.find(value => value !== undefined && value !== null && value !== '');
}

function normalizeCliObject(data, fallbackType = 'file') {
  const source = data?.document || data?.file || data?.folder || data?.result || data || {};
  const type = firstDefined(source.type, source.obj_type, source.token_type, data?.type, fallbackType);
  const token = firstDefined(
    source.token,
    source.document_id,
    source.file_token,
    source.folder_token,
    source.obj_token,
    data?.token,
    data?.document_id,
    data?.file_token,
    data?.folder_token,
  );
  const url = firstDefined(source.url, data?.url, cliUrl(type, token));
  return { ...source, token, type, url };
}

function inspectWithCli(token, type) {
  const data = runLarkCli(['drive', '+inspect', '--url', cliUrl(type, token), '--type', type]);
  return normalizeCliObject(data, type);
}

function cliFileArgs(filePath) {
  const absolute = path.resolve(filePath);
  return { cwd: path.dirname(absolute), relativePath: `./${path.basename(absolute)}` };
}

function escapeXmlText(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\r?\n/g, '<br/>');
}

async function getToken() {
  return await getUserAccessToken(appId, appSecret);
}

async function feishuApi(method, urlPath, opts = {}) {
  let lastError = null;
  let delay = 1000;
  for (let attempt = 1; attempt <= 5; attempt++) {
    const token = await getToken();
    try {
      const resp = await fetch(`${BASE_URL}${urlPath}`, {
        method,
        headers: { 'Authorization': `Bearer ${token}`, ...opts.headers },
        body: opts.body,
      });
      const text = await resp.text();
      let data;
      try { data = JSON.parse(text); } catch { data = { raw: text }; }
      if (resp.status === 429 || data.code === 99991400) {
        await sleep(delay);
        delay = Math.min(delay * 2, 30000);
        continue;
      }
      return { status: resp.status, data };
    } catch (e) {
      lastError = e;
      if (attempt < 5) {
        await sleep(delay);
        delay = Math.min(delay * 2, 30000);
      }
    }
  }
  throw lastError || new Error('Feishu API failed after retries');
}

export async function getFileMeta(fileToken) {
  if (backend === 'lark-cli') {
    try { return { success: true, meta: inspectWithCli(fileToken, 'file') }; }
    catch (e) { return { success: false, error: e.message }; }
  }
  const resp = await feishuApi('GET', `/drive/v1/files/${encodeURIComponent(fileToken)}`);
  return resp.data.code === 0 ? { success: true, meta: resp.data.data } : { success: false, error: resp.data.msg || JSON.stringify(resp.data) };
}

export async function getDocxMeta(documentId) {
  if (backend === 'lark-cli') {
    try { return { success: true, meta: inspectWithCli(documentId, 'docx') }; }
    catch (e) { return { success: false, error: e.message }; }
  }
  const resp = await feishuApi('GET', `/docx/v1/documents/${encodeURIComponent(documentId)}`);
  return resp.data.code === 0 ? { success: true, meta: resp.data.data } : { success: false, error: resp.data.msg || JSON.stringify(resp.data) };
}

export async function getSheetMeta(spreadsheetToken) {
  if (backend === 'lark-cli') {
    try { return { success: true, meta: inspectWithCli(spreadsheetToken, 'sheet') }; }
    catch (e) { return { success: false, error: e.message }; }
  }
  const resp = await feishuApi('GET', `/sheets/v3/spreadsheets/${encodeURIComponent(spreadsheetToken)}`);
  return resp.data.code === 0 ? { success: true, meta: resp.data.data } : { success: false, error: resp.data.msg || JSON.stringify(resp.data) };
}

export async function listFolderChildren(folderToken = '') {
  if (backend === 'lark-cli') {
    const args = ['drive', 'files', 'list', '--page-all', '--page-size', '200'];
    if (folderToken) args.push('--folder-token', folderToken);
    let lastError = null;
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        const data = runLarkCli(args, { timeout: 120000 });
        const files = (data.files || []).map(file => normalizeCliObject(file, file.type || 'file'));
        return { success: true, files };
      } catch (error) {
        lastError = error;
        if (attempt < 2) await sleep(1500);
      }
    }
    return { success: false, error: `lark-cli list folder failed after 2 attempts: ${lastError?.message || 'unknown error'}` };
  }
  const query = folderToken ? `?folder_token=${encodeURIComponent(folderToken)}&page_size=200` : '?page_size=200';
  const resp = await feishuApi('GET', `/drive/v1/files${query}`);
  return resp.data.code === 0 ? { success: true, files: resp.data.data?.files || [] } : { success: false, error: resp.data.msg || JSON.stringify(resp.data) };
}

export async function createFolder({ name, parentToken }) {
  const safeName = sanitizeName(name);
  if (backend === 'lark-cli') {
    const args = ['drive', '+create-folder', '--name', safeName];
    if (parentToken) args.push('--folder-token', parentToken);
    const folder = normalizeCliObject(runLarkCli(args, { timeout: 120000 }), 'folder');
    if (!folder.token) throw new Error('lark-cli create folder returned no token');
    return { ...folder, name: safeName, token: folder.token, url: folder.url || cliUrl('folder', folder.token) };
  }
  const resp = await feishuApi('POST', '/drive/v1/files/create_folder', {
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify({ name: safeName, folder_type: 'normal', folder_token: parentToken || '' }),
  });
  if (resp.data.code === 0) return { token: resp.data.data?.token, url: resp.data.data?.url, name: safeName };
  if (resp.data.code === 140004 || resp.data.code === 180026) throw new Error(`folder_exists: ${resp.data.msg}`);
  throw new Error(`createFolder failed (${resp.data.code}): ${resp.data.msg || JSON.stringify(resp.data)}`);
}

function buildMultipart(fields, fileField) {
  const boundary = `----FeishuUpload${Date.now()}${Math.random().toString(36).slice(2)}`;
  const chunks = [];
  for (const field of fields) {
    chunks.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${field.name}"\r\n\r\n${field.value}\r\n`, 'utf8'));
  }
  if (fileField) {
    chunks.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${fileField.name}"; filename="${fileField.filename}"\r\nContent-Type: ${fileField.contentType || 'application/octet-stream'}\r\n\r\n`, 'utf8'));
    chunks.push(fileField.buffer);
    chunks.push(Buffer.from('\r\n', 'utf8'));
  }
  chunks.push(Buffer.from(`--${boundary}--\r\n`, 'utf8'));
  return { boundary, body: Buffer.concat(chunks) };
}

async function importDirect(filePath, folderToken, name, fileExtension, objType, mimeType) {
  const safeName = sanitizeName(name);
  const fileBuffer = fs.readFileSync(filePath);
  const { boundary, body } = buildMultipart([
    { name: 'file_name', value: `${safeName}.${fileExtension}` },
    { name: 'parent_type', value: 'ccm_import_open' },
    { name: 'size', value: String(fileBuffer.length) },
    { name: 'parent_node', value: folderToken || '' },
    { name: 'extra', value: JSON.stringify({ obj_type: objType, file_extension: fileExtension }) },
  ], { name: 'file', filename: `${safeName}.${fileExtension}`, contentType: mimeType, buffer: fileBuffer });

  const token = await getToken();
  const resp = await fetch(`${BASE_URL}/drive/v1/medias/upload_all`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': `multipart/form-data; boundary=${boundary}` },
    body,
  });
  const text = await resp.text();
  let data;
  try { data = JSON.parse(text); } catch { throw new Error(`upload_all failed: HTTP ${resp.status} — ${text.slice(0, 200)}`); }
  if (data.code !== 0) throw new Error(`upload_all failed (${data.code}): ${data.msg || JSON.stringify(data)}`);
  const uploadToken = data.data?.file_token || data.data?.token;
  if (!uploadToken) throw new Error('upload_all: no file_token in response');
  try {
    return { ...await createImportTask(uploadToken, folderToken, name, fileExtension, objType), method: 'direct_import', token_type: objType };
  } catch (e) {
    return { success: true, token: uploadToken, token_type: 'file', url: `https://my.feishu.cn/drive/file/${uploadToken}`, method: 'direct_upload_no_import', note: `Import failed: ${e.message}; file kept as cloud drive file` };
  }
}

async function uploadChunked(filePath, folderToken, name, fileExtension) {
  const safeName = sanitizeName(name);
  const fileSize = fs.statSync(filePath).size;
  const blockNum = Math.ceil(fileSize / BLOCK_SIZE);
  const prepareResp = await feishuApi('POST', '/drive/v1/files/upload_prepare', {
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify({ file_name: `${safeName}.${fileExtension}`, parent_type: 'explorer', parent_node: folderToken || '', size: fileSize }),
  });
  if (prepareResp.data.code !== 0) throw new Error(`upload_prepare failed (${prepareResp.data.code}): ${prepareResp.data.msg}`);
  const uploadId = prepareResp.data.data?.upload_id;
  if (!uploadId) throw new Error('upload_prepare: no upload_id');

  const fd = fs.openSync(filePath, 'r');
  try {
    for (let i = 0; i < blockNum; i++) {
      const start = i * BLOCK_SIZE;
      const size = Math.min(BLOCK_SIZE, fileSize - start);
      const block = Buffer.allocUnsafe(size);
      fs.readSync(fd, block, 0, size, start);
      const { boundary, body } = buildMultipart([
        { name: 'upload_id', value: uploadId },
        { name: 'seq', value: String(i) },
        { name: 'size', value: String(size) },
      ], { name: 'file', filename: `block_${i}`, contentType: 'application/octet-stream', buffer: block });
      const token = await getToken();
      const partResp = await fetch(`${BASE_URL}/drive/v1/files/upload_part`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': `multipart/form-data; boundary=${boundary}` },
        body,
      });
      const partData = await partResp.json();
      if (partData.code !== 0) throw new Error(`upload_part ${i + 1}/${blockNum} failed (${partData.code}): ${partData.msg}`);
      await sleep(250);
    }
  } finally {
    fs.closeSync(fd);
  }

  const finishResp = await feishuApi('POST', '/drive/v1/files/upload_finish', {
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify({ upload_id: uploadId, block_num: blockNum }),
  });
  if (finishResp.data.code !== 0) throw new Error(`upload_finish failed (${finishResp.data.code}): ${finishResp.data.msg}`);
  return { success: true, token: finishResp.data.data?.file_token, method: 'chunked_upload' };
}

async function createImportTask(fileToken, folderToken, name, fileExtension, targetType) {
  const safeName = sanitizeName(name);
  const resp = await feishuApi('POST', '/drive/v1/import_tasks', {
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify({ file_extension: fileExtension, file_token: fileToken, type: targetType, file_name: safeName, point: { mount_type: 1, mount_key: folderToken || '' } }),
  });
  if (resp.data.code !== 0) throw new Error(`import_tasks failed (${resp.data.code}): ${resp.data.msg}`);
  const ticket = resp.data.data?.ticket;
  for (let i = 0; i < 60; i++) {
    await sleep(2000);
    const r = await feishuApi('GET', `/drive/v1/import_tasks/${ticket}`);
    const js = r.data.data?.result?.job_status;
    if (js === 0) {
      const dt = r.data.data?.result?.token;
      return { success: true, token: dt, url: targetType === 'sheet' ? `https://my.feishu.cn/sheets/${dt}` : `https://my.feishu.cn/docx/${dt}` };
    }
    if (js === 1 || js === 2) throw new Error(`import task failed: job_status=${js}`);
  }
  throw new Error('import task timeout');
}

export async function uploadFile({ filePath, folderToken, name, fileExtension, objType, mimeType }) {
  const fileSize = fs.statSync(filePath).size;
  const ext = fileExtension || path.extname(filePath).slice(1) || 'bin';
  try {
    if (backend === 'lark-cli') {
      const { cwd, relativePath } = cliFileArgs(filePath);
      if (objType) {
        try {
          const args = ['drive', '+import', '--file', relativePath, '--name', sanitizeName(name), '--type', objType];
          if (folderToken) args.push('--folder-token', folderToken);
          const imported = normalizeCliObject(runLarkCli(args, { cwd, timeout: 30 * 60 * 1000 }), objType);
          if (!imported.token) throw new Error('lark-cli import returned no token');
          return { success: true, token: imported.token, token_type: imported.type || objType, url: imported.url || cliUrl(objType, imported.token), method: 'lark_cli_import' };
        } catch (importError) {
          const args = ['drive', '+upload', '--file', relativePath, '--name', `${sanitizeName(name)}.${ext}`];
          if (folderToken) args.push('--folder-token', folderToken);
          const uploaded = normalizeCliObject(runLarkCli(args, { cwd, timeout: 30 * 60 * 1000 }), 'file');
          if (!uploaded.token) throw new Error(`lark-cli import failed (${importError.message}); upload fallback returned no token`);
          return { success: true, token: uploaded.token, token_type: 'file', url: uploaded.url || cliUrl('file', uploaded.token), method: 'lark_cli_upload_fallback', note: `Cloud document import failed; preserved as Drive file: ${importError.message}` };
        }
      }
      const args = ['drive', '+upload', '--file', relativePath, '--name', `${sanitizeName(name)}.${ext}`];
      if (folderToken) args.push('--folder-token', folderToken);
      const uploaded = normalizeCliObject(runLarkCli(args, { cwd, timeout: 30 * 60 * 1000 }), 'file');
      if (!uploaded.token) throw new Error('lark-cli upload returned no token');
      return { success: true, token: uploaded.token, token_type: 'file', url: uploaded.url || cliUrl('file', uploaded.token), method: 'lark_cli_upload' };
    }
    if (fileSize <= SMALL_FILE_LIMIT && objType) return await importDirect(filePath, folderToken, name, ext, objType, mimeType);
    const uploadResult = await uploadChunked(filePath, folderToken, name, ext);
    const fileToken = uploadResult.token;
    if (objType && fileSize > SMALL_FILE_LIMIT) {
      try {
        return { ...await createImportTask(fileToken, folderToken, name, ext, objType), method: 'chunked_upload+import', token_type: objType };
      } catch {
        return { success: true, token: fileToken, token_type: 'file', url: `https://my.feishu.cn/drive/file/${fileToken}`, method: 'cloud_drive_file', note: 'File >20MB could not be converted automatically; uploaded as cloud drive file' };
      }
    }
    return { success: true, token: fileToken, token_type: 'file', url: `https://my.feishu.cn/drive/file/${fileToken}`, method: 'cloud_drive_file' };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

export async function createDocxDocument({ title, folderToken }) {
  const safeTitle = sanitizeName(title).slice(0, 800);
  if (backend === 'lark-cli') {
    const args = ['docs', '+create', '--title', safeTitle, '--content', '<p></p>'];
    if (folderToken) args.push('--parent-token', folderToken);
    else args.push('--parent-position', 'my_library');
    const doc = normalizeCliObject(runLarkCli(args), 'docx');
    if (!doc.token) throw new Error('lark-cli create docx returned no document_id');
    return { success: true, token: doc.token, document_id: doc.token, url: doc.url || cliUrl('docx', doc.token) };
  }
  const resp = await feishuApi('POST', '/docx/v1/documents', {
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify({ title: safeTitle, folder_token: folderToken || '' }),
  });
  if (resp.data.code !== 0) throw new Error(`create docx failed (${resp.data.code}): ${resp.data.msg || JSON.stringify(resp.data)}`);
  const doc = resp.data.data?.document || resp.data.data;
  const token = doc?.document_id || doc?.token || doc?.obj_token;
  return { success: true, token, document_id: token, url: token ? `https://my.feishu.cn/docx/${token}` : '' };
}

export async function addDocxTextBlocks(documentId, texts) {
  const filtered = texts.filter(Boolean).map(text => String(text));
  if (filtered.length === 0) return { success: true };
  if (backend === 'lark-cli') {
    const content = filtered.map(text => `<p>${escapeXmlText(text)}</p>`).join('');
    const data = runLarkCli(['docs', '+update', '--doc', documentId, '--command', 'append', '--content', content]);
    return { success: true, data };
  }
  const children = filtered.map(content => ({
    block_type: 2,
    text: { elements: [{ text_run: { content } }], style: {} },
  }));
  const resp = await feishuApi('POST', `/docx/v1/documents/${documentId}/blocks/${documentId}/children?document_revision_id=-1`, {
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify({ index: -1, children: children.slice(0, 50) }),
  });
  if (resp.data.code !== 0) throw new Error(`add docx text blocks failed (${resp.data.code}): ${resp.data.msg || JSON.stringify(resp.data)}`);
  return { success: true, data: resp.data.data };
}
