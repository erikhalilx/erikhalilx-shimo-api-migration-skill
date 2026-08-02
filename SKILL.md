---
name: shimo-api-migration
version: 1.1.0
description: This skill should be used when the user wants to install or use an agent-guided Shimo to Feishu/Lark migration Skill from GitHub, migrate Shimo documents/folders/full accounts to Feishu Drive, preserve folder structure, run dry-run planning, resume interrupted migrations, retry failures, or execute user-approved fallback migration.
agent_created: true
agents: [workbuddy, claude-code, codex, codex-cli, trae]
tags: [shimo, feishu, lark, migration, documents, agent-skill]
license: MIT
---

# Shimo API Migration

Migrate Shimo documents to Feishu/Lark Drive through an agent-guided conversation. Treat this repository as an installable Skill package and treat CLI commands as deterministic execution helpers.

This project is not an official Shimo or Feishu/Lark tool. It relies on Shimo internal export endpoints that may change without notice.

## Skill Installation Intent

Install the whole GitHub repository as the Skill folder. Keep `SKILL.md`, `scripts/`, `references/`, `package.json`, and `migration.config.example.json` together.

When a user sends the GitHub URL to Codex, Claude Code, WorkBuddy, Trae, or a similar agent:

1. Review `README.md`, `INSTALL.md`, `AGENTS.md`, and this `SKILL.md`.
2. Explain that npm alone installs only the CLI execution engine; the repository provides the Skill instructions and bundled resources.
3. Clone/download the full repository.
4. Run `npm run setup`.
5. Run `npm run doctor`.
6. Continue with the conversational workflow below.

For detailed installation notes, read `references/agent_installation.md`.

## Non-Negotiable Safety Rules

- Treat Shimo source files as read-only. Never delete, rename, move, edit, overwrite, or otherwise modify any Shimo document, folder, or account content.
- Treat existing Feishu/Lark user files as non-destructive. Never delete, rename, move, overwrite, or modify any pre-existing Feishu/Lark file/folder/document.
- Create only new Feishu/Lark folders/files/docx fallback documents inside the user-confirmed destination.
- A file with a real nested `folder_path` must have the matching Feishu/Lark folder token before upload. If the mapping is missing or unresolved, stop the run; never fall back to a space folder, migration root, or other higher-level folder.
- Before any command that writes to Feishu/Lark, explicitly confirm migration scope, destination, root folder name, fallback strategy, and output directory.
- Never reveal `app_secret`, tokens, cookies, sessions, real migration reports, private file names, or private links unless the user explicitly asks inside their own local environment.
- Use the official `lark-cli` user authorization backend by default. The migration process calls the CLI as a subprocess and must not extract or print its stored access tokens. Do not use tenant-token or bot-owner permission repair flows.
- Keep the built-in OAuth backend only as an explicit legacy compatibility option via `--feishu-backend oauth`; it requires the user's own local app credentials.
- Do not claim batch concurrency, adaptive global rate-limit scheduling, or fully verified Windows/Linux support in v1.1.0.

## Chinese Conversation Terminology

When speaking Chinese, prefer translated terms. Do not use naked English jargon. If a CLI option requires an English term, use `English term（中文解释）` on first mention.

- dry run → 预演（只生成迁移计划，不导出、不上传、不写飞书）
- resume → 断点续跑（从上次中断状态继续）
- retry → 重试（再次尝试失败文件）
- fallback → 兜底迁移（用飞书 docx 记录截图或 PDF 引用加石墨原链接）
- OAuth → 飞书授权登录（让工具以用户身份写入飞书）
- token → 令牌（文件夹或授权标识，不要公开）
- candidate → 候选项（等待用户决定如何处理的失败文件）

## Default Conversational Workflow

Do not immediately run real migration. Guide the user step by step:

1. Explain the safety baseline and that the first execution is a dry run（预演）.
2. Confirm Shimo migration scope in natural language.
3. Confirm Feishu/Lark destination: existing folder, new folder under My Space root, or new folder under an existing folder.
4. On the user's first migration run, ask whether they want a local migration supervisor. If yes, generate it after the output directory and safe resume runner are known. The supervisor is optional and must not block migration.
5. Check installation and environment with `npm run doctor`.
6. Check the official `lark-cli`, Feishu/Lark user authorization, and Shimo login status. Do not ask for app secrets when using the default backend.
7. Run a fresh recursive scan, scope resolution, or dry run to produce a migration plan. Do not silently reuse an old generated file list unless the user explicitly supplied it for the current task.
8. Verify scan integrity before claiming full-account coverage: root items use `/lizard-api/api/files?folderId=0`; real folder children use `/lizard-api/files?folder=<folderGuid>`; reject parent-ID mismatches, skip shortcuts, and deduplicate by file GUID. Any folder-listing error or parent-ID mismatch must stop normal migration planning; partial results are debug-only and must never be described as complete.
9. Explain the interpreted scope, destination plan, unsupported files, scan errors/mismatches, and whether the next action writes to Feishu/Lark.
10. Ask for explicit confirmation before real migration.
11. During migration, explain progress and whether the run is resumed from state.
12. At the end, report normal successes, fallback successes, files proven unmigratable by normal API, transient failures, explicitly skipped files, and Shimo source links.

