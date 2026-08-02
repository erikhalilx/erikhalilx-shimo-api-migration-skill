#!/usr/bin/env node
/**
 * fallback_migrate.mjs — type-specific Feishu docx fallback.
 *
 * Every successful fallback includes the original Shimo link and at least one
 * readable reference artifact (PDF or screenshot). A metadata-only docx is
 * returned as a failure, not as fallback success.
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

async function captureScreenshot({ page, guid, shimoUrl: sourceUrl, name, outputDir }) {
  const safeName = sanitizeName(name);
  const filePath = path.join(outputDir, `${safeName}_${guid}_fallback.png`);
  const url = sourceUrl || shimoUrl(guid);
  if (!url) throw new Error('No usable Shimo source URL for screenshot fallback.');
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(5000);
  await page.screenshot({ path: filePath, fullPage: true });
  const stat = fs.statSync(filePath);
  if (stat.size <= 100) throw new Error('Fallback screenshot is empty or invalid.');
  return filePath;
}

async function uploadScreenshot({ task, page, folderToken, outputDir, lines, artifacts }) {
  try {
    const shotPath = await captureScreenshot({
      page,
      guid: task.guid,
      shimoUrl: task.shimo_url,
      name: task.name,
      outputDir,
    });
    const uploaded = await uploadFile({
      filePath: shotPath,
      folderToken,
      name: `${task.name} fallback screenshot`,
      fileExtension: 'png',
      objType: null,
      mimeType: 'image/png',
    });
    if (!uploaded.success) {
      lines.push(`Fallback screenshot upload failed: ${uploaded.error}`);
      return false;
    }
    artifacts.push({ type: 'screenshot', token: uploaded.token, url: uploaded.url, method: uploaded.method });
    lines.push(`Fallback screenshot uploaded: ${uploaded.url}`);
    return true;
  } catch (error) {
    lines.push(`Fallback screenshot failed: ${error.message}`);
    return false;
  }
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
    if (artifacts.length === 0) {
      lines.push('PDF fallback was unavailable; attempting screenshot fallback.');
      await uploadScreenshot({ task, page, folderToken, outputDir, lines, artifacts });
    }
  } else {
    await uploadScreenshot({ task, page, folderToken, outputDir, lines, artifacts });
  }

  await addDocxTextBlocks(doc.document_id, lines);
  if (artifacts.length === 0) {
    return {
      success: false,
      error: 'Fallback docx was created, but no readable PDF or screenshot reference could be uploaded.',
      token: doc.token,
      url: doc.url,
      method: 'fallback_docx_incomplete',
      artifacts,
      classification,
    };
  }
  return {
    success: true,
    token: doc.token,
    url: doc.url,
    method: 'fallback_docx',
    artifacts,
    classification,
  };
}
