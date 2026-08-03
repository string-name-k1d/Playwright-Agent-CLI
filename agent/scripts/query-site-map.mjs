#!/usr/bin/env node
// Targeted query script for the overall site map produced by `profile map`
// (website-profiles/<host>-site-map.json).
//
// Usage:
//   node scripts/query-site-map.mjs <site-map.json> <query>          match label/role/selector/id
//   node scripts/query-site-map.mjs <site-map.json> --list           list all routes
//   node scripts/query-site-map.mjs <site-map.json> --route <path>   dump one route's element tree
//   node scripts/query-site-map.mjs <site-map.json> --query <q> --json   machine-readable output
//
// Examples:
//   node scripts/query-site-map.mjs artifacts/website-profiles/mtpc_test-site-map.json "Full Name"
//   node scripts/query-site-map.mjs artifacts/website-profiles/mtpc_test-site-map.json "input"
//   node scripts/query-site-map.mjs artifacts/website-profiles/mtpc_test-site-map.json --route /style-guide-newsletter

import { readFileSync } from 'node:fs';

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

const rest = args.slice(1);

if (rest.includes('--list')) {
  const total = map.routes.reduce((n, r) => n + countElements(r.elements), 0);
  console.log(`Site: ${map.site}  (map_version ${map.map_version})`);
  console.log(`Routes: ${map.routes.length}  Elements: ${total}\n`);
  for (const r of map.routes) {
    console.log(`  ${r.path.padEnd(40)} ${r.title}  [${countElements(r.elements)} els]`);
  }
  process.exit(0);
}

const routeIdx = rest.indexOf('--route');
if (routeIdx >= 0) {
  const path = rest[routeIdx + 1];
  if (!path) fail('--route requires a path, e.g. --route /style-guide-newsletter');
  const route = map.routes.find(r => r.path === path);
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
for (const route of map.routes) {
  const walk = (el, lineage) => {
    const haystack = [el.label, el.role, el.selector ?? '', el.id ?? ''].join(' ').toLowerCase();
    if (haystack.includes(query)) hits.push({ route, element: el, lineage });
    for (const c of el.children) walk(c, `${lineage} > ${el.role}`);
  };
  for (const el of route.elements) walk(el, el.role);
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
