import { listWebsiteProfiles, loadWebsiteProfileForHost, hostFromUrl } from './dist/lib/website-profile.js';
import { siteMapContextForPrompt, loadSiteMap, formatSiteMapSummary } from './dist/lib/site-map.js';

const baseDir = 'artifacts';
const profiles = listWebsiteProfiles(baseDir);
console.log('profiles:', profiles.map((p) => p.host));

const url = 'http://mtpc_test';
const profile = loadWebsiteProfileForHost(hostFromUrl(url), baseDir);
if (profile) {
  const map = loadSiteMap(hostFromUrl(url), baseDir);
  if (map) console.log(formatSiteMapSummary(map));
  const ctx = siteMapContextForPrompt(profile);
  console.log('\n--- SITE MAP CONTEXT (first 1600 chars) ---\n');
  console.log(ctx.slice(0, 1600));
  console.log('\n...\nLENGTH:', ctx.length);
} else {
  console.log('NO PROFILE FOUND');
}
