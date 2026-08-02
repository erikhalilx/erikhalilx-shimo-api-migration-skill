#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const templateDir = path.join(scriptDir, 'supervisor-template');
const args = process.argv.slice(2);
function value(name, fallback = '') { const index = args.indexOf(name); return index >= 0 ? args[index + 1] : fallback; }
if (args.includes('--help')) {
  console.log('Usage: node scripts/create_supervisor.mjs --migration-dir <dir> --runner <runner.mjs> [--output <dir>] [--node-bin <path>] [--total <n>]');
  process.exit(0);
}
const migrationDir = path.resolve(value('--migration-dir'));
const runnerPath = path.resolve(value('--runner'));
const outputDir = path.resolve(value('--output', path.join(migrationDir, 'migration-supervisor')));
if (!value('--migration-dir') || !value('--runner')) throw new Error('--migration-dir and --runner are required');
if (!fs.existsSync(migrationDir)) throw new Error(`Migration directory not found: ${migrationDir}`);
if (!fs.existsSync(runnerPath)) throw new Error(`Runner not found: ${runnerPath}`);
fs.mkdirSync(outputDir, { recursive: true });
for (const name of ['server.mjs', 'index.html']) fs.copyFileSync(path.join(templateDir, name), path.join(outputDir, name));
const config = {
  migration_dir: migrationDir,
  runner_path: runnerPath,
  node_bin: value('--node-bin', process.execPath),
  total_files: Number(value('--total', 0)) || 0,
};
fs.writeFileSync(path.join(outputDir, 'supervisor.config.json'), JSON.stringify(config, null, 2));
fs.writeFileSync(path.join(outputDir, 'start-supervisor.command'), `#!/bin/sh\nexec "${config.node_bin}" "${path.join(outputDir, 'server.mjs')}"\n`, { mode: 0o755 });
console.log(`Supervisor generated: ${outputDir}`);
console.log(`Start: ${path.join(outputDir, 'start-supervisor.command')}`);
console.log('Open: http://127.0.0.1:4173');
