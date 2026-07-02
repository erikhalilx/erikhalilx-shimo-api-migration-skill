# Agent Conversation Workflow

Use this guide to keep every user-facing step conversational, explicit, and safe.

## Opening explanation

When the user asks to migrate Shimo to Feishu, first explain:

- The tool reads Shimo and creates new content in Feishu.
- It never deletes, renames, moves, overwrites, or edits existing Shimo or Feishu content.
- The agent will first confirm migration scope and Feishu destination.
- The first run is a dry run（预演：只生成迁移计划，不导出、不上传、不写飞书）.
- Real migration starts only after explicit confirmation.

## Installation conversation

After installing the repository as a Skill, say what was installed:

- `SKILL.md` provides the agent workflow.
- `scripts/` provides deterministic execution helpers.
- `references/` contains supporting docs.
- `migration.config.json` is local and must never be published.

Then run or ask to run `npm run doctor` and explain the result.

## Credential conversation

Ask the user to configure Feishu credentials locally:

- app_id
- app_secret
- optional target_root_token

Never ask the user to paste secrets into a public place. If secrets are shown in the local conversation, do not repeat them back.

## Shimo login conversation

Run `npm run login`. Tell the user:

- A browser will open.
- Complete Shimo login and captcha manually.
- The session is stored locally under `.cache/shimo-api-migration/`.
- The tool does not receive the user's password.

## Scope conversation

Ask for scope in natural language:

- 全部迁移
- 只迁移某个空间、文件夹、文件名或链接
- 排除某些归档、历史、测试目录

After scanning or resolving scope, explain the interpreted scope back to the user and ask for confirmation.

## Destination conversation

Ask where to put files in Feishu:

1. Existing Feishu folder URL/token.
2. New folder under My Space root.
3. New folder under an existing Feishu folder.

Before real migration, summarize:

- Shimo scope.
- Feishu destination.
- Root folder name.
- Output directory.
- Fallback mode.
- Whether the next command writes to Feishu.

## Dry-run feedback

After dry run, summarize:

- total selected files
- matched paths/folders
- excluded paths/folders
- unsupported/fallback candidates
- whether credentials are ready
- whether any action wrote to Feishu: must be no

Ask whether the user wants to proceed.

## Real migration feedback

During real migration, report progress in plain language:

- current file count
- successes
- failures
- files waiting for user decision
- whether the run is resuming from state

Avoid exposing tokens or private links unless the user explicitly asks in their local environment.

## Failure decision conversation

At the end, explain choices:

- retry（重试）：try failed files again
- fallback（兜底迁移）：create Feishu docx with original Shimo link and screenshot/PDF reference
- skip（放弃迁移）：leave selected files unresolved

Let the user decide per file or subset. Do not automatically execute fallback after second failure.

## Completion feedback

Finish with:

- success count
- failed count
- decision-candidate count
- report paths
- next recommended action

Warn that real reports and candidate lists may contain private Shimo links and must not be published.