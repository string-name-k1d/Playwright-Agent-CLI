#!/usr/bin/env node
// Targeted query script for the site map produced by `profile map`.
// Supports both the compact two-tier layout (site_index.json + specs/<route>.json)
// and the legacy single-file <host>-site-map.json.
//
// Usage:
//   node scripts/query-site-map.mjs <site-index.json> <query>        match label/role/selector/id
//   node scripts/query-site-map.mjs <site-index.json> --list         list all routes
//   node scripts/query-site-map.mjs <site-index.json> --route <path> dump one route's element tree
//   node scripts/query-site-map.mjs <site-index.json> --query <q> --json   machine-readable output
//
// Examples:
//   node scripts/query-site-map.mjs artifacts/website-profiles/mtpc_test/site_index.json "Full Name"
//   node scripts/query-site-map.mjs artifacts/website-profiles/mtpc_test/site_index.json "input"
//   node scripts/query-site-map.mjs artifacts/website-profiles/mtpc_test/site_index.json --route /style-guide-newsletter

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

function fail(msg) {
  console.error(msg);
  process.exit(1);
}

const args = process.argv.slice(2);
if (args.length === 0) fail('Usage: node scripts/query-site-map.mjs <site-map.json> <query> | --list | --route <path>');

const mapFile = args[0];
let map;
try {
  map = JSON.parse(readFileSync(mapFile, 'utf-8'));
} catch (e) {
  fail(`Cannot read site map "${mapFile}": ${e.message}`);
}

// Normalize routes to the shared in-memory shape:
//   { path, title, elements: [{ id, role, label, selector, state, children, lineagePath? }] }
// New two-tier layout: index routes carry a `spec` file ref and no embedded
// elements — load each spec (flat functional records) and surface `path` as
// lineage. Legacy layout: elements are embedded directly.
function stateFromRecord(r) {
  const hasAny = r.value !== undefined || r.min !== undefined || r.max !== undefined ||
    r.required !== undefined || r.disabled !== undefined;
  if (!hasAny) return undefined;
  return {
    value: r.value ?? '',
    min: r.min !== undefined ? String(r.min) : '',
    max: r.max !== undefined ? String(r.max) : '',
    enabled: r.disabled !== true,
    required: r.required === true,
  };
}

function recordToElement(r) {
  return {
    id: r.ref,
    role: r.role,
    label: r.name ?? '',
    selector: r.selector,
    state: stateFromRecord(r),
    children: [],
    lineagePath: r.path,
  };
}

function normalizeRoutes() {
  if (!map.routes || map.routes.length === 0) return [];
  if (map.routes.some(r => r.spec)) {
    const baseDir = dirname(mapFile);
    return map.routes.map(r => {
      let elements = [];
      try {
        const spec = JSON.parse(readFileSync(join(baseDir, r.spec), 'utf-8'));
        elements = (spec.elements ?? []).map(recordToElement);
      } catch (e) {
        console.error(`warning: cannot read spec for ${r.path}: ${e.message}`);
      }
      return { path: r.path, title: r.title, elements };
    });
  }
  // Legacy embedded-element layout — keep the nested `children` trees.
  return map.routes.map(r => ({
    path: r.path,
    title: r.title,
    elements: (r.elements ?? []).map(el => ({ ...el, children: el.children ?? [] })),
  }));
}

const routes = normalizeRoutes();
const totalElements = routes.reduce((n, r) => n + countElements(r.elements), 0);

const rest = args.slice(1);

if (rest.includes('--list')) {
  console.log(`Site: ${map.site ?? map.host ?? '?'}  (map_version ${map.map_version})`);
  console.log(`Routes: ${routes.length}  Elements: ${totalElements}\n`);
  for (const r of routes) {
    console.log(`  ${r.path.padEnd(40)} ${r.title}  [${countElements(r.elements)} els]`);
  }
  process.exit(0);
}

const routeIdx = rest.indexOf('--route');
if (routeIdx >= 0) {
  const path = rest[routeIdx + 1];
  if (!path) fail('--route requires a path, e.g. --route /style-guide-newsletter');
  const route = routes.find(r => r.path === path);
  if (!route) fail(`Route not found: ${path}`);
  console.log(`Route: ${route.path} — ${route.title}\n`);
  for (const el of route.elements) printElement(el, '');
  process.exit(0);
}

const jsonFlag = rest.includes('--json');
const queryArg = rest.find(a => a !== '--json');
if (!queryArg) fail('Provide a query, --list, or --route <path>.');
const query = queryArg.toLowerCase();

const hits = [];
for (const route of routes) {
  const walk = (el, lineage) => {
    const haystack = [el.label, el.role, el.selector ?? '', el.id ?? ''].join(' ').toLowerCase();
    if (haystack.includes(query)) hits.push({ route, element: el, lineage });
    for (const c of el.children) walk(c, `${lineage} > ${el.role}`);
  };
  for (const el of route.elements) {
    walk(el, el.lineagePath || el.role);
  }
}

if (jsonFlag) {
  console.log(JSON.stringify(hits.map(h => ({
    path: h.route.path,
    title: h.route.title,
    role: h.element.role,
    label: h.element.label,
    id: h.element.id,
    selector: h.element.selector,
    state: h.element.state,
    lineage: h.lineage,
  })), null, 2));
  process.exit(0);
}

if (hits.length === 0) {
  console.log(`No elements matched "${queryArg}".`);
  process.exit(1);
}

console.log(`Matches for "${queryArg}": ${hits.length}\n`);
for (const h of hits) {
  const el = h.element;
  const state = el.state
    ? `  state: value=${JSON.stringify(el.state.value)} min=${JSON.stringify(el.state.min)} max=${JSON.stringify(el.state.max)} enabled=${el.state.enabled} required=${el.state.required}`
    : '';
  console.log(`  [${h.route.path}] ${el.role} "${el.label}" (${el.id ?? 'no id'})`);
  if (el.selector) console.log(`      selector: ${el.selector}`);
  console.log(state);
  console.log(`      path: ${h.lineage}\n`);
}

function countElements(elements) {
  let n = 0;
  const walk = els => { for (const e of els) { n++; walk(e.children); } };
  walk(elements);
  return n;
}

function printElement(el, indent) {
  const sel = el.selector ? `  [${el.selector}]` : '';
  const state = el.state && el.state.required ? `  (required${el.state.min !== '' ? ` min=${el.state.min}` : ''}${el.state.max !== '' ? ` max=${el.state.max}` : ''})` : '';
  console.log(`${indent}${el.role} "${el.label}"${el.id ? ` (${el.id})` : ''}${sel}${state}`);
  for (const c of el.children) printElement(c, indent + '  ');
}
