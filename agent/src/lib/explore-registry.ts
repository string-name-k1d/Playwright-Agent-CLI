import { readFileSync, writeFileSync, existsSync, readdirSync, statSync, mkdirSync } from 'node:fs';
import { join, basename } from 'node:path';
import { parseSnapshotElements, getElementSummary, type SnapshotElements, type ElementInfo } from './snapshot-parser.js';
import { locatorFor } from './element-tree.js';

/**
 * A single structured element parsed from an explore snapshot. `[eN]` refs are
 * accessibility-tree refs (informational only, NOT real DOM attributes). The
 * `pw_get` locator is a best-effort Playwright suggestion derived from
 * role + name and may not be fully reliable (repeating elements may need
 * `.nth()` or a CSS selector to disambiguate on the live page).
 */
export interface ExploreElement {
  idx: string;        // [eN] accessibility ref
  role: string;       // ARIA role (link, button, textbox, ...)
  text: string;       // accessible name (or text content)
  path?: string;      // target URL/path (for links/navigation)
  pw_get?: string;    // suggested Playwright locator (best-effort)
  selector?: string;  // best-effort CSS selector (when resolvable)
  value?: string;     // current input value
  required?: boolean; // input required state
  disabled?: boolean; // element disabled state
  level?: number;     // heading level
}

/**
 * Represents a single explore entry in the registry.
 * Stores metadata about a page snapshot including URL, title, element counts, and links.
 * The full parsed element list lives in a sidecar file (`elementsFile`) to keep
 * the registry compact; a capped inline preview is kept on the entry for
 * lightweight search/display.
 */
export interface ExploreEntry {
  url: string;
  title: string;
  timestamp: string;
  snapshotPath: string;
  snapshotFileName: string;
  elementCount: number;
  linkCount: number;
  headingCount: string[];
  elementsFile?: string;
  elements?: ExploreElement[];
  summary?: string; // legacy text summary — no longer written
}

const REGISTRY_FILE = 'explore-registry.json';
/** Maximum records kept per URL (most recent first). */
const MAX_RECORDS_PER_URL = 3;
/** Number of elements inlined on the entry for quick search/display. */
const INLINE_ELEMENTS_LIMIT = 30;

/** Roles worth indexing as structured elements (mirrors the old text summary). */
const INDEXED_ROLES = new Set([
  'link', 'navigation', 'heading', 'button',
  'textbox', 'combobox', 'checkbox', 'radio', 'searchbox',
  'spinbutton', 'slider', 'listbox', 'switch',
  'img', 'image', 'region', 'complementary', 'main', 'banner', 'contentinfo',
  'dialog', 'alert', 'tab', 'menuitem', 'option', 'treeitem',
  'columnheader', 'rowheader', 'cell', 'gridcell',
]);

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

/**
 * Builds the structured element list for a snapshot. Replaces the old free-text
 * `summary` blob: every indexed element becomes a record with its ref, role,
 * name, target path (for links), best-effort locator and any resolvable CSS
 * selector / input state.
 */
export function buildExploreElements(parsed: SnapshotElements): ExploreElement[] {
  const out: ExploreElement[] = [];
  for (const el of parsed.elements) {
    if (!INDEXED_ROLES.has(el.role)) continue;
    const text = el.name || el.text || '';
    const element: ExploreElement = {
      idx: el.ref,
      role: el.role,
      text,
      level: el.level,
      value: el.value,
      required: el.required,
    };
    if (el.disabled) element.disabled = true;
    if (el.url && (el.role === 'link' || el.role === 'navigation')) element.path = el.url;
    if (text) element.pw_get = locatorFor(el.role, text);
    if (el.selector) element.selector = el.selector;
    out.push(element);
  }
  return out;
}

/** Writes the full structured element list to a sidecar file next to the snapshot. */
function writeElementsSidecar(
  url: string,
  title: string,
  elements: ExploreElement[],
  baseDir: string,
  snapshotFileName: string
): string {
  const base = snapshotFileName.replace(/\.yaml$/i, '');
  const metaDir = join(baseDir, 'explore', 'meta');
  mkdirSync(metaDir, { recursive: true });
  const file = join(metaDir, `${base}.json`);
  writeFileSync(file, JSON.stringify({ url, title, elements }, null, 2), 'utf-8');
  return join('explore', 'meta', `${base}.json`);
}

/** Reads the full structured element list for an entry (sidecar first, inline fallback). */
export function getExploreElements(entry: ExploreEntry, baseDir: string): ExploreElement[] {
  if (entry.elementsFile) {
    try {
      const abs = join(baseDir, entry.elementsFile);
      if (existsSync(abs)) {
        const data = JSON.parse(readFileSync(abs, 'utf-8'));
        if (Array.isArray(data.elements)) return data.elements;
      }
    } catch {
      // fall through to inline
    }
  }
  return entry.elements ?? [];
}

