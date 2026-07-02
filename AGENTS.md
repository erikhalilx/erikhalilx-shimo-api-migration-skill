# AGENTS.md

This repository is an installable agent Skill for migrating Shimo documents to Feishu/Lark Drive.

## Repository role

Treat the repository root as the Skill folder. Read `SKILL.md` before using any migration command. The CLI is the execution engine; the user-facing product is the conversational Skill workflow.

## Installation behavior

When a user provides this GitHub repository URL and asks to install the Skill:

1. Review `README.md`, `SKILL.md`, and `INSTALL.md`.
2. Explain that the Skill is non-official and relies on Shimo internal export APIs.
3. Clone or download the full repository.
4. Run `npm run setup`.
5. Run `npm run doctor`.
6. Ask the user to configure Feishu app credentials locally.
7. Run `npm run login` only when the user is ready to complete Shimo login in the browser.

## Safety rules

- Never delete, rename, move, edit, overwrite, or otherwise modify Shimo source content.
- Never delete, rename, move, overwrite, or modify existing Feishu content.
- Only create new Feishu folders/files/docx fallback documents inside the user-confirmed destination.
- Always run dry run（预演：只生成迁移计划，不导出、不上传、不写飞书）before real migration.
- Ask for explicit confirmation before any command that writes to Feishu.
- Do not print app secrets, tokens, cookies, sessions, or private migration reports.

## Conversation requirements

At each stage, explain:

- What will happen next.
- Whether the next action reads only or writes to Feishu.
- What user input is required.
- Where local state and reports will be written.
- How to recover if interrupted.

Follow `references/agent_conversation_workflow.md` for detailed user-facing phrasing.