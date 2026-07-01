/**
 * scan.mjs — 石墨文件列表扫描
 *
 * 通过 Playwright page.evaluate 调用石墨内部 API 获取文件列表。
 * 保留空间和嵌套文件夹路径结构。
 *
 * 数据来源优先级：
 *   1. 用户提供的 shimo_file_list.json
 *   2. 石墨内部 API (/lizard-api/files?type=used)
 *   3. 页面 DOM 提取 (降级方案)
 */

import fs from 'fs';
import path from 'path';

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ===== SCAN VIA SHIMO API =====
/**
 * 通过石墨 API 扫描文件列表（含嵌套文件夹路径）
 * @param {import('playwright').Page} page
 * @param {Object} opts
 * @param {string} [opts.fileListPath] - 已有的文件列表 JSON 路径
 * @param {boolean} [opts.forceRescan] - 忽略已有文件列表，强制重新扫描
 * @returns {Promise<Array>} 资源列表（含 folder_path 字段）
 */
export async function scanShimoFiles(page, opts = {}) {
  // 1. Use existing file list if provided
  if (opts.fileListPath && fs.existsSync(opts.fileListPath) && !opts.forceRescan) {
    console.log(`📂 使用已有文件列表: ${opts.fileListPath}`);
    return JSON.parse(fs.readFileSync(opts.fileListPath, 'utf-8'));
  }

  // 2. Try common output locations
  const commonPaths = [
    path.join(process.cwd(), 'outputs', 'shimo_file_list.json'),
    path.join(process.cwd(), '..', 'outputs', 'shimo_file_list.json'),
  ];
  for (const p of commonPaths) {
    if (fs.existsSync(p) && !opts.forceRescan) {
      console.log(`📂 发现已有文件列表: ${p}`);
      return JSON.parse(fs.readFileSync(p, 'utf-8'));
    }
  }

  // 3. Scan via API (with folder path resolution)
  console.log('🔍 通过石墨 API 扫描文件列表（含文件夹路径）...');
  const resources = await scanViaApi(page);

  if (resources.length === 0) {
    throw new Error('无法获取石墨文件列表。请提供 --file-list 参数或确保已登录石墨');
  }

  console.log(`   ✅ 扫描到 ${resources.length} 个文件（含嵌套文件夹路径）`);
  return resources;
}

