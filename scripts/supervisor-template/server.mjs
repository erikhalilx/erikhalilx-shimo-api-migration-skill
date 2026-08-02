#!/usr/bin/env node
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const host = '127.0.0.1';
const port = Number(process.env.PORT || 4173);
const trackerDir = path.dirname(fileURLToPath(import.meta.url));
const config = JSON.parse(fs.readFileSync(path.join(trackerDir, 'supervisor.config.json'), 'utf8'));
const migrationDir = path.resolve(config.migration_dir);
const statePath = path.join(migrationDir, 'migration_state.json');
const runtimeStatusPath = path.join(migrationDir, 'migration-runtime-status.json');
const runtimeLogPath = path.join(migrationDir, 'migration-runtime.log');
const runnerPath = path.resolve(config.runner_path);
const indexPath = path.join(trackerDir, 'index.html');
let managedChild = null;

function nowIso() { return new Date().toISOString(); }
function readJson(filePath, fallback = null) { try { return JSON.parse(fs.readFileSync(filePath, 'utf8')); } catch { return fallback; } }
function isPidAlive(pid) { try { process.kill(Number(pid), 0); return Number(pid) > 0; } catch { return false; } }
function cleanLine(line) { return String(line || '').replace(/\u001b\[[0-9;]*m/g, '').trim(); }
function tailText(filePath, maxBytes = 96 * 1024) {
  try {
    const stat = fs.statSync(filePath);
    const length = Math.min(stat.size, maxBytes);
    const fd = fs.openSync(filePath, 'r');
    try { const buffer = Buffer.alloc(length); fs.readSync(fd, buffer, 0, length, stat.size - length); return buffer.toString('utf8'); }
    finally { fs.closeSync(fd); }
  } catch { return ''; }
}
function parseRuntimeLog() {
  const lines = tailText(runtimeLogPath).split(/\r?\n/).map(cleanLine).filter(Boolean);
  return {
    currentTask: [...lines].reverse().find(line => /^\[\d+\/\d+\]|^\s*\[\d+\/\d+\] Fallback:/.test(line)) || '',
    exportAttempt: [...lines].reverse().find(line => /^Exporting .* attempt \d+\/\d+/.test(line)) || '',
    phase: [...lines].reverse().find(line => /^(\d+\.|Exporting|progress=|✅ Exported|✅ Uploaded|Fallback:|Normal migration phase)/.test(line)) || '',
    error: [...lines].reverse().find(line => /Fatal:|❌|failed|ECONN|timeout|Failed to fetch/i.test(line)) || '',
    activityAt: (() => { try { return fs.statSync(runtimeLogPath).mtime.toISOString(); } catch { return null; } })(),
  };
}
function statusLabel(status) {
  return { running: '迁移运行中', running_long_operation: '迁移运行中：正在处理大文件或兜底文件', completed: '迁移已完成', pending: '正常迁移已完成：仍有待处理项', failed: '迁移失败', interrupted: '迁移意外中断', stopped: '迁移未运行' }[status] || status;
}
function readProgress() {
  const state = readJson(statePath, {});
  const summary = state.summary || {};
  const runtime = readJson(runtimeStatusPath, {});
  const log = parseRuntimeLog();
  const tasks = state.tasks || [];
  const total = Number(summary.total || tasks.length || config.total_files || 0);
  const fallbackSuccess = Number(summary.fallback_success || 0);
  const success = Number(summary.success || 0);
  const normalSuccess = Math.max(success - fallbackSuccess, 0);
  const skippedUnmigratable = Number(summary.unmigratable_total || summary.skipped_unmigratable || tasks.filter(t => t.status === 'skipped_unmigratable' || t.unmigratable || (t.export_method === 'fallback' && t.failure_classification)).length);
  const fallbackCandidate = Number(summary.fallback_candidate || 0);
  const failed = Number(summary.failed || 0) + Number(summary.verification_failed || 0);
  const currentlySkippedUnmigratable = Number(summary.skipped_unmigratable || tasks.filter(t => t.status === 'skipped_unmigratable').length);
  const explicitlySkipped = Math.max(Number(summary.skipped || 0) - currentlySkippedUnmigratable, 0);
  const processed = normalSuccess + fallbackSuccess + currentlySkippedUnmigratable + explicitlySkipped;
  const remaining = Math.max(total - processed, 0);
  const percent = total > 0 ? Number(((processed / total) * 100).toFixed(1)) : 0;
  const migrationPid = Number(runtime.pid || managedChild?.pid || 0) || null;
  const processAlive = isPidAlive(migrationPid);
  const activityAt = log.activityAt || runtime.started_at || state.updated_at || null;
  const activityAgeMs = activityAt ? Math.max(Date.now() - new Date(activityAt).getTime(), 0) : null;
  const complete = Boolean(summary.complete) || (total > 0 && processed === total && failed === 0 && fallbackCandidate === 0);
  let status = 'stopped';
  let reason = '当前没有迁移进程。';
  if (processAlive) {
    status = activityAgeMs !== null && activityAgeMs > 5 * 60 * 1000 ? 'running_long_operation' : 'running';
    reason = status === 'running' ? '迁移进程正在运行。' : '迁移进程仍存活，正在执行长时间导出、下载、上传或兜底操作。';
  } else if (complete) {
    status = 'completed'; reason = '所有文件均已正常迁移、兜底迁移或明确跳过。';
  } else if (runtime.status === 'exited' && Number(runtime.exit_code) !== 0) {
    status = 'failed'; reason = runtime.error || log.error || `迁移进程退出，退出码 ${runtime.exit_code ?? '未知'}`;
  } else if (runtime.status === 'running') {
    status = 'interrupted'; reason = log.error || '迁移进程已消失，可安全断点续跑。';
  } else if (Boolean(summary.normal_phase_complete)) {
    status = 'pending'; reason = `${remaining + fallbackCandidate + failed} 个文件仍需重试、兜底或明确跳过。`;
  }
  return {
    total, normalSuccess, fallbackSuccess, skippedUnmigratable, explicitlySkipped, failed, fallbackCandidate,
    processed, remaining, percent, complete, updatedAt: state.updated_at || null,
    status, statusLabel: statusLabel(status), reason, migrationPid, processAlive,
    currentTask: log.currentTask, exportAttempt: log.exportAttempt, phase: log.phase,
    lastActivityAt: activityAt, activityAgeSeconds: activityAgeMs == null ? null : Math.round(activityAgeMs / 1000),
    canRestart: !processAlive && !complete,
    unmigratableFiles: tasks.filter(t => t.status === 'skipped_unmigratable' || t.unmigratable || (t.export_method === 'fallback' && t.failure_classification)).map(t => ({ name: t.name, type: t.type, path: t.shimo_path, reason: t.unmigratable?.reason || t.failure_classification?.reason || t.error?.reason || t.error?.message || '', shimoUrl: t.shimo_url, fallbackSuccess: t.status === 'success' && t.export_method === 'fallback' })),
    supervisor: { pid: process.pid, alive: true, checkedAt: nowIso() },
  };
}
function startMigration() {
  const current = readProgress();
  if (!current.canRestart) return { ok: false, statusCode: 409, error: current.processAlive ? '迁移已经在运行。' : '迁移已经完成。' };
  if (!fs.existsSync(runnerPath)) return { ok: false, statusCode: 500, error: '找不到断点续跑启动器。' };
  managedChild = spawn(config.node_bin || process.execPath, [runnerPath], { cwd: migrationDir, env: { ...process.env }, stdio: 'ignore' });
  managedChild.on('exit', () => { managedChild = null; });
  return { ok: true, statusCode: 202, pid: managedChild.pid, message: '已发起安全断点续跑。' };
}
function headers(type) { return { 'Content-Type': type, 'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type, X-Migration-Control' }; }
function sendJson(response, code, data) { response.writeHead(code, headers('application/json; charset=utf-8')); response.end(JSON.stringify(data)); }
const server = http.createServer((request, response) => {
  const url = new URL(request.url || '/', `http://${host}:${port}`);
  if (request.method === 'OPTIONS') { response.writeHead(204, headers('text/plain')); response.end(); return; }
  if (request.method === 'GET' && url.pathname === '/api/progress') { try { sendJson(response, 200, readProgress()); } catch (error) { sendJson(response, 500, { error: error.message }); } return; }
  if (request.method === 'POST' && url.pathname === '/api/restart') {
    if (request.headers['x-migration-control'] !== 'restart') { sendJson(response, 403, { error: '缺少本机重启确认头。' }); return; }
    const result = startMigration(); sendJson(response, result.statusCode, result); return;
  }
  if (request.method === 'GET' && (url.pathname === '/' || url.pathname === '/index.html')) { response.writeHead(200, headers('text/html; charset=utf-8')); fs.createReadStream(indexPath).pipe(response); return; }
  response.writeHead(404, headers('text/plain; charset=utf-8')); response.end('Not found');
});
server.listen(port, host, () => console.log(`Migration supervisor: http://${host}:${port}`));
