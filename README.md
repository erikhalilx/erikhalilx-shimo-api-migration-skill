# shimo-api-migration

Migrate Shimo documents to Feishu Drive using Shimo internal export APIs and Feishu OAuth user access tokens.

> Disclaimer: this is not an official Shimo or Feishu tool. It relies on Shimo internal export endpoints that may change without notice. Use it only for content you own or are authorized to migrate.

## 中文说明

`shimo-api-migration` 是一个面向 agent 的石墨到飞书迁移工具。WorkBuddy、Codex、Claude Code、Trae 等 agent 应通过 `SKILL.md` 引导用户完成迁移范围确认、飞书落地位置确认、dry run（预演/只生成迁移计划，不写飞书）、真实迁移、resume（断点续跑）、retry（重试）和 fallback（兜底迁移）决策。

CLI 保留为稳定执行内核，不是唯一产品入口。

## Non-destructive safety baseline

- Shimo source files are read-only. The tool never deletes, renames, moves, edits, or overwrites Shimo documents/folders.
- Existing Feishu user files are non-destructive. The tool never deletes, renames, moves, or overwrites existing Feishu content.
- The tool only creates new Feishu folders/files/docx fallback documents inside the user-confirmed destination.
- Real outputs, credentials, tokens, cookies, sessions, and migration reports must not be published.

## Features

- Agent-guided workflow through `SKILL.md`.
- Full-account Shimo scan with folder-path preservation.
- Natural-language scope support via deterministic include/exclude resolver.
- Feishu folder tree creation under a user-selected parent folder or My Space root.
- OAuth `user_access_token`; files are created as the authorized Feishu user.
- API export for `newdoc`, `modoc`, `mosheet/sheet`, `mindmap`, and `presentation`.
- Auto resume when the saved state clearly matches the same task.
- Automatic second API attempt for supported files after the first failure.
- Unsupported API types collected as fallback candidates without wasting API attempts.
- Flexible user decisions after report: retry selected files, fallback selected files, skip selected files, or leave unresolved.
- Observable export logs: taskId, progress samples, downloadUrl state, HTTP status.
- Failure classifier for repeated export failures.
- User-approved fallback docx execution.
- Local and remote verification after upload.
- Redacted migration reports plus retry/fallback candidate JSON lists.

Not implemented in v1.0: batch concurrency and adaptive global rate-limit scheduling. Migration is intentionally serial for safer folder/document creation.

## Supported Types

| Shimo type | API export | Feishu result |
|---|---|---|
| `newdoc` | docx, pdf | Online docx if import succeeds; fallback candidate on repeated failure |
| `modoc` | docx, pdf | Online docx if import succeeds; fallback candidate on repeated failure |
| `mosheet` / `sheet` | xlsx | Online sheet if import succeeds; fallback candidate on repeated failure |
| `mindmap` | xmind, jpg | Cloud drive file or fallback candidate on repeated failure |
| `presentation` | pptx, pdf | Cloud drive file |
| `table` / `board` / `form` | unsupported | recorded as fallback candidate; no API attempts wasted |

## Install

```bash
git clone <repo-url>
cd shimo-api-migration
npm install
cp migration.config.example.json migration.config.json
```

Node.js >= 20 is required. `npm install` installs Playwright Chromium via `postinstall`.

## Feishu setup

1. Create a Feishu developer app.
2. Enable OAuth / web app authorization.
3. Add redirect URI:

```text
http://localhost:10700/callback
```

4. Add document/drive permissions required for creating folders, uploading files, creating docx documents, and editing docx blocks.
5. Publish or enable the app so your user can authorize it.
6. Put your own credentials into `migration.config.json`.

Never commit `migration.config.json`.

## Configuration

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

`migration.types` is advanced/debug only. Normal agent flow should use path/file/link scope selection and `--file-list`.

## Agent-first usage

For WorkBuddy/Codex/Claude Code/Trae users, the agent should follow `SKILL.md`:

1. Ask the user what Shimo paths/files/links to migrate.
2. Run scan/dry run.
3. Resolve the natural-language scope into `selected_file_list.json`.
4. Explain the matched scope back to the user.
5. Ask where to place files in Feishu.
6. Run dry run（预演/只生成迁移计划，不写飞书）.
7. Ask for explicit confirmation before real migration.
8. Auto resume（断点续跑）if interrupted and state is compatible.
9. Report retry/fallback candidates at the end for flexible user decisions.

