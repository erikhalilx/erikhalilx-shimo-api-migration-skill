#!/usr/bin/env node
/**
 * report.mjs — generate migration reports with redacted tokens by default.
 */

import fs from 'fs';
import path from 'path';
import { StateManager } from './state.mjs';

export async function generateReport(outputDir, options = {}) {
  const state = StateManager.load(outputDir);
  if (!state) {
    console.log('⚠️ No state file, skipping report generation');
    return;
  }
  const tasks = state.tasks;
  const summary = state.summary;
  const byType = groupBy(tasks, t => t.type || 'unknown');
  const bySpace = groupBy(tasks, t => firstPathPart(t.shimo_path) || 'unknown');
  const byError = {};
  for (const t of tasks) if (t.error?.category) byError[t.error.category] = (byError[t.error.category] || 0) + 1;
  const totalSize = tasks.reduce((sum, t) => sum + (t.file_size || 0), 0);
  const successSize = tasks.filter(t => t.status === 'success').reduce((sum, t) => sum + (t.file_size || 0), 0);
  const retryCandidates = tasks.filter(t => t.status === 'failed' || t.status === 'verification_failed');
  const fallbackCandidates = tasks.filter(t => t.status === 'fallback_candidate');
  const md = generateMarkdown({ summary, byType, bySpace, byError, tasks, retryCandidates, fallbackCandidates, totalSize, successSize, runId: state.runId, showTokens: options.showTokens });
  const json = {
    run_id: state.runId,
    generated_at: new Date().toISOString(),
    summary,
    by_type: statsObject(byType),
    by_space: statsObject(bySpace),
    by_error: byError,
    total_size_bytes: totalSize,
    success_size_bytes: successSize,
    retry_candidates: retryCandidates.map(candidateRecord),
    fallback_candidates: fallbackCandidates.map(candidateRecord),
    tasks: tasks.map(t => ({
      task_id: t.task_id,
      status: t.status,
      type: t.type,
      name: t.name,
      shimo_url: t.shimo_url,
      shimo_path: t.shimo_path,
      feishu_path: t.feishu_path,
      feishu_token: options.showTokens ? t.feishu_token : redact(t.feishu_token),
      feishu_url: options.showTokens ? t.feishu_url : redactFeishuUrl(t.feishu_url),
      export_method: t.export_method,
      upload_method: t.upload_method,
      file_size: t.file_size,
      verification: options.showTokens ? t.verification : redactDeep(t.verification),
      failure_classification: t.failure_classification,
      action_required: t.action_required,
      fallback: options.showTokens ? t.fallback : redactDeep(t.fallback),
      error: t.error,
    })),
  };
  const mdPath = path.join(outputDir, 'migration_report.md');
  const jsonPath = path.join(outputDir, 'migration_report.json');
  const retryPath = path.join(outputDir, 'retry_candidates.json');
  const fallbackPath = path.join(outputDir, 'fallback_candidates.json');
  fs.writeFileSync(mdPath, md);
  fs.writeFileSync(jsonPath, JSON.stringify(json, null, 2));
  fs.writeFileSync(retryPath, JSON.stringify(retryCandidates.map(candidateRecord), null, 2));
  fs.writeFileSync(fallbackPath, JSON.stringify(fallbackCandidates.map(candidateRecord), null, 2));
  console.log(`\n📊 Reports generated:\n   ${mdPath}\n   ${jsonPath}\n   ${retryPath}\n   ${fallbackPath}`);
  return { mdPath, jsonPath, retryPath, fallbackPath };
}

function candidateRecord(t) {
  return {
    task_id: t.task_id,
    shimo_guid: t.shimo_guid,
    type: t.type,
    name: t.name,
    shimo_url: t.shimo_url,
    shimo_path: t.shimo_path,
    feishu_path: t.feishu_path,
    status: t.status,
    attempts: t.attempts,
    failure_classification: t.failure_classification,
    error: t.error,
    suggested_options: t.action_required?.options || ['retry', 'fallback', 'skip'],
  };
}

