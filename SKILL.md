---
name: shimo-api-migration
version: 1.0.0
description: Agent-first Shimo to Feishu migration assistant using Shimo export APIs. Guides users through scope confirmation, Feishu destination selection, dry run, safe execution, recovery, and fallback decisions.
agents: [workbuddy, claude-code, codex, codex-cli, cursor, trae]
tags: [shimo, feishu, lark, migration, documents]
license: MIT
---

# Shimo API Migration

Migrate Shimo documents to Feishu Drive using Shimo internal export APIs and Feishu OAuth `user_access_token`.

This is an agent-first migration Skill. Treat the CLI as the execution engine, not the main product interface.

This project is not an official Shimo or Feishu tool. It relies on Shimo internal export endpoints that may change.

## Non-Negotiable Safety Rules

- Shimo source files are read-only. Never delete, rename, move, edit, overwrite, or otherwise modify any Shimo document, folder, or account content.
- Existing Feishu user files are non-destructive. Never delete, rename, move, overwrite, or modify any pre-existing Feishu file/folder/document.
- The tool may only create new Feishu folders/files/docx fallback documents inside the user-confirmed destination.
- Before any command that writes to Feishu, explicitly confirm migration scope, destination, root folder name, fallback strategy, and output directory.
- Do not reveal `app_secret`, tokens, cookies, sessions, real migration reports, private file names, or private links unless the user explicitly asks inside their own local environment.
- Use OAuth `user_access_token`; do not use tenant-token/bot-owner permission repair flows.
- Do not claim batch concurrency or adaptive global rate-limit scheduling is implemented in v1.0.

## Terminology for Chinese Conversations

When speaking Chinese, prefer translated Chinese terms in user-facing replies. Do not use naked English jargon. If the English term is needed because it maps to a CLI option, use `English term（中文解释）` on first mention, then use the Chinese term afterwards.

Preferred Chinese terms:

- dry run → 预演（只生成迁移计划，不导出、不上传、不写飞书）
- resume → 断点续跑（从上次中断状态继续）
- retry → 重试（再次尝试失败文件）
- fallback → 兜底迁移（用飞书 docx 记录截图或 PDF 引用加石墨原链接）
- OAuth → 飞书授权登录（让工具以用户身份写入飞书）
- token → 令牌（文件夹或授权标识，不要公开）
- candidate → 候选项（等待用户决定如何处理的失败文件）

## Default Agent-Guided Migration Workflow

When the user enters this Skill or says they want to migrate Shimo to Feishu, do not immediately run migration. Start by explaining the default behavior:

1. The assistant first confirms the migration scope in natural language.
2. The assistant confirms the Feishu destination: existing folder, new folder under My Space root, or new folder under an existing folder.
3. The assistant checks credentials and login status.
4. The assistant runs dry run（预演/只生成迁移计划，不写飞书）first.
5. The assistant explains the dry-run result and asks for confirmation before writing to Feishu.
6. If the task is interrupted, the assistant auto-resumes（自动断点续跑）when the saved state clearly matches the same task.
7. If a specific file fails once, the tool automatically performs one second API attempt.
8. If the second attempt fails, the file is marked as a decision candidate. The migration continues; do not interrupt the whole task.
9. Files that are clearly unsupported by the API are skipped from API attempts and recorded as fallback candidates.
10. At the end, the assistant reports failed/fallback candidates and lets the user choose retry（重试）, fallback（兜底迁移）, or skip（放弃迁移）per file or per subset.

## Migration Scope Selection

Do not make Shimo type selection (`newdoc`, `mosheet`, `mindmap`) the primary user-facing flow. Users think in paths, files, spaces, and links.

Ask the user to describe the scope naturally, for example:

- 全部迁移
- 只迁移“企业空间/项目资料/2024复盘”
- 只迁移这个石墨链接
- 迁移“投放素材库”和“红书 SOP”两个文件夹
- 排除“归档”“历史备份”“测试文件”

Agent process:

1. Run scan or dry run to obtain the file list.
2. Translate the user's natural language into include/exclude rules.
3. Use `scripts/scope_resolver.mjs` to generate a selected file list.
4. Explain the interpreted scope back to the user.
5. Ask for confirmation.
6. Run migration with `--file-list <selected_file_list.json>` only after confirmation.

Scope resolver examples:

```bash
npm run scope -- --file-list outputs/migration/shimo_file_list.json --include "企业空间/项目资料" --exclude "归档" --output outputs/migration/selected_file_list.json --explain
npm run migrate -- --file-list outputs/migration/selected_file_list.json --dry-run
```

`--types` remains available only as an advanced/debug option. Do not lead normal users with it.

## Feishu Destination Selection

Ask where migrated content should land:

1. Existing Feishu folder:
   - Ask user to paste folder URL or token.
   - Extract token from `/drive/folder/<token>` when a URL is provided.
   - Use `--target-root <token>`.

2. New migration folder under Feishu My Space root:
   - Ask for migration root folder name.
   - Do not pass `--target-root`.
   - Use `--root-name <name>`.

3. New migration folder under a specific existing Feishu folder:
   - Ask for parent folder URL/token.
   - Ask for migration root folder name.
   - Use `--target-root <token> --root-name <name>`.

