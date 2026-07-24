# TODO — pw-cli-agent Implementation

## Phase 1: Foundation

- [x] **Config module** (`src/config.ts`)
  - Define `Config` interface with all settings
  - Load from `pw-cli-agent.config.json` (CWD or `~/.config/pw-cli-agent/`)
  - CLI flags override config values
  - Environment variable fallbacks (`OPENCODE_MODEL`, `TARGET_URL`, etc.)

- [x] **Playwright CLI wrapper** (`src/lib/pw-cli.ts`)
  - `pwExec(command, args, opts)` — runs `playwright-cli <cmd>`, returns stdout/stderr/exitCode
  - Helper functions: `pwOpen`, `pwGoto`, `pwSnapshot`, `pwClick`, `pwFill`, `pwClose`, `pwScreenshot`
  - Parse stdout for page info, snapshot file path, generated code
  - Handle timeouts and errors gracefully

- [x] **OpenCode wrapper** (`src/lib/opencode.ts`)
  - `opencodeRun(prompt, opts)` — spawns `opencode run -f json -q`
  - Parse JSON output for structured results
  - Handle timeouts, missing binary, model errors
  - Support `--model` and `--session` flags

- [x] **Artifact manager** (`src/lib/artifacts.ts`)
  - `ensureArtifactsDir()` — creates `./artifacts/{explore,plans,tests,reports}/`
  - `getLatestSnapshot(dir)` — finds most recent snapshot file
  - `savePlan(content)`, `saveTest(content)` — write with timestamped filenames
  - `listArtifacts(subdir)` — list files in a subdirectory

## Phase 2: Core Commands

- [x] **`check` command** (`src/commands/check.ts`)
  - Verify `playwright-cli --version` runs successfully
  - Verify `opencode --version` or `opencode run --help` runs successfully
  - If `--url`: run `playwright-cli open <url>` + `snapshot` to verify site loads
  - Chalk-colored pass/fail output per check
  - Exit code 0 if all pass, 1 if any fail

- [x] **`explore` command** (`src/commands/explore.ts`)
  - Require `--url` flag
  - Run `playwright-cli open <url>` (with `--headed` if specified)
  - Run `playwright-cli snapshot --filename=explore-<timestamp>.yaml`
  - If `--screenshot`: run `playwright-cli screenshot --filename=explore-<timestamp>.png`
  - If `--depth`: pass `--depth=N` to snapshot
  - Save all artifacts to `./artifacts/explore/`
  - Print snapshot file path and page info to stdout

- [x] **`plan` command** (`src/commands/plan.ts`)
  - Accept `--snapshot <file>` or `--url` (auto-explore if no snapshot)
  - Read snapshot content
  - Build prompt from template in `prompt-templates.ts`
  - Call `opencodeRun(prompt)` with structured output
  - Save result to `./artifacts/plans/plan-<timestamp>.md`
  - Print plan summary to stdout

- [x] **`test` command** (`src/commands/test.ts`)
  - Three modes:
    - `--generate`: launch `playwright codegen --target=playwright-test -o <file> <url>`
    - `--execute <file>`: run `npx playwright test <file>`
    - `--plan <file>`: send plan to opencode for code gen, save as `.spec.ts`, then execute
  - Self-healing loop (up to `--retries` attempts):
    - On failure, send error output to opencode for diagnosis
    - Apply suggested fix, re-run
  - Save test files to `./artifacts/tests/`

- [x] **`report` command** (`src/commands/report.ts`)
  - Scan `./artifacts/` for plans, tests, results
  - Generate markdown summary (test plan, pass/fail, screenshots, failures)
  - Optionally generate simple HTML report
  - `--format md|html`, `--output <file>`

## Phase 3: Skill Generation

- [x] **`skill` command** (`src/commands/skill.ts`)
  - Generate `.opencode/skills/pw-cli-agent/SKILL.md` with:
    - Workflow description (explore > plan > test > report)
    - Available commands and usage
    - When to use this skill
  - If `--agents`: also generate agent definition `.md` files for:
    - `pw-explorer` — reads snapshots, identifies testable flows
    - `pw-planner` — generates structured test plans
    - `pw-generator` — writes Playwright test code
    - `pw-healer` — diagnoses and fixes failing tests

## Phase 4: Prompt Templates

- [x] **Prompt templates** (`src/lib/prompt-templates.ts`)
  - `explorerPrompt(snapshot)` — asks opencode to analyze snapshot for testable flows
  - `plannerPrompt(snapshot, context)` — generates structured test plan
  - `generatorPrompt(plan, context)` — generates `.spec.ts` code from plan
  - `healerPrompt(testCode, error, snapshot)` — diagnoses test failure and suggests fix
  - Each template returns a formatted string ready for `opencodeRun()`

## Phase 5: Wiring & CLI Entry

- [x] **Entry point** (`src/index.ts`)
  - Create Commander program `pw-cli-agent`
  - Register all 6 subcommands with their options
  - Global `--config <path>` flag
  - Call `program.parseAsync(process.argv)`

- [x] **Package.json updates**
  - Add `chalk` dependency
  - Update `bin` field to register `pw-cli-agent` command
  - Ensure `build` and `start` scripts work

## Phase 6: Docker & Integration

- [x] **Dockerfile updates**
  - Change CMD to `["node", "dist/index.js"]`
  - Ensure `playwright-cli` global install + skills install remain
  - Copy `src/` properly for build

- [ ] **docker-compose.yml updates**
  - Verify workspace mount for artifact output
  - Consider adding volume for `./artifacts` persistence

- [x] **test_command.sh updates**
  - Test all 6 commands end-to-end
  - Verify artifact creation

## Phase 7: Polish (remaining)

- [ ] **Error handling refinement**
  - Missing `playwright-cli` binary → clear install instructions
  - Missing `opencode` binary → clear install instructions
  - Network errors → timeout messages with suggestions
  - Invalid config → helpful validation errors

- [ ] **Shared command parser** (`shared/utils/command_parser.ts`)
  - Fix existing bug: line 47 maps `headless` to `options.headed`
  - Keep as reference/legacy, not used by new CLI
