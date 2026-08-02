#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { scanShimoFiles } from './scan.mjs';

const testCwd = fs.mkdtempSync(path.join(os.tmpdir(), 'shimo-scan-regression-'));
process.chdir(testCwd);

const rootItems = [
  { id: 10, guid: 'folder-a', name: '项目A', isFolder: true, parentId: 0, teamId: 1 },
  { id: 11, guid: 'root-file', name: '根文件', type: 'newdoc', parentId: 0, teamId: 1 },
  { id: 12, guid: 'shortcut-file', name: '快捷方式', type: 'shortcut', parentId: 0, isShortcut: true },
  { id: 13, guid: 'wrong-root', name: '错误根条目', type: 'newdoc', parentId: 999, teamId: 1 },
];
const folderAItems = [
  { id: 20, guid: 'folder-b', name: '子目录', isFolder: true, parentId: 10, teamId: 1 },
  { id: 21, guid: 'file-a', name: 'A文件', type: 'mosheet', parentId: 10, teamId: 1 },
  { id: 22, guid: 'wrong-child', name: '错误子项', type: 'newdoc', parentId: 999, teamId: 1 },
];
const folderBItems = [
  { id: 30, guid: 'target-guid', name: '目标文件', type: 'mindmap', parentId: 20, teamId: 1 },
  { id: 31, guid: 'file-a', name: '重复文件', type: 'mosheet', parentId: 20, teamId: 1 },
  { id: 32, guid: 'unsupported-guid', name: '不支持类型', type: 'form', parentId: 20, teamId: 1 },
];

const requestedUrls = [];
const responses = new Map([
  ['https://shimo.im/lizard-api/api/files?folderId=0', rootItems],
  ['https://shimo.im/lizard-api/files?folder=folder-a', folderAItems],
  ['https://shimo.im/lizard-api/files?folder=folder-b', folderBItems],
]);
const page = {
  async goto() {},
  async evaluate(_fn, endpoint) {
    requestedUrls.push(endpoint);
    if (!responses.has(endpoint)) return { status: 404, ok: false, data: null, raw: 'not found' };
    return { status: 200, ok: true, data: responses.get(endpoint), raw: null };
  },
};

await assert.rejects(
  () => scanShimoFiles(page, { forceRescan: true }),
  /石墨目录扫描不完整/
);
requestedUrls.length = 0;
const files = await scanShimoFiles(page, { forceRescan: true, allowIncompleteScan: true });
assert.deepEqual(requestedUrls, [
  'https://shimo.im/lizard-api/api/files?folderId=0',
  'https://shimo.im/lizard-api/files?folder=folder-a',
  'https://shimo.im/lizard-api/files?folder=folder-b',
]);
assert.equal(files.length, 4);
assert.equal(files.filter(file => file.guid === 'file-a').length, 1);
assert.equal(files.some(file => file.guid === 'wrong-root'), false);
assert.equal(files.some(file => file.guid === 'wrong-child'), false);
assert.equal(files.some(file => file.guid === 'shortcut-file'), false);
assert.equal(files.find(file => file.guid === 'target-guid')?.folder_path, '项目A/子目录');
assert.equal(files.find(file => file.guid === 'unsupported-guid')?.type, 'form');
fs.rmSync(testCwd, { recursive: true, force: true });
console.log('scan regression test passed');
