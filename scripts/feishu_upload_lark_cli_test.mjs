#!/usr/bin/env node

import assert from 'assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';

import {
  addDocxTextBlocks,
  createDocxDocument,
  createFolder,
  getDocxMeta,
  getFileMeta,
  getSheetMeta,
  initFeishu,
  listFolderChildren,
  uploadFile,
} from './feishu_upload.mjs';
import { getTargetFolderToken } from './folder_tree.mjs';

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'shimo-lark-cli-test-'));
const fakeCli = path.join(tempDir, 'fake-lark-cli.mjs');
const fixture = path.join(tempDir, 'fixture.docx');
const callLog = path.join(tempDir, 'calls.ndjson');

fs.writeFileSync(fixture, 'fixture');
fs.writeFileSync(fakeCli, `import fs from 'fs';
const args = process.argv.slice(2);
const mode = process.env.FAKE_LARK_MODE || 'success';
fs.appendFileSync(process.env.FAKE_LARK_CALL_LOG, JSON.stringify({ args, cwd: process.cwd(), mode }) + '\\n');
if (mode === 'nonzero') {
  process.stderr.write('simulated nonzero exit');
  process.exit(7);
}
if (mode === 'invalid-json') {
  process.stdout.write('not json');
  process.exit(0);
}
if (mode === 'ok-false') {
  process.stdout.write(JSON.stringify({ ok: false, error: { message: 'simulated ok false' } }));
  process.exit(0);
}
if (mode === 'data-error' || (mode === 'import-data-error' && args[0] === 'drive' && args[1] === '+import')) {
  process.stdout.write(JSON.stringify({ ok: true, data: { error: 'simulated data error' } }));
  process.exit(0);
}
let data = {};
if (args[0] === 'drive' && args[1] === 'files') data = { files: [{ name: 'child', token: 'folder_child', type: 'folder' }] };
else if (args[0] === 'drive' && args[1] === '+create-folder') data = { folder: { token: 'folder_created', type: 'folder' } };
else if (args[0] === 'drive' && args[1] === '+import') data = { token: 'doc_imported', type: args[args.indexOf('--type') + 1] };
else if (args[0] === 'drive' && args[1] === '+upload') data = { file: { file_token: 'file_uploaded', type: 'file' } };
else if (args[0] === 'drive' && args[1] === '+inspect') data = { token: args[args.indexOf('--url') + 1].split('/').pop(), type: args[args.indexOf('--type') + 1], title: 'inspected' };
else if (args[0] === 'docs' && args[1] === '+create') data = { document: { document_id: 'doc_created' } };
else if (args[0] === 'docs' && args[1] === '+update') data = { document: { revision_id: 2 }, result: 'success' };
else process.exit(2);
process.stdout.write(JSON.stringify({ ok: true, identity: 'user', data }));
`);
process.env.FAKE_LARK_CALL_LOG = callLog;

