/**
 * scan.mjs — 石墨文件列表扫描
 *
 * 通过 Playwright page.evaluate 调用石墨内部 API 获取文件列表。
 * 保留空间和嵌套文件夹路径结构。
 *
 * 数据来源优先级：
 *   1. 用户明确提供的 shimo_file_list.json
 *   2. 石墨根目录入口 + 真实文件夹 GUID 子项 API
 *   3. 页面 DOM 提取（仅在根目录 API 失败时降级）
 *
 * 不自动复用常见输出目录中的旧文件列表，避免把历史漏扫结果当作新扫描结果。
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
 * @param {boolean} [opts.allowIncompleteScan] - 仅调试使用；允许扫描存在目录异常时返回部分结果
 * @returns {Promise<Array>} 资源列表（含 folder_path 字段）
 */
export async function scanShimoFiles(page, opts = {}) {
  // 1. Use existing file list if provided
  if (opts.fileListPath && fs.existsSync(opts.fileListPath) && !opts.forceRescan) {
    console.log(`📂 使用已有文件列表: ${opts.fileListPath}`);
    return JSON.parse(fs.readFileSync(opts.fileListPath, 'utf-8'));
  }

  // 2. Scan via API (with folder path resolution).
  // Never auto-load an old output file: callers must explicitly pass fileListPath.
  console.log('🔍 通过石墨 API 扫描文件列表（含文件夹路径）...');
  const resources = await scanViaApi(page, opts);

  if (resources.length === 0) {
    throw new Error('无法获取石墨文件列表。请提供 --file-list 参数或确保已登录石墨');
  }

  console.log(`   ✅ 扫描到 ${resources.length} 个文件（含嵌套文件夹路径）`);
  return resources;
}

