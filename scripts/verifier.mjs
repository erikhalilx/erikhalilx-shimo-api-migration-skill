/**
 * verifier.mjs — 中途验证模块
 *
 * 在每个文件上传后验证：
 *   1. 导出文件存在且大小 > 0
 *   2. 导出文件格式合法（zip 结构 / magic bytes）
 *   3. 飞书文件已创建（file_token 存在）
 *   4. 飞书文件可访问（可选，查询 metadata）
 */

import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import { getDocxMeta, getFileMeta, getSheetMeta } from './feishu_upload.mjs';

// ===== VERIFY EXPORT FILE =====
/**
 * 验证导出的本地文件
 * @param {string} filePath - 本地文件路径
 * @param {string} format - 文件格式 (xlsx/docx/xmind/pptx/pdf/jpg/md)
 * @returns {Object} { valid, errors, fileSize, details }
 */
export function verifyExportFile(filePath, format) {
  const errors = [];

  // 1. File exists
  if (!fs.existsSync(filePath)) {
    return { valid: false, errors: ['文件不存在'], fileSize: 0 };
  }

  const stat = fs.statSync(filePath);
  const fileSize = stat.size;

  // 2. Size > 0
  if (fileSize === 0) {
    return { valid: false, errors: ['文件大小为 0'], fileSize: 0 };
  }

  // 3. Format-specific validation
  const formatErrors = validateFormat(filePath, format);
  errors.push(...formatErrors);

  return {
    valid: errors.length === 0,
    errors,
    fileSize,
    details: getFormatDetails(filePath, format),
  };
}

// ===== FORMAT VALIDATION =====
function validateFormat(filePath, format) {
  const errors = [];
  const ext = path.extname(filePath).toLowerCase().replace('.', '');

  // Extension check
  if (ext !== format && !(format === 'md' && ext === 'md')) {
    // Allow mismatch for some edge cases but warn
  }

  switch (format) {
    case 'xlsx':
    case 'docx':
    case 'pptx':
    case 'xmind':
      // ZIP-based formats
      return validateZip(filePath, format);

    case 'jpg':
    case 'jpeg':
      return validateImage(filePath, 'jpg');

    case 'png':
      return validateImage(filePath, 'png');

    case 'pdf':
      return validatePdf(filePath);

    case 'md':
      // Markdown is plain text, just check non-empty
      if (fileSize < 10) errors.push('Markdown 文件过小，可能为空');
      return errors;

    default:
      return errors;
  }
}

// ===== ZIP VALIDATION =====
function validateZip(filePath, expectedType) {
  const errors = [];

  try {
    const check = execSync(`unzip -l "${filePath}" 2>&1`, {
      encoding: 'utf8',
      timeout: 10000,
    });

    // Check if it's actually HTML (error page)
    if (check.includes('<!DOCTYPE') || check.includes('<html')) {
      errors.push('文件内容是 HTML，可能是错误页面');
      return errors;
    }

    // Type-specific structure check
    switch (expectedType) {
      case 'xlsx':
        if (!check.includes('xl/worksheets/')) {
          errors.push('xlsx 缺少 xl/worksheets/ 目录');
        }
        break;
      case 'docx':
        if (!check.includes('word/document.xml') && !check.includes('[Content_Types].xml')) {
          errors.push('docx 缺少 word/document.xml');
        }
        break;
      case 'pptx':
        if (!check.includes('ppt/slides/')) {
          errors.push('pptx 缺少 ppt/slides/ 目录');
        }
        break;
      case 'xmind':
        if (!check.includes('content.xml') && !check.includes('content.json') && !check.includes('META-INF/')) {
          errors.push('xmind 缺少核心内容文件');
        }
        break;
    }
  } catch (e) {
    // unzip not available or file is not a valid zip
    // Check magic bytes instead
    const buf = fs.readFileSync(filePath);
    if (buf[0] !== 0x50 || buf[1] !== 0x4B) { // PK magic
      errors.push(`非 ZIP 格式（magic bytes 检查失败）: ${expectedType}`);
    }
  }

  return errors;
}

