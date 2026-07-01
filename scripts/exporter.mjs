#!/usr/bin/env node
/**
 * exporter.mjs — Shimo internal export API module.
 */

import fs from 'fs';
import path from 'path';
import https from 'https';

export const EXPORT_SUPPORT_MATRIX = {
  newdoc: ['md', 'jpg', 'docx', 'pdf'],
  modoc: ['docx', 'wps', 'pdf'],
  mosheet: ['xlsx'],
  presentation: ['pptx', 'pdf'],
  mindmap: ['xmind', 'jpg'],
};

export const UNSUPPORTED_TYPES = ['table', 'board', 'form'];

export const FEISHU_IMPORT_MAP = {
  docx: { obj_type: 'docx', file_extension: 'docx', mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' },
  xlsx: { obj_type: 'sheet', file_extension: 'xlsx', mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' },
  pptx: { obj_type: null, file_extension: 'pptx', mime: 'application/vnd.openxmlformats-officedocument.presentationml.presentation' },
  xmind: { obj_type: null, file_extension: 'xmind', mime: 'application/zip' },
  jpg: { obj_type: null, file_extension: 'jpg', mime: 'image/jpeg' },
  png: { obj_type: null, file_extension: 'png', mime: 'image/png' },
  pdf: { obj_type: null, file_extension: 'pdf', mime: 'application/pdf' },
  md: { obj_type: 'docx', file_extension: 'md', mime: 'text/markdown' },
};

export function normalizeType(fileType) {
  if (!fileType) return null;
  const t = String(fileType).toLowerCase();
  if (EXPORT_SUPPORT_MATRIX[t]) return t;
  if (t === 'ppt' || t === 'pptx') return 'presentation';
  if (t === 'sheet') return 'mosheet';
  if (t === 'docs' || t === 'document' || t === 'doc') return 'newdoc';
  if (t === 'mindmaps' || t === 'mind') return 'mindmap';
  if (t.includes('sheet')) return 'mosheet';
  if (t.includes('ppt')) return 'presentation';
  if (t.includes('doc')) return 'newdoc';
  if (t.includes('mind')) return 'mindmap';
  return null;
}

export function getExportFormat(fileType) {
  const normalized = normalizeType(fileType);
  if (!normalized || UNSUPPORTED_TYPES.includes(normalized)) return { supported: false, format: null, normalizedType: normalized };
  const formats = EXPORT_SUPPORT_MATRIX[normalized];
  if (!formats?.length) return { supported: false, format: null, normalizedType: normalized };
  const priority = ['docx', 'xlsx', 'pptx', 'xmind', 'pdf', 'jpg', 'md', 'wps'];
  for (const fmt of priority) if (formats.includes(fmt)) return { supported: true, format: fmt, normalizedType: normalized };
  return { supported: true, format: formats[0], normalizedType: normalized };
}

function downloadFile(url, filePath, cookieStr, observable = {}) {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    const options = {
      hostname: urlObj.hostname,
      path: urlObj.pathname + urlObj.search,
      method: 'GET',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
        'Accept': '*/*',
        'Referer': 'https://shimo.im/',
        'Cookie': cookieStr || '',
      },
    };
    const req = https.request(options, (resp) => {
      observable.download_http_status = resp.statusCode;
      observable.download_content_length = resp.headers['content-length'] || null;
      if (resp.statusCode >= 300 && resp.statusCode < 400 && resp.headers.location) {
        downloadFile(resp.headers.location, filePath, cookieStr, observable).then(resolve).catch(reject);
        return;
      }
      if (resp.statusCode !== 200) {
        reject(new Error(`download HTTP ${resp.statusCode}`));
        return;
      }
      let downloaded = 0;
      const writeStream = fs.createWriteStream(filePath);
      resp.on('data', chunk => { downloaded += chunk.length; });
      resp.pipe(writeStream);
      writeStream.on('finish', () => resolve(downloaded));
      writeStream.on('error', err => {
        try { fs.rmSync(filePath, { force: true }); } catch {}
        reject(err);
      });
      resp.on('error', err => {
        try { fs.rmSync(filePath, { force: true }); } catch {}
        reject(err);
      });
    });
    req.on('error', reject);
    req.setTimeout(300000, () => { req.destroy(new Error('download timeout (5min)')); });
    req.end();
  });
}

export async function getCookieString(context) {
  const cookies = await context.cookies();
  return cookies.map(c => `${c.name}=${c.value}`).join('; ');
}

