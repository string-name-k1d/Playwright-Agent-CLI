import { readFileSync, writeFileSync, mkdirSync, existsSync, rmSync, readdirSync } from 'node:fs';
import { join, basename } from 'node:path';
import { createHash } from 'node:crypto';
import type { WebsiteProfile } from './website-profile.js';
import { treeFromRecords, refsOf, type TreeRecord } from './element-tree.js';

/**
 * Overall site map in the shared schema. Mirrors the human-facing example:
 *
 *   {
 *     "site": "mtpc_test",
 *     "map_version": 1,
 *     "routes": [
 *       {
 *         "path": "/style-guide-newsletter",
 *         "title": "...",
 *         "elements": [
 *           {
 *             "id": "e1",
 *             "role": "textbox",
 *             "label": "Full Name",
 *             "children": [...],
 *             "selector": "input#shipping-fullname",
 *             "state": { "value": "", "min": "", "max": "", "enabled": true, "required": true }
 *           }
 *         ]
 *       }
 *     ]
 *   }
 */

export interface SiteMapElement {
  id?: string;
  role: string;
  label: string;
  children: SiteMapElement[];
  selector?: string;
  state?: ElementState;
}

export interface ElementState {
  value: string;
  min: string;
  max: string;
  enabled: boolean;
  required: boolean;
}

export interface SiteMapRoute {
  path: string;
  title: string;
  elements: SiteMapElement[];
}

export interface SiteMap {
  site: string;
  map_version: number;
  routes: SiteMapRoute[];
}

export interface RouteDetailElement extends TreeRecord {
  selector?: string;
  state: ElementState;
}

export interface RouteDetail {
  path: string;
  title: string;
  url: string;
  lastVisited: string;
  elementCount: number;
  linkCount: number;
  elements: RouteDetailElement[];
}

/**
 * Compact per-route spec file. This is the two-tier storage format: the
 * per-site `site_index.json` holds only route metadata (URLs, counts, spec
 * file refs) while the full functional element lists live one-per-route in
 * `<host>/specs/<route_name>.json`. Elements are functional TreeRecords
 * (interactive roles + semantic containers) with empty/duplicate fields
 * pruned and ref arrays collapsed.
 */
export interface RouteSpec {
  path: string;
  title: string;
  url: string;
  lastVisited: string;
  elementCount: number;
  linkCount: number;
  links: { ref: string; name: string; url: string }[];
  elements: TreeRecord[];
}

/** A route entry in the site index (no element payload — see {@link RouteSpec}). */
export interface SiteIndexRoute {
  path: string;
  title: string;
  url: string;
  lastVisited: string;
  elementCount: number;
  linkCount: number;
  /** Relative path to the route's spec file (e.g. "specs/style_guide.json"). */
  spec: string;
}

export interface SiteIndex {
  site: string;
  host: string;
  baseUrl: string;
  map_version: number;
  updatedAt: string;
  routes: SiteIndexRoute[];
}

const MAP_VERSION = 2;

export function websiteProfilesDir(baseDir: string): string {
  return join(baseDir, 'website-profiles');
}

export function hostProfileDir(host: string, baseDir: string): string {
  return join(websiteProfilesDir(baseDir), host);
}

export function siteMapFileFor(host: string, baseDir: string): string {
  return join(hostProfileDir(host, baseDir), 'site_index.json');
}

export function routeDetailDir(host: string, baseDir: string): string {
  return join(hostProfileDir(host, baseDir), 'specs');
}

export function specFileFor(host: string, path: string, baseDir: string): string {
  return join(routeDetailDir(host, baseDir), `${routeFileName(routePathFor(path))}.json`);
}

export function routePathFor(url: string): string {
  try {
    const u = new URL(url);
    return `${u.pathname}${u.search}`.replace(/\/+$/, '') || '/';
  } catch {
    return url.replace(/\/+$/, '') || '/';
  }
}

/**
 * Maps a route path to a spec filename. The slug keeps the name human
 * readable (e.g. `/node/213` → `node_213`); a short path hash guarantees
 * uniqueness so paths that share a slug (e.g. `/` and `/...`) can't collide.
 */
export function routeFileName(path: string): string {
  const slug = path.replace(/[^a-zA-Z0-9_-]+/g, '_').replace(/_+/g, '_').replace(/^_+|_+$/g, '');
  const base = slug || 'index';
  const hash = createHash('sha1').update(path).digest('hex').slice(0, 6);
  return `${base}-${hash}`;
}

function toState(r: TreeRecord): ElementState {
  return {
    value: r.value ?? '',
    min: r.min !== undefined ? String(r.min) : '',
    max: r.max !== undefined ? String(r.max) : '',
    enabled: r.disabled !== true,
    required: r.required === true,
  };
}

