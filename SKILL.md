---
name: shimo-api-migration
version: 1.0.1
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
- Before any command that writes to Feishu/Lark, explicitly confirm migration scope, destination, root folder name, fallback strategy, and output directory.
- Never reveal `app_secret`, tokens, cookies, sessions, real migration reports, private file names, or private links unless the user explicitly asks inside their own local environment.
- Use OAuth user authorization. Do not use tenant-token or bot-owner permission repair flows.
- Do not claim batch concurrency, adaptive global rate-limit scheduling, or fully verified Windows/Linux support in v1.0.1.

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
4. Check installation and environment with `npm run doctor`.
5. Check Feishu/Lark credentials and Shimo login status.
6. Run scan/scope resolution or dry run to produce a migration plan.
7. Explain the interpreted scope, destination plan, unsupported files, and whether the next action writes to Feishu/Lark.
8. Ask for explicit confirmation before real migration.
9. During migration, explain progress and whether the run is resumed from state.
10. At the end, report successes, failures, retry candidates, fallback candidates, and next choices.

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

1. Run scan or dry run to obtain the file list.
2. Translate user scope into include/exclude rules.
3. Run `scripts/scope_resolver.mjs` to generate a selected file list.
4. Explain the interpreted scope back to the user.
5. Ask for confirmation.
6. Run migration with `--file-list <selected_file_list.json>` only after confirmation.

`--types` is advanced/debug only. Do not lead normal users with it.

## Feishu/Lark Destination Selection

Ask where migrated content should land:

1. Existing Feishu/Lark folder: ask for folder URL or token, extract `/drive/folder/<token>`, and use `--target-root <token>`.
2. New migration folder under My Space root: ask for root folder name and use `--root-name <name>` without `--target-root`.
3. New migration folder under an existing folder: ask for parent folder URL/token and root folder name, then use `--target-root <token> --root-name <name>`.

Before writing, summarize destination clearly and ask for confirmation.

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

If the second attempt fails, mark it as a decision candidate, record Shimo link/path/type/attempts/failure classification, continue the migration, and do not immediately execute fallback.

### Unsupported API types（明确不支持 API 的类型）

For known unsupported types such as `table`, skip API export, record as `fallback_candidate`, report at the end, and wait for the user's decision.

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

Fallback（兜底迁移）is not executed automatically by default. Default mode is `collect`.

- `off`: do not collect/execute fallback candidates.
- `collect`: collect candidates and report them for user decision.
- `execute`: execute fallback only for user-approved candidate lists.

Fallback preserves readability and traceability, not original editability:

- `newdoc` / `modoc`: Feishu docx + PDF reference + original Shimo link.
- `mindmap`: Feishu docx + screenshot reference + original Shimo link.
- `sheet` / `mosheet`: Feishu docx + screenshot reference + original Shimo link.
- Unsupported/unrecoverable types: Feishu docx + screenshot/reference + original Shimo link.

## Commands

```bash
npm run setup
npm run doctor
npm run login
npm run migrate -- --dry-run
npm run scope -- --file-list outputs/migration/shimo_file_list.json --include "企业空间/项目资料" --output outputs/migration/selected_file_list.json --explain
npm run migrate -- --file-list outputs/migration/selected_file_list.json --dry-run
npm run migrate -- --file-list outputs/migration/selected_file_list.json --root-name "石墨迁移"
npm run migrate -- --resume
npm run migrate -- --retry-candidate-list outputs/migration/retry_subset.json
npm run migrate -- --fallback-mode execute --fallback-candidate-list outputs/migration/fallback_subset.json
```

## Configuration

Use local `migration.config.json`, copied from `migration.config.example.json`. Never commit it.

```json
{
  "feishu": {
    "app_id": "cli_xxx",
    "app_secret": "your_app_secret",
    "target_root_token": ""
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

## Implemented v1.0.1 Features

- Agent-installable repository structure with `SKILL.md`, `AGENTS.md`, `INSTALL.md`, scripts, and references.
- Agent-guided migration workflow.
- Full-account scan.
- Natural-language scope support through deterministic include/exclude resolver.
- Feishu/Lark folder tree creation and path preservation.
- User-selected destination via `--target-root` / `feishu.target_root_token`.
- OAuth user authorization.
- API export and Feishu/Lark upload/import.
- Auto resume when state is compatible.
- Automatic second API attempt per failed supported file.
- Unsupported API types collected as fallback candidates.
- Failure classifier and observable export metadata.
- User-approved fallback execution.
- Local and remote verification.
- Redacted reports plus retry/fallback candidate lists.

## Not Implemented in v1.0.1

- Batch concurrency and adaptive global rate-limit scheduling.
- Full interactive CLI setup wizard. Agent-guided flow is the primary interface.
- Fully verified Windows/Linux end-to-end migration. Read `references/platform_compatibility.md`.

## Output

`outputs/migration/` contains state, folder map, reports, exports, logs, fallback artifacts, and candidate lists. Do not publish real outputs.