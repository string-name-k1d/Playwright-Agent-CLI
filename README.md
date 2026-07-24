# pw-cli-agent

A TypeScript CLI tool implementing an explore > plan > test > report workflow for automated web testing, combining `playwright-cli` for browser automation with `opencode` as an AI agent backend.

## Table of Contents

- [Overview](#overview)
- [Quick Start](#quick-start)
- [Commands](#commands)
  - [check](#check)
  - [explore](#explore)
  - [plan](#plan)
  - [test](#test)
  - [report](#report)
  - [skill](#skill)
  - [repl](#repl)
- [Commands Summary](#commands-summary)
- [Natural Language Prompts](#natural-language-prompts)
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
check (environment) > explore (browser) > plan (opencode) > test (playwright) > report
```

## Quick Start

```bash
# 1. Build the container
docker-compose build && docker-compose up -d

# 2. Verify environment
docker-compose exec agent node dist/index.js check

# 3. Explore a site and generate a test plan
docker-compose exec agent node dist/index.js plan --url https://example.com

# 4. Or start an interactive session
docker-compose exec agent node dist/index.js repl
```

## Commands

All commands fall back to `TARGET_URL` from `.env` when `--url` is not passed.

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

**Options:**
- `--url <url>` — also verify site connectivity (falls back to `TARGET_URL`)

### `explore`

Open a browser, navigate to a URL, capture a snapshot and optional screenshot.

```bash
pw-cli-agent explore --url https://example.com
pw-cli-agent explore --url https://example.com --screenshot --depth 4 --headed
```

**Options:**
- `--url <url>` — target URL (falls back to `TARGET_URL`)
- `--depth <N>` — snapshot tree depth (default: full)
- `--screenshot` — also capture a PNG screenshot
- `--headed` — show browser window

Artifacts saved to `./artifacts/explore/`.

### `plan`

Send a snapshot to `opencode` and generate a structured test plan. Optionally provide natural language requirements to guide what should be tested.

```bash
# Auto-explore and plan
pw-cli-agent plan --url https://example.com

# Plan from existing snapshot
pw-cli-agent plan --snapshot ./artifacts/explore/page.yaml

# Focus on specific requirements
pw-cli-agent plan --url https://example.com --prompt "Test the login flow and form validation"

# Requirements from a markdown file
pw-cli-agent plan --url https://example.com --prompt-file ./requirements.md
```

**Options:**
- `--snapshot <file>` — specific snapshot file to analyze
- `--url <url>` — if no snapshot, run explore first (falls back to `TARGET_URL`)
- `--model <model>` — opencode model override
- `--output <file>` — custom output path
- `--prompt <text>` — natural language requirements for the test plan
- `--prompt-file <file>` — markdown file containing requirements/targets to test

Plan saved to `./artifacts/plans/`.

### `test`

Generate or execute Playwright tests.

```bash
# Interactive codegen recording
pw-cli-agent test --url https://example.com --generate

# Execute existing test file
pw-cli-agent test --execute ./tests/login.spec.ts

# Generate from plan via opencode, then execute
pw-cli-agent test --plan plan-xxx.md

# Extract test code blocks directly from plan (no opencode generation)
pw-cli-agent test --plan plan-xxx.md --extract
```

**Modes:**
- `--generate` — launches `playwright codegen` for interactive recording
- `--execute <file>` — runs `npx playwright test <file>`
- `--plan <file>` — sends plan to opencode for code generation, then executes
- `--plan <file> --extract` — extracts test code blocks directly from plan markdown

**Options:**
- `--url <url>` — target URL (falls back to `TARGET_URL`)
- `--headed` — visible browser
- `--retries <N>` — self-heal retries on failure (default: 3)

Tests saved to `./artifacts/tests/`.

Test execution results (pass/fail, output, HTML report) are saved to `./artifacts/results/run-<timestamp>/`:
```
artifacts/results/run-2026-07-24T04-00-00/
├── summary.md              # Pass/fail status + metadata
├── output.txt              # Raw stdout/stderr from playwright test
├── playwright-report/      # Playwright HTML report
└── test-results/           # Playwright XML results
```

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

### `repl`

Start an interactive REPL session. Commands run without re-entering `pw-cli-agent`. Session state (URL, last snapshot, last plan) persists across commands.

```bash
pw-cli-agent repl
```

**REPL commands:**
- `check`, `explore`, `plan`, `test`, `report`, `skill` — all standard subcommands
- `set url <url>` — set target URL for the session
- `set model <model>` — set OpenCode model
- `show` — display current session state
- `help` — show available commands
- `exit` — quit

Session initializes from `.env` (`TARGET_URL`, `OPENCODE_MODEL`). Use `↑`/`↓` for history, `Tab` for completion.

## Commands Summary

| Command | Description | Key Options |
|---------|-------------|-------------|
| `check` | Verify environment and connectivity | `--url` |
| `explore` | Open browser, navigate, capture snapshot | `--url`, `--depth`, `--screenshot`, `--headed` |
| `plan` | Generate test plan from snapshot via opencode | `--url`, `--snapshot`, `--prompt`, `--prompt-file`, `--model` |
| `test` | Generate or execute Playwright tests | `--plan`, `--generate`, `--execute`, `--extract`, `--headed` |
| `report` | Aggregate artifacts into summary report | `--format`, `--output` |
| `skill` | Generate opencode skill files | `--output-dir`, `--agents` |
| `repl` | Start interactive REPL session | — |

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

## Architecture

```
pw-cli-agent
├── CLI Layer (Commander.js subcommands)
│   ├── check    — verify playwright-cli + opencode + target site
│   ├── explore  — open browser, navigate, snapshot, screenshot
│   ├── plan     — send snapshots to opencode for test plan generation
│   ├── test     — generate/execute playwright tests
│   ├── report   — aggregate results into markdown/HTML
│   ├── skill    — generate opencode SKILL.md files
│   └── repl     — interactive session (tab completion, state tracking)
├── Playwright CLI Wrapper (child_process.execFile)
│   └── pwExec(command, args, opts) — runs `playwright-cli <cmd>`
├── OpenCode Integration (child_process.spawn)
│   └── opencodeRun(prompt, opts) — runs `opencode run --format json`
├── Artifact Manager
│   └── ./artifacts/{explore,plans,tests,reports,results}/
└── Config
    └── pw-cli-agent.config.json + .env
```

## File Structure

```
agent/
├── Dockerfile
├── package.json
├── tsconfig.json
└── src/
    ├── index.ts                      # Entry point: Commander program
    ├── config.ts                     # Config loading + defaults
    ├── commands/
    │   ├── check.ts                  # Environment verification
    │   ├── explore.ts                # Browser exploration + snapshots
    │   ├── plan.ts                   # Test plan generation via opencode
    │   ├── test.ts                   # Test generation + execution
    │   ├── report.ts                 # Result aggregation
    │   ├── skill.ts                  # OpenCode skill file generation
    │   └── repl.ts                   # Interactive REPL session
    └── lib/
        ├── pw-cli.ts                 # Playwright CLI wrapper
        ├── opencode.ts               # OpenCode subprocess wrapper
        ├── artifacts.ts              # Artifact directory management + code extraction
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
```

## Dependencies

| Package | Purpose |
|---------|---------|
| `commander` | CLI subcommand parsing |
| `chalk` | Terminal output styling |
| `@playwright/test` | Playwright test runner |

Node built-ins: `node:readline` (REPL), `node:child_process`, `node:fs`, `node:path`.

External tools (installed in container):
- `@playwright/cli` — browser automation CLI
- `opencode` — AI agent backend

## References

- [playwright-cli](https://playwright.dev/agent-cli/) — Playwright CLI for coding agents
- [opencode](https://opencode.ai) — AI coding agent for the terminal
- [auto_playwright](https://github.com/ohanedan/playwright-testgen) — Original explore/plan/test/report workflow inspiration
- [commander.js](https://github.com/tj/commander.js) — CLI framework
