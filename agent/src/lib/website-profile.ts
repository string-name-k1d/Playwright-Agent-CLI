import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import type { ExploreEntry } from './explore-registry.js';
import { buildElementTree, toTreeRecords, treeFromRecords, type ElementTree, type TreeRecord } from './element-tree.js';
import { writeSiteMap } from './site-map.js';

/**
 * Per-website structured profile. Each origin gets its own JSON file under
 * `website-profiles/<host>.json` containing a page tree, per-page element
 * trees (with [eN] refs + hierarchy paths), and a flat registry + ref index
 * for fast element lookups.
 */

export interface PageRecord {
  url: string;
  title: string;
  lastVisited: string;
  elementCount: number;
  linkCount: number;
  /** Outbound links → related pages. */
  links: { ref: string; name: string; url: string }[];
  elements: TreeRecord[];
}

export type RegistryEntry = TreeRecord;

export interface WebsiteProfile {
  host: string;
  baseUrl: string;
  updatedAt: string;
  pages: PageRecord[];
  /** Flat element index across all pages. */
  registry: RegistryEntry[];
  /** Quick lookup: ref → page URLs where that ref appears. */
  refIndex: Record<string, string[]>;
}

const PROFILE_DIR = 'website-profiles';

export function websiteProfileDir(baseDir: string): string {
  return join(baseDir, PROFILE_DIR);
}

export function hostFromUrl(url: string): string {
  try {
    const u = new URL(url);
    return u.hostname || u.host || 'site';
  } catch {
    return 'site';
  }
}

function baseFromUrl(url: string): string {
  try {
    const u = new URL(url);
    return `${u.protocol}//${u.host}`;
  } catch {
    return url;
  }
}

export function normalizeUrl(url: string): string {
  try {
    const u = new URL(url);
    return `${u.origin}${u.pathname}`.replace(/\/+$/, '');
  } catch {
    return url.replace(/\/+$/, '');
  }
}

export function profileFileFor(url: string, baseDir: string): string {
  return join(websiteProfileDir(baseDir), `${hostFromUrl(url)}.json`);
}

export function loadWebsiteProfile(url: string, baseDir: string): WebsiteProfile | null {
  const path = profileFileFor(url, baseDir);
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, 'utf-8'));
  } catch {
    return null;
  }
}

export function loadWebsiteProfileForHost(host: string, baseDir: string): WebsiteProfile | null {
  const path = join(websiteProfileDir(baseDir), `${host}.json`);
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, 'utf-8'));
  } catch {
    return null;
  }
}

export function listWebsiteProfiles(baseDir: string): WebsiteProfile[] {
  const dir = websiteProfileDir(baseDir);
  if (!existsSync(dir)) return [];
  let files: string[] = [];
  try {
    files = readdirSafe(dir).filter(f => f.endsWith('.json'));
  } catch {
    return [];
  }
  const profiles: WebsiteProfile[] = [];
  for (const f of files) {
    try {
      const p = JSON.parse(readFileSync(join(dir, f), 'utf-8'));
      if (p && Array.isArray(p.pages) && Array.isArray(p.registry)) profiles.push(p);
    } catch {}
  }
  return profiles;
}

function readdirSafe(dir: string): string[] {
  try {
    return readdirSync(dir);
  } catch {
    return [];
  }
}

function readSnapshot(entry: ExploreEntry): string {
  try {
    return readFileSync(entry.snapshotPath, 'utf-8');
  } catch {
    return '';
  }
}

function saveProfile(profile: WebsiteProfile, baseDir: string): void {
  const dir = websiteProfileDir(baseDir);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const path = profileFileFor(profile.baseUrl || `http://${profile.host}`, baseDir);
  writeFileSync(path, JSON.stringify(profile, null, 2), 'utf-8');
}

/**
 * Updates (or creates) the website profile for the entry's origin from the
 * snapshot's element tree. Merges into the page record for the entry URL and
 * rebuilds the registry + ref index from all pages.
 *
 * @param entry - Explore entry (url, title, snapshotPath)
 * @param baseDir - Artifacts base directory (website-profiles/ lives here)
 * @param snapshotContent - Optional raw snapshot YAML (defaults to reading entry.snapshotPath)
 * @returns The updated WebsiteProfile
 */
