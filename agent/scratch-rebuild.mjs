import { getExploreEntries } from './dist/lib/explore-registry.js';
import { updateWebsiteProfile, loadWebsiteProfile } from './dist/lib/website-profile.js';

const baseDir = './artifacts';
const entries = getExploreEntries(baseDir);
let ok = 0;
let fail = 0;
const seen = new Set();
for (const e of entries) {
  try {
    updateWebsiteProfile(e, baseDir);
    ok++;
  } catch (err) {
    console.error(`failed ${e.url}: ${err.message}`);
    fail++;
  }
}
const p = loadWebsiteProfile(process.env.TARGET_URL || 'http://mtpc_test', baseDir);
console.log(`\nRebuilt: ${ok} ok, ${fail} failed`);
if (p) {
  console.log(`pages: ${p.pages.length}`);
  console.log(`registry records (functional): ${p.registry.length}`);
  const roles = {};
  for (const r of p.registry) roles[r.role] = (roles[r.role] || 0) + 1;
  const top = Object.entries(roles).sort((a, b) => b[1] - a[1]).slice(0, 20);
  for (const [role, n] of top) console.log(`  ${role}: ${n}`);
}
