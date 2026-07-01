#!/usr/bin/env node
/**
 * failure_classifier.mjs — classify repeated API migration failures before fallback.
 */

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

export function classifyFailure(input = {}) {
  const message = String(input.error?.message || input.message || input.error || '').toLowerCase();
  const observable = input.observable_export || input.observable || input.export_observable || {};
  const samples = observable.progress_samples || observable.progressSamples || [];

  if (message.includes('unsupported') || message.includes('not supported') || message.includes('不支持')) {
    return result(FAILURE_CLASSES.UNSUPPORTED_TYPE, false, 'The file type has no supported Shimo API export format.');
  }
  if (message.includes('no taskid') || message.includes('no task id') || message.includes('taskid') && message.includes('response')) {
    return result(FAILURE_CLASSES.API_TASK_NOT_CREATED, true, 'Export API did not return a usable taskId.');
  }
  if (message.includes('download http 404') || message.includes('http 404') || message.includes('404')) {
    return result(FAILURE_CLASSES.API_DOWNLOAD_404, true, 'Download URL repeatedly returned HTTP 404.');
  }
  if (message.includes('context') || message.includes('browser') || message.includes('failed to fetch') || message.includes('network') || message.includes('econn')) {
    return result(FAILURE_CLASSES.API_NETWORK_OR_CONTEXT_FAILED, true, 'Browser context or network failed after retry.');
  }
  if (message.includes('upload') || message.includes('import task')) {
    return result(FAILURE_CLASSES.UPLOAD_FAILED, true, 'Feishu upload or import failed.');
  }
  if (message.includes('verification') || message.includes('verify') || message.includes('验证')) {
    return result(FAILURE_CLASSES.VERIFICATION_FAILED, true, 'Local or remote verification failed.');
  }
  if (message.includes('timeout') || message.includes('export timeout')) {
    const stalled = samples.length > 0 && samples.every(s => {
      const data = s.data || s;
      const progress = Number(data.progress || 0);
      const fileSize = Number(data.fileSize || data.file_size || 0);
      const costTime = Number(data.costTime || data.cost_time || 0);
      const downloadUrl = data.downloadUrl || data.download_url || '';
      return progress === 0 && fileSize === 0 && costTime === 0 && !downloadUrl;
    });
    return result(stalled ? FAILURE_CLASSES.API_TASK_STALLED : FAILURE_CLASSES.API_NETWORK_OR_CONTEXT_FAILED, true, stalled ? 'Export task was created but progress stayed at 0 with no downloadUrl.' : 'Export timed out without enough stall evidence.');
  }
  if (observable.taskId && samples.length > 0) {
    const stalled = samples.every(s => {
      const data = s.data || s;
      return Number(data.progress || 0) === 0 && !(data.downloadUrl || data.download_url);
    });
    if (stalled) return result(FAILURE_CLASSES.API_TASK_STALLED, true, 'Export task was created but did not progress.');
  }
  return result(FAILURE_CLASSES.UNKNOWN, true, 'Failure could not be classified precisely.');
}

export function shouldFallback({ attempts = 0, classification, enabled = false }) {
  if (!enabled) return false;
  if (attempts < 2) return false;
  const cls = typeof classification === 'string' ? classification : classification?.category;
  return [
    FAILURE_CLASSES.API_TASK_NOT_CREATED,
    FAILURE_CLASSES.API_TASK_STALLED,
    FAILURE_CLASSES.API_DOWNLOAD_404,
    FAILURE_CLASSES.API_NETWORK_OR_CONTEXT_FAILED,
    FAILURE_CLASSES.UNSUPPORTED_TYPE,
  ].includes(cls);
}

function result(category, retryable, reason) {
  return { category, retryable, reason, fallback_recommended: !retryable || category !== FAILURE_CLASSES.UNKNOWN };
}
