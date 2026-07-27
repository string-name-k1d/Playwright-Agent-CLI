import { readFileSync, writeFileSync, existsSync, readdirSync, statSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { parseSnapshotElements, getElementSummary, type SnapshotElements, type ElementInfo } from './snapshot-parser.js';

export interface ExploreEntry {
  url: string;
  title: string;
  timestamp: string;
  snapshotPath: string;
  snapshotFileName: string;
  elementCount: number;
  linkCount: number;
  headingCount: string[];
  summary?: string;
}

const REGISTRY_FILE = 'explore-registry.json';

function registryPath(baseDir: string): string {
  return join(baseDir, REGISTRY_FILE);
}

function loadRegistry(baseDir: string): ExploreEntry[] {
  const path = registryPath(baseDir);
  if (!existsSync(path)) return [];
  try {
    return JSON.parse(readFileSync(path, 'utf-8'));
  } catch {
    return [];
  }
}

function saveRegistry(entries: ExploreEntry[], baseDir: string): void {
  const path = registryPath(baseDir);
  writeFileSync(path, JSON.stringify(entries, null, 2), 'utf-8');
}

export function registerExploreEntry(
  url: string,
  title: string,
  snapshotPath: string,
  snapshotFileName: string,
  baseDir: string
): ExploreEntry {
  const entries = loadRegistry(baseDir);

  const content = readFileSync(snapshotPath, 'utf-8');
  const parsed = parseSnapshotElements(content);

  const entry: ExploreEntry = {
    url,
    title,
    timestamp: new Date().toISOString(),
    snapshotPath,
    snapshotFileName,
    elementCount: parsed.elements.length,
    linkCount: parsed.links.length,
    headingCount: parsed.headings.map(h => h.name),
    summary: getElementSummary(parsed),
  };

  entries.push(entry);
  saveRegistry(entries, baseDir);
  return entry;
}

export function getExploreEntries(baseDir: string): ExploreEntry[] {
  return loadRegistry(baseDir);
}

export function getLatestEntryForUrl(url: string, baseDir: string): ExploreEntry | null {
  const entries = loadRegistry(baseDir);
  const matches = entries
    .filter(e => normalizeUrl(e.url) === normalizeUrl(url))
    .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
  return matches[0] ?? null;
}

export function searchExploreEntries(query: string, baseDir: string): ExploreEntry[] {
  const entries = loadRegistry(baseDir);
  const q = query.toLowerCase();
  return entries.filter(e =>
    e.url.toLowerCase().includes(q) ||
    e.title.toLowerCase().includes(q) ||
    (e.summary && e.summary.toLowerCase().includes(q)) ||
    e.headingCount.some(h => h.toLowerCase().includes(q))
  );
}

export function getSnapshotContent(entry: ExploreEntry): string {
  return readFileSync(entry.snapshotPath, 'utf-8');
}

export function getSnapshotElements(entry: ExploreEntry): SnapshotElements {
  const content = getSnapshotContent(entry);
  return parseSnapshotElements(content);
}

export function findElementInEntry(entry: ExploreEntry, query: string): ElementInfo[] {
  const elements = getSnapshotElements(entry);
  const q = query.toLowerCase();
  return elements.elements.filter(el =>
    el.name.toLowerCase().includes(q) ||
    el.ref.toLowerCase().includes(q) ||
    (el.text && el.text.toLowerCase().includes(q))
  );
}

export function buildRegistrySummary(baseDir: string): string {
  const entries = loadRegistry(baseDir);
  if (entries.length === 0) return 'No explore records found.';

  const lines: string[] = [`Explore Registry (${entries.length} records):`, ''];

  const byUrl = new Map<string, ExploreEntry[]>();
  for (const e of entries) {
    const key = normalizeUrl(e.url);
    const list = byUrl.get(key) ?? [];
    list.push(e);
    byUrl.set(key, list);
  }

  for (const [url, urlEntries] of byUrl) {
    const latest = urlEntries.sort((a, b) =>
      new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
    )[0];
    lines.push(`  ${url}`);
    lines.push(`    Title: ${latest.title}`);
    lines.push(`    Elements: ${latest.elementCount}, Links: ${latest.linkCount}`);
    lines.push(`    Headings: ${latest.headingCount.slice(0, 5).join(', ')}`);
    if (urlEntries.length > 1) {
      lines.push(`    Snapshots: ${urlEntries.length} total`);
    }
    lines.push('');
  }

  return lines.join('\n');
}

export function getUnvisitedLinks(entry: ExploreEntry, baseDir: string): { ref: string; name: string; url: string }[] {
  const elements = getSnapshotElements(entry);
  const registry = loadRegistry(baseDir);
  const visitedUrls = new Set(registry.map(e => normalizeUrl(e.url)));

  return elements.links.filter(l => {
    try {
      const resolved = new URL(l.url, entry.url).href;
      return !visitedUrls.has(normalizeUrl(resolved));
    } catch {
      return false;
    }
  });
}

function normalizeUrl(url: string): string {
  try {
    const u = new URL(url);
    return `${u.origin}${u.pathname}`.replace(/\/+$/, '');
  } catch {
    return url.replace(/\/+$/, '');
  }
}