try {
  initFeishu({ backend: 'lark-cli', larkCliPath: fakeCli });

  process.env.FAKE_LARK_MODE = 'success';
  const listed = await listFolderChildren('parent_token');
  assert.equal(listed.success, true);
  assert.equal(listed.files[0].token, 'folder_child');
  assert.equal(listed.files[0].type, 'folder');

  const folder = await createFolder({ name: '测试目录', parentToken: 'parent_token' });
  assert.equal(folder.token, 'folder_created');
  assert.match(folder.url, /folder_created$/);

  const completeFolderMap = {
    migration_root: { feishu_token: 'migration_root' },
    spaces: { space_1: { feishu_folder_token: 'space_folder' } },
    folders: {},
    nested: { 'space_1::项目/资料': { feishu_folder_token: 'nested_folder' } },
  };
  assert.equal(
    getTargetFolderToken({ space_id: 'space_1', folder_path: '项目/资料', name: '路径文件' }, completeFolderMap),
    'nested_folder',
  );
  assert.throws(
    () => getTargetFolderToken({ space_id: 'space_1', folder_path: '项目/缺失', name: '不可回落文件' }, completeFolderMap),
    /Missing Feishu folder mapping for space_1::项目\/缺失/,
  );
  assert.equal(
    getTargetFolderToken({ space_id: 'space_1', folder_path: '', name: '空间根文件' }, completeFolderMap),
    'space_folder',
  );

  const imported = await uploadFile({
    filePath: fixture,
    folderToken: 'folder_created',
    name: '测试文档',
    fileExtension: 'docx',
    objType: 'docx',
  });
  assert.equal(imported.success, true);
  assert.equal(imported.token, 'doc_imported');
  assert.equal(imported.token_type, 'docx');

  const uploaded = await uploadFile({
    filePath: fixture,
    folderToken: 'folder_created',
    name: '附件',
    fileExtension: 'docx',
    objType: null,
  });
  assert.equal(uploaded.success, true);
  assert.equal(uploaded.token, 'file_uploaded');
  assert.equal(uploaded.token_type, 'file');

  assert.equal((await getFileMeta('file_uploaded')).success, true);
  assert.equal((await getDocxMeta('doc_imported')).success, true);
  assert.equal((await getSheetMeta('sheet_imported')).success, true);

  const doc = await createDocxDocument({ title: '兜底文档', folderToken: 'folder_created' });
  assert.equal(doc.document_id, 'doc_created');
  const appended = await addDocxTextBlocks(doc.document_id, ['A & B', '1 < 2']);
  assert.equal(appended.success, true);

  process.env.FAKE_LARK_MODE = 'import-data-error';
  const importFallback = await uploadFile({
    filePath: fixture,
    folderToken: 'folder_created',
    name: '导入失败兜底',
    fileExtension: 'docx',
    objType: 'docx',
  });
  assert.equal(importFallback.success, true);
  assert.equal(importFallback.method, 'lark_cli_upload_fallback');
  assert.equal(importFallback.token, 'file_uploaded');
  assert.match(importFallback.note, /simulated data error/);

  process.env.FAKE_LARK_MODE = 'nonzero';
  await assert.rejects(
    () => createFolder({ name: '非零退出', parentToken: 'parent_token' }),
    /simulated nonzero exit/,
  );

  process.env.FAKE_LARK_MODE = 'invalid-json';
  await assert.rejects(
    () => createFolder({ name: '非法 JSON', parentToken: 'parent_token' }),
    /not json/,
  );

  process.env.FAKE_LARK_MODE = 'ok-false';
  await assert.rejects(
    () => createFolder({ name: 'ok false', parentToken: 'parent_token' }),
    /simulated ok false/,
  );

  process.env.FAKE_LARK_MODE = 'data-error';
  const inspectDataError = await getFileMeta('file_uploaded');
  assert.equal(inspectDataError.success, false);
  assert.match(inspectDataError.error, /simulated data error/);

  process.env.FAKE_LARK_MODE = 'success';
  const calls = fs.readFileSync(callLog, 'utf8').trim().split('\n').map(line => JSON.parse(line));
  const importCall = calls.find(call => call.args[0] === 'drive' && call.args[1] === '+import');
  assert.equal(fs.realpathSync(importCall.cwd), fs.realpathSync(tempDir));
  assert.equal(importCall.args[importCall.args.indexOf('--file') + 1], './fixture.docx');
  const updateCall = calls.find(call => call.args[0] === 'docs' && call.args[1] === '+update');
  const content = updateCall.args[updateCall.args.indexOf('--content') + 1];
  assert.equal(content, '<p>A &amp; B</p><p>1 &lt; 2</p>');
  const fallbackCalls = calls.filter(call => call.mode === 'import-data-error');
  assert.ok(fallbackCalls.some(call => call.args[1] === '+import'));
  assert.ok(fallbackCalls.some(call => call.args[1] === '+upload'));

  console.log('feishu_upload lark-cli backend regression test passed');
} finally {
  delete process.env.FAKE_LARK_MODE;
  delete process.env.FAKE_LARK_CALL_LOG;
  fs.rmSync(tempDir, { recursive: true, force: true });
}
