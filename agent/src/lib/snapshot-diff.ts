/**
 * Snapshot diffing for the healer. Accessibility snapshots reassign
 * `[ref=eN]` tokens on every capture, so identical elements look different
 * across snapshots. Diffs are computed on ref-normalized lines; changed
 * regions are reported from the FRESH snapshot (with fresh refs) plus
 * ancestor context lines so the tree structure stays readable.
 */

export interface SnapshotDiff {
  /** Fraction of normalized lines shared between both snapshots (0..1). */
  similarity: number;
  /** Normalized lines present only in the fresh snapshot. */
  addedLines: number;
  /** Normalized lines present only in the baseline snapshot. */
  removedLines: number;
  totalLines: number;
}

/** Strips [ref=eN] tokens and collapses whitespace so identical elements compare equal across captures. */
export function normalizeSnapshotLine(line: string): string {
  return line.replace(/\[ref=e\d+\]/g, '').replace(/\s+/g, ' ').trim();
}

function normalizedLineSet(snapshot: string): Set<string> {
  const set = new Set<string>();
  for (const line of snapshot.split('\n')) {
    const n = normalizeSnapshotLine(line);
    if (n) set.add(n);
  }
  return set;
}

export function diffSnapshots(baseline: string, fresh: string): SnapshotDiff {
  const oldSet = normalizedLineSet(baseline);
  const newSet = normalizedLineSet(fresh);
  let shared = 0;
  for (const line of newSet) {
    if (oldSet.has(line)) shared++;
  }
  const total = Math.max(oldSet.size, newSet.size) || 1;
  return {
    similarity: shared / total,
    addedLines: newSet.size - shared,
    removedLines: oldSet.size - shared,
    totalLines: newSet.size,
  };
}

function indentOf(line: string): number {
  return line.length - line.trimStart().length;
}

/**
 * Builds a compact diff context for a healer prompt: a summary of what
 * changed plus the changed regions of the FRESH snapshot (fresh refs
 * included), each with its ancestor lines for tree structure. Output is
 * capped at `maxChars`; when the diff would exceed it, the full fresh
 * snapshot is the safer fallback (caller decides via `shouldDiff`).
 */
export function buildDiffContext(baseline: string, fresh: string, maxChars = 12000): string {
  const oldSet = normalizedLineSet(baseline);
  const lines = fresh.split('\n');
  const changed = new Set<number>();
  lines.forEach((line, i) => {
    const n = normalizeSnapshotLine(line);
    if (n && !oldSet.has(n)) changed.add(i);
  });

  // Expand each changed line with its ancestor chain (lines with smaller
  // indent above it) so the YAML-like tree remains parseable in context.
  const include = new Set<number>(changed);
  for (const i of changed) {
    const indent = indentOf(lines[i]);
    for (let j = i - 1; j >= 0; j--) {
      if (!lines[j].trim()) continue;
      if (indentOf(lines[j]) < indent) {
        include.add(j);
        indentOf(lines[j]);
        break;
      }
    }
  }

  const ordered = [...include].sort((a, b) => a - b);
  const header =
    `SNAPSHOT DIFF (baseline vs fresh): ${changed.size} changed line(s), ` +
    `showing changed regions with ancestor context — refs are FRESH:\n`;
  const body = ordered.map((i) => lines[i]).join('\n');

  if (header.length + body.length <= maxChars) {
    return header + body;
  }

  // Keep as many leading changed regions as fit.
  const kept: number[] = [];
  let budget = maxChars - header.length;
  for (const i of ordered) {
    if (lines[i].length + 1 > budget) break;
    kept.push(i);
    budget -= lines[i].length + 1;
  }
  return (
    header +
    kept.map((i) => lines[i]).join('\n') +
    `\n[diff truncated to ${maxChars} chars — ${ordered.length - kept.length} context line(s) omitted]`
  );
}

/**
 * Decides whether to send the healer a compact diff instead of full
 * snapshots. Diff mode kicks in when the combined snapshot payload is large
 * (token cost) or when healing has already failed before (repeated heal
 * attempts) — thresholds are env-overridable.
 */
export function shouldUseDiff(
  totalSnapshotChars: number,
  healAttempt: number,
  opts?: { charThreshold?: number; attemptThreshold?: number }
): boolean {
  const charThreshold = opts?.charThreshold ?? intFromEnv('PW_CLI_HEAL_DIFF_CHARS', 60_000);
  const attemptThreshold = opts?.attemptThreshold ?? intFromEnv('PW_CLI_HEAL_DIFF_ATTEMPT', 2);
  return totalSnapshotChars > charThreshold || healAttempt >= attemptThreshold;
}

function intFromEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = parseInt(raw, 10);
  return Number.isInteger(n) && n > 0 ? n : fallback;
}
