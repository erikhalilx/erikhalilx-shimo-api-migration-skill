#!/usr/bin/env node
/**
 * fallback_migrate.mjs — type-specific Feishu docx fallback.
 *
 * The fallback document always includes the original Shimo link and failure reason.
 * For document-like files it tries to export/upload a PDF reference.
 * For mindmap/sheet/other files it captures a screenshot and uploads it as a cloud file reference.
 */

import fs from 'fs';
import path from 'path';
import { createDocxDocument, addDocxTextBlocks, uploadFile, sanitizeName } from './feishu_upload.mjs';
import { exportFile } from './exporter.mjs';

function shimoUrl(guid) {
  return guid ? `https://shimo.im/docs/${guid}` : '';
}

function isDocumentLike(type) {
  return ['newdoc', 'modoc', 'document', 'doc', 'docs'].includes(String(type || '').toLowerCase());
}

function screenshotExtension() { return 'png'; }

async function captureScreenshot({ page, guid, name, outputDir }) {
  const safeName = sanitizeName(name);
  const filePath = path.join(outputDir, `${safeName}_${guid}_fallback.png`);
  const url = shimoUrl(guid);
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(5000);
  await page.screenshot({ path: filePath, fullPage: true });
  return filePath;
}

export async function runFallbackMigration({ task, page, context, folderToken, outputDir, classification, failureReason }) {
  fs.mkdirSync(outputDir, { recursive: true });
  const normalizedType = task.fileType || task.type;
  const originalUrl = task.shimo_url || shimoUrl(task.guid);
  const title = `Fallback - ${task.name}`;
  const doc = await createDocxDocument({ title, folderToken });
  const lines = [
    `Fallback migration for: ${task.name}`,
    `Source type: ${normalizedType}`,
    `Original Shimo link: ${originalUrl}`,
    `Failure classification: ${classification?.category || 'unknown'}`,
    `Failure reason: ${classification?.reason || failureReason || 'not available'}`,
    'Note: This fallback preserves readable content/reference but may not preserve original editability.',
  ];

  const artifacts = [];
  if (isDocumentLike(normalizedType)) {
    const pdfResult = await exportFile({
      page,
      context,
      guid: task.guid,
      fileType: normalizedType,
      name: task.name,
      outputDir,
      format: 'pdf',
      fileSize: task.size,
    });
    if (pdfResult.success) {
      const uploaded = await uploadFile({
        filePath: pdfResult.filePath,
        folderToken,
        name: `${task.name} fallback PDF`,
        fileExtension: 'pdf',
        objType: null,
        mimeType: 'application/pdf',
      });
      if (uploaded.success) {
        artifacts.push({ type: 'pdf', token: uploaded.token, url: uploaded.url, method: uploaded.method });
        lines.push(`Fallback PDF uploaded: ${uploaded.url}`);
      } else {
        lines.push(`Fallback PDF upload failed: ${uploaded.error}`);
      }
    } else {
      lines.push(`PDF fallback export failed: ${pdfResult.error}`);
    }
  } else {
    try {
      const shotPath = await captureScreenshot({ page, guid: task.guid, name: task.name, outputDir });
      const uploaded = await uploadFile({
        filePath: shotPath,
        folderToken,
        name: `${task.name} fallback screenshot`,
        fileExtension: screenshotExtension(),
        objType: null,
        mimeType: 'image/png',
      });
      if (uploaded.success) {
        artifacts.push({ type: 'screenshot', token: uploaded.token, url: uploaded.url, method: uploaded.method });
        lines.push(`Fallback screenshot uploaded: ${uploaded.url}`);
      } else {
        lines.push(`Fallback screenshot upload failed: ${uploaded.error}`);
      }
    } catch (e) {
      lines.push(`Fallback screenshot failed: ${e.message}`);
    }
  }

  await addDocxTextBlocks(doc.document_id, lines);
  return {
    success: true,
    token: doc.token,
    url: doc.url,
    method: 'fallback_docx',
    artifacts,
    classification,
  };
}