export async function exportFile({ page, context, guid, fileType, name, outputDir, format: forceFormat, fileSize, observe = false }) {
  const { supported, format, normalizedType } = getExportFormat(fileType);
  const observable = {
    guid,
    name,
    file_type: fileType,
    normalized_type: normalizedType,
    requested_format: forceFormat || format,
    started_at: new Date().toISOString(),
    progress_samples: [],
  };

  if (!supported && !forceFormat) {
    return { success: false, error: `unsupported type: ${fileType} (normalized: ${normalizedType})`, guid, name, format: null, observable_export: observable };
  }

  const exportFormat = forceFormat || format;
  const safeName = String(name).replace(/[\/\\:*?"<>|]/g, '_').trim();
  const fileName = `${safeName}_${guid}.${exportFormat}`;
  const filePath = path.join(outputDir, fileName);

  if (fs.existsSync(filePath)) {
    const stat = fs.statSync(filePath);
    if (stat.size > 100) return { success: true, skipped: true, filePath, fileSize: stat.size, format: exportFormat, guid, name, observable_export: observable };
  }

  try {
    const exportResult = await page.evaluate(async (params) => {
      const exportUrl = `/lizard-api/office-gw/files/export?fileGuid=${params.fileGuid}&type=${params.fmt}`;
      const resp = await fetch(exportUrl, { credentials: 'include' });
      const data = await resp.json().catch(() => null);
      return { status: resp.status, data };
    }, { fileGuid: guid, fmt: exportFormat });
    observable.export_http_status = exportResult.status;
    observable.export_response = exportResult.data;

    if (exportResult.status !== 200) return fail(`export API HTTP ${exportResult.status}: ${JSON.stringify(exportResult.data).slice(0, 300)}`);
    const taskId = exportResult.data?.data?.taskId || exportResult.data?.taskId;
    observable.taskId = taskId || null;
    if (!taskId) return fail(`no taskId in response: ${JSON.stringify(exportResult.data).slice(0, 300)}`);

    const exportTimeout = fileSize ? Math.min(1800000, Math.max(300000, fileSize * 0.5)) : 300000;
    observable.timeout_ms = exportTimeout;
    const maxPolls = Math.ceil(exportTimeout / 2000);
    let downloadUrl = null;

    for (let i = 0; i < maxPolls; i++) {
      await new Promise(r => setTimeout(r, 2000));
      const progressResult = await page.evaluate(async (tid) => {
        const resp = await fetch(`/lizard-api/office-gw/files/export/progress?taskId=${tid}`, { credentials: 'include' });
        const data = await resp.json().catch(() => null);
        return { status: resp.status, data };
      }, taskId);
      const data = progressResult.data?.data || progressResult.data || {};
      const sample = {
        at: new Date().toISOString(),
        http_status: progressResult.status,
        progress: data.progress || 0,
        downloadUrl: data.downloadUrl ? '[present]' : '',
        fileSize: data.fileSize || 0,
        costTime: data.costTime || 0,
        status: data.status || '',
      };
      observable.progress_samples.push(sample);
      if (observe && (i % 15 === 0 || sample.downloadUrl)) console.log(`      progress=${sample.progress || 0}, downloadUrl=${sample.downloadUrl || 'empty'}, fileSize=${sample.fileSize || 0}`);
      if (data.downloadUrl && data.downloadUrl.length > 10) {
        downloadUrl = data.downloadUrl;
        break;
      }
      if ((data.status === 'done' || data.status === 'completed') && data.downloadUrl) {
        downloadUrl = data.downloadUrl;
        break;
      }
      if (data.status === 'failed' || data.status === 'error') return fail(`export failed: ${JSON.stringify(data).slice(0, 300)}`);
    }

    if (!downloadUrl) return fail(`export timeout (${Math.round(exportTimeout / 60000)}min)`);
    observable.download_url_present = true;
    observable.download_url_host = new URL(downloadUrl).hostname;

    const cookieStr = await getCookieString(context);
    const downloadedSize = await downloadFile(downloadUrl, filePath, cookieStr, observable);
    observable.finished_at = new Date().toISOString();
    return { success: true, filePath, fileSize: downloadedSize, format: exportFormat, guid, name, observable_export: observable };
  } catch (e) {
    return fail(e.message);
  }

  function fail(message) {
    observable.finished_at = new Date().toISOString();
    return { success: false, error: message, guid, name, format: exportFormat, observable_export: observable };
  }
}
