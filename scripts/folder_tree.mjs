/**
 * folder_tree.mjs — 飞书文件夹树创建（路径保留）
 *
 * 职责：
 *   1. 在飞书创建迁移根目录
 *   2. 为每个石墨空间创建一级文件夹
 *   3. 按拓扑排序（深度从浅到深）创建嵌套文件夹
 *   4. 幂等：通过 folder_map 记录已创建项，resume 时不重复创建
 */

import fs from 'fs';
import path from 'path';
import { createFolder, listFolderChildren } from './feishu_upload.mjs';
import { getUniqueSpaces } from './scan.mjs';

// ===== BUILD FOLDER TREE =====
/**
 * @param {Array} files - Shimo file list
 * @param {Object} config - { root_name, target_root_token, outputDir }
 * @param {Object} [existingFolderMap] - 已有 folder_map（用于 resume）
 * @returns {Promise<Object>} folder_map
 */
export async function buildFolderTree(files, config, existingFolderMap = null) {
  const folderMap = existingFolderMap || initFolderMap(config.root_name || '石墨迁移');
  const outputDir = config.outputDir || 'outputs/migration';

  // 1. Create migration root (idempotent)
  if (!folderMap.migration_root?.feishu_token) {
    const migrationRootName = config.root_name || '石墨迁移';
    console.log(`\n📁 创建迁移根目录: "${migrationRootName}"`);
    try {
      const result = await createFolder({
        name: migrationRootName,
        parentToken: config.target_root_token || undefined,
      });
      folderMap.migration_root = {
        name: migrationRootName,
        feishu_token: result.token,
        feishu_url: result.url,
        created_at: new Date().toISOString(),
      };
      await saveFolderMap(folderMap, outputDir);
    } catch (e) {
      if (e.message?.includes('folder_exists')) {
        const existing = await findChildFolder(config.target_root_token || '', migrationRootName);
        if (!existing) {
          console.log('   ⚠️ 迁移根目录已存在，但无法自动解析 token。请使用 --target-root 指定父目录或更换 --root-name。');
          throw e;
        }
        folderMap.migration_root = {
          name: migrationRootName,
          feishu_token: existing.token,
          feishu_url: existing.url || `https://my.feishu.cn/drive/folder/${existing.token}`,
          status: 'reused_existing',
          created_at: new Date().toISOString(),
        };
        await saveFolderMap(folderMap, outputDir);
      } else {
        throw e;
      }
    }
  } else {
    console.log(`   ⏭️ 迁移根目录已存在: ${folderMap.migration_root.feishu_token}`);
  }

  // 2. Create space folders
  console.log('\n📁 创建空间目录...');
  const spaces = getUniqueSpaces(files);
  for (const [sid, spaceInfo] of Object.entries(spaces)) {
    if (folderMap.spaces[sid]?.feishu_folder_token) {
      console.log(`   ⏭️ 空间已存在: ${spaceInfo.shimo_space_name}`);
      continue;
    }

    try {
      const result = await createFolder({
        name: spaceInfo.shimo_space_name,
        parentToken: folderMap.migration_root.feishu_token,
      });
      folderMap.spaces[sid] = {
        ...spaceInfo,
        feishu_folder_token: result.token,
        feishu_parent_token: folderMap.migration_root.feishu_token,
        feishu_path: `/${folderMap.migration_root.name}/${spaceInfo.shimo_space_name}`,
        status: 'created',
        created_at: new Date().toISOString(),
      };
      console.log(`   ✅ ${spaceInfo.shimo_space_name} → ${result.token}`);
      await saveFolderMap(folderMap, outputDir);
    } catch (e) {
      if (e.message?.includes('folder_exists')) {
        const existing = await findChildFolder(folderMap.migration_root.feishu_token, spaceInfo.shimo_space_name);
        if (!existing) throw e;
        folderMap.spaces[sid] = {
          ...spaceInfo,
          feishu_folder_token: existing.token,
          feishu_parent_token: folderMap.migration_root.feishu_token,
          feishu_path: `/${folderMap.migration_root.name}/${spaceInfo.shimo_space_name}`,
          status: 'reused_existing',
        };
        await saveFolderMap(folderMap, outputDir);
      } else {
        throw e;
      }
    }
  }

  // 3. Create nested folders (if file list has folder structure)
  console.log('\n📁 创建嵌套文件夹...');
  await createNestedFolders(files, folderMap, outputDir);

  return folderMap;
}

