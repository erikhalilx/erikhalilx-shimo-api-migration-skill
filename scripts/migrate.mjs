#!/usr/bin/env node
/**
 * migrate.mjs — Shimo to Feishu migration orchestrator.
 *
 * Safety baseline:
 * - Shimo source content is read-only: this script never deletes/updates Shimo files.
 * - Existing Feishu user content is non-destructive: this script only creates new folders/files/docs
 *   inside the selected destination and never deletes/updates existing Feishu files.
 */

import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';

import { interactiveLogin, isSessionValid, getShimoSessionDir, configureLogin } from './login.mjs';
import { scanShimoFiles, filterByTypes } from './scan.mjs';
import { buildFolderTree, loadFolderMap, getTargetFolderToken, getFeishuPath } from './folder_tree.mjs';
import { exportFile, getExportFormat, FEISHU_IMPORT_MAP, normalizeType, UNSUPPORTED_TYPES } from './exporter.mjs';
import { initFeishu, uploadFile } from './feishu_upload.mjs';
import { verifyTask } from './verifier.mjs';
import { StateManager } from './state.mjs';
import { generateReport } from './report.mjs';
import { classifyFailure } from './failure_classifier.mjs';
import { runFallbackMigration } from './fallback_migrate.mjs';

const DEFAULT_OUTPUT_DIR = 'outputs/migration';
const DEFAULT_CACHE_DIR = '.cache/shimo-api-migration';
const EXPORT_DIR_NAME = 'exports';
const FALLBACK_DIR_NAME = 'fallback_artifacts';
const MAX_API_ATTEMPTS = 2;

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function parseArgs() {
  const args = process.argv.slice(2);
  const config = {
    root_name: `石墨迁移_API_${new Date().toISOString().slice(0, 10).replace(/-/g, '')}`,
    target_root_token: '',
    types: [],
    fileList: '',
    outputDir: DEFAULT_OUTPUT_DIR,
    cacheDir: DEFAULT_CACHE_DIR,
    feishuAppId: '',
    feishuAppSecret: '',
    dryRun: false,
    resume: false,
    retryFailed: false,
    retryCandidateList: '',
    fallbackMode: 'collect',
    fallbackCandidateList: '',
    headless: false,
    skipVerify: false,
    observeExport: false,
    account: '',
    password: '',
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    const next = args[i + 1];
    switch (arg) {
      case '--root-name': config.root_name = next; i++; break;
      case '--target-root':
      case '--target-root-token': config.target_root_token = next; i++; break;
      case '--types': config.types = next.split(',').map(s => s.trim()).filter(Boolean); i++; break;
      case '--file-list': config.fileList = next; i++; break;
      case '--output-dir': config.outputDir = next; i++; break;
      case '--cache-dir': config.cacheDir = next; i++; break;
      case '--feishu-app-id': config.feishuAppId = next; i++; break;
      case '--feishu-app-secret': config.feishuAppSecret = next; i++; break;
      case '--dry-run': config.dryRun = true; break;
      case '--resume': config.resume = true; break;
      case '--retry-failed': config.retryFailed = true; break;
      case '--retry-candidate-list': config.retryCandidateList = next; i++; break;
      case '--fallback-mode': config.fallbackMode = next; i++; break;
      case '--fallback-candidate-list': config.fallbackCandidateList = next; i++; break;
      case '--headless': config.headless = next === 'true'; i++; break;
      case '--skip-verify': config.skipVerify = true; break;
      case '--observe-export': config.observeExport = true; break;
      case '--account': config.account = next; i++; break;
      case '--password': config.password = next; i++; break;
      case '--help': printHelp(); process.exit(0);
      default:
        if (arg.startsWith('--')) throw new Error(`Unknown option: ${arg}`);
    }
  }
  if (!['off', 'collect', 'execute'].includes(config.fallbackMode)) {
    throw new Error('--fallback-mode must be one of: off, collect, execute');
  }
  return config;
}