/**
 * Replaces old records for the same URL: older entries sharing a (url, title)
 * pair with a newer one are dropped, and at most {@link MAX_RECORDS_PER_URL}
 * most-recent records per URL are kept. Original ordering is preserved.
 */
function dedupeAndCap(entries: ExploreEntry[]): ExploreEntry[] {
  const byUrl = new Map<string, ExploreEntry[]>();
  for (const e of entries) {
    const key = normalizeUrl(e.url);
    const list = byUrl.get(key);
    if (list) list.push(e);
    else byUrl.set(key, [e]);
  }
  const keep = new Set<ExploreEntry>();
  for (const group of byUrl.values()) {
    const sorted = [...group].sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
    const newestByTitle = new Map<string, ExploreEntry>();
    for (const g of sorted) if (!newestByTitle.has(g.title)) newestByTitle.set(g.title, g);
    const selected = [...newestByTitle.values()].slice(0, MAX_RECORDS_PER_URL);
    for (const s of selected) keep.add(s);
  }
  return entries.filter(e => keep.has(e));
}

/**
 * Registers a new explore entry in the registry.
 * Parses the snapshot content to extract element metadata and stores it. The
 * full parsed element list is written to a sidecar file and a capped inline
 * preview is kept on the entry; old records with the same URL/title are
 * replaced (at most 3 records per URL).
 *
 * @param url - The page URL that was explored
 * @param title - The page title from the snapshot
 * @param snapshotPath - Path to the snapshot file
 * @param snapshotFileName - Name of the snapshot file
 * @param baseDir - Base directory for artifacts
 * @returns The created ExploreEntry with parsed metadata
 */
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

  const elements = buildExploreElements(parsed);
  const elementsFile = writeElementsSidecar(url, title, elements, baseDir, snapshotFileName);

  const entry: ExploreEntry = {
    url,
    title,
    timestamp: new Date().toISOString(),
    snapshotPath,
    snapshotFileName,
    elementCount: parsed.elements.length,
    linkCount: parsed.links.length,
    headingCount: parsed.headings.map(h => h.name),
    elementsFile,
    elements: elements.slice(0, INLINE_ELEMENTS_LIMIT),
  };

  entries.push(entry);
  saveRegistry(dedupeAndCap(entries), baseDir);
  return entry;
}

/**
 * Re-parses every existing registry entry: rebuilds the structured element
 * sidecars from the snapshot files, refreshes counts, drops the legacy
 * `summary` blob, and applies the URL/title dedupe + per-URL cap. Useful to
 * migrate registries created before the structured element change.
 * Returns the number of entries after compaction.
 */
export function reparseRegistry(baseDir: string): number {
  const entries = loadRegistry(baseDir);
  const migrated: ExploreEntry[] = [];
  for (const e of entries) {
    try {
      const content = readFileSync(e.snapshotPath, 'utf-8');
      const parsed = parseSnapshotElements(content);
      const elements = buildExploreElements(parsed);
      const elementsFile = writeElementsSidecar(e.url, e.title, elements, baseDir, e.snapshotFileName);
      migrated.push({
        url: e.url,
        title: e.title,
        timestamp: e.timestamp,
        snapshotPath: e.snapshotPath,
        snapshotFileName: e.snapshotFileName,
        elementCount: parsed.elements.length,
        linkCount: parsed.links.length,
        headingCount: parsed.headings.map(h => h.name),
        elementsFile,
        elements: elements.slice(0, INLINE_ELEMENTS_LIMIT),
      });
    } catch {
      migrated.push(e); // keep as-is if its snapshot is missing
    }
  }
  const compacted = dedupeAndCap(migrated);
  saveRegistry(compacted, baseDir);
  return compacted.length;
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
    e.headingCount.some(h => h.toLowerCase().includes(q)) ||
    getExploreElements(e, baseDir).some(el =>
      el.text.toLowerCase().includes(q) ||
      (el.path && el.path.toLowerCase().includes(q))
    )
  );
}

/** Finds structured elements matching a query across an entry's parsed list. */
export function findExploreElements(entry: ExploreEntry, query: string, baseDir: string): ExploreElement[] {
  const q = query.toLowerCase();
  return getExploreElements(entry, baseDir).filter(el =>
    el.text.toLowerCase().includes(q) ||
    (el.path && el.path.toLowerCase().includes(q)) ||
    el.role.toLowerCase().includes(q) ||
    el.idx.toLowerCase().includes(q)
  );
}

/** Renders a structured element as a single-line summary. */
export function formatExploreElement(el: ExploreElement): string {
  const path = el.path ? ` → ${el.path}` : '';
  const sel = el.selector ? ` [${el.selector}]` : '';
  const pw = el.pw_get ? `  pw_get: ${el.pw_get}` : '';
  return `[${el.idx}] ${el.role} "${el.text}"${path}${sel}${pw}`;
}

export function getSnapshotContent(entry: ExploreEntry): string {
  try {
    return readFileSync(entry.snapshotPath, 'utf-8');
  } catch {
    return '';
  }
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
