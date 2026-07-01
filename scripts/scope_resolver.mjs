#!/usr/bin/env node
/**
 * scope_resolver.mjs — Select migration files from a scanned Shimo file list.
 *
 * This is intentionally deterministic. The agent should translate the user's natural language
 * into include/exclude rules, run this script, then explain the selected scope back to the user.
 */

import fs from 'fs';
import path from 'path';

function parseArgs() {
  const args = process.argv.slice(2);
  const config = { fileList: '', include: [], exclude: [], output: '', explain: false };
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    const next = args[i + 1];
    switch (arg) {
      case '--file-list': config.fileList = next; i++; break;
      case '--include': config.include.push(next); i++; break;
      case '--exclude': config.exclude.push(next); i++; break;
      case '--output': config.output = next; i++; break;
      case '--explain': config.explain = true; break;
      case '--help': printHelp(); process.exit(0);
      default:
        if (arg.startsWith('--')) throw new Error(`Unknown option: ${arg}`);
        config.include.push(arg);
    }
  }
  if (!config.fileList) throw new Error('--file-list is required');
  if (!config.output) config.output = path.join(path.dirname(config.fileList), 'selected_file_list.json');
  return config;
}

function printHelp() {
  console.log(`
Usage: node scripts/scope_resolver.mjs --file-list <path> [options]

Options:
  --include <text-or-url>   Include files whose name/path/link/guid matches this text. Repeatable.
  --exclude <text-or-url>   Exclude files whose name/path/link/guid matches this text. Repeatable.
  --output <path>           Output selected file list JSON.
  --explain                 Print selected and excluded summary.

Examples:
  node scripts/scope_resolver.mjs --file-list outputs/dry-run/shimo_file_list.json --include "企业空间/项目资料" --exclude "归档"
  node scripts/scope_resolver.mjs --file-list outputs/dry-run/shimo_file_list.json --include "https://shimo.im/docs/xxxxx"
`);
}

function normalize(s) {
  return String(s || '').trim().toLowerCase().replace(/^https?:\/\/shimo\.im\/(docs|sheets|mindmaps)\//, '');
}

function displayPath(file) {
  const spaceName = String(file.space_name || '').trim();
  const folderPath = String(file.folder_path || '').trim();
  const name = String(file.name || '').trim();
  const pathParts = [];

  if (spaceName) pathParts.push(spaceName);
  if (folderPath) {
    if (spaceName && (folderPath === spaceName || folderPath.startsWith(`${spaceName}/`))) {
      pathParts.push(folderPath.slice(spaceName.length).replace(/^\//, ''));
    } else {
      pathParts.push(folderPath);
    }
  }
  if (name) pathParts.push(name);
  return pathParts.filter(Boolean).join('/');
}

function fileHaystack(file) {
  const parts = [
    file.guid,
    file.id,
    file.name,
    file.type,
    file.fileType,
    file.space_name,
    file.folder_path,
    file.shimo_url,
    file.url,
    displayPath(file),
  ];
  return normalize(parts.filter(Boolean).join(' | '));
}

function matchesAny(file, patterns) {
  if (!patterns.length) return false;
  const haystack = fileHaystack(file);
  return patterns.some(p => {
    const n = normalize(p);
    return n && haystack.includes(n);
  });
}

function matchesInclude(file, patterns) {
  if (!patterns.length) return true;
  return matchesAny(file, patterns);
}

function main() {
  const config = parseArgs();
  const files = JSON.parse(fs.readFileSync(config.fileList, 'utf-8'));
  if (!Array.isArray(files)) throw new Error('file list must be an array');
  const included = files.filter(f => matchesInclude(f, config.include));
  const selected = included.filter(f => !matchesAny(f, config.exclude));
  fs.mkdirSync(path.dirname(config.output), { recursive: true });
  fs.writeFileSync(config.output, JSON.stringify(selected, null, 2));

  const typeStats = {};
  for (const f of selected) typeStats[f.type || f.fileType || 'unknown'] = (typeStats[f.type || f.fileType || 'unknown'] || 0) + 1;
  console.log(`Selected ${selected.length}/${files.length} files -> ${config.output}`);
  for (const [type, count] of Object.entries(typeStats)) console.log(`  ${type}: ${count}`);

  if (config.explain) {
    console.log('\nSelected files:');
    selected.slice(0, 80).forEach((f, i) => console.log(`${i + 1}. ${displayPath(f)} (${f.type || f.fileType || 'unknown'})`));
    if (selected.length > 80) console.log(`... ${selected.length - 80} more`);
  }
}

main();