For detailed user-facing phrasing, read `references/agent_conversation_workflow.md`.

## Migration Scope Selection

Do not make type selection (`newdoc`, `mosheet`, `mindmap`) the primary user-facing flow. Users think in paths, folders, files, spaces, and links.

Ask for scope naturally, for example:

- 全部迁移
- 只迁移“企业空间/项目资料/2024复盘”
- 只迁移这个石墨链接
- 迁移“投放素材库”和“红书 SOP”两个文件夹
- 排除“归档”“历史备份”“测试文件”

Process:

1. Run a fresh scan or dry run to obtain the file list. An explicitly supplied `--file-list` is allowed, but an old generated list must not be treated as proof of current full-account completeness.
2. Confirm the recursive scan reported no listing errors or parent-ID mismatches before describing the result as complete.
3. Translate user scope into include/exclude rules.
4. Run `scripts/scope_resolver.mjs` to generate a selected file list.
5. Explain the interpreted scope back to the user.
6. Ask for confirmation.
7. Run migration with `--file-list <selected_file_list.json>` only after confirmation.

`--types` is advanced/debug only. Do not lead normal users with it.

## Feishu/Lark Destination Selection

Ask where migrated content should land:

1. Existing Feishu/Lark folder: ask for folder URL or token, extract `/drive/folder/<token>`, and use `--target-root <token>`.
2. New migration folder under My Space root: ask for root folder name and use `--my-space-root --root-name <name>`. Use the explicit flag so a saved `target_root_token` cannot silently override the user's current choice.
3. New migration folder under an existing folder: ask for parent folder URL/token and root folder name, then use `--target-root <token> --root-name <name>`.

Before writing, summarize destination clearly and ask for confirmation. Never rely on omission of `--target-root` to mean My Space root when a config file may contain an older destination.

## Dry Run First

Always run dry run（预演）before real migration unless the user explicitly confirms they already reviewed the current dry-run result.

Typical command:

```bash
npm run migrate -- --dry-run --file-list <selected_file_list.json> --root-name "石墨迁移"
```

After dry run, summarize:

- Total selected files.
- Included/excluded scope.
- Matched file/folder paths.
- Unsupported/fallback candidate count.
- Feishu/Lark destination plan.
- Whether any action wrote to Feishu/Lark. It must be no.

## Failure Recovery Workflow

### Auto resume（自动断点续跑）

If `migration_state.json` exists and clearly belongs to the same output directory/task, auto-run with `--resume`. Ask the user only when destination changed, scope changed, state is corrupted, state ownership is unclear, or resume fails.

### Automatic second API attempt（自动第二次尝试）

For supported file types, if one file fails the first API migration attempt, the tool automatically tries one more time.

After the second attempt, use evidence rather than the error count alone:

- Mark `skipped_unmigratable` only when at least two independent taskIds both stayed at `progress=0`, `fileSize=0`, and empty `downloadUrl` through the 120-second stall threshold; or when at least two independent completed exports produced download URLs that both returned HTTP 404.
- Ignore `costTime`, textual task status, and progress HTTP status when determining zero-output evidence.
- Never classify network, browser-context, authorization, upload, or verification failures as permanently unmigratable. Keep those retryable and let the network circuit breaker stop the run when necessary.
- Continue with later files after a file is proven unmigratable. Do not let it block the normal migration phase.

### Unsupported API types（明确不支持 API 的类型）

For known unsupported types such as `table`, `board`, and `form`, skip API export immediately, record `skipped_unmigratable`, preserve its name/type/path/reason/Shimo link, and continue normal migration.

### Flexible user decisions

At the end, offer:

- Retry all or selected failed files.
- Fallback all or selected fallback candidates.
- Skip/abandon selected files.
- Leave unresolved files for later.

Use generated files:

- `retry_candidates.json`
- `fallback_candidates.json`

Subset commands:

```bash
npm run migrate -- --retry-candidate-list outputs/migration/retry_subset.json --output-dir outputs/migration
npm run migrate -- --fallback-mode execute --fallback-candidate-list outputs/migration/fallback_subset.json --output-dir outputs/migration
```

## Fallback Rules

Fallback（兜底迁移）runs only after the normal migration phase has processed every still-migratable file.

- `off`: record unmigratable files but do not execute fallback.
- `collect`: record unmigratable files and produce `unmigratable_files.json` for user review (default).
- `execute`: after normal migration completes, execute fallback for all files proven unmigratable in this approved migration scope. A user-approved `--fallback-candidate-list` can still execute only a selected subset.

A fallback is successful only when the Feishu docx and at least one readable PDF or screenshot reference are created. For document-like files, try PDF first; if PDF export/upload fails, automatically try a screenshot using the file's real `shimo_url`.

Fallback preserves readability and traceability, not original editability:

- `newdoc` / `modoc`: Feishu docx + PDF reference + original Shimo link.
- `mindmap`: Feishu docx + screenshot reference + original Shimo link.
- `sheet` / `mosheet`: Feishu docx + screenshot reference + original Shimo link.
- Unsupported/unrecoverable types: Feishu docx + screenshot/reference + original Shimo link.

## Optional Local Migration Supervisor

On the first migration run, ask: “是否需要生成本地迁移监督器？它会显示迁移进程、当前任务、导出尝试、阶段、最后活动、正常成功、兜底成功、无法正常迁移清单，并提供防重复启动的安全断点续跑按钮。”

If the user chooses yes, generate it only after the migration output directory and safe runner are known:

```bash
npm run supervisor -- --migration-dir <output_dir> --runner <safe_resume_runner.mjs> --output <output_dir>/migration-supervisor
```

The generated supervisor:

- Listens on `127.0.0.1:4173` by default and refreshes every 10 seconds.
- Reads `migration_state.json`, `migration-runtime-status.json`, and `migration-runtime.log`.
- Shows normal success, fallback success, explicitly skipped count, remaining count, current task/attempt/phase, last activity, and unmigratable files with Shimo links.
- Refuses duplicate migration starts and requires a local confirmation header for restart.
- Uses the supplied safe runner for断点续跑; it must never invent migration scope or destination.
- Can be kept alive by the host agent or an OS process manager. The portable template does not claim a platform-specific auto-start service.

## Feishu/Lark User Authorization

The default backend is the official `lark-cli`. `npm run setup` installs it as a project dependency. Authorize the current Feishu/Lark user before real migration:

```bash
npx lark-cli auth login --domain drive,docs
npx lark-cli auth status --verify --json
```

For agents that cannot keep a blocking command open, use the device flow:

```bash
npx lark-cli auth login --domain drive,docs --no-wait --json
npx lark-cli auth qrcode "<verification_url>" --output "lark-auth.png"
npx lark-cli auth login --device-code "<device_code>" --json
```

Ask the user to open the verification URL or QR code and confirm authorization. Never print or copy access tokens. `npm run doctor` verifies readiness without exposing token values.

## Commands

```bash
npm run setup
npm run doctor
npx lark-cli auth login --domain drive,docs
npx lark-cli auth status --verify --json
npm run login
npm run migrate -- --dry-run
npm run scope -- --file-list outputs/migration/shimo_file_list.json --include "企业空间/项目资料" --output outputs/migration/selected_file_list.json --explain
npm run migrate -- --file-list outputs/migration/selected_file_list.json --dry-run
npm run migrate -- --file-list outputs/migration/selected_file_list.json --root-name "石墨迁移" --feishu-backend lark-cli
npm run migrate -- --resume
npm run migrate -- --retry-candidate-list outputs/migration/retry_subset.json
npm run migrate -- --fallback-mode execute --fallback-candidate-list outputs/migration/fallback_subset.json
```

Use `--lark-cli-path <path>` only when the executable is not available as `lark-cli`. Use `--feishu-backend oauth` only for the legacy compatibility backend.

## Configuration

Use local `migration.config.json`, copied from `migration.config.example.json`. Never commit it.

```json
{
  "feishu": {
    "backend": "lark-cli",
    "lark_cli_path": "lark-cli",
    "target_root_token": "",
    "app_id": "",
    "app_secret": ""
  },
  "root_name": "石墨迁移",
  "output_dir": "outputs/migration",
  "cache_dir": ".cache/shimo-api-migration",
  "headless": false,
  "file_list": "",
  "migration": {
    "types": [],
    "skip_verify": false,
    "fallback_mode": "collect",
    "observe_export": true,
    "auto_resume": true,
    "auto_second_attempt": true
  }
}
```

## Implemented v1.1.0 Features

- Agent-installable repository structure with `SKILL.md`, `AGENTS.md`, `INSTALL.md`, scripts, and references.
- Agent-guided migration workflow.
- Full-account scan.
- Natural-language scope support through deterministic include/exclude resolver.
- Feishu/Lark folder tree creation and path preservation.
- User-selected destination via `--target-root` / `feishu.target_root_token`.
- Official `lark-cli` user authorization and Feishu/Lark write backend by default.
- Legacy built-in OAuth backend available only through explicit selection.
- API export and Feishu/Lark upload/import.
- Auto resume when state is compatible.
- Automatic second API attempt per failed supported file.
- Unsupported API types collected as fallback candidates.
- Failure classifier and observable export metadata.
- Evidence-based unmigratable detection and terminal skip/continue behavior.
- End-of-normal-phase fallback execution for approved scope.
- Real Shimo URL screenshot fallback and PDF-to-screenshot recovery.
- Optional generated local migration supervisor.
- Local and remote verification.
- Redacted reports plus retry/fallback candidate lists.

## Not Implemented in v1.1.0

- Batch concurrency and adaptive global rate-limit scheduling.
- Full interactive CLI setup wizard. Agent-guided flow is the primary interface.
- Fully verified Windows/Linux end-to-end migration. Read `references/platform_compatibility.md`.

## Output

`outputs/migration/` contains state, folder map, reports, exports, logs, fallback artifacts, and candidate lists. Do not publish real outputs.