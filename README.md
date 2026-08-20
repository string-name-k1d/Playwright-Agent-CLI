# Playwright Agent CLI (`pwcli`)

An playwright-cli based end-to-end web-testing agent: it **explores** a website, **plans** test cases,
**generates** Playwright specs, **executes** them, and **heals** failures using
an AI agent backend — the `opencode` CLI by default, or any OpenAI-compatible
chat-completions API. Browser automation runs through Playwright's
Node.js API directly (in-process) for page actions/snapshots; some pipeline
stages (for example `npx playwright test`, `opencode run`, and optional `drush`)
run as subprocesses. This keeps browser-state handling deterministic while
keeping AI usage (and token spend) minimal.

- Full command reference: [COMMANDS.md](COMMANDS.md)
- Invocation: `pwcli` and `pw-cli` are shell aliases for `node dist/index.js`
  (defined in `.bash_aliases`, interactive shells). In scripts or
  non-interactive shells use `node dist/index.js <command>`.

## Table of Contents

- [Playwright Agent CLI (`pwcli`)](#playwright-agent-cli-pwcli)
  - [Table of Contents](#table-of-contents)
  - [Overview](#overview)
  - [Setup](#setup)
    - [Run with Docker](#run-with-docker)
    - [Configuration](#configuration)
    - [Environment Variables](#environment-variables)
    - [AI Agent Backends](#ai-agent-backends)
    - [First-time login \& verify](#first-time-login--verify)
  - [Commands](#commands)
    - [Command summary (flow order)](#command-summary-flow-order)
    - [Notes on arguments](#notes-on-arguments)
  - [How the pipeline works](#how-the-pipeline-works)
  - [Screenshots](#screenshots)
  - [Natural Language Prompts](#natural-language-prompts)
  - [Site knowledge](#site-knowledge)
    - [Explore Registry](#explore-registry)
    - [Website Profiles \& Site Map](#website-profiles--site-map)
    - [Site Profile](#site-profile)
  - [User References](#user-references)
  - [Locator Rules](#locator-rules)
  - [Accessibility Tree Limitations (CDP)](#accessibility-tree-limitations-cdp)
  - [Docker \& OpenCode connection](#docker--opencode-connection)
  - [Architecture](#architecture)
  - [File Structure](#file-structure)
  - [References](#references)

## Overview

The tool drives Chromium via an in-process Playwright session and captures
**accessibility snapshots** (serialized as YAML with `[eN]` element refs). AI
agents (via the configured backend — `opencode` or an OpenAI-compatible API)
consume those snapshots to plan and write tests. Every
explore also feeds a **structured per-site profile** (hierarchical element trees
with CSS selectors + DOM state) and a **site map** (a two-tier route index +
per-route functional element specs) that can be queried without re-exploring.

```
Manual:  explore → plan → generate → test → report
                                ↘ heal ↗

Autorun: explore → plan → [generate → test → heal → generate] → loop until all pass
```

**Why not MCP?** A deterministic CLI produces more repeatable tests while
offering quick utility functions — avoiding unnecessary AI round-trips.

## Setup

### Run with Docker

```bash
# 1. Build and start the container (Xvfb + noVNC + Playwright + opencode)
docker-compose build
docker-compose up -d

# 2. Sanity-check the environment (playwright-cli, opencode, site reachability)
docker exec playwright_cli bash -lc 'cd /workspace/agent && node dist/index.js check'
```

The container exposes:

| Port | Purpose |
|------|---------|
| `6080` | noVNC web client (`http://localhost:6080/vnc.html`) — view headed browsers |
| `5900` | VNC (native VNC client) |
| `8123` | Playwright UI panel (`ui` command) |

The `agent/` source is bind-mounted at `/workspace/agent`, so edits on the host
are live inside the container. OpenCode API keys come from the host's
`~/.config/opencode` (see [Docker & OpenCode connection](#docker--opencode-connection)).

### Configuration

Create `pw-cli-agent.config.json` in the project root or
`~/.config/pw-cli-agent/config.json` (or pass `--config <path>`):

```json
{
  "targetUrl": "https://example.com",
  "agentProvider": "opencode",
  "opencodeModel": "anthropic/claude-sonnet-4-6",
  "apiModel": "gpt-4o",
  "apiBaseUrl": "https://api.openai.com/v1",
  "apiTimeout": 300000,
  "siteAdapter": "generic",
  "outputDir": "./artifacts",
  "headed": false,
  "snapshotDepth": 4,
  "maxRetries": 3,
  "basicAuthUser": "your-username",
  "basicAuthPass": "your-password"
}
```

Precedence: **CLI flags > env vars > config file > defaults.**

### Environment Variables

| Variable | Description |
|----------|-------------|
| `TARGET_URL` | Default target URL (fallback for `--url`) |
| `AGENT_PROVIDER` | AI agent backend: `opencode` (default) or `api` (OpenAI-compatible chat-completions) |
| `OPENCODE_MODEL` | Default model for the **opencode** backend |
| `OPENCODE_AGENT` | Opencode agent used for generation (default: the non-agentic `codegen` agent) — opencode backend only |
| `OPENCODE_SERVER_URL` | Remote opencode server endpoint (leave empty for local CLI mode; remote server mode is currently broken in opencode 1.18.x) |
| `AGENT_API_KEY` | API key for the **api** backend (env only — never commit; `OPENAI_API_KEY` also works) |
| `AGENT_API_BASE_URL` | Base URL for the **api** backend (default: `https://api.openai.com/v1`) |
| `AGENT_API_MODEL` | Default model for the **api** backend (e.g. `gpt-4o` via OpenAI, `claude-sonnet-4-6`/`anthropic/claude-...` via OpenRouter) |
| `AGENT_API_TIMEOUT` | Request timeout (ms) for the **api** backend (default: `300000`) |
| `PW_CLI_HEADED` | Run browsers headed by default (`true`/`false`) |
| `PW_CLI_SITE_ADAPTER` | Site adapter: `generic` (default) or `drupal` (enables Drupal-specific reveal/add behavior) |
| `PW_CLI_OUTPUT_DIR` | Custom artifacts directory |
| `STORAGE_STATE` | Default browser profile path for saved login state |
| `BASIC_AUTH_USER` / `BASIC_AUTH_PASS` | HTTP Basic Auth credentials for sites behind an nginx auth gate |
| `PW_CLI_PLAN_MAX_PROMPT_CHARS` | Planner prompt/context max characters (default: `180000`) |
| `PW_CLI_PLAN_MAX_REFERENCE_CHARS` | Planner reference payload max characters (default: `40000`) |
| `PW_CLI_PLAN_MAX_SNAPSHOTS` | Max snapshots included per planning call (default: `3`) |
| `PW_CLI_GENERATE_MAX_PROMPT_CHARS` | Generator prompt max characters (default: `180000`) |
| `PW_CLI_GENERATE_MAX_REFERENCE_CHARS` | Generator reference payload max characters (default: `50000`) |
| `PW_CLI_CODEGEN_REFERENCE_MAX_FILES` | Max codegen reference files inlined per generation call (default: `3`) |

All of these can be set in `.env` (copied from `.env.example`); `docker-compose`
loads it automatically. Never commit real `.env` values — `.env` and
`.env.*` are gitignored.

### AI Agent Backends

The planner, generator, and healer all call the configured AI backend through a
single provider dispatcher (`agent/src/lib/agent-provider.ts`). Two backends are
available; the active one is selected by `AGENT_PROVIDER` (env) or
`agentProvider` (config file):

| Backend | `AGENT_PROVIDER` | How it runs prompts |
|---------|------------------|---------------------|
| **opencode** (default) | `opencode` (or unset) | Runs the `opencode` CLI (`opencode run --format json`); auth comes from your opencode config (`~/.config/opencode`). Uses the project's non-agentic `codegen` agent for generation. |
| **API** (OpenAI-compatible) | `api` | POSTs to `{AGENT_API_BASE_URL}/chat/completions` (default `https://api.openai.com/v1`) with the user prompt. Works with OpenAI, OpenRouter, Anthropic-compatible endpoints, local models (Ollama/LM Studio), etc. |

**Using a non-opencode backend:**

```bash
export AGENT_PROVIDER=api
export AGENT_API_KEY=sk-...            # or OPENAI_API_KEY
export AGENT_API_MODEL=gpt-4o          # or e.g. anthropic/claude-sonnet-4-6 (OpenRouter)
# AGENT_API_BASE_URL=https://api.openai.com/v1   # default; change for OpenRouter/local
```

or in `.env`:

```
AGENT_PROVIDER=api
AGENT_API_KEY=sk-...
AGENT_API_MODEL=gpt-4o
```

Notes:

- The API key is read from the **environment only** (`AGENT_API_KEY` or
  `OPENAI_API_KEY`) — never put it in the config file or commit it.
- `--model` still works on `plan`/`heal` as a per-invocation override for
  whichever backend is active; `OPENCODE_MODEL` applies only to the opencode
  backend, `AGENT_API_MODEL` only to the API backend.
- The opencode implementation remains the default and is kept for backward
  compatibility; it is labelled legacy when a non-opencode backend is selected.
- Generation batching (`--batch-size`, default 5 cases per request) applies to
  both backends — keep it small, reasoning models occasionally emit no code when
  their output-token budget is exhausted by internal deliberation.

### First-time login & verify

```bash
# Log in via a Drush one-time link, saves ./auth-profile
node dist/index.js login --url https://example.com --user admin --drush-cmd "docker exec my_drupal drush"

# Or reuse an existing host-browser login behind SSO (CAS/Shibboleth/2FA)
node dist/index.js import-session --capture --url https://your-site.example

# Verify the session is authenticated for the site
node dist/index.js check --url https://example.com
```

After login, all browser commands auto-detect `./auth-profile` — no `--profile`
flag needed. HTTP Basic Auth is passed automatically when `BASIC_AUTH_USER` /
`BASIC_AUTH_PASS` are set in `.env`.

## Commands

Detailed per-command reference (options, examples, behavior): **[COMMANDS.md](COMMANDS.md)**.

### Command summary (flow order)

The pipeline is **explore → plan → generate → test → heal**; `autorun` chains it
in a loop. Setup commands (`check`, `login`, `import-session`) come first.

| Command | Description | Key Options |
|---------|-------------|-------------|
| `check` | Verify environment and connectivity | `--url`, `--screenshot`, `--profile` |
| `login` | Log in via Drush ULI, save browser profile | `--url`, `--user`, `--uli`, `--drush-cmd` (required with `--user`), `--profile` |
| `import-session` | Reuse a host-browser login (cookies import / noVNC capture) | `--cookies`, `--capture`, `--url`, `--profile` |
| `explore` | Navigate, capture snapshot (registry + per-site profile) | `--url`, `--depth`, `--screenshot`, `--headed`, `--expanded`, `--guide`, `--repl`, `--profile` |
| `profile` | Inspect per-site profiles / registry / refs / site map | `tree`, `query`, `ref`, `pages`, `ls`, `map` |
| `plan` | Generate test plan via AI agent (explore-plan mini-loop) | `--url`, `--snapshot`, `--prompt`, `--prompt-file`, `--model`, `--search`, `--explore`, `--reference` |
| `generate` | Generate spec files from plans (extract / AI generation / codegen; batched) | `--plan`, `--extract`, `--codegen`, `--url`, `--profile`, `--reference`, `--batch-size` |
| `test` | Execute Playwright test files (dependency-ordered waves) | `--execute`, `--url`, `--headed`, `--retries`, `--workers`, `--profile` |
| `ui` | Interactive Playwright UI test runner (panel on `8123`) | `--execute`, `--url`, `--profile`, `--ui-host`, `--ui-port` |
| `report` | Aggregate artifacts into a summary report (`md`, `html`, or `json`) | `--format`, `--output` |
| `heal` | Re-explore failures, generate corrected plan (keeps passing tests) | `--url`, `--model`, `--headed`, `--profile` |
| `autorun` | Full loop: explore → [codegen] → plan → generate → test → heal → generate | `--url`, `--headed`, `--prompt`, `--max-iterations`, `--resume`, `--profile`, `--codegen`, `--batch-size` |
| `repl` | Interactive REPL session | — |
| `skill` | Generate opencode skill files | `--output-dir`, `--agents` |
| `clean` | Remove scratch/temp files, prune old run artifacts | `--dry-run`, `--autorun`, `--runs`, `--keep-autorun`, `--keep-runs`, `--all` |

### Notes on arguments

- `url`: all commands fall back to `TARGET_URL` from `.env` when `--url` is omitted.
- `profile`: browser commands auto-detect `./auth-profile` created by `login`.
- Every command **validates its arguments on startup** before doing any work:
  file/dir args must exist (`Error: <flag> not found: <path>`), `--url`/`--uli`
  must be valid `http(s)` URLs, numeric options must be non-negative integers,
  `--resume <runId>` must point to an existing `artifacts/results/autorun-<runId>`,
  and the global `--config <path>` must exist. Glob patterns are accepted for
  `--execute`.

## How the pipeline works

1. **Explore** — capture an accessibility snapshot of a page and register it
   (optionally `--expanded` to open droplists/tabs so hidden components appear).
2. **Plan** — send snapshots + site map to the AI agent; get a structured test plan
   with priorities, dependencies, steps, and expected results.
3. **Generate** — turn the plan into `*.spec.ts` files (extract / AI generation /
   interactive codegen), each batch syntax-checked before saving.
4. **Test** — run specs with Playwright; dependencies schedule execution in
   ordered waves.
5. **Heal** — failures are re-explored and fixed via a corrected healing plan
   that preserves passing tests; autorun loops steps 4–5 until everything passes.

## Screenshots

Generated tests capture full-page screenshots on both pass and fail via a
`test.afterEach` hook, saved under `test-results/<test-dir>/screenshots/` and
aggregated into `artifacts/results/run-<timestamp>/screenshots/`.

## Natural Language Prompts

`plan` and `autorun` accept plain-language requirements to guide test generation:

```bash
pwcli plan --url https://example.com --prompt "Test the checkout flow: add items to cart, apply discount code, and complete payment"
```

Or from a markdown file (`--prompt-file ./requirements.md`). The prompt can
enumerate features, expected behaviors, and priority — the planner maps it to
standalone test cases.

## Site knowledge

### Explore Registry

Every `explore` registers its snapshot in `artifacts/explore-registry.json`
with structured metadata (URL, title, element/link counts, headings) plus a
searchable element list. The `plan` command uses it to reuse cached snapshots,
search records (`--search "login"`), and auto-explore unvisited pages
(`--explore`). Deduplication keeps at most the 3 most-recent records per URL,
with full element lists stored in sidecar files (`artifacts/explore/meta/<snapshot>.json`).

### Website Profiles & Site Map

Every explore/guide snapshot also updates a **per-site profile** — one compact
directory per origin at `artifacts/website-profiles/<host>/`, stored as a
**two-tier** layout so tooling reads one route without loading the whole site:

| File | Content |
|------|---------|
| `site_index.json` | Route index (~KBs): base URL, `updatedAt`, one entry per route (path, title, URL, counts, spec file ref) |
| `specs/<route>-<hash>.json` | Per-route functional spec: flat element list (interactive roles + semantic containers) with CSS selector, hierarchy path, ref links, and DOM state |

Only automation-relevant roles are indexed (buttons, links, inputs, forms,
dialogs, navigation, etc.); structural noise is dropped, cutting payload ~70%.
The site map **is** this two-tier profile — `profile map <url>` rebuilds it.

```bash
pwcli profile ls                                  # list all site profiles
pwcli profile tree <url>                          # hierarchical element tree for a page
pwcli profile query "Page Title" <url>            # registry search on one page
pwcli profile ref e42 <url>                       # where a ref appears + its locator
pwcli profile map <url>                           # (re)build site_index.json + specs/
```

For ad-hoc queries against a built site map, a standalone script is available:
`node scripts/query-site-map.mjs <site_index.json> <query|--list|--route>`
(see its header in `agent/scripts/query-site-map.mjs` for usage).

### Site Profile

A living document at `artifacts/site-profile.md` that accumulates knowledge
about the site across all explore runs: overview, discovered pages, navigation
links, forms, interactive elements, headings, per-page breakdowns, and links to
the structured profiles. It is regenerated after each `explore` and fed to the
planner for context.

## User References

Pass user-authored test procedures and screenshots to the planner/generator so
manual QA scripts become automated tests:

```bash
pwcli plan --url http://example.com --reference ./my-test-procedure.md
pwcli plan --url http://example.com --reference ./test-procedures/   # directory
pwcli generate --plan plan-123.md --reference ./test-procedures/
```

Markdown steps (from `##` headings and numbered lists) are extracted and
injected into the AI prompts; PNG/JPG files in the same directory are associated
with their reference files.

## Locator Rules

The AI planner and generator receive the raw accessibility snapshot from
Playwright. The snapshot uses Playwright's accessibility tree roles which map
**directly** to `getByRole()` — but the AI often misinterprets them. The prompts
include explicit rules to prevent common failures:

| Snapshot Role | Correct Locator | Common Mistake |
|---------------|----------------|----------------|
| `navigation "Tabs"` | `getByRole('navigation', { name: 'Tabs' })` | `getByRole('tablist')` |
| `navigation "Toolbar items"` | `getByRole('navigation', { name: 'Toolbar items' })` | `getByRole('toolbar')` |
| `columnheader` with `link "Updated Sort ascending"` | `getByRole('columnheader', { name: /Updated/ })` | `exact: true` with just `"Updated"` |
| `option` inside `combobox` | `expect(select).toHaveValue(...)` | `expect(option).toBeVisible()` — options are never visible |
| `link "X"` where `link "Edit X"` exists | `getByRole('link', { name: 'X', exact: true })` | `getByRole('link', { name: 'X' })` — strict mode violation |

## Accessibility Tree Limitations (CDP)

Starting with Playwright v1.61.0, `page.accessibility.snapshot()` returns
`undefined`. The tool uses Chrome DevTools Protocol
(`Accessibility.getFullAXTree`) via `page.context().newCDPSession(page)`.
This has known limitations:

| Limitation | Description | Impact |
|------------|-------------|--------|
| **Flat node list** | CDP returns a flat array of nodes; parent-child relationships are encoded via `parentId`/`childIds`. Negative `childId` values are internal inline-text markers and must be filtered. | YAML tree reconstruction is heuristic — isolated nodes or subtrees may be placed at the wrong depth. |
| **CKEditor / WYSIWYG iframes** | Rich text editors render inside `<iframe>` elements; `getFullAXTree` does not cross iframe boundaries. | The editor toolbar and editable area appear as an opaque `application` role; clicking "Bold"/"Italic" requires DOM-based fallback locators. |
| **Collapsed/conditional fields** | Fields hidden by JS (e.g. animation sub-options) do not appear in the CDP tree. | Test generation for conditional form sections is unreliable without prior interaction. |
| **Nested paragraphs (Drupal)** | Sections and blocks render as `<table>` rows with concatenated cell text. | The planner must infer structure from concatenated text rather than role/name pairs. |
| **Dropbutton widget expansion** | Drupal dropbutton secondary actions (e.g. "Add Text Area Block") are hidden until the toggle is clicked. | The explore flow auto-expands paragraph dropbuttons on `/node/add/*` pages so secondary actions are captured; other dropdowns still require manual expansion. |
| **Non-stable nodeId values** | CDP nodeIds are large non-sequential integers that change between page loads. | Element refs (`[ref=N]`) cannot be persisted across sessions; `getByRole()` locators are the only portable identifiers. |
| **Concatenated label text** | Adjacent `StaticText` nodes are sometimes merged or split inconsistently. | Element summaries may show truncated or duplicated text for form descriptions. |

**Mitigations and Workarounds:**

| Problem | Workaround |
|---------|------------|
| CKEditor content capture | Read the editor content via `page.evaluate()` on `CKEDITOR.instances[instanceName].getData()` or the native `innerHTML` of the editable iframe body. |
| Hidden / lazy fields | Include pre-interaction steps in the test plan ("click the Animation checkbox first") or use `locator.click({ force: true })`. |
| Nested paragraph structure | Parse concatenated cell text, splitting on known label keywords; use `page.getByLabel()` as a fallback. |
| Dropbutton / secondary actions | Expand manually: `page.locator('.dropbutton-toggle button').click()`. |
| Non-stable nodeIds | Always use `getByRole()` locators; `[ref=N]` is valid only within a single snapshot. |
| Missing text content | Fall back to `page.locator('selector').textContent()`. |

## Docker & OpenCode connection

The tool runs inside a container with `playwright-cli`, `opencode`, and all
browser dependencies pre-installed (Xvfb, x11vnc, noVNC).

**Mode 1: Local CLI inside the container (default, recommended).** Leave
`OPENCODE_SERVER_URL` empty. The container runs the `opencode` CLI directly
(`opencode run --format json`); API keys are provided by mounting the host's
opencode config into the container (see `docker-compose.yml`).

**Mode 2: Remote server (currently broken — do not use).**
`opencode serve --port 4096` crashes on startup in opencode 1.18.x
(`Unexpected error / ServeError`), and on Windows `opencode` may resolve to the
desktop app (`OpenCode.exe`) rather than a CLI.

**Mode 3: OpenAI-compatible API backend.** With `AGENT_PROVIDER=api`, no
`opencode` binary is needed anywhere — the container reaches the API directly
over HTTPS (`AGENT_API_BASE_URL`, default `https://api.openai.com/v1`). Set
`AGENT_API_KEY` / `AGENT_API_MODEL` in `.env` (loaded by docker-compose); for
hosted models reachable from inside the container this is the simplest setup.
Local model servers (Ollama/LM Studio) work too — point `AGENT_API_BASE_URL` at
the container's reachable address for the model host (e.g.
`http://host.docker.internal:11434/v1`).

## Architecture

```
pw-cli-agent
├── CLI Layer (Commander.js subcommands)
│   ├── check / login / import-session   — environment + session setup
│   ├── explore / guide / profile        — snapshot, registry, per-site profiles, site map
│   ├── plan / generate / test / ui / report
│   ├── autorun / heal / repl
│   └── skill / clean
├── Playwright Session (in-process, no subprocess)
│   └── lib/playwright-session.ts — chromium.launch() / launchPersistentContext()
│       ├── goto, click, fill, screenshot, accessibility snapshot (CDP)
│       ├── page.pause() for Playwright Inspector (codegen mode)
│       ├── YAML accessibility serialization with [ref=eN] format
│       ├── DOM enrichment (best-effort CSS selectors, field state)
│       └── navigation tracking (visitedPages)
├── Agent Backend (provider dispatch — lib/agent-provider.ts)
│   ├── opencode (default) — opencodeRun() via `opencode run --format json`; legacy default
│   └── api — OpenAI-compatible `/chat/completions` (selected with AGENT_PROVIDER=api)
├── Explore Registry (artifacts/explore-registry.json) + snapshot sidecars
├── Website Profiles (lib/website-profile.ts + lib/site-map.ts) — two-tier index
├── Artifact Manager (./artifacts/{explore,plans,tests,reports,results}/)
└── Config (pw-cli-agent.config.json + .env + resolveProfile())
```

## File Structure

```
agent/
├── Dockerfile
├── package.json          # bin: pw-cli-agent -> dist/index.js
├── tsconfig.json
└── src/
    ├── index.ts                      # Entry point: Commander program
    ├── config.ts                     # Config loading + resolveProfile()
    ├── commands/
    │   ├── check.ts                  # Environment verification
    │   ├── login.ts                  # ULI auth + storageState JSON export
    │   ├── import-session.ts         # Host-browser cookie import / noVNC capture
    │   ├── explore.ts                # Browser exploration + snapshots + registry
    │   ├── guide.ts                  # Interactive guided browsing (codegen/REPL)
    │   ├── profile.ts                # Per-site profiles: tree/query/ref/pages/ls/map
    │   ├── plan.ts                   # Test plan generation (registry query, multi-page explore)
    │   ├── generate.ts               # Test file creation (extract / AI generation / codegen)
    │   ├── test.ts                   # Test execution + self-heal retries
    │   ├── ui.ts                     # Playwright UI test runner (headed, panel server)
    │   ├── report.ts                 # Result aggregation
    │   ├── skill.ts                  # Opencode skill file generation
    │   ├── autorun.ts                # Loop: explore → [codegen] → plan → generate → test → heal
    │   ├── heal.ts                   # Element-not-found detection + corrected plan
    │   ├── repl.ts                   # Interactive REPL session
    │   └── clean.ts                  # Scratch/temp cleanup + run-artifact pruning
    └── lib/
        ├── args.ts                   # Argument validation helpers
        ├── pw-cli.ts                 # Playwright CLI wrapper (playwright-cli --version)
        ├── playwright-session.ts     # In-process Playwright wrapper (browsing + snapshots)
        ├── agent-provider.ts         # Agent backend dispatch (opencode | OpenAI-compatible API)
        ├── opencode.ts               # Opencode backend (legacy default provider)
        ├── artifacts.ts              # Artifact directory management + code extraction
        ├── snapshot-parser.ts        # YAML snapshot → structured elements
        ├── codegen-annotator.ts      # Codegen scripts annotated with [eN] refs
        ├── reference-loader.ts       # User test procedures/screenshots → AI prompts
        ├── explore-registry.ts       # Searchable snapshot index + metadata
        ├── element-tree.ts           # Snapshot YAML → hierarchical element tree
        ├── website-profile.ts        # Per-site two-tier profile (site_index + specs)
        ├── site-map.ts               # Site map: route index + per-route functional specs
        ├── site-profile.ts           # Living site profile (accumulated knowledge)
        ├── profile-refresh.ts        # Profile/site-map refresh after explore runs
        ├── login-page.ts             # Login/SSO redirect detection
        └── prompt-templates.ts       # Reusable prompt templates for the AI agent
```

## Recent Improvements

### Form helpers & auto-import

- `publishPage` and `addBlock` are now auto-imported in generated test files
  (`FORM_HELPERS_IMPORT` / `HELPER_NAMES` in `artifacts.ts`).
- `addBlock`'s `labelText` parameter is optional — when omitted the block is
  added without an assertion (useful when the label is hard to predict).
- `injectTemplateImports` correctly handles multi-line `import { ... }`
  statements when injecting shared-helper imports.

### Generator & healer prompts

- `generator.md` recommends `publishPage(page)` over raw
  `clickButton(page, 'Publish Page')` + `waitForURL`, which breaks on
  pathauto alias redirects. The old pattern is explicitly forbidden.
- `healer.md` preserves `publishPage` and `addBlock` imports and uses
  `publishPage()` instead of `waitForURL`.

### Generation budget

- `DEFAULT_BATCH_SIZE` reduced from 5 to 3 — reasoning models occasionally
  emit no code when the output-token budget is exhausted by internal
  deliberation; smaller batches keep per-batch prompts short.
- Generator prompts capped at 180 K chars, codegen references capped at
  3 files / 50 K chars (`prompt-budget.ts`).
- Codegen agent uses `variant: minimal` to reduce reasoning-token
  consumption for reasoning models.

## References

- [playwright-cli](https://playwright.dev/agent-cli/introduction) — Playwright CLI for coding agents
- [opencode](https://opencode.ai) — AI coding agent for the terminal
- [auto_playwright](https://github.com/ohanedan/playwright-testgen) — Original explore/plan/test/report workflow inspiration
- [commander.js](https://github.com/tj/commander.js) — CLI framework