// ===== SCAN VIA INTERNAL API =====
async function scanViaApi(page, opts = {}) {
  await page.goto('https://shimo.im/recent', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await sleep(3000);

  // 根层是特殊入口；只有进入真实文件夹后，才使用 GUID 子项接口。
  const fetchJson = async (endpoint) => page.evaluate(async url => {
    const response = await fetch(url, { credentials: 'include' });
    const text = await response.text();
    let data = null;
    try { data = JSON.parse(text); } catch {}
    return { status: response.status, ok: response.ok, data, raw: data ? null : text.slice(0, 300) };
  }, endpoint);

  const rootResponse = await fetchJson('https://shimo.im/lizard-api/api/files?folderId=0');
  const rootItems = rootResponse.data;
  if (!rootResponse.ok || !Array.isArray(rootItems) || rootItems.length === 0) {
    console.log(`   ⚠️ 根目录 API 失败（HTTP ${rootResponse.status}），尝试页面提取...`);
    return await extractFromPage(page);
  }

  const allItems = [];
  const seenFileGuids = new Set();
  const seenFolderGuids = new Set();
  const folderNames = new Map();
  const errors = [];
  const parentMismatches = [];
  const shortcuts = [];
  const supportedTypes = ['newdoc', 'mosheet', 'sheet', 'mindmap', 'modoc', 'presentation', 'table', 'form', 'board'];

  const getGuid = item => String(item?.guid || item?.fileGuid || item?.file_guid || '');
  const getFolderKey = item => getGuid(item) || String(item?.id || '');
  const getParentId = item => item?.parentId ?? item?.parent_id ?? null;
  const isFolder = item => Boolean(item?.isFolder ?? item?.is_folder);
  const isShortcut = item => Boolean(
    item?.isShortcut || item?.is_shortcut || item?.shortcut || item?.shortcutGuid ||
    item?.shortcut_guid || item?.sourceGuid || item?.source_guid || item?.type === 'shortcut'
  );

  const rememberFolder = (item, parentPath) => {
    const key = getFolderKey(item);
    if (!key) return;
    folderNames.set(key, {
      name: item.name || item.title || '(未命名)',
      parent_id: getParentId(item),
      path: parentPath || '',
    });
  };

  const processItems = async (items, currentFolder, currentPath) => {
    for (const rawItem of Array.isArray(items) ? items : []) {
      const item = rawItem || {};
      if (isShortcut(item)) {
        shortcuts.push({ ...item, observed_in: currentPath });
        continue;
      }

      const parentId = getParentId(item);
      const expectedParent = currentFolder ? (currentFolder.id ?? null) : 0;
      if (parentId !== null && String(parentId) !== String(expectedParent)) {
        parentMismatches.push({ expectedParentId: expectedParent, observedIn: currentPath, item });
        continue;
      }

      if (isFolder(item)) {
        const folderGuid = getGuid(item);
        if (!folderGuid) {
          errors.push({ kind: 'folder_missing_guid', observedIn: currentPath, item });
          continue;
        }
        const folderKey = getFolderKey(item);
        const folderName = item.name || item.title || '(未命名)';
        const folderPath = currentPath ? `${currentPath}/${folderName}` : folderName;
        rememberFolder(item, currentPath);
        if (seenFolderGuids.has(folderKey)) continue;
        seenFolderGuids.add(folderKey);
        await walkFolder({ ...item, guid: folderGuid }, folderPath);
        continue;
      }

      const guid = getGuid(item);
      if (!guid || seenFileGuids.has(guid)) continue;
      // 保留不支持类型，让迁移层统一分类为兜底候选项，而不是在扫描阶段静默丢失。
      if (item.type && !supportedTypes.includes(String(item.type).toLowerCase())) {
        console.log(`   ℹ️ 保留未识别类型文件: ${item.name || item.title || guid} (${item.type})`);
      }
      seenFileGuids.add(guid);
      allItems.push({ ...item, guid, _folder_path: currentPath || '' });
    }
  };

  const walkFolder = async (folder, folderPath) => {
    const response = await fetchJson(`https://shimo.im/lizard-api/files?folder=${encodeURIComponent(folder.guid)}`);
    if (!response.ok || !Array.isArray(response.data)) {
      errors.push({ kind: 'folder_listing_failed', folder: { guid: folder.guid, id: folder.id, name: folder.name, path: folderPath }, status: response.status, raw: response.raw });
      return;
    }
    await processItems(response.data, folder, folderPath);
  };

  await processItems(rootItems, null, '');
  if (allItems.length === 0) {
    console.log('   ⚠️ 正确目录 API 未返回文件，尝试页面提取...');
    return await extractFromPage(page);
  }

  console.log(`   ✅ API /lizard-api/files: ${allItems.length} 个文件，${seenFolderGuids.size} 个文件夹，跳过 ${shortcuts.length} 个快捷方式，${errors.length} 个错误`);
  if (parentMismatches.length) console.log(`   ⚠️ 忽略 ${parentMismatches.length} 个父目录不匹配条目`);
  if (errors.length || parentMismatches.length) {
    const auditPath = path.join(process.cwd(), 'outputs', 'migration', 'scan_audit.json');
    fs.mkdirSync(path.dirname(auditPath), { recursive: true });
    fs.writeFileSync(auditPath, JSON.stringify({
      scannedAt: new Date().toISOString(),
      endpoints: {
        root: '/lizard-api/api/files?folderId=0',
        children: '/lizard-api/files?folder=<folderGuid>',
      },
      errors,
      parentMismatches,
    }, null, 2));
    console.log(`   ⚠️ 扫描审计异常已保存: ${auditPath}`);
    if (!opts.allowIncompleteScan) {
      throw new Error(`石墨目录扫描不完整：${errors.length} 个目录读取错误，${parentMismatches.length} 个父目录不匹配。已停止生成迁移计划，请检查 ${auditPath}`);
    }
  }

  return allItems.map(item => ({
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
    parent_guid: item.parent_guid || item.parentGuid || item.parent_id || item.parentId || null,
    folder_path: item._folder_path || '',
    _scan_errors: errors.length,
    _parent_mismatches: parentMismatches.length,
    _shortcuts_skipped: shortcuts.length,
  }));
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
