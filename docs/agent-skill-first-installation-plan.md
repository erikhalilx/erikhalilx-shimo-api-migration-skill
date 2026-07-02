# Agent-first Skill 安装与使用形态改造评估方案

## 1. 结论

当前 `shimo-api-migration@1.0.0` 已经具备迁移执行能力，但产品形态还偏 CLI-first。

目标产品形态应该改成 Skill-first：用户把 GitHub 项目链接发给 Codex、Claude Code、WorkBuddy、Trae 等 agent，agent 能自行完成安全审查、克隆/下载、依赖安装、配置引导，并在后续对话中按 `SKILL.md` 调用迁移工作流。

因此，下一版不应只补 npm 安装说明。必须把仓库改造成“agent 可安装的 Skill 包”，CLI 只是 Skill 的执行内核。

## 2. 当前状态

已具备：

- `SKILL.md`：已经描述迁移工作流、范围确认、飞书目标确认、预演、断点续跑、重试、兜底迁移。
- `package.json`：已经提供 npm 包和命令入口：
  - `shimo-login`
  - `shimo-migrate`
- `scripts/`：迁移执行内核已可用。
- `migration.config.example.json`：已有配置模板。
- `README.md`：已有 CLI 安装和迁移说明。
- npm 包已发布：`shimo-api-migration@1.0.0`。
- GitHub 仓库已发布：`https://github.com/erikhalilx/erikhalilx-shimo-api-migration-skill`。

主要问题：

- README 让用户以为 `npm install` 就是完整安装。
- 实际上 npm 只安装 CLI，不会自动注册为 WorkBuddy / Codex / Claude Code / Trae 的 Skill。
- 仓库没有明确的“agent 安装入口说明”。
- 没有标准化安装脚本，agent 需要自己推断怎么 clone、npm install、配置、验证。
- 没有跨 agent 适配说明。
- 没有 Windows 兼容性声明和测试矩阵。
- `package.json` 缺少 `repository` / `homepage` / `bugs` 等开源元信息。

## 3. 目标应用形态

用户理想使用方式：

```text
用户：请安装并使用这个 Skill：
https://github.com/erikhalilx/erikhalilx-shimo-api-migration-skill
```

agent 应完成：

1. 读取仓库 README / SKILL.md。
2. 做安全审查，确认不会删除或覆盖石墨/飞书原内容。
3. 克隆或下载仓库。
4. 安装 Node 依赖。
5. 安装 Playwright Chromium。
6. 复制或生成本地配置文件。
7. 引导用户填写飞书 app_id / app_secret。
8. 引导用户完成石墨登录。
9. 引导用户说明迁移范围。
10. 先执行预演。
11. 用户确认后再真实写入飞书。
12. 迁移中断时自动断点续跑。
13. 对失败项提供重试/兜底/跳过选择。

换句话说，仓库本身必须告诉 agent：

- 我是谁。
- 我怎么安装。
- 我装在哪里。
- 我怎么自检。
- 我如何调用。
- 我不能做什么。
- 用户需要在哪些节点人工介入。

## 4. 必须改动清单

### 4.1 README 改造

新增顶层章节：

```markdown
## Install as an Agent Skill
## WorkBuddy Installation
## Claude Code Installation
## Codex / Codex CLI Installation
## Trae Installation
## CLI-only Installation
## Platform Support
```

重点写清楚：

- npm 安装只是 CLI，不等于自动注册 Skill。
- 推荐安装方式是把整个 GitHub 仓库作为 Skill 包安装。
- agent 应优先读取 `SKILL.md`，再调用 CLI。
- 对话式迁移是主入口，命令行是执行内核。

### 4.2 新增 `INSTALL.md`

用途：给人类和 agent 一个短安装入口。

建议结构：

```markdown
# Installation

## For agents
If the user sends you this GitHub URL, install it as a local Skill package.

## WorkBuddy
Clone to ~/.workbuddy/skills/shimo-api-migration, run npm install, then enable the Skill.

## Claude Code
Clone the repo and reference SKILL.md in the project/user skill mechanism.

## Codex / Codex CLI
Clone the repo and reference SKILL.md or AGENTS instructions depending on the runtime.

## Trae
Clone the repo and import/use SKILL.md as custom agent instruction.

## Verification
Run npm run check and shimo-migrate --dry-run.
```

### 4.3 新增 `AGENTS.md`

很多 agent 会优先读取 `AGENTS.md` 或类似项目指令文件。即使不同工具支持程度不同，放这个文件对 agent 安装非常有利。

内容定位：

