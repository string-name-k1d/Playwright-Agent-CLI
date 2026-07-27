# pw-cli-agent

A TypeScript CLI tool implementing an explore > plan > test > report workflow for automated web testing, combining `playwright-cli` for browser automation with `opencode` as an AI agent backend.

## Table of Contents

- [Overview](#overview)
- [Quick Start](#quick-start)
- [Commands](#commands)
  - [check](#check)
  - [login](#login)
  - [explore](#explore)
  - [plan](#plan)
  - [generate](#generate)
  - [test](#test)
  - [report](#report)
  - [skill](#skill)
  - [autorun](#autorun)
  - [heal](#heal)
  - [repl](#repl)
- [Commands Summary](#commands-summary)
- [Screenshots](#screenshots)
- [Natural Language Prompts](#natural-language-prompts)
- [Explore Registry](#explore-registry)
- [Architecture](#architecture)
- [File Structure](#file-structure)
- [Configuration](#configuration)
- [Environment Variables](#environment-variables)
- [Docker](#docker)
- [Dependencies](#dependencies)
- [References](#references)

## Overview

`pw-cli-agent` orchestrates end-to-end test generation and execution. It uses `playwright-cli` for token-efficient browser control and `opencode` for AI-powered test planning, code generation, and self-healing.

```
Manual:  explore → plan → generate → test → report
                                        ↘ heal ↗

Autorun: explore → [plan → generate → test → heal] → loop until all pass
```

## Quick Start

```bash
# 1. Build the container
docker-compose build && docker-compose up -d

# 2. Verify environment
docker-compose exec agent node dist/index.js check

# 3. Log in (generates one-time login link via Drush, saves browser profile)
docker-compose exec agent node dist/index.js login --user admin

# 4. Full auto loop (auto-detects ./auth-profile)
docker-compose exec agent node dist/index.js autorun --url http://mtpc_test/admin/mtpc/content --prompt "Test Add Standard Page"

# 5. Or start an interactive session
docker-compose exec agent node dist/index.js repl
```

## Commands

All commands fall back to `TARGET_URL` from `.env` when `--url` is not passed. All browser commands (`check`, `explore`, `autorun`, `heal`) auto-detect the `./auth-profile` directory created by `login` — no need to pass `--profile` explicitly if you used the default path.

### `check`

Verify environment and connectivity.

```bash
pw-cli-agent check
pw-cli-agent check --url https://example.com
```

Checks:
- `playwright-cli --version` is available
- `opencode --version` is available
- Target site loads and responds to snapshot

If `./auth-profile` exists (created by `login`), it is automatically used for authenticated pages.

**Options:**
- `--url <url>` — also verify site connectivity (falls back to `TARGET_URL`)
- `--screenshot` — capture a screenshot of the reached site
- `--profile <path>` — explicit browser profile path (overrides auto-detection)

### `login`

Log in via Drush one-time login link (ULI) and save browser session for reuse. Runs `drush uli` to generate a one-time login URL, opens a browser with the Playwright API directly, authenticates, and saves both a Chromium profile directory (for `explore`) and a `storageState` JSON file (for tests).

```bash
# Login as admin (default) via Drush in the mtpc_test container
pw-cli-agent login --url http://mtpc_test

# Login as specific user
pw-cli-agent login --url http://mtpc_test --user admin

# Use a direct one-time login URL (skip drush generation)
pw-cli-agent login --url http://mtpc_test --uli "http://mtpc_test/user/reset/1/12345678/login"

# Custom drush command (e.g., local drush or different container)
pw-cli-agent login --url http://mtpc_test --drush-cmd "docker exec my_drupal drush"

# Save to custom profile path
pw-cli-agent login --url http://mtpc_test --profile ./my-session

# Headed mode (see the browser)
pw-cli-agent login --url http://mtpc_test --headed
```

**Options:**
- `--url <url>` — target URL (falls back to `TARGET_URL`)
- `--user <user>` — Drupal username (default: `admin`)
- `--uli <url>` — direct one-time login URL (skips drush generation)
- `--drush-cmd <cmd>` — drush command prefix (default: `docker exec mtpc_test drush`)
- `--headed` — show browser window
- `--profile <path>` — browser profile directory to save (default: `./auth-profile`)

**How it works:**
1. Generates ULI via `drush uli admin --uri=http://mtpc_test --no-browser`
2. Launches Chromium via `chromium.launchPersistentContext(auth-profile/)` — saves cookies to the Chromium profile directory
3. Navigates to the ULI URL — auto-authenticates via one-time login token
4. Saves `auth-profile/state.json` via `context.storageState()` — Playwright-compatible JSON with cookies + localStorage
5. Other commands auto-detect `./auth-profile` — no `--profile` needed

**Output files:**
```
auth-profile/           ← Chromium user data dir (used by explore via playwright-cli)
├── Default/            ← Chromium internal files (cookies, cache, etc.)
├── state.json          ← Playwright storageState JSON (used by test runner)
└── login.png           ← Verification screenshot
```

**Saving to config (optional):**
```json
{
  "storageState": "./auth-profile"
}
```
Or in `.env`:
```
STORAGE_STATE=./auth-profile
```

### `explore`

Open a browser, navigate to a URL, capture a snapshot and optional screenshot. Each explore result is registered in the **explore registry** — a searchable index of all snapshots with element metadata (links, headings, buttons, inputs).

```bash
pw-cli-agent explore --url https://example.com
pw-cli-agent explore --url https://example.com --screenshot --depth 4 --headed
```

**Options:**
- `--url <url>` — target URL (falls back to `TARGET_URL`)
- `--depth <N>` — snapshot tree depth (default: full)
- `--screenshot` — also capture a PNG screenshot
- `--headed` — show browser window
- `--profile <path>` — explicit browser profile path (overrides auto-detection)

Artifacts saved to `./artifacts/explore/`. Registry stored at `./artifacts/explore-registry.json`.

### `plan`

Send a snapshot to `opencode` and generate a structured test plan. Queries the **explore registry** for cached snapshots and can auto-explore unvisited pages. Optionally provide natural language requirements to guide what should be tested.

```bash
# Auto-explore and plan
pw-cli-agent plan --url https://example.com

# Plan from existing snapshot
pw-cli-agent plan --snapshot ./artifacts/explore/page.yaml

# Focus on specific requirements
pw-cli-agent plan --url https://example.com --prompt "Test the login flow and form validation"

# Requirements from a markdown file
pw-cli-agent plan --url https://example.com --prompt-file ./requirements.md

# Search explore registry for matching records
pw-cli-agent plan --search "login"

# Auto-explore unvisited pages found in links
pw-cli-agent plan --url https://example.com --explore
```

**Options:**
- `--snapshot <file>` — specific snapshot file to analyze
- `--url <url>` — if no snapshot, run explore first (falls back to `TARGET_URL`)
- `--model <model>` — opencode model override
- `--output <file>` — custom output path
- `--prompt <text>` — natural language requirements for the test plan
- `--prompt-file <file>` — markdown file containing requirements/targets to test
- `--search <query>` — search explore registry for matching records (URLs, titles, headings)
- `--explore` — also explore unvisited pages found in snapshot links (top 3 internal pages)

**Multi-page planning:** When `--explore` is used or URLs appear in `--prompt`, the plan command explores additional pages and includes their element maps and snapshots in the AI context for more precise locator generation.

Plan saved to `./artifacts/plans/`.

### `generate`

Generate Playwright test files from plans. Three modes: extract code blocks from plan markdown, generate via opencode AI, or launch interactive codegen.

```bash
# Extract test code blocks directly from plan (fast, no AI)
pw-cli-agent generate --plan plan-xxx.md --extract

# Generate full test file via opencode from plan
pw-cli-agent generate --plan plan-xxx.md

# Launch interactive playwright codegen
pw-cli-agent generate --codegen --url https://example.com
```

**Options:**
- `--plan <file>` — plan file to generate tests from
- `--extract` — extract code blocks directly (skip opencode generation)
- `--codegen` — launch interactive `playwright codegen`
- `--url <url>` — target URL (for opencode context)
- `--headed` — show browser window (codegen mode)

Tests saved to `./artifacts/tests/`.

### `test`

Execute Playwright test files. Auth state is automatically loaded from `./auth-profile/state.json` if the profile exists.

```bash
# Execute a test file
pw-cli-agent test --execute ./artifacts/tests/test-0.spec.ts

# Execute with visible browser
pw-cli-agent test --execute ./tests/login.spec.ts --headed

# Explicit profile for auth
pw-cli-agent test --execute ./tests/test.spec.ts --profile ./my-session
```

**Options:**
- `--execute <file>` — test file to execute
- `--headed` — visible browser
- `--retries <N>` — retry count (default: 3)
- `--profile <path>` — browser profile for auth state (auto-detects `./auth-profile`)
- `--url <url>` — target URL (falls back to `TARGET_URL`)

Test results saved to `./artifacts/results/run-<timestamp>/`.

### `report`

Aggregate artifacts into a summary report.

```bash
pw-cli-agent report
pw-cli-agent report --format html --output ./report.html
```

**Options:**
- `--format <md|html>` — output format (default: md)
- `--output <file>` — custom output path

### `skill`

Generate opencode skill files so agents can discover the workflow natively.

```bash
pw-cli-agent skill
pw-cli-agent skill --output-dir .opencode/skills --agents
```

**Options:**
- `--output-dir <dir>` — skill output directory (default: `.opencode/skills`)
- `--agents` — also generate agent definition files

### `autorun`

Run the full testing pipeline in a loop: explore → plan → generate → test → heal → plan → ... Repeats until all tests pass or max iterations reached. Saves state after each step so interrupted runs can be resumed.

```bash
# Full auto loop
pw-cli-agent autorun --url https://example.com

# With requirements
pw-cli-agent autorun --url https://example.com --prompt "Test the login flow"

# Limit iterations
pw-cli-agent autorun --url https://example.com --max-iterations 5

# Resume an interrupted run
pw-cli-agent autorun --resume abc1234
```

**Pipeline loop:**
1. **Explore** — capture accessibility snapshot (once)
2. **Plan** — generate test plan from snapshot via opencode
3. **Generate** — extract test code blocks from plan
4. **Test** — execute tests via Playwright
5. **Heal** — re-explore failures, generate corrected plan
6. Loop back to step 2 until all tests pass or max iterations reached

**Options:**
- `--url <url>` — target URL (falls back to `TARGET_URL`)
- `--headed` — show browser window
- `--prompt <text>` — natural language requirements
- `--prompt-file <file>` — markdown file containing requirements
- `--max-iterations <N>` — maximum loop iterations (default: retries + 1)
- `--resume <runId>` — resume a previous interrupted run
- `--profile <path>` — browser profile for auth state (auto-detects `./auth-profile`)

State saved to `./artifacts/results/autorun-<runId>/state.json`.

Exit code: `0` if all tests pass, `1` if any fail after all iterations.

### `heal`

Re-explore failing pages and generate a corrected test plan. Reads the latest test results, identifies failures, and detects **element-not-found errors** to trigger targeted re-exploration of the affected pages. Used standalone or as part of the autorun loop.

```bash
# Heal the latest failures
pw-cli-agent heal

# Specify URL and model
pw-cli-agent heal --url https://example.com --model anthropic/claude-sonnet-4-6
```

**Pipeline steps:**
1. **Analyze** — parse latest `artifacts/results/` for failing tests and their error context
2. **Detect** — identify element-not-found errors (locator not found, timeout exceeded, etc.)
3. **Re-explore** — open affected pages and capture fresh accessibility snapshots
4. **Heal** — send all fresh snapshots + failure details to opencode, generate corrected plan

**Element-not-found detection:** When tests fail due to missing locators, the heal command extracts the page URL from the error context and re-explores that specific page. This ensures the healing plan uses accurate, up-to-date element refs.

**Options:**
- `--url <url>` — target URL (falls back to `TARGET_URL`)
- `--model <model>` — opencode model override
- `--headed` — show browser window
- `--profile <path>` — browser profile for auth state (auto-detects `./auth-profile`)

Saved to `./artifacts/plans/heal-<timestamp>.md`.

### `repl`

Start an interactive REPL session. Commands run without re-entering `pw-cli-agent`. Session state (URL, last snapshot, last plan) persists across commands.

```bash
pw-cli-agent repl
```

**REPL commands:**
- `check`, `login`, `explore`, `plan`, `generate`, `test`, `report`, `skill`, `autorun`, `heal` — all standard subcommands
- `set url <url>` — set target URL for the session
- `set model <model>` — set OpenCode model
- `show` — display current session state
- `help` — show available commands
- `exit` — quit

Session initializes from `.env` (`TARGET_URL`, `OPENCODE_MODEL`). Use `↑`/`↓` for history, `Tab` for completion.

## Commands Summary

| Command | Description | Key Options |
|---------|-------------|-------------|
| `check` | Verify environment and connectivity | `--url`, `--screenshot`, `--profile` |
| `login` | Log in via Drush ULI, save browser profile | `--url`, `--user`, `--uli`, `--drush-cmd`, `--profile` |
| `explore` | Open browser, navigate, capture snapshot (registers in explore registry) | `--url`, `--depth`, `--screenshot`, `--headed`, `--profile` |
| `plan` | Generate test plan from snapshot via opencode (queries/explores registry) | `--url`, `--snapshot`, `--prompt`, `--prompt-file`, `--model`, `--search`, `--explore` |
| `generate` | Generate test files from plans | `--plan`, `--extract`, `--codegen`, `--url`, `--headed` |
| `test` | Execute Playwright test files | `--execute`, `--headed`, `--retries`, `--profile` |
| `report` | Aggregate artifacts into summary report | `--format`, `--output` |
| `skill` | Generate opencode skill files | `--output-dir`, `--agents` |
| `autorun` | Loop: explore → plan → generate → test → heal | `--url`, `--headed`, `--prompt`, `--max-iterations`, `--resume`, `--profile` |
| `heal` | Re-explore failures (element-not-found aware), generate corrected plan | `--url`, `--model`, `--headed`, `--profile` |
| `repl` | Start interactive REPL session | — |

## Screenshots

All generated tests automatically capture full-page screenshots on both pass and fail via a `test.afterEach` hook. Screenshots are saved to:

```
test-results/<test-dir>/screenshots/<test_name>_pass.png
test-results/<test-dir>/screenshots/<test_name>_fail.png
```

Screenshots are included in the test results directory (`artifacts/results/run-<timestamp>/test-results/`) after each test run. The hook is injected into:
- **Extracted tests** — code blocks pulled from plan markdown via `test --extract`
- **Generated tests** — opencode-generated `.spec.ts` files via `test --plan`

## Natural Language Prompts

The `plan` command accepts natural language requirements to guide test generation. This lets you specify what should be tested without writing formal test cases.

**Inline prompt:**
```bash
pw-cli-agent plan --url https://example.com --prompt "Test the checkout flow: add items to cart, apply discount code, and complete payment"
```

**Requirements file:**
```bash
pw-cli-agent plan --url https://example.com --prompt-file ./requirements.md
```

Example `requirements.md`:
```markdown
## Test Requirements

### Priority 1: Authentication
- Test login with valid credentials
- Test login with invalid credentials shows error
- Test logout flow

### Priority 2: Navigation
- Test main menu links work correctly
- Test breadcrumb navigation
- Test search functionality

### Priority 3: Forms
- Test contact form validation
- Test form submission with valid data
```

## Explore Registry

Every `explore` command registers its snapshot in `artifacts/explore-registry.json` with structured metadata: URL, title, element count, link count, heading names, and a compact element summary. The `plan` command uses this registry to:

- **Reuse cached snapshots** — avoids re-exploring the same page
- **Search records** — `plan --search "login"` finds snapshots containing "login" in URLs, titles, or headings
- **Auto-explore unvisited pages** — `plan --explore` finds internal links not yet in the registry and explores the top 3
- **Build multi-page context** — combines element maps from multiple pages for richer AI prompts

```
artifacts/explore-registry.json
├── url: http://example.com/
├── title: Home Page
├── elementCount: 142
├── linkCount: 28
├── headingCount: ["Welcome", "Products", "Contact"]
└── summary: "Links:\n  [e5] \"Login\" → /login\n  ..."
```

## Architecture

```
pw-cli-agent
├── CLI Layer (Commander.js subcommands)
│   ├── check    — verify playwright-cli + opencode + target site
│   ├── login    — Playwright API: launchPersistentContext → ULI → storageState JSON
│   ├── explore  — playwright-cli open --profile, navigate, snapshot → explore registry
│   ├── plan     — generate test plan from snapshots (queries registry, can trigger explore)
│   ├── generate — create .spec.ts files from plans (extract / opencode / codegen)
│   ├── test     — execute playwright tests (loads storageState JSON for auth)
│   ├── report   — aggregate results into markdown/HTML
│   ├── skill    — generate opencode SKILL.md files
│   ├── autorun  — loop: explore → plan → generate → test → heal
│   ├── heal     — detect element-not-found errors, re-explore, generate corrected plan
│   └── repl     — interactive session (tab completion, state tracking)
├── Playwright API (login)
│   └── chromium.launchPersistentContext() + context.storageState()
├── Playwright CLI Wrapper (explore/snapshot)
│   └── pwExec(command, args, opts) — runs `playwright-cli <cmd>`
├── OpenCode Integration (child_process.spawn)
│   └── opencodeRun(prompt, opts) — runs `opencode run --format json`
├── Explore Registry
│   └── explore-registry.json — searchable index of snapshots with element metadata
├── Snapshot Parser
│   └── parseSnapshotElements(yaml) — extract refs, roles, names, links, headings, buttons
├── Artifact Manager
│   └── ./artifacts/{explore,plans,tests,reports,results}/
└── Config
    └── pw-cli-agent.config.json + .env + resolveProfile()
```

## File Structure

```
agent/
├── Dockerfile
├── package.json
├── tsconfig.json
└── src/
    ├── index.ts                      # Entry point: Commander program
    ├── config.ts                     # Config loading + resolveProfile() shared utility
    ├── commands/
    │   ├── check.ts                  # Environment verification
    │   ├── login.ts                  # Playwright API: ULI auth + storageState JSON export
    │   ├── explore.ts                # Browser exploration via playwright-cli + snapshots + registry
    │   ├── plan.ts                   # Test plan generation (registry query, multi-page explore)
    │   ├── generate.ts               # Test file creation (extract / opencode / codegen)
    │   ├── test.ts                   # Test execution + self-heal retries (loads storageState)
    │   ├── report.ts                 # Result aggregation
    │   ├── skill.ts                  # OpenCode skill file generation
    │   ├── autorun.ts                # Loop: explore → plan → generate → test → heal
    │   ├── heal.ts                   # Element-not-found detection + re-explore + corrected plan
    │   └── repl.ts                   # Interactive REPL session
    └── lib/
        ├── pw-cli.ts                 # Playwright CLI wrapper (explore/snapshot commands)
        ├── opencode.ts               # OpenCode subprocess wrapper
        ├── artifacts.ts              # Artifact directory management + code extraction
        ├── snapshot-parser.ts        # YAML snapshot → structured elements (refs, roles, links)
        ├── explore-registry.ts       # Searchable index of explore snapshots + metadata
        └── prompt-templates.ts       # Reusable prompt templates for opencode
```

## Configuration

Create `pw-cli-agent.config.json` in your project root or `~/.config/pw-cli-agent/config.json`:

```json
{
  "targetUrl": "https://example.com",
  "opencodeModel": "anthropic/claude-sonnet-4-6",
  "outputDir": "./artifacts",
  "headed": false,
  "snapshotDepth": 4,
  "maxRetries": 3
}
```

Priority: CLI flags > env vars > config file > defaults.

## Environment Variables

| Variable | Description |
|----------|-------------|
| `TARGET_URL` | Default target URL |
| `OPENCODE_MODEL` | Default opencode model |
| `OPENCODE_SERVER_URL` | Connect to a host-running `opencode serve` instead of local CLI |
| `PW_CLI_HEADED` | Run browsers headed by default |
| `PW_CLI_OUTPUT_DIR` | Custom artifacts directory |
| `STORAGE_STATE` | Default browser profile path for saved login state |

## Docker

The tool runs inside a container with `playwright-cli`, `opencode`, and all browser dependencies pre-installed.

### OpenCode Connection

**Mode 1: Remote server (recommended for Docker)**

```bash
# On host — start opencode server
opencode serve --port 4096

# In .env
OPENCODE_SERVER_URL=http://host.docker.internal:4096
OPENCODE_MODEL=anthropic/claude-sonnet-4-6
```

**Mode 2: Local CLI inside container**

If `OPENCODE_SERVER_URL` is not set, the container runs `opencode` CLI directly. Requires API keys inside the container.

### Usage

```bash
docker-compose build
docker-compose up -d
docker-compose exec agent node dist/index.js check
docker-compose exec agent node dist/index.js repl
```

### .env

```bash
TARGET_URL=https://example.com
OPENCODE_MODEL=anthropic/claude-sonnet-4-6
OPENCODE_SERVER_URL=http://host.docker.internal:4096
STORAGE_STATE=./auth-profile
```

## Dependencies

| Package | Purpose |
|---------|---------|
| `commander` | CLI subcommand parsing |
| `chalk` | Terminal output styling |
| `@playwright/test` | Playwright test runner |
| `playwright` | Browser API for login (launchPersistentContext, storageState) |

Node built-ins: `node:readline` (REPL), `node:child_process`, `node:fs`, `node:path`.

External tools (installed in container):
- `@playwright/cli` — browser automation CLI
- `opencode` — AI agent backend

Internal modules:
- `snapshot-parser.ts` — parses Playwright YAML snapshots into structured element data (refs, roles, links, headings, buttons)
- `explore-registry.ts` — searchable index of explore snapshots with element metadata

## References

- [playwright-cli](https://playwright.dev/agent-cli/) — Playwright CLI for coding agents
- [opencode](https://opencode.ai) — AI coding agent for the terminal
- [auto_playwright](https://github.com/ohanedan/playwright-testgen) — Original explore/plan/test/report workflow inspiration
- [commander.js](https://github.com/tj/commander.js) — CLI framework