function groupBy(items, keyFn) {
  const out = {};
  for (const item of items) {
    const key = keyFn(item);
    if (!out[key]) out[key] = [];
    out[key].push(item);
  }
  return out;
}

function statsObject(groups) {
  const out = {};
  for (const [key, items] of Object.entries(groups)) out[key] = summarize(items);
  return out;
}

function summarize(items) {
  return {
    total: items.length,
    success: items.filter(t => t.status === 'success').length,
    failed: items.filter(t => t.status === 'failed').length,
    verification_failed: items.filter(t => t.status === 'verification_failed').length,
    fallback_candidate: items.filter(t => t.status === 'fallback_candidate').length,
    skipped: items.filter(t => t.status === 'skipped').length,
    fallback_success: items.filter(t => t.status === 'success' && t.export_method === 'fallback').length,
    size_bytes: items.reduce((sum, t) => sum + (t.file_size || 0), 0),
  };
}

function firstPathPart(p) {
  return String(p || '').split('/').filter(Boolean)[0] || '';
}

function redact(token) {
  if (!token) return '';
  const s = String(token);
  if (s.length <= 8) return '***';
  return `${s.slice(0, 4)}...${s.slice(-4)}`;
}

function redactFeishuUrl(url) {
  if (!url) return '';
  const s = String(url);
  return s.replace(/(my\.feishu\.cn\/(?:docx|sheets|drive\/file|drive\/folder)\/)([A-Za-z0-9_-]+)/g, (_, prefix, token) => `${prefix}${redact(token)}`);
}

function redactDeep(value) {
  if (value == null) return value;
  if (Array.isArray(value)) return value.map(redactDeep);
  if (typeof value === 'object') {
    const out = {};
    for (const [key, val] of Object.entries(value)) {
      if (/token|document_id|spreadsheet_token|file_token/i.test(key)) out[key] = redact(val);
      else if (/url/i.test(key) && typeof val === 'string') out[key] = redactFeishuUrl(val);
      else out[key] = redactDeep(val);
    }
    return out;
  }
  return value;
}

function esc(s) { return String(s || '').replace(/\|/g, '\\|').replace(/\n/g, ' '); }

