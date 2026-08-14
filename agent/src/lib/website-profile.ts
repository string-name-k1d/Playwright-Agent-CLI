import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import type { ExploreEntry } from './explore-registry.js';
import { buildElementTree, functionalRecords, treeFromRecords, type ElementTree, type TreeRecord } from './element-tree.js';
import { writeSiteMap, loadSiteMap, hostProfileDir, siteMapFileFor, type SiteIndex, type RouteSpec } from './site-map.js';

/**
 * Per-website structured profile. Each origin gets its own directory under
 * `website-profiles/<host>/` containing a compact route index
 * (`site_index.json`) and one functional-element spec file per route
 * (`specs/<route_name>.json`). In memory the profile is hydrated back into
 * per-page element trees (with [eN] refs + hierarchy paths), a flat registry,
 * and a ref index for fast element lookups.
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
  return siteMapFileFor(hostFromUrl(url), baseDir);
}

export function loadWebsiteProfile(url: string, baseDir: string): WebsiteProfile | null {
  return loadWebsiteProfileForHost(hostFromUrl(url), baseDir);
}

export function loadWebsiteProfileForHost(host: string, baseDir: string): WebsiteProfile | null {
  const index = loadSiteMap(host, baseDir);
  if (index) return hydrateWebsiteProfile(host, baseDir, index);

  // Legacy fallback: single-file monolith (`<host>.json`) from before the
  // two-tier split. Read as-is; the next write migrates it.
  const legacy = join(websiteProfileDir(baseDir), `${host}.json`);
  if (!existsSync(legacy)) return null;
  try {
    return JSON.parse(readFileSync(legacy, 'utf-8'));
  } catch {
    return null;
  }
}

/** Rehydrates a full WebsiteProfile from the compact two-tier layout. */
function hydrateWebsiteProfile(host: string, baseDir: string, index: SiteIndex): WebsiteProfile | null {
  const pages: PageRecord[] = [];
  for (const route of index.routes) {
    try {
      const specPath = join(hostProfileDir(host, baseDir), route.spec);
      if (!existsSync(specPath)) continue;
      const spec = JSON.parse(readFileSync(specPath, 'utf-8')) as RouteSpec;
      pages.push({
        url: route.url,
        title: route.title,
        lastVisited: route.lastVisited,
        elementCount: route.elementCount,
        linkCount: route.linkCount,
        links: spec.links ?? [],
        elements: spec.elements ?? [],
      });
    } catch {
      // Skip an unreadable route spec rather than dropping the whole profile.
    }
  }
  if (pages.length === 0) return null;

  const registry: RegistryEntry[] = pages.flatMap(p => p.elements);
  const refIndex: Record<string, string[]> = {};
  for (const r of registry) {
    const list = refIndex[r.ref] ?? (refIndex[r.ref] = []);
    if (!list.includes(r.pageUrl)) list.push(r.pageUrl);
  }
  return {
    host,
    baseUrl: index.baseUrl,
    updatedAt: index.updatedAt,
    pages,
    registry,
    refIndex,
  };
}

function isDirectory(abs: string): boolean {
  try {
    return statSync(abs).isDirectory();
  } catch {
    return false;
  }
}

export function listWebsiteProfiles(baseDir: string): WebsiteProfile[] {
  const dir = websiteProfileDir(baseDir);
  if (!existsSync(dir)) return [];
  let names: string[] = [];
  try {
    names = readdirSync(dir);
  } catch {
    return [];
  }

  const profiles: WebsiteProfile[] = [];
  const newHosts = new Set<string>();
  for (const name of names) {
    const abs = join(dir, name);
    if (isDirectory(abs) && existsSync(join(abs, 'site_index.json'))) newHosts.add(name);
  }
  for (const host of newHosts) {
    const index = loadSiteMap(host, baseDir);
    if (!index) continue;
    const p = hydrateWebsiteProfile(host, baseDir, index);
    if (p) profiles.push(p);
  }
  // Legacy single-file monoliths (skipped when a two-tier dir exists for the host).
  for (const f of names) {
    if (!f.endsWith('.json') || f.endsWith('-site-map.json')) continue;
    const stem = f.slice(0, -5);
    if (newHosts.has(stem) || isDirectory(join(dir, f))) continue;
    try {
      const p = JSON.parse(readFileSync(join(dir, f), 'utf-8'));
      if (p && Array.isArray(p.pages) && Array.isArray(p.registry)) profiles.push(p);
    } catch {}
  }
  return profiles;
}

function readSnapshot(entry: ExploreEntry): string {
  try {
    return readFileSync(entry.snapshotPath, 'utf-8');
  } catch {
    return '';
  }
}

/**
 * Updates (or creates) the website profile for the entry's origin from the
 * snapshot's element tree. Merges into the page record for the entry URL and
 * rebuilds the registry + ref index from all pages. Persisted as the compact
 * two-tier layout (`site_index.json` + `specs/<route_name>.json`).
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

  const records = functionalRecords(tree, normUrl);
  const page: PageRecord = {
    url: normUrl,
    title: entry.title,
    lastVisited: now,
    elementCount: records.length,
    linkCount: tree.links.length,
    links: tree.links.map(l => ({ ref: l.ref, name: l.name, url: l.url ?? '' })),
    elements: records,
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
