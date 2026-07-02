# shimo-api-migration

Agent-first Skill for migrating Shimo documents to Feishu/Lark Drive using Shimo internal export APIs and Feishu/Lark OAuth user authorization.

> Disclaimer: this is not an official Shimo or Feishu/Lark tool. It relies on Shimo internal export endpoints that may change without notice. Use it only for content you own or are authorized to migrate.

## 中文说明

`shimo-api-migration` 是一个面向 Codex、Claude Code、WorkBuddy、Trae 等 agent 工具的 Skill-first 石墨到飞书迁移工具。推荐使用方式不是先敲 CLI，而是把 GitHub 项目链接交给 agent，让 agent 安装整个仓库，读取 `SKILL.md`，再通过对话引导用户完成安装、自检、飞书配置、石墨登录、迁移范围确认、飞书落地位置确认、dry run（预演：只生成迁移计划，不导出、不上传、不写飞书）、真实迁移、resume（断点续跑）、retry（重试）和 fallback（兜底迁移）决策。

CLI 是稳定执行内核；对话式 Skill 工作流是主要产品入口。

## Install as an Agent Skill

Recommended usage:

1. Agent Skill installation: use the GitHub repository.
2. Conversational usage: read and follow `SKILL.md`.
3. Environment setup: run `npm run setup`.
4. Installation self-check: run `npm run doctor`.
5. CLI-only users: run `npm install shimo-api-migration`.

Give this GitHub URL to your agent:

```text
https://github.com/erikhalilx/erikhalilx-shimo-api-migration-skill
```

Ask the agent to install it as a local Skill. The agent should:

1. Clone or download the whole repository.
2. Read `SKILL.md` first.
3. Run `npm run setup`.
4. Run `npm run doctor`.
5. Guide the user through Feishu/Lark app setup, Shimo login, migration scope confirmation, dry run（预演）, and explicit confirmation before real migration.

Important: `npm install shimo-api-migration` installs the CLI package only. It does not automatically register this Skill in every agent tool. For conversational Skill use, install or import the whole GitHub repository.

Read `INSTALL.md` and `references/agent_installation.md` for details.

### Universal Agent Installation Flow

Use this flow for Codex, Claude Code, WorkBuddy, Trae, and similar agent tools:

1. Give the GitHub repository URL to the agent.
2. Ask the agent to review `README.md`, `SKILL.md`, `INSTALL.md`, and `AGENTS.md`.
3. Ask the agent to install or import the whole repository as a Skill/tool package.
4. Ask the agent to run `npm run setup` and `npm run doctor`.
5. Continue through conversation: Feishu/Lark setup, Shimo login, scope confirmation, destination confirmation, dry run（预演）, and explicit confirmation before real migration.

### WorkBuddy Installation

```bash
mkdir -p ~/.workbuddy/skills
cd ~/.workbuddy/skills
git clone https://github.com/erikhalilx/erikhalilx-shimo-api-migration-skill.git shimo-api-migration
cd shimo-api-migration
npm run setup
npm run doctor
```

Then enable or refresh the Skill in WorkBuddy. If using a UI import, import the whole repository/zip so `SKILL.md`, `scripts/`, `references/`, and `package.json` remain together.

### Claude Code Installation / Integration

Claude Code environments may differ. Install or reference the whole repository as an instruction-backed tool package:

1. Clone the repository into a local tools/skills directory.
2. Ask Claude Code to read `SKILL.md` before running migration commands.
3. Use `AGENTS.md` as repository-level guidance if supported.
4. Run `npm run setup` and `npm run doctor` before migration.
5. Follow the conversational workflow and never start real migration before dry run and explicit confirmation.

### Codex / Codex CLI Installation / Integration

Codex environments may differ. Install or reference the whole repository as an instruction-backed tool package:

1. Clone the repository into a local tools/skills directory.
2. Ask Codex to read `SKILL.md` and `AGENTS.md`.
3. Run `npm run setup` and `npm run doctor` before migration.
4. Let Codex use CLI commands only as execution helpers for the conversation workflow.
5. Do not start real migration before dry run and explicit confirmation.

### Trae Installation / Integration

Trae environments may differ. Install or reference the whole repository through Trae's custom agent instruction or project context mechanism:

1. Clone or import the whole repository.
2. Ask Trae to read `SKILL.md` before running commands.
3. Run `npm run setup` and `npm run doctor` before migration.
4. Follow the same conversational workflow: scope confirmation, destination confirmation, dry run, then real migration only after explicit confirmation.

## CLI-only Installation

For terminal-only usage:

```bash
npm install shimo-api-migration
```

This provides:

```bash
shimo-login
shimo-migrate
shimo-setup
shimo-doctor
```

CLI-only installation does not automatically install the agent Skill instructions.

## Non-destructive Safety Baseline

- Shimo source files are read-only. The tool never deletes, renames, moves, edits, or overwrites Shimo documents/folders.
- Existing Feishu/Lark user files are non-destructive. The tool never deletes, renames, moves, or overwrites existing Feishu/Lark content.
- The tool only creates new Feishu/Lark folders/files/docx fallback documents inside the user-confirmed destination.
- Real outputs, credentials, tokens, cookies, sessions, and migration reports must not be published.
- Real migration must only happen after dry run（预演）and explicit user confirmation.

