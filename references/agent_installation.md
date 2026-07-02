# Agent Skill Installation Guide

This repository root is the Skill folder. Install the whole repository, not only the npm package.

## Agent installation protocol

When a user sends the GitHub URL to an agent:

1. Review `README.md`, `SKILL.md`, and this file.
2. Explain that the repository will be installed as a local agent Skill and that the CLI is only the execution engine.
3. Clone or download the whole repository into a local skill/tools directory.
4. Run `npm run setup` from the repository root.
5. Run `npm run doctor` and explain any missing prerequisites.
6. Ask the user to provide Feishu app credentials locally in `migration.config.json` or via CLI flags. Never print secrets.
7. Run `npm run login` and ask the user to finish Shimo login in the opened browser.
8. Ask the user for migration scope and Feishu destination in natural language.
9. Run a dry run（预演：只生成迁移计划，不导出、不上传、不写飞书）first.
10. Explain dry-run results and ask for explicit confirmation before any real Feishu write.

## WorkBuddy

Recommended local install:

```bash
mkdir -p ~/.workbuddy/skills
cd ~/.workbuddy/skills
git clone https://github.com/erikhalilx/erikhalilx-shimo-api-migration-skill.git shimo-api-migration
cd shimo-api-migration
npm run setup
npm run doctor
```

Then enable or refresh the Skill in WorkBuddy. If importing from the UI, import the whole repository/zip so that `SKILL.md`, `scripts/`, `references/`, and `package.json` stay together.

## Claude Code / Codex / Trae

These tools do not share one universal Skill registry. Use the repository as an instruction-backed tool package:

1. Clone the full repository to a local tools/skills directory.
2. Ask the agent to read `SKILL.md` first and `AGENTS.md` for repository-level instructions.
3. Run `npm run setup` and `npm run doctor` before migration.
4. Use only conversational workflow first; execute CLI commands only as implementation steps.

Do not claim that `npm install shimo-api-migration` automatically registers a Skill in every agent. npm installs the CLI package; the GitHub repository provides the Skill instructions and bundled resources.

## CLI-only install

For users who only want terminal commands:

```bash
npm install shimo-api-migration
```

This provides `shimo-login` and `shimo-migrate`, but it does not install the agent Skill instructions.