- 这是一个 Skill-first 仓库。
- 不要把它当普通 npm 库。
- 安装后必须通过对话引导用户。
- 写飞书前必须确认范围和目标。
- 不得删除、移动、覆盖任何石墨或飞书已有内容。
- 安装命令和自检命令。

建议核心内容：

```markdown
# AGENTS.md

This repository is an installable agent Skill.
When a user asks you to install it from GitHub, clone the whole repository, install dependencies, read SKILL.md, and treat CLI commands as execution helpers.
Never start a real migration before dry run and explicit user confirmation.
```

### 4.4 新增安装脚本

新增：

```text
scripts/install-skill.mjs
```

目标：降低 agent 推断成本。

能力：

- 检查 Node 版本 >= 20。
- 检查 npm 是否可用。
- 安装依赖。
- 安装 Playwright Chromium。
- 如果不存在 `migration.config.json`，从 example 复制。
- 输出下一步：配置飞书、执行登录、执行预演。

新增 npm script：

```json
"setup": "node scripts/install-skill.mjs"
```

agent 安装时只需要运行：

```bash
npm run setup
```

注意：这个脚本不能写死用户目录，不能读取秘密，不能自动发布或联网到非必要域名。

### 4.5 新增自检脚本

新增：

```text
scripts/doctor.mjs
```

新增 npm script：

```json
"doctor": "node scripts/doctor.mjs"
```

检查项：

- Node 版本。
- Playwright 可用性。
- `migration.config.json` 是否存在。
- 飞书 app_id/app_secret 是否填写，注意只检查存在，不打印值。
- `.cache` 是否存在石墨登录态。
- 输出目录是否可写。
- 当前平台：macOS / Windows / Linux。
- Windows 下提醒未完整验证。

agent 在安装后可运行：

```bash
npm run doctor
```

### 4.6 新增跨平台兼容说明

当前应诚实声明：

```text
Tested: macOS
Expected: Windows/Linux with Node >= 20 and Playwright Chromium
Not fully verified: Windows/Linux migration end-to-end
```

README 中必须写清楚：

- v1.0 已在 macOS 实测。
- Windows 理论可用，但需要完整回归。
- 不要声称 Windows 已正式支持。

Windows 重点测试：

- `npm install`
- `npm run setup`
- `npm run doctor`
- `shimo-login`
- `shimo-migrate --dry-run`
- 中文路径
- 特殊字符文件名
- 长路径
- Playwright Chromium 下载
- 断点续跑
- 兜底迁移

### 4.7 `package.json` 元信息补齐

新增：

```json
"repository": {
  "type": "git",
  "url": "git+https://github.com/erikhalilx/erikhalilx-shimo-api-migration-skill.git"
},
"homepage": "https://github.com/erikhalilx/erikhalilx-shimo-api-migration-skill#readme",
"bugs": {
  "url": "https://github.com/erikhalilx/erikhalilx-shimo-api-migration-skill/issues"
}
```

新增 keywords：

```json
"agent-skill",
"workbuddy-skill",
"claude-code",
"codex",
"trae"
```

### 4.8 npm 包文件白名单更新

当前 `files` 不包含新增文档和脚本时会漏包。

需要确保 npm 包包含：

```json
"files": [
  "scripts/",
  "references/",
  "docs/",
  "README.md",
  "SKILL.md",
  "AGENTS.md",
  "INSTALL.md",
  "migration.config.example.json",
  "LICENSE"
]
```

### 4.9 `SKILL.md` 补安装章节

`SKILL.md` 现在偏使用流程，还缺安装身份说明。

新增：

```markdown
## Skill Installation Intent

This repository is meant to be installed as a local agent Skill. If a user gives you the GitHub URL, clone the full repository, run npm install or npm run setup, read this SKILL.md, and guide the user conversationally.
```

同时强调：

- 不要仅执行 `npm install -g` 后就认为 Skill 安装完成。
- 必须保留 `SKILL.md` 与 scripts 在同一仓库中。
- agent 调用时优先遵守 `SKILL.md`。

## 5. 推荐仓库结构

目标结构：

```text
shimo-api-migration/
├── README.md
├── INSTALL.md
├── AGENTS.md
├── SKILL.md
├── LICENSE
├── package.json
├── package-lock.json
├── migration.config.example.json
├── docs/
│   ├── agent-skill-first-installation-plan.md
│   ├── workbuddy-installation.md
│   ├── claude-code-installation.md
│   ├── codex-installation.md
│   ├── trae-installation.md
│   └── windows-compatibility.md
├── references/
│   ├── api_matrix.md
│   └── feishu_upload.md
└── scripts/
    ├── install-skill.mjs
    ├── doctor.mjs
    ├── login.mjs
    ├── migrate.mjs
    ├── scope_resolver.mjs
    └── ...
```