// ===== IMAGE VALIDATION =====
function validateImage(filePath, type) {
  const errors = [];
  const buf = fs.readFileSync(filePath);

  if (type === 'jpg' || type === 'jpeg') {
    if (buf[0] !== 0xFF || buf[1] !== 0xD8) {
      errors.push('非 JPEG 文件（magic bytes 检查失败）');
    }
  } else if (type === 'png') {
    if (buf[0] !== 0x89 || buf[1] !== 0x50 || buf[2] !== 0x4E || buf[3] !== 0x47) {
      errors.push('非 PNG 文件（magic bytes 检查失败）');
    }
  }

  return errors;
}

// ===== PDF VALIDATION =====
function validatePdf(filePath) {
  const errors = [];
  const buf = fs.readFileSync(filePath, { start: 0, end: 5 });

  if (!buf.toString('ascii').startsWith('%PDF')) {
    errors.push('非 PDF 文件（magic bytes 检查失败）');
  }

  return errors;
}

// ===== GET FORMAT DETAILS =====
function getFormatDetails(filePath, format) {
  const details = {};

  try {
    if (['xlsx', 'docx', 'pptx', 'xmind'].includes(format)) {
      const check = execSync(`unzip -l "${filePath}" 2>&1`, {
        encoding: 'utf8',
        timeout: 10000,
      });

      if (format === 'xlsx') {
        const sheetCount = check.split('\n').filter(l => /xl\/worksheets\/sheet\d+\.xml/.test(l)).length;
        details.sheetCount = sheetCount;
      }
    }
  } catch {}

  return details;
}

// ===== VERIFY FEISHU UPLOAD =====
/**
 * 验证飞书上传是否成功
 * @param {string} fileToken - 飞书文件 token
 * @param {boolean} skipRemoteCheck - 跳过远程检查（默认 false）
 * @returns {Object} { valid, error, meta }
 */
export async function verifyFeishuUpload(fileToken, skipRemoteCheck = false, tokenType = 'file') {
  if (!fileToken) {
    return { valid: false, error: 'file_token 为空' };
  }

  if (skipRemoteCheck) {
    return { valid: true, note: '跳过远程检查' };
  }

  let metaResult;
  if (tokenType === 'docx') {
    metaResult = await getDocxMeta(fileToken);
  } else if (tokenType === 'sheet') {
    metaResult = await getSheetMeta(fileToken);
  } else {
    metaResult = await getFileMeta(fileToken);
  }

  if (!metaResult.success) {
    return { valid: false, error: metaResult.error };
  }

  return { valid: true, meta: metaResult.meta, tokenType };
}

// ===== FULL VERIFICATION =====
/**
 * 完整验证：导出文件 + 飞书上传
 * @param {Object} opts
 * @param {string} opts.filePath - 本地导出文件路径
 * @param {string} opts.format - 文件格式
 * @param {string} opts.feishuToken - 飞书文件 token
 * @param {boolean} [opts.skipRemoteCheck] - 跳过远程检查
 * @returns {Object} { exportValid, uploadValid, errors, details }
 */
export async function verifyTask({ filePath, format, feishuToken, skipRemoteCheck, feishuTokenType = 'file' }) {
  const exportResult = verifyExportFile(filePath, format);
  const uploadResult = await verifyFeishuUpload(feishuToken, skipRemoteCheck, feishuTokenType);

  return {
    exportValid: exportResult.valid,
    uploadValid: uploadResult.valid,
    errors: [...exportResult.errors, uploadResult.error].filter(Boolean),
    details: {
      exportSize: exportResult.fileSize,
      exportDetails: exportResult.details,
      feishuMeta: uploadResult.meta,
    },
  };
}
