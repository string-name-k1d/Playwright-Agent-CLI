# Commands

Reference for every `pwcli` subcommand. For setup, workflows, and site-knowledge
concepts, see [README.md](README.md).

> **Invocation:** `pwcli` and `pw-cli` are shell aliases (defined in
> `.bash_aliases`, interactive shells) for `node dist/index.js` inside the
> `playwright_cli` container. Use `node dist/index.js <command>` directly in
> scripts or non-interactive shells.

## Content overview

- [Commands](#commands)
  - [Commands Summary](#commands-summary)
  - [Notes on arguments](#notes-on-arguments)
  - [`check`](#check)
  - [`login`](#login)
  - [`import-session`](#import-session)
  - [HTTP Basic Auth](#http-basic-auth)
  - [`explore`](#explore)
  - [Guided Browsing Session](#guided-browsing-session)
    - [Default: Codegen Mode (Playwright Inspector)](#default-codegen-mode-playwright-inspector)
    - [Alternative: REPL Mode (`--repl`)](#alternative-repl-mode---repl)
  - [`profile`](#profile)
  - [`plan`](#plan)
    - [Plan Format](#plan-format)
  - [`generate`](#generate)
  - [`test`](#test)
  - [`ui`](#ui)
  - [`report`](#report)
  - [`heal`](#heal)
  - [`autorun`](#autorun)
  - [`repl`](#repl)
  - [`skill`](#skill)
  - [`clean`](#clean)

## Commands Summary

The pipeline is **explore → plan → generate → test → heal** (`autorun` chains it
in a loop). Setup commands (`check`, `login`, `import-session`) come first.

| Command | Description | Key Options |
|---------|-------------|-------------|
| `check` | Verify environment and connectivity | `--url`, `--screenshot`, `--profile` |
| `login` | Log in via Drush ULI, save browser profile | `--url`, `--user`, `--uli`, `--drush-cmd` (required with `--user`), `--profile` |
| `import-session` | Reuse a host-browser login: import exported cookies or capture via noVNC | `--cookies`, `--capture`, `--url`, `--profile` |
| `explore` | Open browser, navigate, capture snapshot (registers in explore registry + per-site profile) | `--url`, `--depth`, `--screenshot`, `--headed`, `--expanded`, `--guide`, `--repl`, `--profile` |
| `profile` | Inspect per-site profiles: element trees, registry queries, refs, pages, site map | `tree <url>`, `query <q> [url]`, `ref <eN> [url]`, `pages [url]`, `ls`, `map [url]` |
| `plan` | Generate test plan from snapshot via the AI agent (queries/explores registry; runs an explore-plan mini-loop with interactive expanded re-exploration for droplist-hidden components) | `--url`, `--snapshot`, `--prompt`, `--prompt-file`, `--model`, `--search`, `--explore`, `--reference`, `--output` |
| `generate` | Generate test files from plans (extract / AI generation / interactive codegen with `[eN]` ref annotation; batched generation) | `--plan`, `--extract`, `--codegen`, `--url`, `--headed`, `--profile`, `--reference`, `--batch-size` |
| `test` | Execute Playwright test files | `--execute`, `--url`, `--headed`, `--retries`, `--workers`, `--profile` |
| `ui` | Run the interactive Playwright UI test runner (headed, panel served on `8123`) | `--execute`, `--url`, `--profile`, `--ui-host`, `--ui-port` |
| `report` | Aggregate artifacts into summary report (`md`, `html`, `json`) | `--format`, `--output` |
| `heal` | Re-explore failures (element-not-found aware), generate corrected plan (preserves passing tests) | `--url`, `--model`, `--headed`, `--profile` |
| `autorun` | Loop: explore → [codegen] → plan → generate → test → heal → generate (dependency-ordered parallel tests; planner uses site map + codegen reference) | `--url`, `--headed`, `--prompt`, `--prompt-file`, `--max-iterations`, `--resume`, `--profile`, `--codegen [file]`, `--batch-size` |
| `repl` | Start interactive REPL session | — |
| `skill` | Generate opencode skill files | `--output-dir`, `--agents` |
| `clean` | Remove scratch/temp files, prune old autorun/run result dirs | `--dry-run`, `--autorun`, `--runs`, `--keep-autorun`, `--keep-runs`, `--all` |

### Notes on arguments

- `url`: All commands fall back to `TARGET_URL` from `.env` when `--url` is not passed.
- `profile`: All browser commands (`check`, `explore`, `autorun`, `heal`) auto-detect the `./auth-profile` directory created by `login` — no need to pass `--profile` explicitly if you used the default path.

**Argument validation:** every command validates its arguments immediately on startup, before doing any work:
- File/directory arguments (`--cookies`, `--snapshot`, `--prompt-file`, `--plan`, `--reference`, `--execute`, `--codegen <file>`, ...) must exist — otherwise the command fails fast with `Error: <flag> not found: <path>`.
- `--url`/`--uli` must be valid `http(s)` URLs.
- Numeric options (`--depth`, `--retries`, `--workers`, `--max-iterations`, `--keep-autorun`, `--keep-runs`, `--ui-port`) must be non-negative integers.
- `--resume <runId>` must point to an existing `artifacts/results/autorun-<runId>` directory.
- The global `--config <path>` must point to an existing file.
- The global `--site-adapter <generic|drupal>` selects generic vs Drupal-specific browsing behavior.
- Glob patterns (e.g. `tests/*.spec.ts`) are accepted for `--execute` without an existence check.

**Prompt budgets (env):**
- `PW_CLI_PLAN_MAX_PROMPT_CHARS` (default `180000`)
- `PW_CLI_PLAN_MAX_REFERENCE_CHARS` (default `40000`)
- `PW_CLI_PLAN_MAX_SNAPSHOTS` (default `3`)
- `PW_CLI_GENERATE_MAX_PROMPT_CHARS` (default `180000`)
- `PW_CLI_GENERATE_MAX_REFERENCE_CHARS` (default `50000`)
- `PW_CLI_CODEGEN_REFERENCE_MAX_FILES` (default `3`)

---

### `check`

Verify environment and connectivity.

```bash
pwcli check
pwcli check --url https://example.com
```

Checks:
- `playwright-cli --version` is available
- The configured agent backend is available (`opencode --version` for the
  default backend, or the API key/model config for `AGENT_PROVIDER=api`)
- Target site loads and responds to snapshot

> **Agent backends:** prompts are sent to the backend selected by
> `AGENT_PROVIDER` (default `opencode`) — see *AI Agent Backends* in the
> [README](README.md#ai-agent-backends). With the default `opencode` backend,
> `check` verifies the `opencode` CLI; with `AGENT_PROVIDER=api` it verifies
> `AGENT_API_KEY` / `AGENT_API_MODEL` are configured (no `opencode` binary
> needed).

The site check uses the same in-process Chromium session as the other browser commands, so HTTP Basic Auth (`BASIC_AUTH_USER` / `BASIC_AUTH_PASS` from `.env`) and the saved `./auth-profile` session are honored automatically. The default target is the site homepage (safe, non-destructive) — pass `--url` to check a specific page.

If `./auth-profile` exists (created by `login` or `import-session`), it is automatically used for authenticated pages. When the loaded page turns out to be a login/SSO page (e.g. `login.microsoftonline.com`, `shib.ust.hk`), `check` prints a warning that the profile is not authenticated for the site.

**Options:**
- `--url <url>` — also verify site connectivity (falls back to `TARGET_URL`; default is the site homepage)
- `--screenshot` — capture a screenshot of the reached site
- `--profile <path>` — explicit browser profile path (overrides auto-detection)

### `login`

Log in via Drush one-time login link (ULI) and save browser session for reuse. Runs `drush uli` to generate a one-time login URL, opens a browser with the Playwright API directly, authenticates, and saves both a Chromium profile directory (for `explore`) and a `storageState` JSON file (for tests).

```bash
# Login as admin via Drush (explicit drush command required with --user)
pwcli login --url https://example.com --user admin --drush-cmd "docker exec my_drupal drush"

# Login as specific user
pwcli login --url https://example.com --user admin --drush-cmd "drush"

# Use a direct one-time login URL (skip drush generation)
pwcli login --url https://example.com --uli "https://example.com/user/reset/1/12345678/login"

# Custom drush command (e.g., local drush or different container)
pwcli login --url https://example.com --user admin --drush-cmd "docker exec my_drupal drush"

# Save to custom profile path
pwcli login --url https://example.com --profile ./my-session

# Headed mode (see the browser)
pwcli login --url https://example.com --headed
```

**Options:**
- `--url <url>` — target URL (falls back to `TARGET_URL`)
- `--user <user>` — Drupal username (default: `admin`)
- `--uli <url>` — direct one-time login URL (skips drush generation)
- `--drush-cmd <cmd>` — drush command prefix (**required when using `--user`**)
- `--headed` — show browser window
- `--profile <path>` — browser profile directory to save (default: `./auth-profile`)

**How it works:**
1. Generates ULI via `drush uli admin --uri=<target-url> --no-browser`
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
pwcli import-session --cookies ./shared/callitso-cookies.json

# Alternative: headed interactive capture — log in via noVNC (http://localhost:6080/vnc.html),
# the session is saved once an authenticated page is detected
pwcli import-session --capture --url https://callitso.docker-uat01.ust.hk

# Verify the imported session
pwcli check --url https://callitso.docker-uat01.ust.hk
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
pwcli explore --url https://example.com
pwcli explore --url https://example.com --screenshot --depth 4 --headed

# Expanded exploration: open droplists/reveals/tabs to capture hidden components
pwcli explore --url https://example.com --expanded

# Interactive guided browsing session (codegen mode by default)
pwcli explore --guide --url https://example.com

# Or use REPL mode (manual text commands)
pwcli explore --guide --url https://example.com --repl
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
docker exec playwright_cli bash -ic 'cd /workspace/agent && node dist/index.js explore --guide --url https://example.com'
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
docker exec playwright_cli bash -ic 'cd /workspace/agent && node dist/index.js explore --guide --url https://example.com --repl'
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

### `profile`

Inspect the per-site knowledge the tool builds while exploring. Reads the two-tier
per-site profile (`artifacts/website-profiles/<host>/`).

```bash
pwcli profile ls                                  # list all site profiles
pwcli profile tree https://example.com            # hierarchical element tree for a page
pwcli profile tree https://example.com --include-text
pwcli profile query "Add Standard Page"           # registry search (name/role/ref/text)
pwcli profile query "Page Title" <url>            # restrict search to one page
pwcli profile ref e42                             # show pages + paths where ref e42 appears
pwcli profile ref e162 <url>                      # narrow a ref to one page
pwcli profile pages <url>                         # list pages in a site profile
pwcli profile map <url>                           # (re)build site_index.json + specs/
```

**Subcommands:**
- `ls` — list all website profiles
- `tree [url] [--include-text]` — show the hierarchical element tree for a page
- `query <q> [url]` — look up elements in the registry (by name, role, ref, or free text)
- `ref <eN> [url]` — show the hierarchy path + locator for an `[eN]` ref
- `pages [url]` — list pages in a site profile
- `map [url]` — build the site map JSON + per-route detail files for a site

`[eN]` refs are per-snapshot, so `profile ref` reports every page the ref appears on; pass a URL to disambiguate. The `guide` REPL uses the profile to disambiguate `click` targets when the live snapshot has multiple matches.

### `plan`

Send a snapshot to the AI agent and generate a structured test plan. Queries the **explore registry** for cached snapshots and can auto-explore unvisited pages. Optionally provide natural language requirements to guide what should be tested.

The plan runs an **explore-plan mini-loop**: after each plan is generated, it opens any pages the planner annotated, appends their snapshots to the context, and re-plans — up to `MAX_EXPLORE_DEPTH` iterations — until the planner requests no further pages.

**Expanded re-exploration:** if a plan requests `[explore-expanded: URL]` (or otherwise mentions components hidden behind droplists/reveals/tabs — "List additional actions", "Toggle Actions", "Advanced Options", dropbutton actions), the loop re-explores **exactly that page** interactively with `--expanded` so the hidden components enter the snapshot context and the generated tests can target them. Plain `[explore: URL]` requests stay non-interactive, and expanded requests for a page are only honored once (cached snapshots are never reused for an expanded re-run, since they predate the interaction).

```bash
# Auto-explore and plan
pwcli plan --url https://example.com

# Plan from existing snapshot
pwcli plan --snapshot ./artifacts/explore/page.yaml

# Focus on specific requirements
pwcli plan --url https://example.com --prompt "Test the login flow and form validation"

# Requirements from a markdown file
pwcli plan --url https://example.com --prompt-file ./requirements.md

# UAT: recorded test cases for the "Add Custom Page (MTPC)" form
pwcli plan --prompt-file ./prompts/prompts-uat-add-custom-mtpc-page.md \
  --url https://callitso.docker-uat01.ust.hk/node/add/custom_page/mtpc

# Search explore registry for matching records
pwcli plan --search "login"

# Auto-explore unvisited pages found in links
pwcli plan --url https://example.com --explore
```

**Options:**
- `--snapshot <file>` — specific snapshot file to analyze
- `--url <url>` — if no snapshot, run explore first (falls back to `TARGET_URL`)
- `--model <model>` — agent model override (active backend only)
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
- The test runner reads these dependency labels to schedule execution: when running tests in parallel, dependent tests are executed in waves **after** the tests they depend on (see [`test`](#test)).
- During planning, if the AI needs a page that hasn't been explored, it appends a `## Pages to Explore` section with `[explore: /path]` annotations. The system explores those URLs and re-invokes the planner with the expanded context.
- The planner also receives the **site map** from the per-site profile (routes + elements with best-effort CSS selectors/state) and, when passed, an existing codegen/exploration script (`--codegen <file>`), giving it structured context for reliable locators.

Healing plans use the same standardized format.

### `generate`

Generate Playwright test files from plans. Three modes: extract code blocks from plan markdown, generate via the AI agent, or launch interactive codegen.

```bash
# Extract test code blocks directly from plan (fast, no AI)
pwcli generate --plan plan-xxx.md --extract

# Generate full test file via the AI agent from plan
pwcli generate --plan plan-xxx.md

# Launch interactive playwright codegen
pwcli generate --codegen --url https://example.com
```

**Options:**
- `--plan <file>` — plan file to generate tests from
- `--extract` — extract code blocks directly (skip AI generation)
- `--codegen` — launch interactive `playwright codegen` (always headed; codegen does not accept `--headed`)
- `--url <url>` — target URL (for AI context)
- `--headed` — show browser window (non-codegen modes)
- `--profile <path>` — browser profile for auth state (auto-detects `./auth-profile`); codegen loads it via `--load-storage`
- `--reference <path>` — user test procedures/screenshots directory or file
- `--batch-size <N>` — test cases generated per agent call (default `5`; `1` = single request for the whole plan)

**Batched generation:** Plans with many test cases (e.g. 50 `TC-*` cases) are split into batches of `--batch-size` test cases, and each batch is generated in its own agent request. Each request stays small and focused, which cuts token usage per call, keeps responses fast, and avoids the model drifting agentic on an oversized prompt. Batches are written to separate files (`generated-<ts>-batch-<N>.spec.ts`) under `./artifacts/tests/`; a batch that fails to produce code is skipped and reported, and the remaining batches are still saved. When `--batch-size 1` is given the whole plan is sent as one request (legacy behavior). Each batch runs with a 10-minute timeout and is attempted up to 3 times (retries inject a "skip deliberation, output code only" nudge). Note that reasoning models (e.g. the `big-pickle` default) count internal reasoning against their output-token budget and occasionally emit no code at all — retries recover from that, but keep batches small (`5` or fewer) when the plan test cases are detailed, and prefer prompting from the plan alone over inlining large codegen-reference scripts that the model has to reconcile.

**Output validation:** each batch's generated code is syntax-checked (TypeScript parse) before it is saved. Truncated or malformed output (e.g. a trailing lone `await`, or imports emitted after the `test()` body — common when a reasoning model hits its output-token limit mid-response) is treated as a failed batch and retried with the "skip deliberation" nudge instead of being written to disk, where it would crash the whole Playwright run with a load-time `SyntaxError` that the healer cannot parse.

**Generation agent (opencode backend only):** with the default `opencode` backend, generation runs in `--format json` mode against the project's non-agentic `codegen` agent (`.opencode/agent/codegen.md`), which is told to answer directly with only the requested code and never to use tools — this prevents the default `build` agent from going agentic (running Grep/read tools, asking clarifying questions) and timing out. Override with `OPENCODE_AGENT=<name>` (e.g. `OPENCODE_AGENT=build`). The `api` backend has no agent concept — prompts are sent as a plain user message (optionally with a system preamble).

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

**Codegen scripts feed the AI generator:** Any `codegen-*.spec.ts` files under `./artifacts/tests/` are automatically inlined as reference material whenever tests are generated via the AI agent (`generate --plan`, and autorun's generation steps). The generator treats the recorded actions as the authoritative source for locators and interaction order, and uses the `[eN]` annotations to disambiguate repeating elements — the refs are informational only and are translated into `getByRole()`/`getByText()` locators (never emitted as DOM selectors).

Tests saved to `./artifacts/tests/`.

### `test`

Execute Playwright test files. Auth state is automatically loaded from `./auth-profile/state.json` if the profile exists.

```bash
# Execute a test file
pwcli test --execute ./artifacts/tests/test-0.spec.ts

# Execute with visible browser
pwcli test --execute ./tests/login.spec.ts --headed

# Explicit profile for auth
pwcli test --execute ./tests/test.spec.ts --profile ./my-session
```

**Options:**
- `--execute <file>` — test file to execute
- `--url <url>` — target URL (falls back to `TARGET_URL`)
- `--headed` — visible browser
- `--retries <N>` — retry count (default: 3)
- `--workers <N>` — parallel worker count (default: 4)
- `--profile <path>` — browser profile for auth state (auto-detects `./auth-profile`)

**Dependency-ordered parallel execution:** When multiple test files are run together, the runner reads the dependency labels from the plan (`depends: TC-N` / `depends: <test-name>`). Test files are then executed in dependency-ordered **waves**: files with no dependencies run first (in parallel), and each subsequent wave starts only after the tests it depends on have finished. Files within the same wave still run in parallel. Autorun enables this automatically for multi-file runs.

Test results saved to `./artifacts/results/run-<timestamp>/`.

### `ui`

Run the interactive Playwright UI test runner against the container display. Launches headed Chromium on the Xvfb display and serves the Playwright UI panel, so you can watch and debug tests in a browser.

```bash
# Open the UI panel (defaults to generated tests in ./artifacts/tests)
pwcli ui

# Open a specific test file/directory
pwcli ui --execute ./artifacts/tests/test-0.spec.ts
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
pwcli report
pwcli report --format html --output ./report.html
pwcli report --format json --output ./report.json
```

**Options:**
- `--format <md|html|json>` — output format (default: md). `json` uses schema version `report-v1`
- `--output <file>` — custom output path

### `heal`

Re-explore failing pages and generate a corrected test plan. Reads the latest test results, identifies failures, and detects **element-not-found errors** to trigger targeted re-exploration of the affected pages. Used standalone or as part of the autorun loop.

**Preserves passing tests:** The healer receives the original plan alongside the failure details and fresh snapshots. Test cases that passed are preserved **verbatim** — the healing plan contains every test case (passing and fixed), and only failing tests are corrected. Within autorun, the healed plan is used directly for the next generation step (no re-plan), so previously-passing tests are not regenerated and remain green.

```bash
# Heal the latest failures
pwcli heal

# Specify URL and model
pwcli heal --url https://example.com --model anthropic/claude-sonnet-4-6
```

**Pipeline steps:**
1. **Analyze** — parse latest `artifacts/results/` for failing tests and their error context
2. **Detect** — identify element-not-found errors (locator not found, timeout exceeded, etc.)
3. **Re-explore** — open affected pages and capture fresh accessibility snapshots
4. **Heal** — send fresh snapshots + failure details + the original plan to the AI agent; generate a corrected healing plan that fixes only the failing tests and preserves the passing ones

**Element-not-found detection:** When tests fail due to missing locators, the heal command extracts the page URL from the error context and re-explores that specific page. This ensures the healing plan uses accurate, up-to-date element refs.

**Options:**
- `--url <url>` — target URL (falls back to `TARGET_URL`)
- `--model <model>` — agent model override (active backend only)
- `--headed` — show browser window
- `--profile <path>` — browser profile for auth state (auto-detects `./auth-profile`)

Saved to `./artifacts/plans/heal-<timestamp>.md`.

### `autorun`

Run the full testing pipeline in a loop: explore → plan → generate → test → heal → generate → ... Repeats until all tests pass or max iterations reached. Saves state after each step so interrupted runs can be resumed.

```bash
# Full auto loop
pwcli autorun --url https://example.com

# With requirements
pwcli autorun --url https://example.com --prompt "Test the login flow"

# Limit iterations
pwcli autorun --url https://example.com --max-iterations 5

# Record a one-time codegen flow before planning (element-ref annotated, feeds the AI generator)
pwcli autorun --url https://example.com --codegen

# Reuse an existing codegen/exploration script as reference material
pwcli autorun --url https://example.com --codegen ./artifacts/tests/codegen-abc123.spec.ts

# Generate tests in batches of 5 test cases per agent call
pwcli autorun --url https://example.com --batch-size 5

# Resume an interrupted run
pwcli autorun --resume abc1234
```

**Pipeline loop:**
1. **Explore** — capture accessibility snapshot (once). The explore feeds the per-site **Website Profile** and **Site Map** (see below), which the planner later uses as structured route + selector context
2. **Codegen** *(optional, with `--codegen`)* — either record a one-time flow in the browser (viewable via noVNC `http://localhost:6080/vnc.html`; the script is saved to `./artifacts/tests/`, annotated with `[eN]` element refs) or pass an existing codegen/exploration file (`--codegen <file>`) to use it as reference material. Recorded/selected scripts are auto-inlined whenever tests are generated
3. **Plan** — generate test plan from snapshot via the AI agent. The planner receives the current site map (routes + elements with best-effort CSS selectors/state) plus any codegen reference script as extra context. The explore-plan mini-loop (see [`plan`](#plan)) re-explores pages the planner annotates — including interactive **expanded re-exploration** for droplist/reveal-hidden components (e.g. "List additional actions", "Advanced Options" tabs) — before tests are generated
4. **Generate** — extract test code blocks from plan (falls back to AI generation, which includes any codegen scripts as reference)
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
- `--batch-size <N>` — test cases generated per agent call during the generate step (default `5`; `1` = single request). See [generate](#generate) for details.

State saved to `./artifacts/results/autorun-<runId>/state.json`.

Exit code: `0` if all tests pass, `1` if any fail after all iterations.

### `repl`

Start an interactive REPL session. Commands run without re-entering `pwcli`. Session state (URL, last snapshot, last plan) persists across commands.

```bash
pwcli repl
```

**REPL commands:**
- `check`, `login`, `explore`, `plan`, `generate`, `test`, `report`, `skill`, `autorun`, `heal` — all standard subcommands
- `set url <url>` — set target URL for the session
- `set model <model>` — set the AI agent model
- `show` — display current session state
- `help` — show available commands
- `exit` — quit

Session initializes from `.env` (`TARGET_URL`, `OPENCODE_MODEL`). Use `↑`/`↓` for history, `Tab` for completion.

### `skill`

Generate opencode skill files so agents can discover the workflow natively.

```bash
pwcli skill
pwcli skill --output-dir .opencode/skills --agents
```

**Options:**
- `--output-dir <dir>` — skill output directory (default: `.opencode/skills`)
- `--agents` — also generate agent definition files

### `clean`

Remove scratch/temp files and prune old run artifacts so the working tree stays tidy.

```bash
# Safe default: remove scratch/temp files only (scratch-*.mjs, scratch-*.txt,
# stray PNGs, duplicate guided-session notes — newest kept)
pwcli clean

# Preview what would be removed without deleting anything
pwcli clean --dry-run

# Also prune old autorun-* and run-* result dirs (keeps the newest few)
pwcli clean --autorun --runs

# Full wipe of artifacts/ (recreates the standard subdirs afterwards)
pwcli clean --all
```

**Options:**
- `--dry-run` — preview what would be removed without deleting anything
- `--autorun` — prune old `autorun-*` result dirs, keeping the newest (default: 3)
- `--runs` — prune old `run-*` result dirs, keeping the newest (default: 5)
- `--keep-autorun <N>` — autorun dirs to keep when pruning (default: 3)
- `--keep-runs <N>` — run dirs to keep when pruning (default: 5)
- `--all` — wipe the entire `artifacts/` directory (explore, plans, tests, reports, results, website-profiles, registry, profiles) and recreate the standard subdirs

Pruning is opt-in; a bare `pwcli clean` only touches scratch/temp files. The opencode `/clean` slash command wraps this CLI, and the `clean` npm script runs `node dist/index.js clean`.
