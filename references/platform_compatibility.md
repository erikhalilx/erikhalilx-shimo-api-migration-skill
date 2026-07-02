# Platform Compatibility

## Current support statement

- Tested end-to-end: macOS.
- Expected to work: Windows and Linux with Node.js >= 20 and Playwright Chromium.
- Not fully verified in v1.0/v1.0.1: Windows/Linux end-to-end migration.

Do not claim full Windows/Linux support until the test matrix below passes.

## Why cross-platform support is feasible

The execution engine is based on:

- Node.js >= 20
- Playwright Chromium
- standard filesystem/path APIs
- Shimo web login and export HTTP APIs
- Feishu/Lark HTTP APIs

The code should avoid OS-specific shell behavior and hard-coded user paths.

## Windows test matrix

Run these before claiming Windows support:

1. `npm install`
2. `npm run setup`
3. `npm run doctor`
4. `npm run login`
5. Shimo login/captcha in Playwright Chromium
6. `npm run migrate -- --dry-run`
7. Scope resolver with Chinese paths
8. Single `newdoc` real migration
9. Unsupported `table` fallback candidate collection
10. User-approved fallback execution
11. Resume（断点续跑）from an existing `migration_state.json`
12. File names containing Windows-reserved characters
13. Long path handling
14. PowerShell command examples

## User-facing wording

Use this wording in docs and conversation:

> v1.0.1 is tested on macOS. Windows and Linux should work in principle because the tool is Node.js + Playwright based, but full end-to-end validation is still pending. Please run `npm run doctor` first and report platform-specific issues.