## Features

- Agent-installable repository with `SKILL.md`, `AGENTS.md`, `INSTALL.md`, `scripts/`, and `references/`.
- Agent-guided workflow through `SKILL.md`.
- Setup and doctor scripts for installation guidance and environment self-check.
- Full-account Shimo scan with folder-path preservation.
- Natural-language scope support via deterministic include/exclude resolver.
- Feishu/Lark folder tree creation under a user-selected parent folder or My Space root.
- OAuth `user_access_token`; files are created as the authorized Feishu/Lark user.
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

Not implemented in v1.0.1: batch concurrency and adaptive global rate-limit scheduling. Migration is intentionally serial for safer folder/document creation.


## Supported Types

| Shimo type | API export | Feishu/Lark result |
|---|---|---|
| `newdoc` | docx, pdf | Online docx if import succeeds; fallback candidate on repeated failure |
| `modoc` | docx, pdf | Online docx if import succeeds; fallback candidate on repeated failure |
| `mosheet` / `sheet` | xlsx | Online sheet if import succeeds; fallback candidate on repeated failure |
| `mindmap` | xmind, jpg | Cloud drive file or fallback candidate on repeated failure |
| `presentation` | pptx, pdf | Cloud drive file |
| `table` / `board` / `form` | unsupported | recorded as fallback candidate; no API attempts wasted |

## Setup and Doctor

```bash
npm run setup
npm run doctor
```

`setup` checks Node/npm, installs dependencies when needed, installs Playwright Chromium, and creates `migration.config.json` from the example if missing.

`doctor` checks environment readiness and prints next steps without exposing secret values.

## Feishu/Lark Setup

1. Create a Feishu/Lark developer app.
2. Enable OAuth / web app authorization.
3. Add redirect URI:

```text
http://localhost:10700/callback
```

4. Add document/drive permissions required for creating folders, uploading files, creating docx documents, and editing docx blocks.
5. Publish or enable the app so your user can authorize it.
6. Put your own credentials into local `migration.config.json`.

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

## Agent-first Usage

For WorkBuddy/Codex/Claude Code/Trae users, the agent should follow `SKILL.md`:

1. Explain safety rules and that the first run is dry run（预演）.
2. Ask what Shimo paths/files/links to migrate.
3. Run scan/dry run.
4. Resolve natural-language scope into `selected_file_list.json`.
5. Explain the matched scope back to the user.
6. Ask where to place files in Feishu/Lark.
7. Run dry run（预演：只生成迁移计划，不写飞书）.
8. Ask for explicit confirmation before real migration.
9. Auto resume（断点续跑）if interrupted and state is compatible.
10. Report retry/fallback candidates at the end for flexible user decisions.

Read `references/agent_conversation_workflow.md` for user-facing guidance.

## Login to Shimo

```bash
npm run login
```

A browser opens. Complete Shimo login/captcha manually. Session is stored under `.cache/shimo-api-migration/shimo/`.

## Dry Run

```bash
npm run migrate -- --dry-run
```

Dry run（预演）does not export, upload, or write to Feishu/Lark.

## Scope Selection

Use the resolver after a scan has produced a Shimo file list:

```bash
npm run scope -- --file-list outputs/migration/shimo_file_list.json --include "企业空间/项目资料" --exclude "归档" --output outputs/migration/selected_file_list.json --explain
npm run migrate -- --file-list outputs/migration/selected_file_list.json --dry-run
```

## Full Migration

```bash
npm run migrate -- --file-list outputs/migration/selected_file_list.json --root-name "石墨迁移"
```

Or choose an existing Feishu/Lark parent folder:

```bash
npm run migrate -- --file-list outputs/migration/selected_file_list.json --target-root <feishu_folder_token> --root-name "石墨迁移"
```

## Resume / Retry / Fallback

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

## Reports

Reports are written to `output_dir`:

- `migration_state.json`
- `migration_report.md`
- `migration_report.json`
- `retry_candidates.json`
- `fallback_candidates.json`
- `folder_map.json`

Feishu/Lark tokens, document/file URLs, fallback artifact tokens, and verification metadata are redacted in reports by default. Candidate lists intentionally keep Shimo GUIDs/links so users can select subsets locally; do not publish real reports or candidate lists.

## Platform Support

- Tested end-to-end: macOS.
- Expected to work: Windows and Linux with Node.js >= 20 and Playwright Chromium.
- Not fully verified in v1.0.1: Windows/Linux end-to-end migration.

Read `references/platform_compatibility.md` before claiming Windows/Linux support.

## Security

- Do not commit credentials, tokens, cookies, sessions, or migration reports.
- `.gitignore` excludes cache, config, outputs, and token-like files.
- This repository contains no personal migration data.

## Roadmap

- Windows/Linux full validation.
- Batch concurrency and adaptive rate-limit scheduling.
- More provider-specific verification endpoints for every Feishu/Lark object type.
- Richer fallback doc rendering with native embedded media blocks where available.
- Optional interactive CLI setup wizard; agent-guided flow remains primary.


## License

MIT