function printHelp() {
  console.log(`
Usage: shimo-migrate [options]

Options:
  --root-name <name>                 Migration root folder name in Feishu
  --target-root <token>              Existing Feishu parent folder token; if omitted, create under My Space root
  --file-list <path>                 Use selected Shimo file list JSON
  --types <type1,type2>              Advanced/debug only: filter by Shimo types
  --output-dir <path>                Output directory (default: outputs/migration)
  --cache-dir <path>                 Cache directory for Shimo/Feishu sessions (default: .cache/shimo-api-migration)
  --feishu-app-id <id>               Feishu app ID
  --feishu-app-secret <secret>       Feishu app secret
  --dry-run                          Plan only, no writes to Feishu
  --resume                           Resume from saved state
  --retry-failed                     Retry all failed tasks from state
  --retry-candidate-list <path>      Retry only selected failed candidates from report JSON
  --fallback-mode <off|collect|execute>
                                      off: do not collect/execute fallback candidates
                                      collect: collect candidates and report them (default)
                                      execute: execute fallback for selected candidates only
  --fallback-candidate-list <path>   JSON list of candidates approved by the user for fallback execution
  --headless <true|false>            Browser headless mode for export (default: false)
  --skip-verify                      Skip local and remote verification
  --observe-export                   Log export taskId/progress/download state
  --account <phone-or-email>         Optional Shimo account autofill
  --password <password>              Optional Shimo password autofill (not recommended for shared shells)
`);
}

function loadConfig(config) {
  const configPaths = [
    path.join(process.cwd(), 'migration.config.json'),
    path.join(config.outputDir, 'migration.config.json'),
    path.join(process.cwd(), '..', 'migration.config.json'),
  ];
  for (const p of configPaths) {
    if (!fs.existsSync(p)) continue;
    const fileConfig = JSON.parse(fs.readFileSync(p, 'utf-8'));
    if (!config.feishuAppId && fileConfig.feishu?.app_id) config.feishuAppId = fileConfig.feishu.app_id;
    if (!config.feishuAppSecret && fileConfig.feishu?.app_secret) config.feishuAppSecret = fileConfig.feishu.app_secret;
    if (!config.target_root_token && fileConfig.feishu?.target_root_token) config.target_root_token = fileConfig.feishu.target_root_token;
    if (!config.fileList && fileConfig.file_list) config.fileList = fileConfig.file_list;
    if (config.outputDir === DEFAULT_OUTPUT_DIR && fileConfig.output_dir) config.outputDir = fileConfig.output_dir;
    if (config.cacheDir === DEFAULT_CACHE_DIR && fileConfig.cache_dir) config.cacheDir = fileConfig.cache_dir;
    if (fileConfig.root_name && config.root_name.startsWith('石墨迁移_API_')) config.root_name = fileConfig.root_name;
    if (typeof fileConfig.headless === 'boolean') config.headless = fileConfig.headless;
    if (fileConfig.migration?.types?.length && config.types.length === 0) config.types = fileConfig.migration.types;
    if (typeof fileConfig.migration?.skip_verify === 'boolean') config.skipVerify = fileConfig.migration.skip_verify;
    if (fileConfig.migration?.fallback_mode) config.fallbackMode = fileConfig.migration.fallback_mode;
    if (typeof fileConfig.migration?.observe_export === 'boolean') config.observeExport = fileConfig.migration.observe_export;
    break;
  }
  return config;
}

function getTaskId(task) {
  return `${task.guid}_${task.fileType || normalizeType(task.type) || task.type}`;
}

function shimoPath(task) {
  const folderPath = task.folder_path ? `/${task.folder_path}` : '';
  return `/${task.space_name || 'unknown'}${folderPath}/${task.name}`;
}