export function updateWebsiteProfile(entry: ExploreEntry, baseDir: string, snapshotContent?: string): WebsiteProfile {
  const content = snapshotContent ?? readSnapshot(entry);
  const tree = buildElementTree(content);
  const normUrl = normalizeUrl(entry.url || '');
  const host = hostFromUrl(entry.url || '');
  const baseUrl = baseFromUrl(entry.url || '');
  const now = new Date().toISOString();

  const existing = loadWebsiteProfile(entry.url || '', baseDir);
  const profile: WebsiteProfile = existing ?? {
    host,
    baseUrl,
    updatedAt: now,
    pages: [],
    registry: [],
    refIndex: {},
  };

  const page: PageRecord = {
    url: normUrl,
    title: entry.title,
    lastVisited: now,
    elementCount: tree.nodes.length,
    linkCount: tree.links.length,
    links: tree.links.map(l => ({ ref: l.ref, name: l.name, url: l.url ?? '' })),
    elements: toTreeRecords(tree, normUrl),
  };

  const idx = profile.pages.findIndex(p => p.url === normUrl);
  if (idx >= 0) profile.pages[idx] = page;
  else profile.pages.push(page);
  profile.pages.sort((a, b) => a.url.localeCompare(b.url));

  profile.registry = profile.pages.flatMap(p => p.elements);
  profile.refIndex = {};
  for (const r of profile.registry) {
    const list = profile.refIndex[r.ref] ?? (profile.refIndex[r.ref] = []);
    if (!list.includes(r.pageUrl)) list.push(r.pageUrl);
  }
  profile.updatedAt = now;

  saveProfile(profile, baseDir);
  writeSiteMap(profile, baseDir);
  return profile;
}

export function getPageRecord(profile: WebsiteProfile, url: string): PageRecord | null {
  const norm = normalizeUrl(url);
  return profile.pages.find(p => p.url === norm) ?? null;
}

export function getPageTree(profile: WebsiteProfile, url: string): ElementTree | null {
  const page = getPageRecord(profile, url);
  if (!page) return null;
  return treeFromRecords(page.elements);
}

export interface ElementQuery {
  ref?: string;
  role?: string;
  name?: string;
  text?: string;
  url?: string;
  query?: string;
}

/**
 * Profile-first element lookup across the registry. Free-text `query` matches
 * name, ref, role, text, url and hierarchy path.
 */
export function resolveElement(profile: WebsiteProfile, q: ElementQuery): RegistryEntry[] {
  let results: RegistryEntry[] = profile.registry;

  if (q.url) {
    const norm = normalizeUrl(q.url);
    results = results.filter(r => r.pageUrl === norm);
  }
  if (q.ref) results = results.filter(r => r.ref === q.ref);
  if (q.role) results = results.filter(r => r.role === q.role);
  if (q.name) results = results.filter(r => r.name === q.name);
  if (q.text) results = results.filter(r => r.text === q.text);

  if (q.query) {
    const s = q.query.toLowerCase();
    results = results.filter(r =>
      r.name.toLowerCase().includes(s) ||
      r.ref.toLowerCase().includes(s) ||
      r.role.toLowerCase().includes(s) ||
      (r.text ?? '').toLowerCase().includes(s) ||
      (r.url ?? '').toLowerCase().includes(s) ||
      r.path.toLowerCase().includes(s)
    );
  }

  return results;
}

/**
 * Resolves a [eN] ref within an optional page context. Refs are per-snapshot,
 * so an ambiguous ref may match on several pages — a page URL narrows it.
 */
export function resolveRef(profile: WebsiteProfile, ref: string, url?: string): RegistryEntry[] {
  return resolveElement(profile, { ref, url });
}

export function buildProfileSummary(profile: WebsiteProfile): string {
  const lines: string[] = [];
  lines.push(`Website profile: ${profile.host}`);
  lines.push(`  Base URL:  ${profile.baseUrl}`);
  lines.push(`  Pages:     ${profile.pages.length}`);
  lines.push(`  Elements:  ${profile.registry.length}`);
  lines.push(`  Updated:   ${profile.updatedAt.slice(0, 19)}`);
  lines.push('');
  lines.push('Pages:');
  for (const p of profile.pages) {
    lines.push(`  ${p.url} — ${p.title}`);
    lines.push(`    elements: ${p.elementCount}, links: ${p.linkCount} (last visited ${p.lastVisited.slice(0, 10)})`);
  }
  return lines.join('\n');
}