function elementFromRecord(r: TreeRecord): RouteDetailElement {
  return {
    ...r,
    selector: r.selector,
    state: toState(r),
  };
}

function mapElementFromRecord(r: TreeRecord, children: SiteMapElement[]): SiteMapElement {
  const el: SiteMapElement = {
    id: r.ref,
    role: r.role,
    label: r.name,
    children,
  };
  if (r.selector) el.selector = r.selector;
  if (
    r.value !== undefined || r.min !== undefined || r.max !== undefined ||
    r.disabled !== undefined || r.required !== undefined
  ) {
    el.state = toState(r);
  }
  return el;
}

function treeRecordToMapElement(r: TreeRecord, all: Map<string, TreeRecord>): SiteMapElement {
  const children = mapChildren(r, all);
  return mapElementFromRecord(r, children);
}

/** Expands a record's children, flattening non-semantic wrappers (text, generic). */
function mapChildren(r: TreeRecord, all: Map<string, TreeRecord>): SiteMapElement[] {
  const out: SiteMapElement[] = [];
  for (const c of refsOf(r.childRefs)) {
    const rec = all.get(c);
    if (!rec) continue;
    if (rec.role === 'text' || rec.role === 'generic') {
      out.push(...mapChildren(rec, all));
    } else {
      out.push(treeRecordToMapElement(rec, all));
    }
  }
  return out;
}

/** Flattens a list of records into map elements (root level). */
function recordsToMapElements(records: TreeRecord[], all: Map<string, TreeRecord>): SiteMapElement[] {
  const out: SiteMapElement[] = [];
  for (const r of records) {
    if (r.role === 'text' || r.role === 'generic') {
      out.push(...mapChildren(r, all));
    } else {
      out.push(treeRecordToMapElement(r, all));
    }
  }
  return out;
}

/**
 * Builds the overall site map for a website profile. Elements reuse the
 * recorded hierarchy (RootWebArea excluded) so landmarks/headings nest their
 * interactive children the same way the snapshot tree did.
 */
export function buildSiteMap(profile: WebsiteProfile): SiteMap {
  const routes: SiteMapRoute[] = [];
  for (const page of profile.pages) {
    const all = new Map<string, TreeRecord>(page.elements.map(r => [r.ref, r]));
    const roots = page.elements.filter(r => refsOf(r.ancestorRefs).every(ref => !all.has(ref)));
    routes.push({
      path: routePathFor(page.url),
      title: page.title,
      elements: recordsToMapElements(roots, all),
    });
  }
  routes.sort((a, b) => a.path.localeCompare(b.path));
  return {
    site: profile.host,
    map_version: MAP_VERSION,
    routes,
  };
}

export function buildRouteDetail(profile: WebsiteProfile, path: string): RouteDetail | null {
  const page = profile.pages.find(p => routePathFor(p.url) === path);
  if (!page) return null;
  return {
    path,
    title: page.title,
    url: page.url,
    lastVisited: page.lastVisited,
    elementCount: page.elementCount,
    linkCount: page.linkCount,
    elements: page.elements.map(elementFromRecord),
  };
}

/**
 * Persists the site profile in the compact two-tier format:
 *
 *   website-profiles/<host>/site_index.json     — route metadata index (~KB)
 *   website-profiles/<host>/specs/<route>.json  — per-route functional elements
 *
 * The in-memory `SiteMap` (with embedded element trees) is returned for
 * tooling that wants the full structure. Legacy single-file artifacts
 * (`<host>-site-map.json`, `<host>-routes/`) are removed once migrated.
 */