## Login to Shimo

```bash
npm run login
```

A browser opens. Complete Shimo login/captcha manually. Session is stored under `.cache/shimo-api-migration/shimo/`.

## Dry run

```bash
npm run migrate -- --dry-run
```

Dry run（预演/只生成迁移计划，不写飞书）does not export, upload, or write to Feishu.

## Scope selection

Use the resolver after a scan has produced a Shimo file list:

```bash
npm run scope -- --file-list outputs/migration/shimo_file_list.json --include "企业空间/项目资料" --exclude "归档" --output outputs/migration/selected_file_list.json --explain
npm run migrate -- --file-list outputs/migration/selected_file_list.json --dry-run
```

## Full migration

```bash
npm run migrate -- --file-list outputs/migration/selected_file_list.json --root-name "石墨迁移"
```

Or choose an existing Feishu parent folder:

```bash
npm run migrate -- --file-list outputs/migration/selected_file_list.json --target-root <feishu_folder_token> --root-name "石墨迁移"
```

## Resume / retry / fallback

Resume（断点续跑/从上次中断状态继续）:

```bash
npm run migrate -- --resume --output-dir outputs/migration
```

Retry（重试/再次尝试失败文件） selected candidates:

```bash
npm run migrate -- --retry-candidate-list outputs/migration/retry_subset.json --output-dir outputs/migration
```

Fallback（兜底迁移/创建飞书 docx，加入截图或 PDF 引用和石墨原链接） selected candidates:

```bash
npm run migrate -- --fallback-mode execute --fallback-candidate-list outputs/migration/fallback_subset.json --output-dir outputs/migration
```

The user may choose only some failed files for retry/fallback and skip the rest.

## CLI

```text
--root-name <name>
--target-root <token>
--file-list <path>
--types <type1,type2>              advanced/debug only
--output-dir <path>
--cache-dir <path>
--feishu-app-id <id>
--feishu-app-secret <secret>
--dry-run
--resume
--retry-failed
--retry-candidate-list <path>
--fallback-mode <off|collect|execute>
--fallback-candidate-list <path>
--headless <true|false>
--skip-verify
--observe-export
```

## Fallback behavior

Default fallback mode is `collect`:

1. Supported file fails once -> automatic second API attempt.
2. Supported file fails twice -> recorded as decision candidate; no immediate fallback.
3. Unsupported type -> recorded as fallback candidate immediately; no API attempts.
4. End report lists candidate files and lets the user choose retry/fallback/skip per subset.

Fallback output:

- Document-like files: create a Feishu docx with original Shimo link and uploaded PDF reference.
- Mindmap/sheet/other: create a Feishu docx with original Shimo link and uploaded screenshot reference.

Fallback preserves readability and traceability, but may not preserve original editability.

## Reports

Reports are written to `output_dir`:

- `migration_state.json`
- `migration_report.md`
- `migration_report.json`
- `retry_candidates.json`
- `fallback_candidates.json`
- `folder_map.json`

Feishu tokens, Feishu document/file URLs, fallback artifact tokens, and verification metadata are redacted in reports by default. Candidate lists intentionally keep Shimo GUIDs/links so users can select subsets locally; do not publish real reports or candidate lists.

## Bilingual release checklist

Before public GitHub/npm release, provide Chinese and English versions for:

- README quick start and safety notice.
- Non-official API disclaimer.
- Feishu OAuth setup guide.
- Shimo login guide.
- Agent workflow guide.
- Failure recovery / retry / fallback guide.
- Configuration reference.
- Troubleshooting FAQ.
- Report field explanations.

In Chinese docs or Chinese conversations, avoid naked English jargon. Use explanations such as dry run（预演）, resume（断点续跑）, retry（重试）, fallback（兜底迁移）, OAuth（飞书授权登录）, token（令牌）.

## Security

- Do not commit credentials, tokens, cookies, sessions, or migration reports.
- `.gitignore` excludes cache, config, outputs, and token-like files.
- This repository contains no personal migration data.

## Roadmap

- Batch concurrency and adaptive rate-limit scheduling.
- More provider-specific verification endpoints for every Feishu object type.
- Richer fallback doc rendering with native embedded media blocks where available.
- Optional interactive CLI setup wizard; agent-guided flow remains primary.

## License

MIT