// ===== CREATE NESTED FOLDERS =====
async function createNestedFolders(files, folderMap, outputDir) {
  // Extract unique folder paths from the file list
  const folderPaths = new Set();
  const folderContext = new Map();
  for (const f of files) {
    if (f.folder_path && f.folder_path.length > 0) {
      const parts = f.folder_path.split('/').filter(Boolean);
      for (let i = 0; i < parts.length; i++) {
        const segment = parts.slice(0, i + 1).join('/');
        const key = makeNestedKey(f.space_id || 'unknown', segment);
        folderPaths.add(key);
        if (!folderContext.has(key)) folderContext.set(key, { space_id: f.space_id || 'unknown', path: segment });
      }
    }
  }

  if (folderPaths.size === 0) {
    console.log('   ℹ️ 无嵌套文件夹（文件列表中无 folder_path 字段）');
    return;
  }

  // Sort by depth (shallow first) and then alphabetically.
  const sortedSegments = [...folderPaths].sort((a, b) => {
    const pathA = folderContext.get(a)?.path || a;
    const pathB = folderContext.get(b)?.path || b;
    const depthA = pathA.split('/').length;
    const depthB = pathB.split('/').length;
    if (depthA !== depthB) return depthA - depthB;
    return a.localeCompare(b);
  });

  console.log(`   📁 ${sortedSegments.length} 个嵌套文件夹需要创建`);

  let created = 0;
  let skipped = 0;

  for (const key of sortedSegments) {
    const ctx = folderContext.get(key);
    const segment = ctx.path;
    const sid = ctx.space_id || 'unknown';
    const folderName = segment.split('/').pop();
    const parentPath = segment.split('/').slice(0, -1).join('/');
    const parentKey = parentPath ? makeNestedKey(sid, parentPath) : '';

    if (folderMap.nested[key]?.feishu_folder_token) {
      skipped++;
      continue;
    }

    let parentToken = null;
    if (parentPath && folderMap.nested[parentKey]?.feishu_folder_token) {
      parentToken = folderMap.nested[parentKey].feishu_folder_token;
    } else {
      parentToken = folderMap.spaces[sid]?.feishu_folder_token || folderMap.migration_root?.feishu_token;
    }

    if (!parentToken) {
      console.log(`   ⚠️ 无法确定父文件夹: ${key}`);
      continue;
    }

    try {
      const result = await createFolder({ name: folderName, parentToken });
      folderMap.nested[key] = {
        space_id: sid,
        folder_path: segment,
        feishu_folder_token: result.token,
        feishu_parent_token: parentToken,
        name: folderName,
        status: 'created',
        created_at: new Date().toISOString(),
      };
      created++;
      await saveFolderMap(folderMap, outputDir);
    } catch (e) {
      if (e.message?.includes('folder_exists')) {
        const existing = await findChildFolder(parentToken, folderName);
        if (existing) {
          folderMap.nested[key] = {
            space_id: sid,
            folder_path: segment,
            feishu_folder_token: existing.token,
            feishu_parent_token: parentToken,
            name: folderName,
            status: 'reused_existing',
          };
        } else {
          folderMap.nested[key] = { space_id: sid, folder_path: segment, feishu_folder_token: null, name: folderName, status: 'exists_unresolved' };
        }
        skipped++;
        await saveFolderMap(folderMap, outputDir);
      } else {
        console.log(`   ❌ 创建文件夹失败: ${key} — ${e.message}`);
      }
    }
  }

  console.log(`   ✅ 创建 ${created} 个, 跳过 ${skipped} 个`);
}

// ===== GET TARGET FOLDER TOKEN FOR FILE =====
/**
 * 根据文件的 space_id 和 folder_path 确定飞书目标文件夹 token
 */
export function getTargetFolderToken(file, folderMap) {
  // If file has a folder_path, look up the nested folder token
  if (file.folder_path && file.folder_path.length > 0) {
    const key = makeNestedKey(file.space_id || 'unknown', file.folder_path);
    const token = folderMap.nested?.[key]?.feishu_folder_token || folderMap.nested?.[file.folder_path]?.feishu_folder_token;
    if (token) return token;
  }

  // If file has parent_guid that maps to a created folder
  if (file.parent_guid && folderMap.folders[file.parent_guid]?.feishu_folder_token) {
    return folderMap.folders[file.parent_guid].feishu_folder_token;
  }

  // If file belongs to a space
  const sid = file.space_id || 'unknown';
  if (folderMap.spaces[sid]?.feishu_folder_token) {
    return folderMap.spaces[sid].feishu_folder_token;
  }

  // Fallback to migration root
  return folderMap.migration_root?.feishu_token;
}

// ===== GET FEISHU PATH FOR FILE =====
export function getFeishuPath(file, folderMap) {
  const rootName = folderMap.migration_root?.name || '石墨迁移';
  const spaceName = folderMap.spaces[file.space_id]?.shimo_space_name || '未知空间';

  if (file.folder_path && file.folder_path.length > 0) {
    return `${rootName}/${spaceName}/${file.folder_path}/${file.name}`;
  }
  return `${rootName}/${spaceName}/${file.name}`;
}

// ===== INIT FOLDER MAP =====
function initFolderMap(rootName) {
  return {
    migration_root: null,
    spaces: {},
    folders: {},
    nested: {},
  };
}

// ===== SAVE FOLDER MAP =====
async function saveFolderMap(folderMap, outputDir) {
  fs.mkdirSync(outputDir, { recursive: true });
  const tmpPath = path.join(outputDir, '.folder_map.tmp.json');
  const finalPath = path.join(outputDir, 'folder_map.json');
  fs.writeFileSync(tmpPath, JSON.stringify(folderMap, null, 2));
  fs.renameSync(tmpPath, finalPath);
}

// ===== LOAD FOLDER MAP =====
export function loadFolderMap(outputDir) {
  const p = path.join(outputDir, 'folder_map.json');
  if (!fs.existsSync(p)) return null;
  return JSON.parse(fs.readFileSync(p, 'utf-8'));
}

function makeNestedKey(spaceId, folderPath) {
  return `${spaceId || 'unknown'}::${folderPath || ''}`;
}

async function findChildFolder(parentToken, name) {
  const listed = await listFolderChildren(parentToken || '');
  if (!listed.success) return null;
  return listed.files.find(f => f.name === name && (f.type === 'folder' || f.file_type === 'folder')) || null;
}
