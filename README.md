# pw-cli-agent

A TypeScript CLI tool implementing an explore > plan > test > report workflow for automated web testing. Uses **Playwright's Node.js API directly** (in-process) for browser automation — no subprocess calls — combined with `opencode` as an AI agent backend.

## Table of Contents

- [pw-cli-agent](#pw-cli-agent)
  - [Table of Contents](#table-of-contents)
  - [Overview](#overview)
  - [Quick Start](#quick-start)
  - [Commands](#commands)
    - [`check`](#check)
    - [`login`](#login)
    - [`import-session`](#import-session)
    - [HTTP Basic Auth](#http-basic-auth)
    - [`explore`](#explore)
    - [Guided Browsing Session](#guided-browsing-session)
    - [Default: Codegen Mode (Playwright Inspector)](#default-codegen-mode-playwright-inspector)
    - [Alternative: REPL Mode (`--repl`)](#alternative-repl-mode---repl)
    - [`plan`](#plan)
      - [Plan Format](#plan-format)
    - [`generate`](#generate)
    - [`test`](#test)
    - [`ui`](#ui)
    - [`report`](#report)
    - [`skill`](#skill)
    - [`autorun`](#autorun)
    - [`heal`](#heal)
    - [`repl`](#repl)
    - [`clean`](#clean)
  - [Commands Summary](#commands-summary)
  - [Screenshots](#screenshots)
  - [Natural Language Prompts](#natural-language-prompts)
  - [Explore Registry](#explore-registry)
  - [Website Profiles](#website-profiles)
    - [Functional filtering](#functional-filtering)
    - [Compact serialization](#compact-serialization)
    - [Profile commands](#profile-commands)
  - [Site Map](#site-map)
    - [Querying the site map](#querying-the-site-map)
  - [Site Profile](#site-profile)
  - [User References](#user-references)
    - [Usage](#usage)
    - [Reference Format](#reference-format)
    - [How It Works](#how-it-works)
    - [Reference Directory Structure](#reference-directory-structure)
  - [Locator Rules](#locator-rules)
  - [Accessibility Tree Limitations (CDP)](#accessibility-tree-limitations-cdp)
    - [Mitigations and Workarounds](#mitigations-and-workarounds)
  - [Architecture](#architecture)
  - [File Structure](#file-structure)
  - [Configuration](#configuration)
  - [Environment Variables](#environment-variables)
  - [Docker](#docker)
    - [OpenCode Connection](#opencode-connection)
    - [Usage](#usage-1)
    - [.env](#env)
  - [Contribution Rules](#contribution-rules)
  - [Dependencies](#dependencies)
  - [References](#references)

## Overview

`pw-cli-agent` orchestrates end-to-end test generation and execution. It drives Chromium via Playwright's in-process Node.js API (accessibility snapshots serialized with `[eN]` element refs) and uses `opencode` for AI-powered test planning, code generation, and self-healing. Every explore also feeds a **structured per-site profile** (hierarchical element trees with CSS selectors + DOM state) and an **overall site map** (`site-map.json` + per-route detail files) that can be queried without re-exploring.

```
Manual:  explore → plan → generate → test → report
                                ↘ heal ↗

Autorun: explore → plan → [generate → test → heal → generate] → loop until all pass
```

```mermaid
---
config:
  theme: redux
  layout: fixed
---
flowchart TB
    n4["Explore"] --> n1["Planner"]
    n6["Prompt"] --> n1
    n1 --> n2["Generator"]
    n2 --> n3["Healer"]
    n3 --> n10["Success?"]
    n10 --> n11["Report"] & n1
    n5["Site Map"]
    n7["NL Description of testing task (with batch processing)"]
    n8["Test Cases (.md)"]
    n9["Test Files (.spec.js)"]
    n12["Success/<br>Fault unfixable"]
    n13["Fail"]

    n4@{ shape: rect}
    n1@{ shape: rect}
    n6@{ shape: rect}
    n2@{ shape: rect}
    n3@{ shape: rect}
    n10@{ shape: diam}
    n11@{ shape: rounded}
    n5@{ shape: text}
    n7@{ shape: text}
    n8@{ shape: text}
    n9@{ shape: text}
    n12@{ shape: text}
    n13@{ shape: text}
```

## Quick Start

```bash
# 1. Build and start the container
docker-compose build && docker-compose up -d

# 2. Guided browsing (default: codegen mode with Playwright Inspector)
docker-compose exec agent node dist/index.js explore --guide --url https://example.com

# 3. Log in (generates one-time login link via Drush, saves browser profile)
docker-compose exec agent node dist/index.js login --user admin

# 4. Full auto loop
docker-compose exec agent node dist/index.js autorun --url http://mtpc_test/admin/mtpc/content --prompt "Test Add Standard Page"

# 5. Or start an interactive REPL session
docker-compose exec agent node dist/index.js repl
```

## Commands

All commands fall back to `TARGET_URL` from `.env` when `--url` is not passed. All browser commands (`check`, `explore`, `autorun`, `heal`) auto-detect the `./auth-profile` directory created by `login` — no need to pass `--profile` explicitly if you used the default path.

**Argument validation:** every command validates its arguments immediately on startup, before doing any work:
- File/directory arguments (`--cookies`, `--snapshot`, `--prompt-file`, `--plan`, `--reference`, `--execute`, `--codegen <file>`, ...) must exist — otherwise the command fails fast with `Error: <flag> not found: <path>`.
- `--url`/`--uli` must be valid `http(s)` URLs.
- Numeric options (`--depth`, `--retries`, `--workers`, `--max-iterations`, `--keep-autorun`, `--keep-runs`, `--ui-port`) must be non-negative integers.
- `--resume <runId>` must point to an existing `artifacts/results/autorun-<runId>` directory.
- The global `--config <path>` must point to an existing file.
- Glob patterns (e.g. `tests/*.spec.ts`) are accepted for `--execute` without an existence check.

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

The site check uses the same in-process Chromium session as the other browser commands, so HTTP Basic Auth (`BASIC_AUTH_USER` / `BASIC_AUTH_PASS` from `.env`) and the saved `./auth-profile` session are honored automatically. The default target is the site homepage (safe, non-destructive) — pass `--url` to check a specific page.

If `./auth-profile` exists (created by `login` or `import-session`), it is automatically used for authenticated pages. When the loaded page turns out to be a login/SSO page (e.g. `login.microsoftonline.com`, `shib.ust.hk`), `check` prints a warning that the profile is not authenticated for the site.

**Options:**
- `--url <url>` — also verify site connectivity (falls back to `TARGET_URL`; default is the site homepage)
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

### `import-session`

Reuse a login you already have in your **host browser** (e.g. a site behind HKUST CAS/Shibboleth SSO) without logging in again in the container. Exports the session cookies from the host browser and injects them into the container's `auth-profile`, which all other commands auto-detect.

```bash
# Import cookies exported from the host browser (Cookie-Editor JSON array,
# or a Playwright storageState file with a "cookies" array)
pw-cli-agent import-session --cookies ./shared/callitso-cookies.json

# Alternative: headed interactive capture — log in via noVNC (http://localhost:6080/vnc.html),
# the session is saved once an authenticated page is detected
pw-cli-agent import-session --capture --url https://callitso.docker-uat01.ust.hk

# Verify the imported session
pw-cli-agent check --url https://callitso.docker-uat01.ust.hk
```

**Options:**
- `--cookies <file>` — JSON cookies file (Cookie-Editor export or Playwright storageState)
- `--capture` — headed capture instead of file import (log in via noVNC)
- `--url <url>` — target URL to verify the session against (falls back to `TARGET_URL`)
- `--headed` — show browser window
- `--profile <path>` — profile directory to save (default: `./auth-profile`)

The command injects the cookies into the Chromium profile, navigates to the target, detects whether a Drupal `SESS*` session cookie is present, and writes `auth-profile/state.json` for the test runner. Export cookies for both the app host (e.g. `callitso.docker-uat01.ust.hk`) and the SSO IdP host (e.g. `shib.ust.hk`) for full sessions.

> **Profile locks:** browsers launch with `--no-singleton` and stale Chrome `SingletonLock`/`SingletonSocket`/`SingletonCookie` files are removed before launch, so a previous crashed/killed run can never make the next run fail with "browser profile is in use". Failed/aborted commands always close their browser so no Chromium process leaks to hold the lock.

### HTTP Basic Auth

Sites behind an nginx auth gate (`WWW-Authenticate: Basic` — e.g. UAT hosts that return `401` to everything) are supported via Playwright `httpCredentials`. Configure the credentials in `.env` and every browser flow (`check`, `explore`, `guide`, `login`, `import-session`, `autorun`, `test`, `ui`) passes them automatically:

```
BASIC_AUTH_USER=helper
BASIC_AUTH_PASS=secret
```

Or in `pw-cli-agent.config.json`: `"basicAuthUser"` / `"basicAuthPass"`.

### `explore`

Open a browser, navigate to a URL, capture a snapshot and optional screenshot. Each explore result is registered in the **explore registry** — a searchable index of all snapshots with element metadata (links, headings, buttons, inputs). After each run, the **site profile**, the **per-site website profile** (`website-profiles/<host>/site_index.json` + `specs/`), and the **site map** (the same two-tier index + per-route spec files) are automatically regenerated.

```bash
pw-cli-agent explore --url https://example.com
pw-cli-agent explore --url https://example.com --screenshot --depth 4 --headed

# Expanded exploration: open droplists/reveals/tabs to capture hidden components
pw-cli-agent explore --url https://example.com --expanded

# Interactive guided browsing session (codegen mode by default)
pw-cli-agent explore --guide --url https://example.com

# Or use REPL mode (manual text commands)
pw-cli-agent explore --guide --url https://example.com --repl
```

**Options:**
- `--url <url>` — target URL (falls back to `TARGET_URL`)
- `--depth <N>` — snapshot tree depth (default: full)
- `--screenshot` — also capture a PNG screenshot
- `--headed` — show browser window
- `--expanded` — **expanded exploration**: before snapshotting, interactively open droplist/reveal controls so hidden components are captured (see below)
- `--guide` — interactive guided browsing session (default: codegen mode with Playwright Inspector)
- `--repl` — use REPL mode instead of codegen (manual text commands)
- `--profile <path>` — explicit browser profile path (overrides auto-detection)

**Reveal-hidden components (the droplist problem):** on sites like Drupal, secondary actions are NOT present in the DOM until a reveal control is opened — e.g. "List additional actions" / "Toggle Actions" dropbuttons, or the "Advanced Options" jQuery tabs (fields like "Full Width" are absent until the tab is activated). A plain explore snapshot therefore omits those components entirely. `--expanded` runs `expandReveals()` before snapshotting: it iteratively clicks every "List additional actions" button, `.paragraphs-dropdown-toggle` / dropbutton toggles, unselected `[role="tab"]` panels, and collapsed `<details>` elements (multiple passes with settle time), then captures the snapshot. The `plan` command uses this automatically (see [`plan`](#plan)).

Artifacts saved to `./artifacts/explore/`. Registry stored at `./artifacts/explore-registry.json`. Site profile saved to `./artifacts/site-profile.md`.

> **Unauthenticated redirect guard:** if the browser lands on a login/SSO page (e.g. `login.microsoftonline.com`, `shib.ust.hk`, `/user/login`) instead of the requested page, `explore` **aborts without snapshotting** — otherwise the plan → generate pipeline would emit tests for elements that only exist on the login page. Authenticate first with `import-session --capture` (see above).

### Guided Browsing Session

An interactive mode where you manually browse a website while the tool records observations. Useful for building the site profile before automated testing.

By default, the guided session runs in **codegen mode**, which opens the Playwright Inspector for interactive recording. Alternatively, use `--repl` for a terminal-based command prompt.

### Default: Codegen Mode (Playwright Inspector)

The browser opens headed inside the container's Xvfb virtual display. View and interact with it via noVNC:

- Open **http://localhost:6080/vnc.html** in your host browser to see the browser window

The Playwright Inspector opens automatically, letting you click, type, and navigate on the page while the tool records each action.

```bash
# Codegen mode (default) — opens Playwright Inspector
docker-compose exec agent node dist/index.js explore --guide --url https://example.com
```

How it works:
1. Opens a headed Chromium browser at the target URL (inside Xvfb)
2. Opens the Playwright Inspector (DevTools-style window) for interactive recording
3. Every action you perform in the browser is recorded
4. Close the Inspector or press Ctrl+C to finish
5. A session summary is saved and the site profile is regenerated

### Alternative: REPL Mode (`--repl`)

A terminal-based command prompt for navigating the site via text commands. Useful in headless environments or when you prefer typed commands over visual interaction.

```bash
# REPL mode — manual commands
docker-compose exec agent node dist/index.js explore --guide --url https://example.com --repl
```

**Interactive commands:**

| Command | Description |
|---------|-------------|
| `go <url>` | Navigate to a URL |
| `click <ref>` | Click element by ref (e.g. `click e5`) |
| `fill <ref> <text>` | Fill an input field |
| `snap` | Take and save a snapshot |
| `screenshot` | Capture a PNG screenshot |
| `ls` | Show page elements (links, buttons, inputs, headings) |
| `links` | Show all links with URLs |
| `history` | Show browsing session history |
| `annotate <text>` | Add an annotation note |
| `done` | Finish session and save profile |
| `help` | Show available commands |

**Example REPL session:**
```
guide> click e5
  Clicking [e5]...
Page: Login
URL: http://example.com/login

  Links:
    [e3] "Home" → /
    [e7] "Register" → /register

  Inputs:
    [e10] "Username" (textbox)
    [e12] "Password" (textbox)

guide> fill e10 admin
guide> fill e12 secret
guide> click e15
guide> annotate User should see dashboard after login
guide> done
```

Session summaries are saved to `./artifacts/guided-session-<timestamp>.md`.

### `plan`

Send a snapshot to `opencode` and generate a structured test plan. Queries the **explore registry** for cached snapshots and can auto-explore unvisited pages. Optionally provide natural language requirements to guide what should be tested.

The plan runs an **explore-plan mini-loop**: after each plan is generated, it opens any pages the planner annotated, appends their snapshots to the context, and re-plans — up to `MAX_EXPLORE_DEPTH` iterations — until the planner requests no further pages.

**Expanded re-exploration:** if a plan requests `[explore-expanded: URL]` (or otherwise mentions components hidden behind droplists/reveals/tabs — "List additional actions", "Toggle Actions", "Advanced Options", dropbutton actions), the loop re-explores **exactly that page** interactively with `--expanded` so the hidden components enter the snapshot context and the generated tests can target them. Plain `[explore: URL]` requests stay non-interactive, and expanded requests for a page are only honored once (cached snapshots are never reused for an expanded re-run, since they predate the interaction).

```bash
# Auto-explore and plan
pw-cli-agent plan --url https://example.com

# Plan from existing snapshot
pw-cli-agent plan --snapshot ./artifacts/explore/page.yaml

# Focus on specific requirements
pw-cli-agent plan --url https://example.com --prompt "Test the login flow and form validation"

# Requirements from a markdown file
pw-cli-agent plan --url https://example.com --prompt-file ./requirements.md

# UAT: recorded test cases for the "Add Custom Page (MTPC)" form
pw-cli-agent plan --prompt-file ./prompts/prompts-uat-add-custom-mtpc-page.md \
  --url https://callitso.docker-uat01.ust.hk/node/add/custom_page/mtpc

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

#### Plan Format

All plans follow a standardized markdown format. The AI planner is instructed to produce exactly this structure:

```markdown
## Objective
<Single paragraph describing the overall goal of this test plan — what pages are tested and what user flows are covered.>

## Pages
- <URL> — <description of the page's role in the plan>

## Test Cases

### TC-1: <kebab-case-test-name>
- **Priority:** high|medium|low
- **Dependencies:** standalone | depends: TC-NAME | requires: <description>
- **Description:** <one-line description of what this test verifies>
- **Steps:**
  1. <action — describe element and action, include locator hint>
  2. <action>
- **Expected:** <what should happen after the steps>

### TC-2: <kebab-case-test-name>
...
```

**Format rules:**
- The plan must start with `## Objective` as the very first line (no preamble).
- Test cases are numbered `TC-1`, `TC-2`, etc. with kebab-case names.
- Each test case has exactly five bold-field labels: `Priority`, `Dependencies`, `Description`, `Steps`, `Expected`.
- `Pages` lists all URLs that were explored and their role in the test plan.
- `Dependencies` uses labels: `standalone` for independent tests, `depends: <TC-NAME>` for sequential ordering, `requires: <setup>` for page setup needs.
- The test runner reads these dependency labels to schedule execution: when running tests in parallel, dependent tests are executed in waves **after** the tests they depend on (see `test`).
- During planning, if the AI needs a page that hasn't been explored, it appends a `## Pages to Explore` section with `[explore: /path]` annotations. The system explores those URLs and re-invokes the planner with the expanded context.
- The planner also receives the **site map** from the per-site profile (routes + elements with best-effort CSS selectors/state) and, when passed, an existing codegen/exploration script (`--codegen <file>`), giving it structured context for reliable locators.

Healing plans use the same standardized format.

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
- `--codegen` — launch interactive `playwright codegen` (always headed; codegen does not accept `--headed`)
- `--url <url>` — target URL (for opencode context)
- `--profile <path>` — browser profile for auth state (auto-detects `./auth-profile`); codegen loads it via `--load-storage`
- `--reference <path>` — user test procedures/screenshots directory or file
- `--batch-size <N>` — test cases generated per opencode call (default `5`; `1` = single request for the whole plan)

**Batched generation:** Plans with many test cases (e.g. 50 `TC-*` cases) are split into batches of `--batch-size` test cases, and each batch is generated in its own opencode request. Each request stays small and focused, which cuts token usage per call, keeps responses fast, and avoids the model drifting agentic on an oversized prompt. Batches are written to separate files (`generated-<ts>-batch-<N>.spec.ts`) under `./artifacts/tests/`; a batch that fails to produce code is skipped and reported, and the remaining batches are still saved. When `--batch-size 1` is given the whole plan is sent as one request (legacy behavior). Each batch runs with a 10-minute timeout and is attempted up to 3 times (retries inject a "skip deliberation, output code only" nudge). Note that reasoning models (e.g. the `big-pickle` default) count internal reasoning against their output-token budget and occasionally emit no code at all — retries recover from that, but keep batches small (`5` or fewer) when the plan test cases are detailed, and prefer prompting from the plan alone over inlining large codegen-reference scripts that the model has to reconcile.

**Generation agent:** opencode runs in `--format json` mode against the project's non-agentic `codegen` agent (`.opencode/agent/codegen.md`), which is told to answer directly with only the requested code and never to use tools — this prevents the default `build` agent from going agentic (running Grep/read tools, asking clarifying questions) and timing out. Override with `OPENCODE_AGENT=<name>` (e.g. `OPENCODE_AGENT=build`).

**Built-in site-form guidance:** The generator prompt ships with a Drupal/Composer form-mechanics section so generated tests handle this site's patterns correctly out of the box — hidden add buttons behind "List additional actions" reveals (absent from the DOM until clicked), jQuery-UI "Advanced Options" tabs whose fields only exist once opened (re-query tabs after each click, wait on `aria-selected`), `.paragraph-type-label` as the reliable "was added" signal, `getByRole()` substring-matching pitfalls (e.g. "Add Slide" also matches "Add Slideshow Block"), numeric `<select>` values asserted via `option:checked`, unvalidated blank fields, and `test.setTimeout(120000)` / `test.describe.configure({ timeout: 120000 })` for multi-step flows on slow hosts.

**Codegen mode:**
- Opens the Playwright Inspector on the container's Xvfb display. View and drive it from your host browser via noVNC at `http://localhost:6080/vnc.html` (native VNC client: `localhost:5900`).
- Auth state is loaded automatically when a profile exists (`./auth-profile` or `--profile <path>`), so protected pages work immediately.
- On session close the script is saved to `./artifacts/tests/codegen-<timestamp>.spec.ts` and a saved/not-saved confirmation is printed.

**Element refs (`[eN]`) for repeating elements:** Every saved codegen script is post-processed against the latest explore snapshot (`./artifacts/explore/`). Each `getByRole()`/`getByText()`/`getByLabel()` locator is annotated with the matching accessibility-snapshot ref as a trailing comment, so repeating elements are unambiguous:

- unique match → `await page.getByRole('button', { name: 'Add Text Area Block' }).click(); // [e4]`
- repeating element picked with `.first()`/`.nth(k)` → resolved to that specific ref (e.g. `.nth(1)` → `// [e6]`)
- repeating element without an index → `// [e2, e3] (2 matches - use .nth())`

Annotations are comments only, so the file stays valid TypeScript and fully runnable.

**Codegen scripts feed the AI generator:** Any `codegen-*.spec.ts` files under `./artifacts/tests/` are automatically inlined as reference material whenever tests are generated via opencode (`generate --plan`, and autorun's generation steps). The generator treats the recorded actions as the authoritative source for locators and interaction order, and uses the `[eN]` annotations to disambiguate repeating elements — the refs are informational only and are translated into `getByRole()`/`getByText()` locators (never emitted as DOM selectors).

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
- `--workers <N>` — parallel worker count (default: 4)
- `--profile <path>` — browser profile for auth state (auto-detects `./auth-profile`)
- `--url <url>` — target URL (falls back to `TARGET_URL`)

**Dependency-ordered parallel execution:** When multiple test files are run together, the runner reads the dependency labels from the plan (`depends: TC-N` / `depends: <test-name>`). Test files are then executed in dependency-ordered **waves**: files with no dependencies run first (in parallel), and each subsequent wave starts only after the tests it depends on have finished. Files within the same wave still run in parallel. Autorun enables this automatically for multi-file runs.

Test results saved to `./artifacts/results/run-<timestamp>/`.

### `ui`

Run the interactive Playwright UI test runner against the container display. Launches headed Chromium on the Xvfb display and serves the Playwright UI panel, so you can watch and debug tests in a browser.

```bash
# Open the UI panel (defaults to generated tests in ./artifacts/tests)
pw-cli-agent ui

# Open a specific test file/directory
pw-cli-agent ui --execute ./artifacts/tests/test-0.spec.ts
```

**Options:**
- `--execute <file>` — specific test file/directory to open (default: generated tests)
- `--url <url>` — target URL (falls back to `TARGET_URL`)
- `--profile <path>` — browser profile for auth state (auto-detects `./auth-profile`)
- `--ui-host <host>` — host to serve the UI panel on (default: `0.0.0.0`)
- `--ui-port <port>` — port to serve the UI panel on (default: `8123`; `0` = any free port)

Access the panel from your host browser at `http://localhost:8123`; the headed browser is viewable via noVNC at `http://localhost:6080/vnc.html`.

### `report`

Aggregate artifacts into a summary report. The report opens with a **Contents** index (an overview of all its sections): the plan/heal files under `Test Plans` (each linked to its section anchor, `#<file>`), plus `Generated Tests` and `Exploration Snapshots` when present. The HTML variant renders these as in-page anchor links (`id` attributes on each heading).

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

Run the full testing pipeline in a loop: explore → plan → generate → test → heal → generate → ... Repeats until all tests pass or max iterations reached. Saves state after each step so interrupted runs can be resumed.

```bash
# Full auto loop
pw-cli-agent autorun --url https://example.com

# With requirements
pw-cli-agent autorun --url https://example.com --prompt "Test the login flow"

# Limit iterations
pw-cli-agent autorun --url https://example.com --max-iterations 5

# Record a one-time codegen flow before planning (element-ref annotated, feeds the AI generator)
pw-cli-agent autorun --url https://example.com --codegen

# Reuse an existing codegen/exploration script as reference material
pw-cli-agent autorun --url https://example.com --codegen ./artifacts/tests/codegen-abc123.spec.ts

# Generate tests in batches of 5 test cases per opencode call
pw-cli-agent autorun --url https://example.com --batch-size 5

# Resume an interrupted run
pw-cli-agent autorun --resume abc1234
```

**Pipeline loop:**
1. **Explore** — capture accessibility snapshot (once). The explore feeds the per-site **Website Profile** and **Site Map** (see below), which the planner later uses as structured route + selector context
2. **Codegen** *(optional, with `--codegen`)* — either record a one-time flow in the browser (viewable via noVNC `http://localhost:6080/vnc.html`; the script is saved to `./artifacts/tests/`, annotated with `[eN]` element refs) or pass an existing codegen/exploration file (`--codegen <file>`) to use it as reference material. Recorded/selected scripts are auto-inlined whenever tests are generated
3. **Plan** — generate test plan from snapshot via opencode. The planner receives the current site map (routes + elements with best-effort CSS selectors/state) plus any codegen reference script as extra context. The explore-plan mini-loop (see [`plan`](#plan)) re-explores pages the planner annotates — including interactive **expanded re-exploration** for droplist/reveal-hidden components (e.g. "List additional actions", "Advanced Options" tabs) — before tests are generated
4. **Generate** — extract test code blocks from plan (falls back to opencode generation, which includes any codegen scripts as reference)
5. **Test** — execute tests via Playwright (dependent tests run after their dependencies)
6. **Heal** — re-explore failures, generate a corrected healing plan (passing tests preserved)
7. **Generate** — the healing plan feeds directly back into test generation (no fresh re-plan, so previously-passing tests are not regenerated and stay green)

The loop repeats steps 4–7 until all tests pass or max iterations reached.

**Options:**
- `--url <url>` — target URL (falls back to `TARGET_URL`)
- `--headed` — show browser window
- `--prompt <text>` — natural language requirements
- `--prompt-file <file>` — markdown file containing requirements
- `--max-iterations <N>` — maximum loop iterations (default: retries + 1)
- `--resume <runId>` — resume a previous interrupted run
- `--profile <path>` — browser profile for auth state (auto-detects `./auth-profile`)
- `--codegen [file]` — record a one-time codegen flow before planning, or pass an existing codegen/exploration file (e.g. `--codegen ./artifacts/tests/codegen-abc123.spec.ts`) to use as reference material instead
- `--batch-size <N>` — test cases generated per opencode call during the generate step (default `5`; `1` = single request). See [generate](#generate) for details.

State saved to `./artifacts/results/autorun-<runId>/state.json`.

Exit code: `0` if all tests pass, `1` if any fail after all iterations.

### `heal`

Re-explore failing pages and generate a corrected test plan. Reads the latest test results, identifies failures, and detects **element-not-found errors** to trigger targeted re-exploration of the affected pages. Used standalone or as part of the autorun loop.

**Preserves passing tests:** The healer receives the original plan alongside the failure details and fresh snapshots. Test cases that passed are preserved **verbatim** — the healing plan contains every test case (passing and fixed), and only failing tests are corrected. Within autorun, the healed plan is used directly for the next generation step (no re-plan), so previously-passing tests are not regenerated and remain green.

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
4. **Heal** — send fresh snapshots + failure details + the original plan to opencode; generate a corrected healing plan that fixes only the failing tests and preserves the passing ones

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

### `clean`

Remove scratch/temp files and prune old run artifacts so the working tree stays tidy.

```bash
# Safe default: remove scratch/temp files only (scratch-*.mjs, scratch-*.txt,
# stray PNGs, duplicate guided-session notes — newest kept)
pw-cli-agent clean

# Preview what would be removed without deleting anything
pw-cli-agent clean --dry-run

# Also prune old autorun-* and run-* result dirs (keeps the newest few)
pw-cli-agent clean --autorun --runs

# Full wipe of artifacts/ (recreates the standard subdirs afterwards)
pw-cli-agent clean --all
```

**Options:**
- `--dry-run` — preview what would be removed without deleting anything
- `--autorun` — prune old `autorun-*` result dirs, keeping the newest (default: 3)
- `--runs` — prune old `run-*` result dirs, keeping the newest (default: 5)
- `--keep-autorun <N>` — autorun dirs to keep when pruning (default: 3)
- `--keep-runs <N>` — run dirs to keep when pruning (default: 5)
- `--all` — wipe the entire `artifacts/` directory (explore, plans, tests, reports, results, website-profiles, registry, profiles) and recreate the standard subdirs

Pruning is opt-in; a bare `pw-cli-agent clean` only touches scratch/temp files. The opencode `/clean` slash command wraps this CLI, and the `clean` npm script runs `node dist/index.js clean`.

## Commands Summary

| Command | Description | Key Options |
|---------|-------------|-------------|
| `check` | Verify environment and connectivity | `--url`, `--screenshot`, `--profile` |
| `login` | Log in via Drush ULI, save browser profile | `--url`, `--user`, `--uli`, `--drush-cmd`, `--profile` |
| `import-session` | Reuse a host-browser login: import exported cookies or capture via noVNC | `--cookies`, `--capture`, `--url`, `--profile` |
| `explore` | Open browser, navigate, capture snapshot (registers in explore registry + per-site profile) | `--url`, `--depth`, `--screenshot`, `--headed`, `--expanded`, `--guide`, `--repl`, `--profile` |
| `profile` | Inspect per-site profiles: element trees, registry queries, refs, pages, site map | `tree <url>`, `query <q> [url]`, `ref <eN> [url]`, `pages [url]`, `ls`, `map [url]` |
| `plan` | Generate test plan from snapshot via opencode (queries/explores registry; runs an explore-plan mini-loop with interactive expanded re-exploration for droplist-hidden components) | `--url`, `--snapshot`, `--prompt`, `--prompt-file`, `--model`, `--search`, `--explore`, `--reference` |
| `generate` | Generate test files from plans (extract / opencode / interactive codegen with `[eN]` ref annotation; batched generation) | `--plan`, `--extract`, `--codegen`, `--url`, `--profile`, `--reference`, `--batch-size` |
| `test` | Execute Playwright test files | `--execute`, `--headed`, `--retries`, `--workers`, `--profile` |
| `ui` | Run the interactive Playwright UI test runner (headed, panel served on `8123`) | `--execute`, `--url`, `--profile`, `--ui-host`, `--ui-port` |
| `report` | Aggregate artifacts into summary report | `--format`, `--output` |
| `skill` | Generate opencode skill files | `--output-dir`, `--agents` |
| `autorun` | Loop: explore → [codegen] → plan → generate → test → heal → generate (dependency-ordered parallel tests; planner uses site map + codegen reference) | `--url`, `--headed`, `--prompt`, `--max-iterations`, `--resume`, `--profile`, `--codegen [file]`, `--batch-size` |
| `heal` | Re-explore failures (element-not-found aware), generate corrected plan (preserves passing tests) | `--url`, `--model`, `--headed`, `--profile` |
| `repl` | Start interactive REPL session | — |
| `clean` | Remove scratch/temp files, prune old autorun/run result dirs | `--dry-run`, `--autorun`, `--runs`, `--keep-autorun`, `--keep-runs`, `--all` |

## Screenshots

All generated tests automatically capture full-page screenshots on both pass and fail via a `test.afterEach` hook. Screenshots are saved to:

```
test-results/<test-dir>/screenshots/<test_name>_pass.png
test-results/<test-dir>/screenshots/<test_name>_fail.png
```

Screenshots are saved to `artifacts/results/run-<timestamp>/screenshots/` (flat directory). The hook is injected into:
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

Every `explore` command registers its snapshot in `artifacts/explore-registry.json` with structured metadata: URL, title, element count, link count, heading names, and a structured element list. The `plan` command uses this registry to:

- **Reuse cached snapshots** — avoids re-exploring the same page
- **Search records** — `plan --search "login"` finds snapshots containing "login" in URLs, titles, headings, or elements
- **Auto-explore unvisited pages** — `plan --explore` finds internal links not yet in the registry and explores the top 3
- **Build multi-page context** — combines element maps from multiple pages for richer AI prompts

**Deduplication:** registering a snapshot replaces older records for the same URL + title, keeping at most 3 most-recent records per URL. The full parsed element list lives in a **sidecar file** (`artifacts/explore/meta/<snapshot>.json`) so the registry stays compact; entries keep a capped inline preview for lightweight search/display.

```
artifacts/explore-registry.json
├── url: http://example.com/
├── title: Home Page
├── elementCount: 142
├── linkCount: 28
├── headingCount: ["Welcome", "Products", "Contact"]
├── elementsFile: "explore/meta/explore-....json"
└── elements: [                          # inline preview (first 30)
    ├── { idx: "e5", role: "link", text: "Login", path: "/login",
    │      pw_get: "getByRole('link', { name: 'Login' })" }
    └── ...
  ]
```

Structured element fields: `idx` (`[eN]` accessibility ref — informational only, never used as a selector), `role` (ARIA role), `text` (accessible name), `path` (target URL for links/navigation), `pw_get` (best-effort Playwright locator — may need `.nth()`/selector disambiguation on the live page), plus `selector`, `value`, `required`, `disabled`, `level` when resolvable. Existing registries can be re-parsed and compacted with the internal `reparseRegistry()` helper.

## Website Profiles

Beyond the flat registry, every `explore` / `guide` snapshot also updates a **structured per-site profile** — one compact directory per origin at `artifacts/website-profiles/<host>/` (e.g. `mtpc_test/`). The profile is stored in a **two-tier layout** so tooling can read a single route's data without loading the whole site:

| File | Content |
|------|---------|
| `site_index.json` | **Route index** (~KBs): base URL, `updatedAt`, and one entry per route with path, title, URL, element/link counts and a `spec` file reference |
| `specs/<route>-<hash>.json` | **Per-route spec**: flat functional element list (interactive roles + semantic containers) with CSS selector, hierarchy path, ref links and DOM state |

### Functional filtering

Only roles that matter for automation are indexed: interactive widgets (`button`, `link`, `textbox`, `checkbox`, `radio`, `combobox`, `tab`, `switch`, `menuitem`) plus semantic containers (`form`, `dialog`, `main`, `navigation`). Structural noise — `generic`, `group`, `paragraph`, `section`, `heading` (unless a visual assertion needs it), `presentation`, `text`, lists/tables — is dropped. Hierarchy links (`childRefs` / `ancestorRefs` / `path`) are rewritten to the retained nodes, so the tree stays intact while the payload shrinks ~70%.

### Compact serialization

Spec files are written as compact JSON with redundant data pruned: empty values (`value`, `description`, `placeholder`), `disabled: false`, empty ref lists, and duplicate text are omitted. Ref arrays are **collapsed dynamically** — omitted when empty, a plain string when holding one ref, an array only when needed. The original `mtpc_test` profile went from ~17 MB across three redundant files to **~0.9 MB** of two-tier specs.

In memory the profile is hydrated back into per-page element trees (with `[eN]` refs + hierarchy paths), a flat registry, and a `refIndex` for fast lookups — so the `profile` commands below behave exactly as before.

### Profile commands

```bash
pw-cli-agent profile ls                                  # list all site profiles
pw-cli-agent profile tree <url>                          # hierarchical element tree for a page
pw-cli-agent profile tree <url> --include-text           # include text nodes in the tree
pw-cli-agent profile query "Add Standard Page"           # registry search (name/role/ref/text)
pw-cli-agent profile query "Page Title" <url>            # restrict search to one page
pw-cli-agent profile ref e42                             # show pages + paths where ref e42 appears
pw-cli-agent profile ref e162 <url>                      # narrow a ref to one page
pw-cli-agent profile pages <url>                         # list pages in a site profile
pw-cli-agent profile map <url>                           # (re)build site_index.json + specs/
```

`[eN]` refs are per-snapshot, so `profile ref` reports every page the ref appears on; pass a URL to disambiguate. The `guide` REPL uses the profile to disambiguate `click` targets when the live snapshot has multiple matches.

## Site Map

The overall site map **is** the per-site two-tier profile: `artifacts/website-profiles/<host>/site_index.json` lists every route (path, title, URL, element/link counts, spec file ref), and each route's functional elements live in `specs/<route>-<hash>.json`. `profile map <url>` rebuilds both from the existing profile at any time.

Each spec element carries its `[eN]` ref, ARIA role, accessible name, hierarchy path (e.g. `main > form > textbox`), a best-effort CSS selector (e.g. `input#edit-title-0-value`), and DOM state (`required`, `min`/`max`, `placeholder`, `disabled`) when present:

```json
{
  "site": "mtpc_test",
  "host": "mtpc_test",
  "map_version": 2,
  "routes": [
    {
      "path": "/node/add/custom_page",
      "title": "Create Standard Page",
      "url": "http://mtpc_test/node/add/custom_page",
      "elementCount": 58,
      "linkCount": 40,
      "spec": "specs/node_add_custom_page-9a4c1f.json"
    }
  ]
}
```

Specs preserve the snapshot hierarchy (non-semantic wrappers are flattened away), so landmarks nest their interactive children the same way the page does — but at a fraction of the size.

### Querying the site map

`scripts/query-site-map.mjs` queries the new `site_index.json` (loading specs on demand) and still reads legacy single-file maps:

```bash
node scripts/query-site-map.mjs artifacts/website-profiles/mtpc_test/site_index.json "Page Title"
node scripts/query-site-map.mjs artifacts/website-profiles/mtpc_test/site_index.json textbox --json   # machine-readable
node scripts/query-site-map.mjs artifacts/website-profiles/mtpc_test/site_index.json --list            # list routes
node scripts/query-site-map.mjs artifacts/website-profiles/mtpc_test/site_index.json --route /node/add/custom_page
```

## Site Profile

A living document at `artifacts/site-profile.md` that accumulates knowledge about the website across all explore runs. Regenerated after each `explore` command and after guided sessions.

The profile contains:

| Section | Content |
|---------|---------|
| **Overview** | Base URL, pages explored, total elements/links, first/last explored timestamps |
| **Discovered Pages** | Table of all explored URLs with titles, element counts, link counts |
| **Navigation** | All discovered navigation links with URLs |
| **Forms** | Pages with input fields — lists each input's name and type |
| **Interactive Elements** | Buttons and actions found across the site |
| **Content Headings** | All headings discovered across pages (site map) |
| **Page Details** | Per-page breakdown with headings and metadata |
| **Website Profiles** | Links to per-site structured profiles (site map, route details) with command examples |

The profile is useful for:
- Understanding site structure before planning tests
- Providing context to the AI planner (included automatically when the registry has multiple entries)
- Reviewing what the tool knows about the site
- Identifying untested areas

## User References

Provide user-authored test procedures and screenshots as reference material for the AI planner and generator. This is useful when you have:
- Manual test scripts that need to be automated
- Screenshots showing expected behavior
- Step-by-step procedures from QA teams

### Usage

```bash
# Single reference file
pw-cli-agent plan --url http://example.com --reference ./my-test-procedure.md

# Directory of references
pw-cli-agent plan --url http://example.com --reference ./test-procedures/

# With generate command
pw-cli-agent generate --plan plan-123.md --reference ./test-procedures/
```

### Reference Format

References can be markdown files with step-by-step instructions:

```markdown
# Login Test Procedure

## Steps

1. Navigate to the login page
2. Enter username in the "Username" field
3. Enter password in the "Password" field
4. Click the "Login" button
5. Verify the dashboard loads

## Expected Results

- User should see "Welcome, admin!" message
- Navigation menu should be visible
```

Screenshots (PNG, JPG) in the same directory are automatically associated with the reference files.

### How It Works

1. The `--reference` flag loads markdown files and screenshots from the specified path
2. Steps are extracted from headings (`##`, `###`) and numbered lists (`1.`, `2.`)
3. The content is injected into the AI prompts as user-provided test procedures
4. The AI uses these as the primary source for test steps and expected behavior

### Reference Directory Structure

```
test-procedures/
├── login-test.md          # Test procedure with steps
├── checkout-flow.md       # Another test procedure
├── login-screenshot.png   # Screenshot referenced by login-test.md
└── expected-results.md    # Expected behavior documentation
```

The agent will load all `.md` files and associate any images in the same directory.

## Locator Rules

The AI planner and generator receive the raw accessibility snapshot from Playwright. The snapshot uses Playwright's accessibility tree roles which map **directly** to `getByRole()` — but the AI often misinterprets them. The prompts include explicit rules to prevent common failures:

| Snapshot Role | Correct Locator | Common Mistake |
|---------------|----------------|----------------|
| `navigation "Tabs"` | `getByRole('navigation', { name: 'Tabs' })` | `getByRole('tablist')` |
| `navigation "Toolbar items"` | `getByRole('navigation', { name: 'Toolbar items' })` | `getByRole('toolbar')` |
| `columnheader` with `link "Updated Sort ascending"` | `getByRole('columnheader', { name: /Updated/ })` | `exact: true` with just `"Updated"` |
| `option` inside `combobox` | `expect(select).toHaveValue(...)` | `expect(option).toBeVisible()` — options are never visible |
| `link "X"` where `link "Edit X"` exists | `getByRole('link', { name: 'X', exact: true })` | `getByRole('link', { name: 'X' })` — strict mode violation |

The element summary in generated plans includes Playwright locator hints (e.g. `[e5] "Login" → /login (getByRole('link', { name: 'Login' }))`).

## Accessibility Tree Limitations (CDP)

Starting with Playwright v1.61.0, `page.accessibility.snapshot()` returns `undefined`. The tool uses Chrome DevTools Protocol (`Accessibility.getFullAXTree`) as a replacement via `page.context().newCDPSession(page)`. This approach has known limitations:

| Limitation | Description | Impact |
|------------|-------------|--------|
| **Flat node list** | CDP returns a flat array of nodes; parent-child relationships are encoded via `parentId`/`childIds` (strings), but `RootWebArea` may not be the first node. Negative `childId` values (e.g. `-1000000002`) are internal inline-text markers and must be filtered. | YAML tree reconstruction is heuristic — isolated nodes or subtrees may be placed at the wrong depth. |
| **CKEditor / WYSIWYG iframes** | Rich text editors render inside `<iframe>` elements. `getFullAXTree` does not cross iframe boundaries, so the editor toolbar and editable area appear as an opaque `application` role with generic text. | The text area block's body content and toolbar buttons are not accessible as structured elements. Clicking "Bold" or "Italic" in the CKEditor toolbar requires DOM-based fallback locators. |
| **Collapsed/conditional fields** | Fields hidden by JS (e.g. animation sub-options shown only after checking "Animation") do not appear in the CDP tree. | The planner cannot see hidden fields — test generation for conditional form sections is unreliable without prior interaction (clicking the toggles). |
| **Nested paragraphs (Drupal)** | Sections and blocks are rendered as `<table>` rows with concatenated cell text. The tree shows a single `cell` node containing all labels concatenated (e.g. `"1-COLUMN SECTION Collapse Toggle Actions Section Name …"`) instead of structured child elements. | The planner must infer the structure from the concatenated text rather than from role/name pairs. |
| **Dropbutton widget expansion** | Drupal's dropbutton secondary actions (e.g. "Add Text Area Block") are hidden until the toggle is clicked. They are not present in the CDP tree on initial page load. | On `/node/add/*` pages the explore flow auto-expands the paragraph dropbuttons (clicks "Add N-Column Section" first), so secondary actions are captured in the snapshot. Other dropdowns still require manual expansion. |
| **Non-stable nodeId values** | CDP nodeIds are large non-sequential integers (501 digit gaps) that change between page loads. They are internal DOM pointers, not stable identifiers. | Element refs (`[ref=N]`) cannot be persisted across sessions. Playwright `getByRole()` locators are the only portable cross-session identifiers. |
| **Concatenated label text** | Adjacent `StaticText` nodes (e.g. label + description) are sometimes merged into one or split inconsistently across parent/child. | Element summaries may show truncated or duplicated text for form descriptions. |

### Mitigations and Workarounds

| Problem | Workaround |
|---------|------------|
| CKEditor content capture | Before snapshotting, use `page.evaluate()` to read the CKEditor instance content via `CKEDITOR.instances[instanceName].getData()` or the native `innerHTML` of the editor's editable iframe body. |
| Hidden / lazy fields | Include pre-interaction steps in the test plan: "click the Animation checkbox first, then snapshot" or use `locator.click({ force: true })` on hidden fields. |
| Nested paragraph structure | Parse the concatenated cell text and split on known label keywords ("Section Name:", "Full Width:", etc.). Use `page.getByLabel()` as a fallback for fields within paragraphs. |
| Dropbutton / secondary actions | The explore flow auto-expands paragraph dropbuttons on `/node/add/*` pages (clicks "Add N-Column Section") before snapshotting, so "Add Text Area Block" etc. appear. For other dropdowns, expand manually: `page.locator('.dropbutton-toggle button').click()`. |
| Non-stable nodeIds | Always use `getByRole()` locators with the accessible name for cross-session portability. The `[ref=N]` notation is valid only within a single session/snapshot. |
| Missing text content | For static text inside `cell` or `StaticText` nodes that appear truncated, use `page.locator('selector').textContent()` as a fallback. |

## Architecture

```
pw-cli-agent
├── CLI Layer (Commander.js subcommands)
│   ├── check    — verify environment + target site
│   ├── login    — Playwright API: launchPersistentContext → ULI → storageState JSON
│   ├── import-session — reuse host-browser login (cookie import / noVNC capture) → storageState JSON
│   ├── explore  — PlaywrightSession: navigate, accessibility snapshot → registry + site profile
│   ├── guide    — PlaywrightSession: interactive codegen (default) or REPL session
│   ├── profile  — per-site element trees, registry queries, refs, pages, site map
│   ├── plan     — generate test plan from snapshots (queries registry, can trigger explore)
│   ├── generate — create .spec.ts files from plans (extract / opencode / codegen with [eN] refs)
│   ├── test     — execute playwright tests (loads storageState JSON for auth)
│   ├── report   — aggregate results into markdown/HTML
│   ├── skill    — generate opencode SKILL.md files
│   ├── autorun  — loop: explore → plan → generate → test → heal → generate
│   ├── heal     — detect element-not-found errors, re-explore, generate corrected plan (preserves passing tests)
│   ├── repl     — interactive session (tab completion, state tracking)
│   └── clean    — remove scratch/temp files, prune old autorun/run result dirs
├── Playwright Session (in-process, no subprocess)
│   └── lib/playwright-session.ts — chromium.launch() / launchPersistentContext()
│       ├── goto, click, fill, screenshot, accessibility snapshot
│       ├── page.pause() for Playwright Inspector (codegen mode)
│       ├── YAML accessibility serialization with [ref=eN] format
│       ├── DOM enrichment (best-effort CSS selectors, required/min/max/placeholder state)
│       └── navigation tracking (visitedPages)
├── OpenCode Integration (child_process.spawn)
│   └── opencodeRun(prompt, opts) — runs `opencode run --format json`
├── Explore Registry
│   └── explore-registry.json — searchable index of snapshots with element metadata
├── Snapshot Parser
│   └── parseSnapshotElements(yaml) — extract refs, roles, names, links, headings, buttons
├── Website Profiles
│   ├── lib/element-tree.ts — snapshot YAML → hierarchical element tree + functional TreeRecords (selectors, state)
│   ├── lib/website-profile.ts — per-origin two-tier profile (site_index + specs; pages, registry, refIndex)
│   └── lib/site-map.ts — site map: route index + per-route functional element specs (selector/state schema)
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
    │   ├── import-session.ts         # Reuse host-browser login: cookie import / noVNC capture
    │   ├── explore.ts                # Browser exploration via in-process PlaywrightSession + snapshots + registry
    │   ├── guide.ts                  # Interactive guided browsing session (headed, records observations)
    │   ├── profile.ts                # Per-site profiles: element trees, registry queries, refs, site map
    │   ├── plan.ts                   # Test plan generation (registry query, multi-page explore)
    │   ├── generate.ts               # Test file creation (extract / opencode / codegen + ref annotation)
    │   ├── test.ts                   # Test execution + self-heal retries (loads storageState)
    │   ├── ui.ts                     # Interactive Playwright UI test runner (headed, panel server)
    │   ├── report.ts                 # Result aggregation
    │   ├── skill.ts                  # OpenCode skill file generation
    │   ├── autorun.ts                # Loop: explore → [codegen] → plan → generate → test → heal
    │   ├── heal.ts                   # Element-not-found detection + re-explore + corrected plan
    │   ├── repl.ts                   # Interactive REPL session
    │   └── clean.ts                  # Scratch/temp cleanup + run-artifact pruning
    └── lib/
        ├── pw-cli.ts                 # Playwright CLI wrapper (explore/snapshot commands)
        ├── opencode.ts               # OpenCode subprocess wrapper
        ├── artifacts.ts              # Artifact directory management + code extraction
        ├── snapshot-parser.ts        # YAML snapshot → structured elements (refs, roles, links)
        ├── codegen-annotator.ts      # Post-processes codegen scripts with [eN] snapshot refs
        ├── reference-loader.ts       # Loads user test procedures/screenshots into AI prompts
        ├── explore-registry.ts       # Searchable index of explore snapshots + metadata
        ├── element-tree.ts           # Snapshot YAML → hierarchical element tree + TreeRecords
        ├── website-profile.ts        # Per-site profile: two-tier write (site_index + specs) + hydration
        ├── site-map.ts               # Site map: route index + per-route functional element specs
        ├── site-profile.ts           # Living site profile (accumulated knowledge from all explores)
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
  "maxRetries": 3,
  "basicAuthUser": "helper",
  "basicAuthPass": "secret"
}
```

Priority: CLI flags > env vars > config file > defaults.

## Environment Variables

| Variable | Description |
|----------|-------------|
| `TARGET_URL` | Default target URL (`.env` sets the site homepage — a safe, non-destructive default for `check`; use `--url` to target a specific page like `/node/add/custom_page/mtpc`) |
| `OPENCODE_MODEL` | Default opencode model |
| `OPENCODE_SERVER_URL` | Remote opencode server endpoint (leave empty for local CLI mode; remote server mode is currently broken in opencode 1.18.x) |
| `PW_CLI_HEADED` | Run browsers headed by default |
| `PW_CLI_OUTPUT_DIR` | Custom artifacts directory |
| `STORAGE_STATE` | Default browser profile path for saved login state |
| `BASIC_AUTH_USER` | HTTP Basic Auth username for sites behind an nginx auth gate |
| `BASIC_AUTH_PASS` | HTTP Basic Auth password for sites behind an nginx auth gate |

## Docker

The tool runs inside a container with `playwright-cli`, `opencode`, and all browser dependencies pre-installed.

### OpenCode Connection

**Mode 1: Local CLI inside the container (default, recommended)**

Leave `OPENCODE_SERVER_URL` empty. The container runs the `opencode` CLI directly (`opencode run --format json`), and API keys are provided by mounting the host's opencode config into the container (see `docker-compose.yml`). Verify the connection with `pw-cli-agent check`.

**Mode 2: Remote server (currently broken — do not use)**

`opencode serve --port 4096` starts a headless server, but opencode 1.18.11 crashes immediately with `Error: Unexpected error` / `ServeError` on startup, so this mode is not usable. On Windows the `opencode` command may also resolve to the OpenCode **desktop app** (`OpenCode.exe`), which is not a CLI and ignores `serve` arguments. If a working server becomes available, set `OPENCODE_SERVER_URL=http://host.docker.internal:4096`.

### Usage

The container exposes these ports:
- `6080` — noVNC web client (`http://localhost:6080/vnc.html`)
- `5900` — VNC (native VNC client)
- `8123` — Playwright UI panel (`ui` command; configurable via `--ui-port`)

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

## Contribution Rules

- **After every code update, update `README.md`** (and any other affected docs) to reflect the change — new commands, options, behavior, output files, and layout. Documentation edits land in the same change as the code they describe.
- The full rule set (including the `agent/` build/verify workflow) lives in `AGENTS.md` at the repo root and applies to all agent changes.

## Dependencies

| Package | Purpose |
|---------|---------|
| `commander` | CLI subcommand parsing |
| `chalk` | Terminal output styling |
| `@playwright/test` | Playwright test runner |
| `playwright` | Browser API (launch, launchPersistentContext, accessibility snapshots) |

Node built-ins: `node:readline` (REPL), `node:child_process`, `node:fs`, `node:path`.

External tools (installed in container):
- `opencode` — AI agent backend

Internal modules:
- `playwright-session.ts` — in-process Playwright wrapper (goto, click, fill, screenshot, accessibility YAML, DOM enrichment)
- `snapshot-parser.ts` — parses Playwright YAML snapshots into structured element data (refs, roles, links, headings, buttons)
- `explore-registry.ts` — searchable index of explore snapshots with element metadata
- `element-tree.ts` — hierarchical element tree from snapshot YAML (paths, CSS selectors, DOM state)
- `website-profile.ts` — per-origin structured profile (two-tier: route index + functional per-route specs; pages, registry, ref index in memory)
- `site-map.ts` — site map: `site_index.json` route index + `specs/<route>.json` functional element lists (shared schema)
- `site-profile.ts` — living site profile regenerated from the explore registry after each run

## References

- [playwright-cli](https://playwright.dev/agent-cli/) — Playwright CLI for coding agents
- [opencode](https://opencode.ai) — AI coding agent for the terminal
- [auto_playwright](https://github.com/ohanedan/playwright-testgen) — Original explore/plan/test/report workflow inspiration
- [commander.js](https://github.com/tj/commander.js) — CLI framework
