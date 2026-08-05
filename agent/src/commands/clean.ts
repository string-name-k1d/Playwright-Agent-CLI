import chalk from 'chalk';
import { existsSync, readdirSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { ensureArtifactsDir } from '../lib/artifacts.js';

export interface CleanOptions {
  dryRun?: boolean;
  autorun?: boolean;
  runs?: boolean;
  all?: boolean;
  keepAutorun?: number;
  keepRuns?: number;
}

interface Removal {
  path: string;
  type: 'file' | 'dir';
  size: number;
  reason: string;
}

function humanSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function dirSize(dir: string): number {
  let total = 0;
  try {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        total += dirSize(full);
      } else if (entry.isFile()) {
        try {
          total += statSync(full).size;
        } catch {
          // ignore individual stat failures
        }
      }
    }
  } catch {
    // directory may have been removed mid-scan
  }
  return total;
}

function collectScratch(root: string): Removal[] {
  const removals: Removal[] = [];
  if (!existsSync(root)) return removals;

  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (!entry.isFile()) continue;
    const full = join(root, entry.name);
    try {
      const size = statSync(full).size;
      if (/^scratch-.*\.(mjs|js|ts|txt|json|tmp|md)$/.test(entry.name)) {
        removals.push({ path: full, type: 'file', size, reason: 'scratch file' });
      } else if (entry.name.endsWith('.png')) {
        removals.push({ path: full, type: 'file', size, reason: 'stray screenshot' });
      }
    } catch {
      // ignore unreadable files
    }
  }
  return removals;
}

function collectArtifactsScratch(artifactsDir: string): Removal[] {
  const removals: Removal[] = [];
  if (!existsSync(artifactsDir)) return removals;

  const sessions = readdirSync(artifactsDir, { withFileTypes: true })
    .filter((e) => e.isFile() && /^guided-session-.*\.md$/.test(e.name))
    .map((e) => {
      const full = join(artifactsDir, e.name);
      return { full, size: statSync(full).size, time: statSync(full).mtimeMs };
    })
    .sort((a, b) => b.time - a.time);

  for (const s of sessions.slice(1)) {
    removals.push({ path: s.full, type: 'file', size: s.size, reason: 'duplicate guided-session note (keeping newest)' });
  }

  for (const entry of readdirSync(artifactsDir, { withFileTypes: true })) {
    if (!entry.isFile()) continue;
    const full = join(artifactsDir, entry.name);
    try {
      const size = statSync(full).size;
      if (entry.name.endsWith('.png')) {
        removals.push({ path: full, type: 'file', size, reason: 'stray screenshot in artifacts/' });
      } else if (/^prompts-.*\.md$/.test(entry.name)) {
        removals.push({ path: full, type: 'file', size, reason: 'stray prompt scratch file' });
      }
    } catch {
      // ignore unreadable files
    }
  }
  return removals;
}

function collectPruned(resultsDir: string, prefix: string, keep: number): Removal[] {
  const removals: Removal[] = [];
  if (!existsSync(resultsDir)) return removals;

  const dirs = readdirSync(resultsDir, { withFileTypes: true })
    .filter((e) => e.isDirectory() && e.name.startsWith(prefix))
    .map((e) => {
      const full = join(resultsDir, e.name);
      return { full, time: statSync(full).mtimeMs };
    })
    .sort((a, b) => b.time - a.time);

  for (const d of dirs.slice(keep)) {
    removals.push({ path: d.full, type: 'dir', size: dirSize(d.full), reason: `old ${prefix}* run dir (keeping ${keep} newest)` });
  }
  return removals;
}

function collectAll(artifactsDir: string): Removal[] {
  const removals: Removal[] = [];
  if (!existsSync(artifactsDir)) return removals;

  for (const entry of readdirSync(artifactsDir, { withFileTypes: true })) {
    const full = join(artifactsDir, entry.name);
    const isDir = entry.isDirectory();
    removals.push({
      path: full,
      type: isDir ? 'dir' : 'file',
      size: isDir ? dirSize(full) : statSync(full).size,
      reason: 'full artifact wipe (--all)',
    });
  }
  return removals;
}

function dedupe(removals: Removal[]): Removal[] {
  const seen = new Set<string>();
  const out: Removal[] = [];
  for (const r of removals) {
    if (seen.has(r.path)) continue;
    seen.add(r.path);
    out.push(r);
  }
  return out;
}

function execute(removals: Removal[], dryRun: boolean): number {
  let freed = 0;
  const ordered = [
    ...removals.filter((r) => r.type === 'file'),
    ...removals.filter((r) => r.type === 'dir').sort((a, b) => b.path.length - a.path.length),
  ];

  for (const r of ordered) {
    if (dryRun) {
      console.log(chalk.yellow(`  [dry-run] would remove ${r.path} (${humanSize(r.size)}) — ${r.reason}`));
      continue;
    }
    try {
      rmSync(r.path, { recursive: true, force: true });
      freed += r.size;
      console.log(chalk.red(`  removed ${r.path} (${humanSize(r.size)}) — ${r.reason}`));
    } catch (err) {
      console.log(chalk.red(`  failed to remove ${r.path}: ${(err as Error).message}`));
    }
  }
  return freed;
}

export async function cleanCommand(opts: CleanOptions): Promise<void> {
  const root = process.cwd();
  const artifactsDir = join(root, 'artifacts');
  const resultsDir = join(artifactsDir, 'results');

  console.log(chalk.bold('\nArtifact Cleanup\n'));

  if (!existsSync(artifactsDir)) {
    console.log(chalk.gray('  No artifacts directory found — nothing to clean.'));
    return;
  }

  const removals: Removal[] = [];

  if (opts.all) {
    removals.push(...collectAll(artifactsDir));
  } else {
    removals.push(...collectScratch(root));
    removals.push(...collectArtifactsScratch(artifactsDir));
    if (opts.autorun) removals.push(...collectPruned(resultsDir, 'autorun-', opts.keepAutorun ?? 3));
    if (opts.runs) removals.push(...collectPruned(resultsDir, 'run-', opts.keepRuns ?? 5));
  }

  const unique = dedupe(removals);

  if (unique.length === 0) {
    console.log(chalk.green('  Nothing to clean.'));
    console.log(chalk.gray('  Hint: --autorun prunes old autorun-* runs, --runs prunes old run-* runs, --all wipes artifacts/ entirely.'));
    return;
  }

  const total = unique.reduce((sum, r) => sum + r.size, 0);
  console.log(chalk.cyan(`  ${opts.dryRun ? 'Would remove' : 'Removing'} ${unique.length} item(s) (${humanSize(total)}):\n`));

  const freed = execute(unique, !!opts.dryRun);

  if (!opts.dryRun) {
    console.log(chalk.green(`\n  Freed ${humanSize(freed)}.`));
    if (opts.all) {
      ensureArtifactsDir(artifactsDir);
      console.log(chalk.gray('  Recreated standard artifact subdirectories (explore, plans, tests, reports, results).'));
    }
  }
}
