---
description: Clean up generated artifacts and scratch files (run pw-cli-agent clean in the container).
agent: build
---

Run the artifact cleanup inside the `playwright_cli` container, passing through whatever the user typed after `/clean`:

```
docker exec playwright_cli bash -lc "cd /workspace/agent && node dist/index.js clean $ARGUMENTS"
```

Behavior:
- Default (no args): safe cleanup of scratch/temp files only — `scratch-*.mjs`/`scratch-*.txt` at the agent root, stray PNGs, and duplicate `guided-session-*.md` notes (newest kept).
- `--dry-run` — preview what would be removed without deleting anything. Use this first unless the user asked to actually clean.
- `--autorun` — prune old `autorun-*` result dirs, keeping the newest (default 3; `--keep-autorun <N>`).
- `--runs` — prune old `run-*` result dirs, keeping the newest (default 5; `--keep-runs <N>`).
- `--all` — wipe `artifacts/` entirely and recreate the standard subdirs. Only run this if the user explicitly asked for a full wipe.

If files were actually deleted (not `--dry-run`), briefly summarize what was removed and how much space was freed.
