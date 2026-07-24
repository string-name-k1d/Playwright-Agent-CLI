# pw-cli-agent

A TypeScript CLI tool that implements an explore > plan > test > report workflow for automated web testing, combining `playwright-cli` for browser automation with `opencode` as an AI agent backend.

## Overview

`pw-cli-agent` is a command-line tool that orchestrates end-to-end test generation and execution. Instead of using MCP (Model Context Protocol) for browser interaction, it leverages `playwright-cli` for token-efficient browser control and `opencode` for AI-powered test planning, code generation, and self-healing.

The workflow mirrors `auto_playwright` but replaces MCP with CLI-based browser automation:

```
check (environment) > explore (browser) > plan (opencode) > test (playwright) > report
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
│   └── skill    — generate opencode SKILL.md files
├── Playwright CLI Wrapper (child_process.execFile)
│   └── pwExec(command, args, opts) — runs `playwright-cli <cmd>`
├── OpenCode Integration (child_process.spawn)
│   └── opencodeRun(prompt, opts) — runs `opencode run -f json`
├── Artifact Manager
│   └── ./artifacts/{explore,plans,tests,reports}/
└── Config
    └── pw-cli-agent.config.json
```

## Commands

### `check`

Verify environment and connectivity.

```bash
pw-cli-agent check
pw-cli-agent check --url https://example.com
```

Checks:
- `playwright-cli --version` is available
- `opencode --version` or `opencode run --help` is available
- Target site loads via `playwright-cli open <url>` + `snapshot` (if `--url` provided)

**Options:**
- `--url <url>` — also verify site connectivity

### `explore`

Open a browser, navigate to a URL, capture a snapshot and optional screenshot.

```bash
pw-cli-agent explore --url https://example.com
pw-cli-agent explore --url https://example.com --screenshot --depth 4 --headed
```

**Options:**
- `--url <url>` — target URL (required)
- `--depth <N>` — snapshot tree depth (default: full)
- `--screenshot` — also capture a PNG screenshot
- `--headed` — show browser window

Artifacts saved to `./artifacts/explore/`.

### `plan`

Send a snapshot to `opencode` and generate a structured test plan.

```bash
pw-cli-agent plan --snapshot ./artifacts/explore/page.yaml
pw-cli-agent plan --url https://example.com
```

**Options:**
- `--snapshot <file>` — specific snapshot file to analyze
- `--url <url>` — if no snapshot, run explore first
- `--model <model>` — opencode model override
- `--output <file>` — custom output path

Plan saved to `./artifacts/plans/`.

### `test`

Generate or execute Playwright tests.

```bash
# Interactive codegen recording
pw-cli-agent test --url https://example.com --generate

# Execute existing test file
pw-cli-agent test --execute ./tests/login.spec.ts

# Generate from plan via opencode, then execute
pw-cli-agent test --url https://example.com --plan ./artifacts/plans/plan-xxx.md
```

**Modes:**
- `--generate` — launches `playwright codegen` for interactive recording
- `--execute <file>` — runs `npx playwright test <file>`
- `--plan <file>` — sends plan to opencode for code generation, then executes

**Options:**
- `--url <url>` — target URL
- `--headed` — visible browser
- `--retries <N>` — self-heal retries on failure (default: 3)

Tests saved to `./artifacts/tests/`.

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
    │   └── skill.ts                  # OpenCode skill file generation
    └── lib/
        ├── pw-cli.ts                 # Playwright CLI wrapper
        ├── opencode.ts               # OpenCode subprocess wrapper
        ├── artifacts.ts              # Artifact directory management
        └── prompt-templates.ts       # Reusable prompt templates for opencode
shared/
└── utils/
    └── command_parser.ts             # Legacy parser (reference only)
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

CLI flags override config file values.

## Environment Variables

| Variable | Description |
|----------|-------------|
| `OPENCODE_MODEL` | Default opencode model |
| `TARGET_URL` | Default target URL |
| `PW_CLI_HEADED` | Run browsers headed by default |
| `PW_CLI_OUTPUT_DIR` | Custom artifacts directory |
| `OPENCODE_SERVER_URL` | Connect to a host-running `opencode serve` instead of local CLI |

## Docker

The tool runs inside a container with `playwright-cli`, `opencode`, and all browser dependencies pre-installed.

### OpenCode Connection

The container supports two modes for connecting to opencode:

**Mode 1: Remote server (recommended for Docker)**

Start opencode on the host, then point the container to it:

```bash
# On host — start opencode server
opencode serve --port 4096

# In .env
OPENCODE_SERVER_URL=http://host.docker.internal:4096
OPENCODE_MODEL=anthropic/claude-sonnet-4-6
```

The container connects to the host's opencode server via HTTP. API keys and auth live on the host — no need to duplicate them in the container.

**Mode 2: Local CLI inside container**

If `OPENCODE_SERVER_URL` is not set, the container runs `opencode` CLI directly. This requires API keys to be available inside the container (via `.env` or mounted config).

### Usage

```bash
docker-compose build
docker-compose up -d
docker-compose exec agent node dist/index.js check --url https://example.com
```

### .env

```bash
OPENCODE_MODEL=anthropic/claude-sonnet-4-6
TARGET_URL=https://example.com
OPENCODE_SERVER_URL=http://host.docker.internal:4096
```

## Dependencies

| Package | Purpose |
|---------|---------|
| `commander` | CLI subcommand parsing |
| `chalk` | Terminal output styling |
| `@playwright/test` | Playwright test runner |
| `readline` | REPL input (reserved for future use) |

External tools (must be installed separately):
- `@playwright/cli` — browser automation CLI
- `opencode` — AI agent backend

## References

- [playwright-cli](https://playwright.dev/agent-cli/) — Playwright CLI for coding agents
- [opencode](https://opencode.ai) — AI coding agent for the terminal
- [auto_playwright](https://github.com/ohanedan/playwright-testgen) — Original explore/plan/test/report workflow inspiration
- [commander.js](https://github.com/tj/commander.js) — CLI framework