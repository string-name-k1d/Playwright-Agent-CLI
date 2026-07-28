# TODO — pw-cli-agent

## Completed

- [x] Config module with env vars, JSON file, CLI flags
- [x] Playwright CLI wrapper (`pwExec`, `pwOpen`, `pwSnapshot`, etc.)
- [x] OpenCode wrapper (CLI + HTTP server modes)
- [x] Artifact manager (explore, plans, tests, reports)
- [x] All 6 commands: check, explore, plan, test, report, skill
- [x] REPL with tab completion and session state
- [x] Docker setup (playwright-cli + opencode + chromium)
- [x] Fixed: stdin piping for large prompts (27KB+ hangs with CLI args)
- [x] Fixed: JSON stream extraction from `--format json` output
- [x] Fixed: explore copies actual YAML snapshot from `.playwright-cli/`
- [x] Code block extraction from plan markdown (`--extract` flag)

## Remaining

- [x] Self-healing loop: test failure → opencode diagnosis → fix → retry
- [ ] HTTP server mode: opencode serve integration testing
- [x] Plan-to-test: auto-extract code blocks when plan contains executable tests
- [ ] Config validation: helpful errors for missing/invalid settings
- [x] Generated prompts markdown for Add Standard Page form (50 prompts)
