#!/usr/bin/env node
import assert from 'node:assert/strict';
import { assessUnmigratable, classifyFailure, FAILURE_CLASSES, isZeroProgressEvidence } from './failure_classifier.mjs';

const stalled = taskId => ({
  status: 'failed',
  failure_classification: { category: FAILURE_CLASSES.API_TASK_STALLED },
  observable_export: {
    taskId,
    progress_samples: [
      { http_status: 200, progress: 0, fileSize: 0, downloadUrl: '', costTime: 50, status: 'processing' },
      { http_status: 400, progress: 0, fileSize: 0, downloadUrl: '', costTime: 90, status: 'queued' },
    ],
  },
});

assert.equal(isZeroProgressEvidence(stalled('a').observable_export), true);
assert.equal(classifyFailure({ error: 'export timeout', observable_export: stalled('a').observable_export }).category, FAILURE_CLASSES.API_TASK_STALLED);
assert.equal(assessUnmigratable({ fileType: 'table' }).unmigratable, true);
assert.equal(assessUnmigratable({ fileType: 'mosheet', attemptHistory: [stalled('a')] }).unmigratable, false);
assert.equal(assessUnmigratable({ fileType: 'mosheet', attemptHistory: [stalled('a'), stalled('b')] }).unmigratable, true);
assert.equal(assessUnmigratable({ fileType: 'mosheet', attemptHistory: [stalled('same'), stalled('same')] }).unmigratable, false);

const download404 = taskId => ({
  status: 'failed',
  failure_classification: { category: FAILURE_CLASSES.API_DOWNLOAD_404 },
  observable_export: { taskId, download_url_present: true, download_http_status: 404, progress_samples: [{ progress: 100, fileSize: 1000, downloadUrl: '[present]' }] },
});
assert.equal(assessUnmigratable({ fileType: 'newdoc', attemptHistory: [download404('a'), download404('b')] }).unmigratable, true);
assert.equal(assessUnmigratable({ fileType: 'newdoc', attemptHistory: [download404('same'), download404('same')] }).unmigratable, false);

const network = {
  status: 'failed',
  failure_classification: { category: FAILURE_CLASSES.API_NETWORK_OR_CONTEXT_FAILED },
  observable_export: {},
};
assert.equal(assessUnmigratable({ fileType: 'newdoc', attemptHistory: [network, network], classification: network.failure_classification }).unmigratable, false);
console.log('failure_classifier_test: all assertions passed');