export function writeSiteMap(profile: WebsiteProfile, baseDir: string): SiteMap {
  const map = buildSiteMap(profile);
  const host = profile.host;

  const hostDir = hostProfileDir(host, baseDir);
  mkdirSync(hostDir, { recursive: true });
  mkdirSync(routeDetailDir(host, baseDir), { recursive: true });

  const index: SiteIndex = {
    site: host,
    host,
    baseUrl: profile.baseUrl,
    map_version: MAP_VERSION,
    updatedAt: profile.updatedAt,
    routes: profile.pages.map(p => {
      const path = routePathFor(p.url);
      return {
        path,
        title: p.title,
        url: p.url,
        lastVisited: p.lastVisited,
        elementCount: p.elementCount,
        linkCount: p.linkCount,
        spec: join('specs', `${routeFileName(path)}.json`).replace(/\\/g, '/'),
      };
    }),
  };
  writeFileSync(siteMapFileFor(host, baseDir), JSON.stringify(index, null, 2), 'utf-8');

  for (const p of profile.pages) {
    const spec: RouteSpec = {
      path: routePathFor(p.url),
      title: p.title,
      url: p.url,
      lastVisited: p.lastVisited,
      elementCount: p.elementCount,
      linkCount: p.linkCount,
      links: p.links,
      elements: p.elements,
    };
    writeFileSync(specFileFor(host, p.url, baseDir), JSON.stringify(spec), 'utf-8');
  }

  // Prune stale spec files no longer referenced by the index.
  try {
    const referenced = new Set(index.routes.map(r => basename(r.spec)));
    for (const f of readdirSync(routeDetailDir(host, baseDir))) {
      if (!referenced.has(f)) rmSync(join(routeDetailDir(host, baseDir), f), { force: true });
    }
  } catch {}

  // Drop legacy single-file artifacts now that two-tier files exist.
  const legacyMap = join(websiteProfilesDir(baseDir), `${host}-site-map.json`);
  const legacyRoutes = join(websiteProfilesDir(baseDir), `${host}-routes`);
  const legacyMonolith = join(websiteProfilesDir(baseDir), `${host}.json`);
  for (const f of [legacyMap, legacyMonolith]) {
    try {
      if (existsSync(f)) rmSync(f);
    } catch {}
  }
  try {
    if (existsSync(legacyRoutes)) rmSync(legacyRoutes, { recursive: true, force: true });
  } catch {}

  return map;
}

/** Reads the compact site index (`site_index.json`) for a host, if present. */
export function loadSiteMap(host: string, baseDir: string): SiteIndex | null {
  const path = siteMapFileFor(host, baseDir);
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, 'utf-8'));
  } catch {
    return null;
  }
}

export interface SiteMapQueryResult {
  path: string;
  title: string;
  element: SiteMapElement;
}

/**
 * Targeted query across the site map: matches element label, role, selector
 * and id (ref). Returns (route, element) pairs for every hit.
 */
export function querySiteMap(map: SiteMap, query: string): SiteMapQueryResult[] {
  const s = query.toLowerCase();
  const results: SiteMapQueryResult[] = [];
  for (const route of map.routes) {
    const walk = (el: SiteMapElement): void => {
      const haystack = [
        el.label,
        el.role,
        el.selector ?? '',
        el.id ?? '',
        el.state?.required === true ? 'required' : '',
      ].join(' ').toLowerCase();
      if (haystack.includes(s)) {
        results.push({ path: route.path, title: route.title, element: el });
      }
      for (const child of el.children) walk(child);
    };
    for (const el of route.elements) walk(el);
  }
  return results;
}

export function formatSiteMapSummary(map: SiteMap): string {
  const lines: string[] = [];
  lines.push(`Site map: ${map.site} (version ${map.map_version})`);
  lines.push(`  Routes: ${map.routes.length}`);
  for (const r of map.routes) {
    lines.push(`  ${r.path} — ${r.title}`);
  }
  return lines.join('\n');
}

function flattenMapElements(elements: SiteMapElement[]): SiteMapElement[] {
  const out: SiteMapElement[] = [];
  const walk = (els: SiteMapElement[]): void => {
    for (const el of els) {
      out.push(el);
      walk(el.children);
    }
  };
  walk(elements);
  return out;
}

function formatElementState(s: ElementState): string {
  const parts: string[] = [];
  if (s.value) parts.push(`value="${s.value}"`);
  if (s.min !== '') parts.push(`min=${s.min}`);
  if (s.max !== '') parts.push(`max=${s.max}`);
  if (s.required) parts.push('required');
  if (!s.enabled) parts.push('disabled');
  return parts.join(', ');
}

/**
 * Renders the structured site map (from the per-site profile) as prompt text.
 * Used by the planner to surface routes + elements with best-effort CSS
 * selectors and state so generated locators are reliable.
 */
export function siteMapContextForPrompt(profile: WebsiteProfile): string {
  const map = buildSiteMap(profile);
  const lines: string[] = [];
  lines.push(`SITE MAP (${map.site}) — ${map.routes.length} route(s).`);
  lines.push('Routes and their elements (with best-effort CSS selectors + state) from the per-site profile. Use them to plan reliable locators; disambiguate on the live page when needed.');
  for (const route of map.routes) {
    lines.push(`\nRoute ${route.path} — ${route.title}`);
    const flat = flattenMapElements(route.elements);
    const shown = flat.slice(0, 120);
    for (const el of shown) {
      const sel = el.selector ? ` [${el.selector}]` : '';
      const st = el.state ? ` (${formatElementState(el.state)})` : '';
      lines.push(`  ${el.role} "${el.label}"${sel}${st}`);
    }
    if (flat.length > shown.length) lines.push(`  … and ${flat.length - shown.length} more element(s)`);
  }
  return lines.join('\n');
}
