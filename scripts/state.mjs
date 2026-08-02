#!/usr/bin/env node
/**
 * state.mjs — migration state management with atomic writes and attempt history.
 */

import fs from 'fs';
import path from 'path';
import { classifyFailure } from './failure_classifier.mjs';

export function classifyError(error) {
  const c = classifyFailure({ error });
  return { category: c.category, retryable: c.retryable, reason: c.reason };
}

export class StateManager {
  constructor(outputDir, runId) {
    this.outputDir = outputDir;
    this.statePath = path.join(outputDir, 'migration_state.json');
    this.runId = runId || formatTimestamp();
    this.tasks = [];
    this.summary = { total: 0, success: 0, failed: 0, skipped: 0, skipped_unmigratable: 0, unmigratable_total: 0, verification_failed: 0, fallback_candidate: 0, fallback_success: 0, processed: 0, normal_phase_complete: false, complete: false };
  }

  static load(outputDir) {
    const statePath = path.join(outputDir, 'migration_state.json');
    if (!fs.existsSync(statePath)) return null;
    const data = JSON.parse(fs.readFileSync(statePath, 'utf8'));
    const sm = new StateManager(outputDir, data.run_id);
    sm.tasks = data.tasks || [];
    sm.summary = data.summary || sm.summary;
    return sm;
  }

  recordTask(task) {
    const existingIdx = this.tasks.findIndex(t => t.task_id === task.task_id);
    const existing = existingIdx >= 0 ? this.tasks[existingIdx] : null;
    const classified = task.error ? (task.failure_classification || classifyError(task.error)) : (task.failure_classification || null);
    const previousAttempts = existing?.attempts || 0;
    const attempts = task.attempts || previousAttempts + 1;
    const attemptEntry = {
      attempt: attempts,
      status: task.status,
      error: task.error ? { message: task.error?.message || String(task.error) } : null,
      failure_classification: classified || null,
      observable_export: task.observable_export || null,
      finished_at: task.finished_at || new Date().toISOString(),
    };

    const entry = {
      task_id: task.task_id,
      status: task.status,
      attempts,
      type: task.type,
      name: task.name,
      shimo_guid: task.shimo_guid || task.guid || '',
      shimo_url: task.shimo_url || (task.shimo_guid || task.guid ? `https://shimo.im/docs/${task.shimo_guid || task.guid}` : ''),
      shimo_path: task.shimo_path || '',
      feishu_path: task.feishu_path || '',
      feishu_token: task.feishu_token || null,
      feishu_url: task.feishu_url || '',
      export_method: task.export_method || 'api',
      upload_method: task.upload_method || '',
      file_size: task.file_size || 0,
      verification: task.verification || null,
      failure_classification: task.error ? classified : task.failure_classification || null,
      observable_export: task.observable_export || null,
      fallback: task.fallback || null,
      unmigratable: task.unmigratable || existing?.unmigratable || null,
      error: task.error ? {
        category: classified?.category || 'unknown_failure',
        message: task.error?.message || String(task.error),
        retryable: classified?.retryable ?? true,
        reason: classified?.reason || '',
      } : null,
      action_required: task.action_required || null,
      attempt_history: [...(existing?.attempt_history || []), attemptEntry],
      started_at: task.started_at || existing?.started_at || new Date().toISOString(),
      finished_at: task.finished_at || new Date().toISOString(),
    };

    if (existingIdx >= 0) this.tasks[existingIdx] = entry;
    else this.tasks.push(entry);
    this.updateSummary();
  }

  updateSummary() {
    this.summary.total = this.tasks.length;
    this.summary.success = this.tasks.filter(t => t.status === 'success').length;
    this.summary.failed = this.tasks.filter(t => t.status === 'failed').length;
    this.summary.skipped = this.tasks.filter(t => t.status === 'skipped' || t.status === 'skipped_unmigratable').length;
    this.summary.skipped_unmigratable = this.tasks.filter(t => t.status === 'skipped_unmigratable').length;
    this.summary.unmigratable_total = this.tasks.filter(t => t.status === 'skipped_unmigratable' || t.unmigratable || (t.export_method === 'fallback' && t.failure_classification)).length;
    this.summary.verification_failed = this.tasks.filter(t => t.status === 'verification_failed').length;
    this.summary.fallback_candidate = this.tasks.filter(t => t.status === 'fallback_candidate').length;
    this.summary.fallback_success = this.tasks.filter(t => t.status === 'success' && t.export_method === 'fallback').length;
    this.summary.processed = this.tasks.filter(t => ['success', 'skipped', 'skipped_unmigratable'].includes(t.status)).length;
    this.summary.normal_phase_complete = this.summary.total > 0 && this.summary.processed + this.summary.fallback_candidate === this.summary.total;
    this.summary.complete = this.summary.total > 0
      && this.summary.processed === this.summary.total
      && this.summary.failed === 0
      && this.summary.verification_failed === 0
      && this.summary.fallback_candidate === 0;
  }

  async save() {
    const data = {
      run_id: this.runId,
      started_at: this.tasks[0]?.started_at || new Date().toISOString(),
      updated_at: new Date().toISOString(),
      summary: this.summary,
      tasks: this.tasks,
    };
    fs.mkdirSync(this.outputDir, { recursive: true });
    const tmpPath = path.join(this.outputDir, '.migration_state.tmp.json');
    fs.writeFileSync(tmpPath, JSON.stringify(data, null, 2));
    fs.renameSync(tmpPath, this.statePath);
  }

  getFailedTasks() {
    return this.tasks.filter(t => ['failed', 'verification_failed', 'fallback_candidate'].includes(t.status));
  }

  getRetryableFailedTasks() {
    return this.tasks.filter(t => ['failed', 'verification_failed'].includes(t.status));
  }

  getFallbackCandidates() {
    return this.tasks.filter(t => t.status === 'fallback_candidate');
  }

  getUnmigratableTasks() {
    return this.tasks.filter(t => t.status === 'skipped_unmigratable');
  }

  getCompletedGuids() {
    return new Set(this.tasks
      .filter(t => ['success', 'skipped', 'skipped_unmigratable'].includes(t.status))
      .map(t => t.shimo_guid || t.task_id));
  }

  getTaskByGuid(guid) {
    return this.tasks.find(t => t.shimo_guid === guid || t.task_id === guid);
  }
}

function formatTimestamp() {
  const d = new Date();
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}_${String(d.getHours()).padStart(2, '0')}${String(d.getMinutes()).padStart(2, '0')}`;
}