Before writing to Feishu, summarize destination clearly and ask for confirmation.

## Dry Run First

Always run dry run（预演/只生成迁移计划，不写飞书）before real migration unless the user explicitly says they already reviewed the current dry-run result.

Dry-run command:

```bash
npm run migrate -- --dry-run --file-list <selected_file_list.json> --root-name "石墨迁移"
```

After dry run, summarize:

- Total files.
- Included/excluded scope.
- File paths or folder paths matched.
- Unsupported/fallback candidate count.
- Feishu destination plan.
- Whether any action will write to Feishu.

## Failure Recovery Workflow

### Auto resume（自动断点续跑）

If `migration_state.json` exists and clearly belongs to the same output directory/task, auto-run with `--resume`. Ask the user only when:

- Destination changed.
- Scope changed.
- State file is corrupted or incomplete.
- It is unclear whether the saved state belongs to the current task.
- Resume fails.

### Automatic second API attempt（自动第二次尝试）

For supported file types, if a single file fails the first API migration attempt, the tool automatically tries one more time.

If the second attempt fails:

- Mark it as `fallback_candidate` or failed decision candidate.
- Record Shimo link, path, type, attempts, observable export metadata, and failure classification.
- Continue the migration.
- Do not immediately execute fallback.

### Unsupported API types（明确不支持 API 的类型）

If a file type is known to be unsupported, such as `table`, do not waste time on two API attempts.

- Skip API export.
- Record it as `fallback_candidate`.
- Report it at the end.
- Wait for the user's decision.

### Flexible user decisions after report

At the end, give the user flexible options. The user may choose different actions for different files:

- Retry all failed files.
- Retry only selected files.
- Fallback all recommended fallback candidates.
- Fallback only selected files.
- Skip/abandon selected files.
- Leave the rest unresolved.

Use generated files:

- `retry_candidates.json`
- `fallback_candidates.json`

The user or agent can edit/copy subsets and then run:

```bash
npm run migrate -- --retry-candidate-list outputs/migration/retry_subset.json --output-dir outputs/migration
npm run migrate -- --fallback-mode execute --fallback-candidate-list outputs/migration/fallback_subset.json --output-dir outputs/migration
```

## Fallback Rules

Fallback（兜底迁移）is not executed automatically by default. Default mode is `collect`.

Fallback mode:

- `off`: do not collect/execute fallback candidates.
- `collect`: collect candidates and report them for user decision. Default.
- `execute`: execute fallback only for user-approved candidate lists.

Fallback by type:

- `newdoc` / `modoc`: Feishu docx + PDF reference + original Shimo link.
- `mindmap`: Feishu docx + screenshot reference + original Shimo link.
- `sheet` / `mosheet`: Feishu docx + screenshot reference + original Shimo link.
- Unsupported/unrecoverable types: Feishu docx + screenshot/reference + original Shimo link.

Explain clearly that fallback preserves visibility/reference, not original editability.

## Configuration

Use `migration.config.json`:

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

## Commands

```bash
npm install
npm run login
npm run migrate -- --dry-run
npm run scope -- --file-list outputs/migration/shimo_file_list.json --include "企业空间/项目资料" --output outputs/migration/selected_file_list.json --explain
npm run migrate -- --file-list outputs/migration/selected_file_list.json --dry-run
npm run migrate -- --file-list outputs/migration/selected_file_list.json --root-name "石墨迁移"
npm run migrate -- --resume
npm run migrate -- --retry-candidate-list outputs/migration/retry_subset.json
npm run migrate -- --fallback-mode execute --fallback-candidate-list outputs/migration/fallback_subset.json
```

## Implemented v1.0 Features

- Agent-guided migration workflow.
- Full-account scan.
- Natural-language scope support through deterministic include/exclude resolver.
- Feishu folder tree creation and path preservation.
- User-selected destination via `--target-root` / `feishu.target_root_token`.
- OAuth user authorization.
- API export and Feishu upload/import.
- Auto resume when state is compatible.
- Automatic second API attempt per failed supported file.
- Unsupported API types collected as fallback candidates.
- Failure classifier and observable export metadata.
- User-approved fallback execution.
- Local and remote verification.
- Redacted reports plus retry/fallback candidate lists. Reports redact Feishu tokens, Feishu document/file URLs, fallback artifact tokens, and verification metadata by default; candidate lists intentionally keep Shimo GUIDs/links for local subset decisions and must not be published.

## Not Implemented in v1.0

- Batch concurrency and adaptive global rate-limit scheduling.
- Full interactive CLI setup wizard. Agent-guided flow in this SKILL.md is the primary interface.

## Bilingual / Translation Requirements for GitHub

Keep these in both Chinese and English before public release:

- README quick start and safety notice.
- Non-official API disclaimer.
- Feishu OAuth setup guide.
- Shimo login guide.
- Agent workflow guide.
- Failure recovery / retry / fallback guide.
- Configuration reference.
- Troubleshooting FAQ.
- Report field explanations.

For Chinese docs and Chinese conversations, never use dry run/resume/retry/fallback/OAuth/token without a Chinese explanation on first mention.

## Output

`outputs/migration/` contains state, folder map, reports, exports, logs, fallback artifacts, and candidate lists. Do not publish real outputs.
