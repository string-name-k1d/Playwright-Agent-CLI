import { readFileSync } from 'node:fs';
const p = JSON.parse(readFileSync('/workspace/agent/artifacts/website-profiles/mtpc_test.json', 'utf-8'));
const el = p.pages[0]?.elements || [];
console.log('pages:', p.pages.length, 'registry:', p.registry.length);
console.log('page0:', p.pages[0].url);
const roles = [...new Set(el.map(e => e.role))];
console.log('roles:', JSON.stringify(roles.slice(0, 40)));
const nameKeys = Object.keys(el[0] || {});
console.log('record keys:', JSON.stringify(nameKeys));
// Count how many records would be kept vs discarded by the functional filter
const DISCARD = new Set(['generic', 'group', 'paragraph', 'section', 'presentation', 'text', 'StaticText', 'InlineTextBox']);
const KEEP = new Set(['button', 'link', 'textbox', 'checkbox', 'radio', 'combobox', 'tab', 'switch', 'menuitem', 'form', 'dialog', 'main', 'navigation']);
const kept = el.filter(e => KEEP.has(e.role)).length;
const discarded = el.filter(e => DISCARD.has(e.role)).length;
const other = el.length - kept - discarded;
console.log(`page0 elements: ${el.length}, KEEP: ${kept}, DISCARD: ${discarded}, other: ${other}`);
const allRoles = new Map();
for (const pg of p.pages) {
  for (const e of pg.elements || []) allRoles.set(e.role, (allRoles.get(e.role) || 0) + 1);
}
console.log('ALL ROLES across profile:');
for (const [r, c] of [...allRoles.entries()].sort((a, b) => b[1] - a[1])) console.log(`  ${r}: ${c}`);
