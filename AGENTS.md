# Project Rules

Rules that apply to every change made in this repository.

## Docs stay current

- **After every code update, update `README.md`** (and any other affected docs in this repo) to reflect the change — new commands, options, behavior, output files, and layout. Never leave a code change undocumented.
- Documentation edits land in the same change as the code they describe, before the work is considered done.
- If a change affects how agents/`opencode` behave (new skills, slash commands, agent files), note that too.

## Build & verify

- The `agent/` TypeScript code must be compiled with `tsc` (`npm run build`). Builds and test runs happen inside the `playwright_cli` Docker container:
  `docker exec playwright_cli bash -lc "cd /workspace/agent && npm run build"`
- After changes, verify with `npm run check` (run via the container).