// ===== SCAN VIA INTERNAL API =====
async function scanViaApi(page) {
  await page.goto('https://shimo.im/recent', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await sleep(3000);

  // Step 1: Get root folder contents
  const rootItems = await page.evaluate(async () => {
    const r = await fetch('https://shimo.im/lizard-api/api/files?folderId=0', { credentials: 'include' });
    if (!r.ok) return [];
    return await r.json();
  });

  if (!Array.isArray(rootItems) || rootItems.length === 0) {
    console.log('   ⚠️ API 均失败，尝试页面提取...');
    return await extractFromPage(page);
  }

  // Collect folder names and IDs for path resolution
  const folderNames = new Map();
  const subFolderIds = [];
  
  const supportedTypes = ['newdoc', 'mosheet', 'sheet', 'mindmap', 'modoc', 'presentation', 'table'];

  for (const item of rootItems) {
    if (item.isFolder && item.id) {
      folderNames.set(String(item.id), { name: item.name || '(未命名)', parent_id: item.parent_id || item.parentId });
      subFolderIds.push(item.id);
    }
  }

  // Step 2: Fetch ALL subfolders in parallel
  const subResults = await page.evaluate(async (folderIds) => {
    const results = {};
    const promises = folderIds.map(async (fid) => {
      try {
        const r = await fetch(`https://shimo.im/lizard-api/api/files?folderId=${fid}`, { credentials: 'include' });
        if (r.ok) {
          results[fid] = await r.json();
        } else {
          results[fid] = [];
        }
      } catch { results[fid] = []; }
    });
    await Promise.all(promises);
    return results;
  }, subFolderIds);

  // Step 3: Build complete file list with folder paths
  const allItems = [];
  const seenFileGuids = new Set();
  const processedFolders = new Set();
  const isShortcut = (item) => Boolean(item.isShortcut || item.shortcut || item.shortcutGuid || item.sourceGuid || item.source_guid);
  const getFileGuid = (item) => item.guid || item.fileGuid || item.file_guid || '';
  const processItems = (items, parentPath, folderId) => {
    const fid = String(folderId);
    if (processedFolders.has(fid)) return; // Prevent infinite recursion
    processedFolders.add(fid);
    
    for (const item of Array.isArray(items) ? items : []) {
      if (!item || isShortcut(item)) continue;
      
      if (item.isFolder && item.id) {
        folderNames.set(String(item.id), { name: item.name || '(未命名)', parent_id: item.parent_id || item.parentId });
        // Also add any deeper subfolder results if they exist
        if (subResults[item.id]) {
          const subPath = parentPath ? `${parentPath}/${item.name}` : (item.name || '(未命名)');
          processItems(subResults[item.id], subPath, item.id);
        }
        continue;
      }

      const guid = getFileGuid(item);
      if (guid && supportedTypes.includes(item.type) && !seenFileGuids.has(guid)) {
        seenFileGuids.add(guid);
        allItems.push({ ...item, guid, _folder_path: parentPath || '' });
      }
    }
  };

  processItems(rootItems, '', 0);

  console.log(`   ✅ API /lizard-api/api/files: ${allItems.length} 个文件`);

  // Normalize
  const normalizedFiles = allItems.map(item => {
    let folderPath = item._folder_path || '';
    if (!folderPath && (item.parent_id || item.parentId)) {
      const pid = String(item.parent_id || item.parentId);
      if (pid !== '0' && folderNames.has(pid)) {
        const parts = [];
        let current = pid;
        while (current && folderNames.has(current)) {
          const f = folderNames.get(current);
          parts.unshift(f.name);
          current = f.parent_id ? String(f.parent_id) : null;
        }
        folderPath = parts.join('/');
      }
    }

    return {
      name: item.name || item.title || '未命名',
      type: item.type || 'unknown',
      size: item.fileSize || item.size || 0,
      guid: item.guid || '',
      url: item.url || item.link || '',
      updatedAt: item.updatedAt || item.updated_at || '',
      createdAt: item.createdAt || item.created_at || '',
      teamId: item.teamId || item.team_id || null,
      space_id: item.teamId || item.team_id ? String(item.teamId || item.team_id) : 'personal',
      space_name: item.teamId || item.team_id ? '企业空间' : '个人空间',
      parent_guid: item.parent_guid || item.parent_id || null,
      folder_path: folderPath,
    };
  });

  return normalizedFiles;
}

// ===== RESOLVE FOLDER MAP =====
/**
 * 从文件列表中提取所有唯一的 parent_guid，并通过 API 解析为文件夹名称和层级
 */
async function resolveFolderMap(page, allItems) {
  // Collect unique parent_guids that are NOT files (need to resolve as folders)
  const fileGuids = new Set(allItems.map(f => f.guid).filter(Boolean));
  const parentGuids = [...new Set(
    allItems
      .map(f => f.parent_guid)
      .filter(g => g && g !== '0' && !fileGuids.has(g))
  )];

  if (parentGuids.length === 0) {
    console.log('   ℹ️ 无嵌套文件夹需要解析');
    return new Map();
  }

  console.log(`   🔍 解析 ${parentGuids.length} 个文件夹路径...`);

  // Resolve folder names in batches to avoid rate limiting
  const folderMap = new Map();

  await page.evaluate(async (guids) => {
    const resolved = {};
    const BATCH_SIZE = 15;
    const DELAY_MS = 500;

    for (let i = 0; i < guids.length; i += BATCH_SIZE) {
      const batch = guids.slice(i, i + BATCH_SIZE);
      const results = await Promise.allSettled(
        batch.map(async (guid) => {
          try {
            const r = await fetch(`https://shimo.im/lizard-api/files/${guid}`, { credentials: 'include' });
            if (r.ok) {
              const item = await r.json();
              return { guid, name: item.name || '(未命名)', parent_guid: item.parent_guid || null, isFolder: true };
            }
            return { guid, error: `HTTP ${r.status}` };
          } catch (e) {
            return { guid, error: e.message };
          }
        })
      );

      for (const r of results) {
        if (r.status === 'fulfilled') {
          resolved[r.value.guid] = r.value;
        }
      }

      // Small delay between batches
      if (i + BATCH_SIZE < guids.length) {
        await new Promise(r => setTimeout(r, DELAY_MS));
      }
    }

    return resolved;
  }, parentGuids).then(resolved => {
    for (const [guid, info] of Object.entries(resolved || {})) {
      folderMap.set(guid, info);
    }
  });

  const resolved = folderMap.size;
  const failed = parentGuids.length - resolved;
  console.log(`   ✅ 文件夹解析: ${resolved} 成功, ${failed} 失败（空间根目录/403 等）`);

  return folderMap;
}

// ===== BUILD FOLDER PATH =====
function buildFolderPath(guid, folderMap, depth = 0) {
  if (!guid || depth > 20) return [];

  const info = folderMap.get(guid);
  if (!info || info.error) return [];

  const path = [info.name];
  if (info.parent_guid && info.parent_guid !== '0') {
    const parentPath = buildFolderPath(info.parent_guid, folderMap, depth + 1);
    path.unshift(...parentPath);
  }

  return path;
}

// ===== NORMALIZE API ITEM =====
function normalizeApiItem(item) {
  return {
    name: item.name || item.title || '未命名',
    type: item.type || item.fileType || 'unknown',
    size: item.size || item.fileSize || 0,
    guid: item.guid || item.id || item.fileGuid || '',
    url: item.url || item.link || '',
    updatedAt: item.updatedAt || item.updated_at || '',
    createdAt: item.createdAt || item.created_at || '',
    folderName: item.folderName || item.folder_name || '',
    teamId: item.teamId || item.team_id || null,
    space_id: item.space_id || item.spaceId || (item.teamId || item.team_id ? String(item.teamId || item.team_id) : 'personal'),
    space_name: item.space_name || item.spaceName || (item.teamId || item.team_id ? '企业空间' : '个人空间'),
    parent_guid: item.parent_guid || item.parentGuid || item.parentId || null,
    folder_path: '',  // will be populated if using new API
  };
}

// ===== NORMALIZE WITH FOLDER PATH =====
function normalizeWithFolderPath(item, folderMap) {
  const normalized = {
    name: item.name || item.title || '未命名',
    type: item.type || 'unknown',
    size: item.fileSize || item.size || 0,
    guid: item.guid || '',
    url: item.url || item.link || '',
    updatedAt: item.updatedAt || item.updated_at || '',
    createdAt: item.createdAt || item.created_at || '',
    teamId: item.teamId || item.team_id || null,
    space_id: item.teamId || item.team_id ? String(item.teamId || item.team_id) : 'personal',
    space_name: item.teamId || item.team_id ? '企业空间' : '个人空间',
    parent_guid: item.parent_guid || null,
  };

  // Build folder path from parent_guid
  const parentPath = normalized.parent_guid ? buildFolderPath(normalized.parent_guid, folderMap) : [];
  normalized.folder_path = parentPath.join('/');

  return normalized;
}

// ===== PAGE EXTRACTION (fallback) =====
async function extractFromPage(page) {
  try {
    const data = await page.evaluate(() => {
      const nextData = document.getElementById('__NEXT_DATA__');
      if (nextData) {
        try {
          const parsed = JSON.parse(nextData.textContent);
          if (parsed?.props?.pageProps?.files) return parsed.props.pageProps.files;
          if (parsed?.props?.pageProps?.initialState?.files) return parsed.props.pageProps.initialState.files;
        } catch {}
      }

      if (window.__INITIAL_STATE__?.files) return window.__INITIAL_STATE__.files;

      const items = [];
      document.querySelectorAll('[data-guid], [data-file-guid], [class*="file-item"], [class*="FileItem"]').forEach(el => {
        const guid = el.getAttribute('data-guid') || el.getAttribute('data-file-guid');
        const name = el.querySelector('[class*="name"], [class*="title"]')?.textContent?.trim();
        const type = el.getAttribute('data-type') || el.className.match(/type-(\w+)/)?.[1];
        if (guid && name) items.push({ guid, name, type: type || 'unknown' });
      });
      return items;
    });

    if (data && data.length > 0) {
      return data.map(normalizeApiItem);
    }
  } catch (e) {
    console.log(`   ⚠️ 页面提取失败: ${e.message}`);
  }

  return [];
}

// ===== FILTER BY TYPE =====
export function filterByTypes(files, types) {
  if (!types || types.length === 0) return files;
  return files.filter(f => {
    const t = String(f.type).toLowerCase();
    return types.some(ft => t.includes(ft.toLowerCase()));
  });
}

// ===== GET UNIQUE SPACES =====
export function getUniqueSpaces(files) {
  const spaces = {};
  for (const f of files) {
    const sid = f.space_id || 'unknown';
    if (!spaces[sid]) {
      spaces[sid] = {
        shimo_space_id: sid,
        shimo_space_name: f.space_name || '未知空间',
      };
    }
  }
  return spaces;
}

// ===== GET UNIQUE FOLDERS (for nested folder tree) =====
export function getUniqueFolders(files) {
  const folders = new Map();
  for (const f of files) {
    if (f.folder_path && f.space_id) {
      const key = `${f.space_id}::${f.folder_path}`;
      if (!folders.has(key)) {
        folders.set(key, {
          space_id: f.space_id,
          folder_path: f.folder_path,
        });
      }
    }
  }
  return [...folders.values()];
}
