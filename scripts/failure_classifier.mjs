#!/usr/bin/env node
/**
 * failure_classifier.mjs — classify API migration failures and decide whether
 * repeated evidence is strong enough to mark a file as unmigratable by API.
 */

import { getExportFormat } from './exporter.mjs';

export const FAILURE_CLASSES = {
  API_TASK_NOT_CREATED: 'api_task_not_created',
  API_TASK_STALLED: 'api_task_stalled',
  API_DOWNLOAD_404: 'api_download_404',
  API_NETWORK_OR_CONTEXT_FAILED: 'api_network_or_context_failed',
  UNSUPPORTED_TYPE: 'unsupported_type',
  UPLOAD_FAILED: 'upload_failed',
  VERIFICATION_FAILED: 'verification_failed',
  UNKNOWN: 'unknown_failure',
};

export function isZeroProgressEvidence(observable = {}) {
  const samples = observable.progress_samples || observable.progressSamples || [];
  if (!samples.length) return false;
  return samples.every(sample => {
    const data = sample.data || sample;
    return Number(data.progress || 0) === 0
      && Number(data.fileSize || data.file_size || 0) === 0
      && !(data.downloadUrl || data.download_url);
  });
}

export function classifyFailure(input = {}) {
  const message = String(input.error?.message || input.message || input.error || '').toLowerCase();
  const observable = input.observable_export || input.observable || input.export_observable || {};

  if (message.includes('unsupported') || message.includes('not supported') || message.includes('不支持')) {
    return result(FAILURE_CLASSES.UNSUPPORTED_TYPE, false, 'The file type has no supported Shimo API export format.');
  }
  if (message.includes('no taskid') || message.includes('no task id') || message.includes('taskid') && message.includes('response')) {
    return result(FAILURE_CLASSES.API_TASK_NOT_CREATED, true, 'Export API did not return a usable taskId.');
  }
  if (message.includes('download http 404') || message.includes('http 404') || message.includes('404')) {
    return result(FAILURE_CLASSES.API_DOWNLOAD_404, true, 'The generated download URL returned HTTP 404.');
  }
  if (message.includes('context') || message.includes('browser') || message.includes('failed to fetch') || message.includes('network') || message.includes('econn')) {
    return result(FAILURE_CLASSES.API_NETWORK_OR_CONTEXT_FAILED, true, 'Browser context or network failed.');
  }
  if (message.includes('upload') || message.includes('import task')) {
    return result(FAILURE_CLASSES.UPLOAD_FAILED, true, 'Feishu upload or import failed.');
  }
  if (message.includes('verification') || message.includes('verify') || message.includes('验证')) {
    return result(FAILURE_CLASSES.VERIFICATION_FAILED, true, 'Local or remote verification failed.');
  }
  if (message.includes('export stalled') || message.includes('zero progress')) {
    return result(FAILURE_CLASSES.API_TASK_STALLED, true, 'Export task stayed at zero progress with no fileSize or downloadUrl beyond the stall threshold.');
  }
  if (message.includes('timeout') || message.includes('export timeout')) {
    const stalled = Boolean(observable.taskId) && isZeroProgressEvidence(observable);
    return result(
      stalled ? FAILURE_CLASSES.API_TASK_STALLED : FAILURE_CLASSES.API_NETWORK_OR_CONTEXT_FAILED,
      true,
      stalled
        ? 'Export task was created but progress, fileSize, and downloadUrl stayed empty.'
        : 'Export timed out without enough repeated stall evidence.'
    );
  }
  if (observable.taskId && isZeroProgressEvidence(observable)) {
    return result(FAILURE_CLASSES.API_TASK_STALLED, true, 'Export task was created but did not produce progress, fileSize, or downloadUrl.');
  }
  return result(FAILURE_CLASSES.UNKNOWN, true, 'Failure could not be classified precisely.');
}

export function assessUnmigratable({ fileType, attemptHistory = [], classification = null } = {}) {
  const { supported } = getExportFormat(fileType);
  const category = typeof classification === 'string' ? classification : classification?.category;
  if (!supported || category === FAILURE_CLASSES.UNSUPPORTED_TYPE) {
    return {
      unmigratable: true,
      category: FAILURE_CLASSES.UNSUPPORTED_TYPE,
      reason: 'This Shimo file type is not supported by the current export API.',
      evidence: { known_unsupported_type: true, independent_task_ids: [] },
    };
  }

  const attempts = attemptHistory
    .map(entry => ({
      category: entry.failure_classification?.category || entry.error?.category || '',
      observable: entry.observable_export || {},
    }))
    .filter(entry => entry.category);

  const stalledTaskIds = unique(attempts
    .filter(entry => entry.observable.taskId && isZeroProgressEvidence(entry.observable))
    .map(entry => entry.observable.taskId));
  if (stalledTaskIds.length >= 2) {
    return {
      unmigratable: true,
      category: FAILURE_CLASSES.API_TASK_STALLED,
      reason: 'At least two independent export tasks stayed at zero progress with no fileSize or downloadUrl.',
      evidence: { known_unsupported_type: false, independent_task_ids: stalledTaskIds.slice(-2), required_independent_tasks: 2 },
    };
  }

  const notFoundTaskIds = unique(attempts
    .filter(entry => entry.category === FAILURE_CLASSES.API_DOWNLOAD_404)
    .filter(entry => entry.observable.taskId && Number(entry.observable.download_http_status) === 404 && entry.observable.download_url_present)
    .map(entry => entry.observable.taskId));
  if (notFoundTaskIds.length >= 2) {
    return {
      unmigratable: true,
      category: FAILURE_CLASSES.API_DOWNLOAD_404,
      reason: 'At least two independent completed exports produced download URLs that returned HTTP 404.',
      evidence: { known_unsupported_type: false, independent_task_ids: notFoundTaskIds.slice(-2), required_independent_tasks: 2 },
    };
  }

  return {
    unmigratable: false,
    category: category || FAILURE_CLASSES.UNKNOWN,
    reason: category === FAILURE_CLASSES.API_NETWORK_OR_CONTEXT_FAILED
      ? 'Network or browser-context failures are transient and must not be treated as permanent evidence.'
      : 'The available evidence does not yet prove that the Shimo API cannot migrate this file.',
    evidence: { known_unsupported_type: false, independent_task_ids: [] },
  };
}

export function shouldFallback({ fileType, attemptHistory = [], classification, enabled = false } = {}) {
  if (!enabled) return false;
  return assessUnmigratable({ fileType, attemptHistory, classification }).unmigratable;
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function result(category, retryable, reason) {
  return {
    category,
    retryable,
    reason,
    fallback_recommended: [
      FAILURE_CLASSES.API_TASK_STALLED,
      FAILURE_CLASSES.API_DOWNLOAD_404,
      FAILURE_CLASSES.UNSUPPORTED_TYPE,
    ].includes(category),
  };
}
