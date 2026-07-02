#!/usr/bin/env node
import { existsSync, accessSync, constants, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import process from 'node:process';

const root = process.cwd();
const checks = [];
let hasFailure = false;
let hasWarning = false;

function add(status, name, detail) {
  checks.push({ status, name, detail });
  if (status === 'FAIL') hasFailure = true;
  if (status === 'WARN') hasWarning = true;
}

function fileExists(relativePath) {
  return existsSync(path.join(root, relativePath));
}

function checkNode() {
  const major = Number(process.versions.node.split('.')[0]);
  if (Number.isFinite(major) && major >= 20) {
    add('OK', 'Node.js', process.version);
  } else {
    add('FAIL', 'Node.js', `Node.js >= 20 required. Current: ${process.version}`);
  }
}

function checkNpm() {
  const result = spawnSync('npm', ['--version'], {
    cwd: root,
    encoding: 'utf8',
    shell: process.platform === 'win32',
  });
  if (result.status === 0) add('OK', 'npm', String(result.stdout).trim());
  else add('FAIL', 'npm', 'npm not found');
}

function checkPackageInstall() {
  if (!fileExists('node_modules')) add('WARN', 'dependencies', 'node_modules not found. Run npm run setup or npm install.');
  else add('OK', 'dependencies', 'node_modules exists');
}

function checkPlaywright() {
  const result = spawnSync('npx', ['playwright', '--version'], {
    cwd: root,
    encoding: 'utf8',
    shell: process.platform === 'win32',
  });
  if (result.status === 0) add('OK', 'Playwright', String(result.stdout).trim());
  else add('WARN', 'Playwright', 'Playwright not ready. Run npm run setup.');
}

function readConfig() {
  const configPath = path.join(root, 'migration.config.json');
  if (!existsSync(configPath)) {
    add('WARN', 'migration.config.json', 'Missing. Run npm run setup to copy the example config.');
    return null;
  }
  try {
    const config = JSON.parse(readFileSync(configPath, 'utf8'));
    add('OK', 'migration.config.json', 'Found and parseable');
    return config;
  } catch (error) {
    add('FAIL', 'migration.config.json', `Invalid JSON: ${error.message}`);
    return null;
  }
}

function checkFeishuConfig(config) {
  if (!config) return;
  const appId = config.feishu?.app_id;
  const appSecret = config.feishu?.app_secret;
  if (appId && appId !== 'cli_xxx') add('OK', 'Feishu/Lark app_id', 'Configured');
  else add('WARN', 'Feishu/Lark app_id', 'Not configured');
  if (appSecret && appSecret !== 'your_app_secret') add('OK', 'Feishu/Lark app_secret', 'Configured but not printed');
  else add('WARN', 'Feishu/Lark app_secret', 'Not configured');
}

function checkShimoSession(config) {
  const cacheDir = config?.cache_dir || '.cache/shimo-api-migration';
  const full = path.join(root, cacheDir);
  if (existsSync(full)) add('OK', 'Shimo session/cache', `${cacheDir} exists`);
  else add('WARN', 'Shimo session/cache', `No local session found at ${cacheDir}. Run npm run login.`);
}

function checkOutputDir(config) {
  const outputDir = config?.output_dir || 'outputs/migration';
  const full = path.join(root, outputDir);
  try {
    if (existsSync(full)) accessSync(full, constants.W_OK);
    else accessSync(root, constants.W_OK);
    add('OK', 'output directory', `${outputDir} is writable or can be created`);
  } catch {
    add('FAIL', 'output directory', `${outputDir} is not writable`);
  }
}

function checkPlatform() {
  const platform = `${process.platform} ${process.arch}`;
  if (process.platform === 'darwin') add('OK', 'platform', `${platform}; macOS end-to-end has been tested`);
  else add('WARN', 'platform', `${platform}; expected to work, but end-to-end migration is not fully verified in v1.0.1`);
}

function printReport() {
  console.log('shimo-api-migration doctor\n');
  for (const c of checks) {
    console.log(`[${c.status}] ${c.name}: ${c.detail}`);
  }
  console.log('\nNext steps:');
  console.log('- Fix any FAIL items before migration.');
  console.log('- WARN items may require user action before real migration.');
  console.log('- Run npm run login after Feishu/Lark credentials are configured.');
  console.log('- Always run dry run before real migration.');
  if (hasFailure) process.exitCode = 1;
  else if (hasWarning) process.exitCode = 0;
}

checkNode();
checkNpm();
checkPackageInstall();
checkPlaywright();
const config = readConfig();
checkFeishuConfig(config);
checkShimoSession(config);
checkOutputDir(config);
checkPlatform();
printReport();
