#!/usr/bin/env node
import { existsSync, copyFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import process from 'node:process';

const root = process.cwd();
const minMajor = 20;

function log(message) {
  console.log(message);
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: root,
    stdio: 'inherit',
    shell: process.platform === 'win32',
    ...options,
  });
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(' ')} failed with exit code ${result.status}`);
  }
}

function checkNode() {
  const major = Number(process.versions.node.split('.')[0]);
  if (!Number.isFinite(major) || major < minMajor) {
    throw new Error(`Node.js >= ${minMajor} is required. Current version: ${process.version}`);
  }
  log(`Node.js OK: ${process.version}`);
}

function checkNpm() {
  const result = spawnSync('npm', ['--version'], {
    cwd: root,
    encoding: 'utf8',
    shell: process.platform === 'win32',
  });
  if (result.status !== 0) {
    throw new Error('npm is required but was not found. Install Node.js/npm first.');
  }
  log(`npm OK: ${String(result.stdout).trim()}`);
}

function installDependencies() {
  if (existsSync(path.join(root, 'node_modules'))) {
    log('node_modules exists; skipping npm install.');
    return;
  }
  log('Installing npm dependencies...');
  run('npm', ['install']);
}

function installChromium() {
  log('Ensuring Playwright Chromium is installed...');
  run('npx', ['playwright', 'install', 'chromium']);
}

function ensureConfig() {
  const configPath = path.join(root, 'migration.config.json');
  const examplePath = path.join(root, 'migration.config.example.json');
  if (existsSync(configPath)) {
    log('migration.config.json already exists; keeping it unchanged.');
    return;
  }
  if (!existsSync(examplePath)) {
    throw new Error('migration.config.example.json not found.');
  }
  copyFileSync(examplePath, configPath);
  log('Created local migration.config.json from migration.config.example.json. Official lark-cli user authorization is the default Feishu/Lark backend.');
}

function printNextSteps() {
  log('\nSetup completed. Next steps:');
  log('1. Run npm run doctor');
  log('2. Run npx lark-cli auth login --domain drive,docs to authorize the current Feishu/Lark user');
  log('3. Run npx lark-cli auth status --verify --json to verify authorization');
  log('4. Run npm run login and complete Shimo login in the browser');
  log('5. Ask your agent to guide migration scope and Feishu/Lark destination selection');
  log('6. Run dry run first; do not start real migration before explicit confirmation');
  log('Legacy only: use --feishu-backend oauth and local app_id/app_secret if you intentionally need the built-in OAuth backend.');
}

try {
  log('Setting up shimo-api-migration as an agent Skill...');
  checkNode();
  checkNpm();
  installDependencies();
  installChromium();
  ensureConfig();
  printNextSteps();
} catch (error) {
  console.error(`Setup failed: ${error.message}`);
  process.exit(1);
}