function readCandidateList(candidatePath) {
  if (!candidatePath) return null;
  if (!fs.existsSync(candidatePath)) throw new Error(`Candidate list not found: ${candidatePath}`);
  const raw = JSON.parse(fs.readFileSync(candidatePath, 'utf-8'));
  const items = Array.isArray(raw) ? raw : raw.candidates || raw.tasks || [];
  return new Set(items.map(x => x.shimo_guid || x.guid || x.task_id).filter(Boolean));
}

function recordFallbackCandidate(stateManager, { task, taskId, currentAttempt, classification, errorMessage, observableExport, feishuPath, startedAt, status = 'fallback_candidate' }) {
  stateManager.recordTask({
    task_id: taskId,
    status,
    attempts: currentAttempt,
    type: task.type,
    name: task.name,
    shimo_guid: task.guid,
    shimo_url: task.shimo_url,
    shimo_path: shimoPath(task),
    feishu_path: feishuPath,
    export_method: 'api',
    error: { message: errorMessage || classification?.reason || 'fallback candidate' },
    failure_classification: classification,
    observable_export: observableExport || null,
    action_required: {
      category: 'fallback_decision_required',
      options: ['retry', 'fallback', 'skip'],
      note: 'User must decide whether to retry API migration, execute fallback, or abandon this file.',
    },
    started_at: startedAt,
    finished_at: new Date().toISOString(),
  });
}