## 6. 各 agent 的建议安装路径

### 6.1 WorkBuddy

推荐安装方式：

```bash
mkdir -p ~/.workbuddy/skills
cd ~/.workbuddy/skills
git clone https://github.com/erikhalilx/erikhalilx-shimo-api-migration-skill.git shimo-api-migration
cd shimo-api-migration
npm run setup
npm run doctor
```

然后在 WorkBuddy 技能页面启用，或重启后通过对话触发。

### 6.2 Claude Code

建议文档写法：

```text
Clone this repository into a local tools/skills directory, then tell Claude Code to read SKILL.md before running migration commands.
```

不要声称所有 Claude Code 环境都会自动注册 Skill。不同用户配置不同。

### 6.3 Codex / Codex CLI

建议文档写法：

```text
Clone the repository and reference SKILL.md / AGENTS.md as the task instruction source. The agent should run npm run setup once, then use npm run login / npm run migrate as needed.
```

### 6.4 Trae

建议文档写法：

```text
Import or reference SKILL.md as custom agent instruction, then let the agent run setup and doctor before migration.
```

## 7. 用户体验目标

最终对用户应该是这样：

```text
用户：帮我安装这个 Skill：https://github.com/erikhalilx/erikhalilx-shimo-api-migration-skill

agent：我会先审查仓库，然后安装依赖和浏览器运行环境。安装后我会引导你配置飞书应用、登录石墨，并先做预演，不会直接写飞书。
```

安装完成后：

```text
用户：帮我把石墨里“项目资料”迁移到飞书“资料归档”下面。

agent：我会先扫描石墨文件列表，解析你说的范围，然后给你确认。确认后只做预演，不写飞书。
```

这才是正确产品形态。

## 8. 实施顺序

### P0：必须做，建议发布 v1.0.1

1. 新增 `INSTALL.md`。
2. 新增 `AGENTS.md`。
3. README 增加 Agent Skill 安装说明。
4. `SKILL.md` 增加安装意图说明。
5. `package.json` 补 repository/homepage/bugs/keywords。
6. npm `files` 白名单加入 `docs/`、`INSTALL.md`、`AGENTS.md`。
7. 新增 `scripts/doctor.mjs`。
8. 新增 `scripts/install-skill.mjs` 或 `setup` script。
9. 跑：
   - `npm run check`
   - `npm run doctor`
   - `npm pack --dry-run --json`
   - 敏感扫描
10. 提交 Git，发布 npm `1.0.1`。

### P1：建议做，发布 v1.1.0

1. Windows 完整回归测试。
2. Linux 完整回归测试。
3. 增加 PowerShell 示例。
4. 增加 Windows 文件名清理测试。
5. 增加安装 smoke test。
6. 增加 `npx shimo-api-migration doctor` 或独立 bin：
   - `shimo-doctor`
   - `shimo-setup`

### P2：后续增强

1. 发布 GitHub Release，附 zip 技能包。
2. 提供一键安装命令。
3. 提供 marketplace 元数据，如果某些 agent 平台支持。
4. 增加 CI：macOS / Windows / Linux 的 `npm install` + `npm run check` + `npm run doctor`。

## 9. 风险和边界

必须避免错误承诺：

- 不能承诺 npm 安装后所有 agent 自动识别 Skill。
- 不能承诺 Claude Code / Codex / Trae 有统一 Skill 注册机制。
- 不能承诺 Windows 已正式支持，除非完成实测。
- 不能让安装脚本自动读取、上传、打印用户凭证。
- 不能让 agent 在未预演、未确认前写入飞书。

可以承诺：

- 仓库提供标准 `SKILL.md` 和 `AGENTS.md`，便于 agent 读取和安装。
- WorkBuddy 可按本地 Skill 包方式安装。
- npm 包提供 CLI 执行内核。
- agent 可通过 `npm run setup` / `npm run doctor` 降低安装和自检成本。
- 迁移流程默认预演优先、写入前确认、源端只读、目标端不破坏已有内容。

## 10. 最终建议

下一步直接做 v1.0.1 文档与安装形态修复，不改迁移核心逻辑。

原因：

- v1.0 的迁移闭环已经测通。
- 当前最大短板是“用户如何把 GitHub 链接交给 agent 后完成安装”。
- 这个短板主要靠仓库结构、安装文档、agent 指令文件和自检脚本解决。
- 不需要重构迁移执行内核。

一句话：

> 把它从“带 SKILL.md 的 npm CLI 项目”改成“带 npm CLI 执行内核的 agent-installable Skill 仓库”。
