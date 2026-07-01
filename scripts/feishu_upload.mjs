#!/usr/bin/env node
/**
 * feishu_upload.mjs — Feishu upload/import/doc helper using OAuth user_access_token.
 */

import fs from 'fs';
import path from 'path';
import { getUserAccessToken, configureAuth } from './auth.mjs';

const BASE_URL = 'https://open.feishu.cn/open-apis';
const SMALL_FILE_LIMIT = 20 * 1024 * 1024;
const BLOCK_SIZE = 4 * 1024 * 1024;

let appId = null;
let appSecret = null;

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
export function sanitizeName(name) { return String(name || 'untitled').replace(/[\/\\:*?"<>|]/g, '_').trim() || 'untitled'; }

export function initFeishu(config) {
  appId = config.feishu?.app_id || config.app_id;
  appSecret = config.feishu?.app_secret || config.app_secret;
  if (!appId || !appSecret) throw new Error('Missing Feishu app credentials');
  if (config.cacheDir || config.cache_dir) configureAuth({ cacheDir: config.cacheDir || config.cache_dir });
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
  const resp = await feishuApi('GET', `/drive/v1/files/${encodeURIComponent(fileToken)}`);
  return resp.data.code === 0 ? { success: true, meta: resp.data.data } : { success: false, error: resp.data.msg || JSON.stringify(resp.data) };
}

export async function getDocxMeta(documentId) {
  const resp = await feishuApi('GET', `/docx/v1/documents/${encodeURIComponent(documentId)}`);
  return resp.data.code === 0 ? { success: true, meta: resp.data.data } : { success: false, error: resp.data.msg || JSON.stringify(resp.data) };
}

export async function getSheetMeta(spreadsheetToken) {
  const resp = await feishuApi('GET', `/sheets/v3/spreadsheets/${encodeURIComponent(spreadsheetToken)}`);
  return resp.data.code === 0 ? { success: true, meta: resp.data.data } : { success: false, error: resp.data.msg || JSON.stringify(resp.data) };
}

export async function listFolderChildren(folderToken = '') {
  const query = folderToken ? `?folder_token=${encodeURIComponent(folderToken)}&page_size=200` : '?page_size=200';
  const resp = await feishuApi('GET', `/drive/v1/files${query}`);
  return resp.data.code === 0 ? { success: true, files: resp.data.data?.files || [] } : { success: false, error: resp.data.msg || JSON.stringify(resp.data) };
}

export async function createFolder({ name, parentToken }) {
  const safeName = sanitizeName(name);
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
  const children = texts.filter(Boolean).map(content => ({
    block_type: 2,
    text: { elements: [{ text_run: { content: String(content) } }], style: {} },
  }));
  if (children.length === 0) return { success: true };
  const resp = await feishuApi('POST', `/docx/v1/documents/${documentId}/blocks/${documentId}/children?document_revision_id=-1`, {
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify({ index: -1, children: children.slice(0, 50) }),
  });
  if (resp.data.code !== 0) throw new Error(`add docx text blocks failed (${resp.data.code}): ${resp.data.msg || JSON.stringify(resp.data)}`);
  return { success: true, data: resp.data.data };
}