async function main() {
  const config = loadConfig(parseArgs());
  configureLogin({ cacheDir: config.cacheDir });

  console.log('══════════════════════════════════════════════════════');
  console.log('  Shimo API Migration');
  console.log('══════════════════════════════════════════════════════\n');
  console.log('Safety: Shimo source files are read-only. Existing Feishu files are never deleted or modified.\n');

  if (!config.dryRun && (!config.feishuAppId || !config.feishuAppSecret)) {
    console.error('❌ Missing Feishu credentials. Provide them in migration.config.json or CLI options.');
    process.exit(1);
  }

  if (config.feishuAppId && config.feishuAppSecret) {
    initFeishu({ feishu: { app_id: config.feishuAppId, app_secret: config.feishuAppSecret }, cacheDir: config.cacheDir });
  }
  fs.mkdirSync(config.outputDir, { recursive: true });
  const exportDir = path.join(config.outputDir, EXPORT_DIR_NAME);
  const fallbackDir = path.join(config.outputDir, FALLBACK_DIR_NAME);
  fs.mkdirSync(exportDir, { recursive: true });
  fs.mkdirSync(fallbackDir, { recursive: true });

  let stateManager = (config.resume || config.retryFailed || config.retryCandidateList || config.fallbackCandidateList) ? StateManager.load(config.outputDir) : null;
  if (stateManager) console.log(`📂 Loaded state: ${stateManager.tasks.length} tasks\n`);
  else stateManager = new StateManager(config.outputDir);

  if (!config.resume && !config.retryFailed && !config.retryCandidateList && !config.fallbackCandidateList && fs.existsSync(path.join(config.outputDir, 'migration_state.json'))) {
    console.log('💡 Existing migration_state.json detected. Auto switching to --resume.');
    config.resume = true;
    stateManager = StateManager.load(config.outputDir) || stateManager;
  }

  console.log('1. Checking Shimo login...');
  const sessionValid = await isSessionValid({ cacheDir: config.cacheDir });
  if (!sessionValid) {
    console.log('   ⚠️ Session invalid or expired. Interactive login required.');
    const result = await interactiveLogin(config.account, config.password, { cacheDir: config.cacheDir });
    if (!result.success) throw new Error('Shimo login failed');
  } else {
    console.log('   ✅ Shimo session valid');
  }

  console.log('\n2. Scanning Shimo files...');
  let files = await (async () => {
    const context = await chromium.launchPersistentContext(getShimoSessionDir(), {
      headless: true,
      args: ['--no-sandbox', '--disable-blink-features=AutomationControlled'],
    });
    const page = context.pages()[0] || await context.newPage();
    try { return await scanShimoFiles(page, { fileListPath: config.fileList }); }
    finally { await context.close(); }
  })();

  if (config.types.length > 0) {
    files = filterByTypes(files, config.types);
    console.log(`   Filtered by advanced type filter: ${files.length} files`);
  }

  const scannedFileListPath = path.join(config.outputDir, 'shimo_file_list.json');
  fs.writeFileSync(scannedFileListPath, JSON.stringify(files, null, 2));
  console.log(`   Saved scanned file list: ${scannedFileListPath}`);

  if (config.dryRun) {
    console.log('\n══════════════════════════════════════════════════════');
    console.log('  Dry Run — Migration Plan');
    console.log('══════════════════════════════════════════════════════\n');
    console.log(`Feishu parent folder token: ${config.target_root_token || '(My Space root)'}`);
    console.log(`Migration root folder name: ${config.root_name}`);
    console.log(`Fallback mode: ${config.fallbackMode}`);
    console.log(`Files: ${files.length}`);
    const typeStats = {};
    for (const f of files) typeStats[normalizeType(f.type) || f.type] = (typeStats[normalizeType(f.type) || f.type] || 0) + 1;
    for (const [t, c] of Object.entries(typeStats)) {
      const { supported, format } = getExportFormat(t);
      console.log(`  ${t}: ${c} ${supported ? `→ ${format}` : '(unsupported; will be reported as fallback candidate)'}`);
    }
    console.log('\nNo files were exported or uploaded in dry-run mode.');
    return;
  }

  console.log('\n3. Building Feishu folder tree...');
  let folderMap = loadFolderMap(config.outputDir);
  folderMap = await buildFolderTree(files, config, folderMap);

  console.log('\n4. Generating task queue...');
  let taskQueue = files.map(f => ({
    guid: f.guid,
    name: f.name,
    type: f.type,
    fileType: normalizeType(f.type),
    space_id: f.space_id,
    space_name: f.space_name,
    parent_guid: f.parent_guid,
    folder_path: f.folder_path || '',
    shimo_url: f.shimo_url || `https://shimo.im/docs/${f.guid}`,
    size: f.size || 0,
  }));

  const retryCandidateSet = readCandidateList(config.retryCandidateList);
  const fallbackCandidateSet = readCandidateList(config.fallbackCandidateList);

  if (config.retryFailed) {
    const failedGuids = new Set(stateManager.getRetryableFailedTasks().map(t => t.shimo_guid));
    taskQueue = taskQueue.filter(t => failedGuids.has(t.guid));
    console.log(`   Retry failed only: ${taskQueue.length}`);
  }
  if (retryCandidateSet) {
    taskQueue = taskQueue.filter(t => retryCandidateSet.has(t.guid) || retryCandidateSet.has(getTaskId(t)));
    console.log(`   Retry selected candidates: ${taskQueue.length}`);
  }
  if (fallbackCandidateSet) {
    taskQueue = taskQueue.filter(t => fallbackCandidateSet.has(t.guid) || fallbackCandidateSet.has(getTaskId(t)));
    config.fallbackMode = 'execute';
    console.log(`   Execute fallback for selected candidates: ${taskQueue.length}`);
  }

  const completedGuids = stateManager.getCompletedGuids();
  const pendingTasks = fallbackCandidateSet ? taskQueue : taskQueue.filter(t => !completedGuids.has(t.guid));
  console.log(`   Pending: ${pendingTasks.length} (completed ${taskQueue.length - pendingTasks.length})`);

  console.log('\n5. Executing migration tasks...\n');
  const context = await chromium.launchPersistentContext(getShimoSessionDir(), {
    headless: config.headless,
    viewport: { width: 1280, height: 800 },
    args: ['--no-sandbox', '--disable-blink-features=AutomationControlled'],
  });
  const page = context.pages()[0] || await context.newPage();
  await page.addInitScript(() => Object.defineProperty(navigator, 'webdriver', { get: () => false }));
  await page.goto('https://shimo.im/recent', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await sleep(2000);

  let processed = 0;
  let successCount = 0;
  let failCount = 0;
  let candidateCount = 0;

  try {
    for (const task of pendingTasks) {
      processed++;
      const startedAt = new Date().toISOString();
      const taskId = getTaskId(task);
      const previous = stateManager.getTaskByGuid(task.guid);
      const previousAttempts = fallbackCandidateSet ? (previous?.attempts || MAX_API_ATTEMPTS) : (previous?.attempts || 0);
      const currentAttempt = fallbackCandidateSet ? previousAttempts : previousAttempts + 1;
      const folderToken = getTargetFolderToken(task, folderMap);
      const feishuPath = getFeishuPath(task, folderMap);
      console.log(`[${processed}/${pendingTasks.length}] ${task.name} (${task.fileType || task.type}) attempt ${currentAttempt}`);

      const { supported, format } = getExportFormat(task.fileType || task.type);

      if (fallbackCandidateSet) {
        console.log('   Executing user-approved fallback...');
        const classification = previous?.failure_classification || classifyFailure({ error: `fallback approved for ${task.type}` });
        const fallbackResult = await runFallbackMigration({ task, page, context, folderToken, outputDir: fallbackDir, classification, failureReason: classification.reason });
        stateManager.recordTask({ task_id: taskId, status: 'success', attempts: currentAttempt, type: task.type, name: task.name, shimo_guid: task.guid, shimo_url: task.shimo_url, shimo_path: shimoPath(task), feishu_path: feishuPath, feishu_token: fallbackResult.token, feishu_url: fallbackResult.url, export_method: 'fallback', upload_method: fallbackResult.method, fallback: fallbackResult, failure_classification: classification, started_at: startedAt, finished_at: new Date().toISOString() });
        await stateManager.save();
        successCount++;
        continue;
      }

      if (!supported) {
        const classification = classifyFailure({ error: `unsupported type: ${task.type}` });
        console.log(`   ⏭️ Unsupported by API; collecting fallback candidate: ${classification.category}`);
        recordFallbackCandidate(stateManager, { task, taskId, currentAttempt: 0, classification, errorMessage: `unsupported type: ${task.type}`, feishuPath, startedAt, status: 'fallback_candidate' });
        await stateManager.save();
        candidateCount++;
        continue;
      }

      let finalExportResult = null;
      let finalClassification = null;
      let finalError = '';

      for (let attempt = Math.max(1, currentAttempt); attempt <= MAX_API_ATTEMPTS; attempt++) {
        console.log(`   Exporting (${format}) attempt ${attempt}/${MAX_API_ATTEMPTS}...`);
        const exportResult = await exportFile({ page, context, guid: task.guid, fileType: task.fileType, name: task.name, outputDir: exportDir, format, fileSize: task.size, observe: config.observeExport });
        finalExportResult = exportResult;
        if (exportResult.success) break;
        finalError = exportResult.error;
        finalClassification = classifyFailure({ error: exportResult.error, observable_export: exportResult.observable_export });
        stateManager.recordTask({ task_id: taskId, status: 'failed', attempts: attempt, type: task.type, name: task.name, shimo_guid: task.guid, shimo_url: task.shimo_url, shimo_path: shimoPath(task), feishu_path: feishuPath, export_method: 'api', error: { message: exportResult.error }, failure_classification: finalClassification, observable_export: exportResult.observable_export, started_at: startedAt, finished_at: new Date().toISOString() });
        await stateManager.save();
        if (attempt < MAX_API_ATTEMPTS) console.log(`   ⚠️ First API attempt failed; retrying once automatically: ${exportResult.error}`);
      }

      if (!finalExportResult?.success) {
        console.log(`   ❌ API failed twice; collecting decision candidate: ${finalClassification?.category || 'unknown_failure'}`);
        recordFallbackCandidate(stateManager, { task, taskId, currentAttempt: MAX_API_ATTEMPTS, classification: finalClassification, errorMessage: finalError, observableExport: finalExportResult?.observable_export, feishuPath, startedAt, status: 'fallback_candidate' });
        await stateManager.save();
        candidateCount++;
        failCount++;
        continue;
      }

      const exportResult = finalExportResult;
      console.log(`   ✅ Exported: ${(exportResult.fileSize / 1024 / 1024).toFixed(1)}MB`);
      const feishuImport = FEISHU_IMPORT_MAP[format] || {};
      const uploadResult = await uploadFile({ filePath: exportResult.filePath, folderToken, name: task.name, fileExtension: format, objType: feishuImport.obj_type || null, mimeType: feishuImport.mime || 'application/octet-stream' });
      if (!uploadResult.success) {
        const classification = classifyFailure({ error: uploadResult.error });
        stateManager.recordTask({ task_id: taskId, status: 'failed', attempts: currentAttempt, type: task.type, name: task.name, shimo_guid: task.guid, shimo_url: task.shimo_url, shimo_path: shimoPath(task), feishu_path: feishuPath, export_method: 'api', file_size: exportResult.fileSize, error: { message: uploadResult.error }, failure_classification: classification, observable_export: exportResult.observable_export, started_at: startedAt, finished_at: new Date().toISOString() });
        await stateManager.save();
        failCount++;
        continue;
      }

      let verification = null;
      if (!config.skipVerify) {
        verification = await verifyTask({ filePath: exportResult.filePath, format, feishuToken: uploadResult.token, feishuTokenType: uploadResult.token_type || 'file', skipRemoteCheck: false });
        if (!verification.exportValid || !verification.uploadValid) {
          const classification = classifyFailure({ error: `verification failed: ${verification.errors.join(', ')}` });
          stateManager.recordTask({ task_id: taskId, status: 'verification_failed', attempts: currentAttempt, type: task.type, name: task.name, shimo_guid: task.guid, shimo_url: task.shimo_url, shimo_path: shimoPath(task), feishu_path: feishuPath, feishu_token: uploadResult.token, feishu_url: uploadResult.url, export_method: 'api', upload_method: uploadResult.method, file_size: exportResult.fileSize, verification, error: { message: `verification failed: ${verification.errors.join(', ')}` }, failure_classification: classification, observable_export: exportResult.observable_export, started_at: startedAt, finished_at: new Date().toISOString() });
          await stateManager.save();
          failCount++;
          continue;
        }
      }

      try { fs.unlinkSync(exportResult.filePath); } catch {}
      stateManager.recordTask({ task_id: taskId, status: 'success', attempts: currentAttempt, type: task.type, name: task.name, shimo_guid: task.guid, shimo_url: task.shimo_url, shimo_path: shimoPath(task), feishu_path: feishuPath, feishu_token: uploadResult.token, feishu_url: uploadResult.url, export_method: 'api', upload_method: uploadResult.method, file_size: exportResult.fileSize, verification, observable_export: exportResult.observable_export, started_at: startedAt, finished_at: new Date().toISOString() });
      await stateManager.save();
      successCount++;
      console.log(`   ✅ Uploaded [${uploadResult.method}]: ${uploadResult.url}`);
      await sleep(2000);
    }
  } finally {
    await context.close().catch(() => {});
  }

  console.log('\n6. Generating report...');
  await generateReport(config.outputDir);
  console.log('\n══════════════════════════════════════════════════════');
  console.log('  Migration complete');
  console.log(`  This run: ${processed} processed, ${successCount} success, ${failCount} failed, ${candidateCount} need decision`);
  console.log(`  Total: ${stateManager.summary.total}, success ${stateManager.summary.success}, failed ${stateManager.summary.failed}, fallback candidates ${stateManager.summary.fallback_candidate || 0}, fallback ${stateManager.summary.fallback_success || 0}`);
  console.log(`  Report: ${path.join(config.outputDir, 'migration_report.md')}`);
  console.log('══════════════════════════════════════════════════════\n');
}

main().catch(e => {
  console.error('Fatal:', e.message);
  console.error(e.stack);
  process.exit(1);
});
