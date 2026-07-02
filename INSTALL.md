# Installation

This repository is intended to be installed as an agent Skill. The repository root is the Skill folder.

## Install from a GitHub link with an agent

Give this repository URL to WorkBuddy, Claude Code, Codex, Trae, or another coding agent:

```text
https://github.com/erikhalilx/erikhalilx-shimo-api-migration-skill
```

Ask the agent to:

1. Clone or download the whole repository.
2. Read `SKILL.md` first.
3. Run `npm run setup`.
4. Run `npm run doctor`.
5. Guide you through Feishu app setup, Shimo login, migration scope confirmation, dry run（预演）, and real migration confirmation.

Do not install only the npm package if the goal is conversational Skill usage. npm provides the CLI execution engine; this GitHub repository provides the Skill instructions and bundled resources.

## WorkBuddy local Skill install

```bash
mkdir -p ~/.workbuddy/skills
cd ~/.workbuddy/skills
git clone https://github.com/erikhalilx/erikhalilx-shimo-api-migration-skill.git shimo-api-migration
cd shimo-api-migration
npm run setup
npm run doctor
```

Then enable or refresh the Skill in WorkBuddy. If WorkBuddy imports a zip package, import the whole repository so `SKILL.md`, `scripts/`, `references/`, and `package.json` remain together.

## Claude Code / Codex / Trae

These agents do not share a single universal Skill registry. Use the repository as an instruction-backed tool package:

1. Clone the whole repository to a local tools/skills directory.
2. Tell the agent to read `SKILL.md` before running commands.
3. Let the agent use `AGENTS.md` as repository-level guidance if supported.
4. Run `npm run setup` and `npm run doctor` before migration.
5. Use the conversation flow in `SKILL.md`; do not start real migration before dry run and explicit confirmation.

## CLI-only install

```bash
npm install shimo-api-migration
```

This provides:

```bash
shimo-login
shimo-migrate
```

CLI-only install does not automatically register this repository as a Skill in every agent tool.

## Requirements

- Node.js >= 20
- npm
- Playwright Chromium, installed by setup/postinstall
- A Feishu/Lark developer app with OAuth permissions
- A Shimo account the user is authorized to migrate

## Verify installation

```bash
npm run check
npm run doctor
```

`doctor` prints missing prerequisites and next steps. It does not print secret values.