function generateMarkdown({ summary, byType, bySpace, byError, tasks, retryCandidates, fallbackCandidates, successSize, runId, showTokens }) {
  const successRate = summary.total > 0 ? ((summary.success / summary.total) * 100).toFixed(1) : '0.0';
  const successTasks = tasks.filter(t => t.status === 'success');
  let md = `# Shimo to Feishu Migration Report\n\n`;
  md += `**Run ID**: ${runId}\n`;
  md += `**Generated at**: ${new Date().toISOString()}\n`;
  md += `**Token display**: ${showTokens ? 'full tokens shown by explicit option' : 'redacted by default'}\n\n`;
  md += `## Safety Notice\n\nThis tool is designed to be non-destructive: Shimo source files are read-only, and existing Feishu user files are not deleted or modified. The tool only creates new folders/files/docs in the selected destination.\n\n`;
  md += `## Summary\n\n| Metric | Value |\n|---|---:|\n`;
  md += `| Total tasks | ${summary.total} |\n| Success | ${summary.success} |\n| Fallback success | ${summary.fallback_success || 0} |\n| Retry candidates | ${retryCandidates.length} |\n| Fallback candidates awaiting decision | ${fallbackCandidates.length} |\n| Failed | ${summary.failed} |\n| Verification failed | ${summary.verification_failed} |\n| Skipped | ${summary.skipped} |\n| Success rate | ${successRate}% |\n| Successful migrated size | ${(successSize / 1024 / 1024).toFixed(1)} MB |\n`;

  md += `\n## By Type\n\n| Type | Total | Success | Fallback | Retry Candidates | Fallback Candidates | Verification Failed | Skipped | Size |\n|---|---:|---:|---:|---:|---:|---:|---:|---:|\n`;
  for (const [type, items] of Object.entries(byType)) {
    const s = summarize(items);
    md += `| ${esc(type)} | ${s.total} | ${s.success} | ${s.fallback_success} | ${s.failed} | ${s.fallback_candidate} | ${s.verification_failed} | ${s.skipped} | ${(s.size_bytes / 1024 / 1024).toFixed(1)} MB |\n`;
  }

  md += `\n## By Shimo Space\n\n| Space | Total | Success | Fallback | Retry Candidates | Fallback Candidates | Verification Failed | Skipped | Size |\n|---|---:|---:|---:|---:|---:|---:|---:|---:|\n`;
  for (const [space, items] of Object.entries(bySpace)) {
    const s = summarize(items);
    md += `| ${esc(space)} | ${s.total} | ${s.success} | ${s.fallback_success} | ${s.failed} | ${s.fallback_candidate} | ${s.verification_failed} | ${s.skipped} | ${(s.size_bytes / 1024 / 1024).toFixed(1)} MB |\n`;
  }

  if (Object.keys(byError).length > 0) {
    md += `\n## Error Categories\n\n| Category | Count |\n|---|---:|\n`;
    for (const [cat, count] of Object.entries(byError)) md += `| ${esc(cat)} | ${count} |\n`;
  }

  if (retryCandidates.length > 0 || fallbackCandidates.length > 0) {
    md += `\n## User Decision Required\n\nYou can handle failed files flexibly. You do not need to apply one strategy to all files. Pick any subset and choose one of these actions per subset:\n\n`;
    md += `- Retry: try API migration again for selected files.\n`;
    md += `- Fallback: create Feishu fallback docx for selected files.\n`;
    md += `- Skip: abandon migration for selected files.\n\n`;
    md += `Machine-readable lists are generated as \`retry_candidates.json\` and \`fallback_candidates.json\`. Edit/copy a subset before passing it to retry or fallback commands.\n`;
  }

  if (retryCandidates.length > 0) {
    md += `\n## Retry Candidates (${retryCandidates.length})\n\n| # | Type | Name | Shimo Link | Classification | Error |\n|---:|---|---|---|---|---|\n`;
    retryCandidates.forEach((t, i) => {
      md += `| ${i + 1} | ${esc(t.type)} | ${esc(t.name)} | ${esc(t.shimo_url)} | ${esc(t.failure_classification?.category || t.error?.category)} | ${esc((t.error?.message || '').slice(0, 160))} |\n`;
    });
  }

  if (fallbackCandidates.length > 0) {
    md += `\n## Fallback Candidates Awaiting User Decision (${fallbackCandidates.length})\n\n| # | Type | Name | Shimo Link | Classification | Suggested Options | Reason |\n|---:|---|---|---|---|---|---|\n`;
    fallbackCandidates.forEach((t, i) => {
      md += `| ${i + 1} | ${esc(t.type)} | ${esc(t.name)} | ${esc(t.shimo_url)} | ${esc(t.failure_classification?.category || t.error?.category)} | ${esc((t.action_required?.options || []).join('/'))} | ${esc(t.error?.reason || t.error?.message || '')} |\n`;
    });
  }

  if (successTasks.length > 0) {
    md += `\n## Successful Tasks (${successTasks.length})\n\n| # | Type | Name | Method | Size | Feishu Link |\n|---:|---|---|---|---:|---|\n`;
    successTasks.forEach((t, i) => {
      const feishuUrl = showTokens ? t.feishu_url : redactFeishuUrl(t.feishu_url);
      md += `| ${i + 1} | ${esc(t.type)} | ${esc(t.name)} | ${esc(t.export_method === 'fallback' ? 'fallback_docx' : t.upload_method)} | ${((t.file_size || 0) / 1024 / 1024).toFixed(1)} MB | ${esc(feishuUrl)} |\n`;
    });
  }

  md += `\n---\nGenerated by shimo-api-migration.\n`;
  return md;
}
