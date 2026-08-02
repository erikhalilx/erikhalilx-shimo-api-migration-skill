#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { StateManager } from './state.mjs';

const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), 'shimo-state-test-'));
try {
  const state = new StateManager(outputDir, 'test');
  state.recordTask({ task_id: 'a', shimo_guid: 'a', status: 'success', type: 'newdoc', name: 'A' });
  state.recordTask({ task_id: 'b', shimo_guid: 'b', status: 'skipped_unmigratable', type: 'table', name: 'B' });
  state.recordTask({ task_id: 'c', shimo_guid: 'c', status: 'fallback_candidate', type: 'newdoc', name: 'C' });
  assert.equal(state.summary.success, 1);
  assert.equal(state.summary.skipped_unmigratable, 1);
  assert.equal(state.summary.processed, 2);
  assert.equal(state.summary.normal_phase_complete, true);
  assert.equal(state.summary.complete, false);
  assert.deepEqual([...state.getCompletedGuids()].sort(), ['a', 'b']);
  assert.equal(state.getRetryableFailedTasks().length, 0);

  state.recordTask({ task_id: 'c', shimo_guid: 'c', status: 'success', type: 'newdoc', name: 'C', export_method: 'fallback' });
  assert.equal(state.summary.fallback_success, 1);
  assert.equal(state.summary.processed, 3);
  assert.equal(state.summary.complete, true);
  console.log('state_test: all assertions passed');
} finally {
  fs.rmSync(outputDir, { recursive: true, force: true });
}
