import chalk from 'chalk';
import type { Config } from '../config.js';
import {
  loadWebsiteProfile,
  loadWebsiteProfileForHost,
  listWebsiteProfiles,
  getPageRecord,
  getPageTree,
  resolveElement,
  resolveRef,
  buildProfileSummary,
  normalizeUrl,
  hostFromUrl,
  type WebsiteProfile,
  type RegistryEntry,
} from '../lib/website-profile.js';
import { formatTreeNode, formatTree, locatorFor, buildElementTree, type ElementTree } from '../lib/element-tree.js';
import { getLatestEntryForUrl, getSnapshotContent } from '../lib/explore-registry.js';
import { buildSiteMap, writeSiteMap, siteMapFileFor, routeDetailDir, type SiteMapElement } from '../lib/site-map.js';

export interface ProfileOptions {
  url?: string;
  includeText?: boolean;
  config: Config;
}

function loadProfileFor(url: string | undefined, config: Config): WebsiteProfile | null {
  if (!url) return null;
  return loadWebsiteProfile(url, config.outputDir);
}

function findHostProfile(url: string | undefined, config: Config): WebsiteProfile | null {
  if (!url) return null;
  return loadWebsiteProfileForHost(hostFromUrl(url), config.outputDir);
}

function formatRoots(tree: ElementTree, includeText: boolean): string {
  const root = tree.root;
  if (!root) return '(empty tree)';
  const roots = tree.nodes.filter(n => n.ancestors.length === 0);
  if (roots.length <= 1) return formatTree(tree, { includeText });
  return roots.map(r => formatTreeNode(r, { includeText })).join('\n');
}

function resolveFromSnapshot(url: string, config: Config): { yaml: string; pageUrl: string } | null {
  const entry = getLatestEntryForUrl(url, config.outputDir);
  if (!entry) return null;
  return { yaml: getSnapshotContent(entry), pageUrl: normalizeUrl(entry.url) };
}

export function profileTree(opts: ProfileOptions): void {
  if (!opts.url) {
    console.error(chalk.red('Error: a page URL is required (or set TARGET_URL in .env)'));
    return;
  }

  let profile = loadProfileFor(opts.url, opts.config);
  if (profile) {
    const page = getPageRecord(profile, opts.url!);
    if (!page) {
      console.log(chalk.yellow(`Page not profiled yet: ${normalizeUrl(opts.url)}`));
      console.log(chalk.yellow('Run `pw-cli-agent explore --url <url>` to build the profile.'));
      return;
    }
    const tree = getPageTree(profile, opts.url!);
    console.log(chalk.bold(`\n${page.url} — "${page.title}"`));
    console.log(chalk.gray(`  ${page.elementCount} elements, ${page.linkCount} links, last visited ${page.lastVisited.slice(0, 10)}`));
    console.log('');
    console.log(formatRoots(tree!, opts.includeText ?? false));
    return;
  }

  // Fallback: build a fresh tree from the latest explore snapshot.
  const snap = resolveFromSnapshot(opts.url, opts.config);
  if (!snap) {
    console.log(chalk.yellow(`No profile or snapshot found for ${opts.url}.`));
    console.log(chalk.yellow('Run `pw-cli-agent explore --url <url>` to build the profile.'));
    return;
  }
  const tree = buildElementTree(snap.yaml);
  console.log(chalk.bold(`\n${snap.pageUrl} — "${opts.url}" (from latest snapshot)`));
  console.log('');
  console.log(formatRoots(tree, opts.includeText ?? false));
}

function renderRegistryEntries(results: RegistryEntry[], title: string, limit = 40): void {
  if (results.length === 0) {
    console.log(chalk.gray('  No matches found.'));
    return;
  }
  console.log(chalk.bold(`\n${title} (${results.length}):`));
  for (const r of results.slice(0, limit)) {
    const namePart = r.name ? ` "${r.name}"` : '';
    console.log(chalk.cyan(`  [${r.ref}]`) + ` ${r.role}${namePart}`);
    console.log(chalk.gray(`      page:    ${r.pageUrl}`));
    console.log(chalk.gray(`      path:    ${r.path}`));
    if (r.selector) console.log(chalk.gray(`      selector: ${r.selector}`));
    const stateParts: string[] = [];
    if (r.value !== undefined && r.value !== '') stateParts.push(`value="${r.value}"`);
    if (r.min !== undefined) stateParts.push(`min=${r.min}`);
    if (r.max !== undefined) stateParts.push(`max=${r.max}`);
    if (r.disabled === true) stateParts.push('disabled');
    if (r.required === true) stateParts.push('required');
    if (stateParts.length > 0) console.log(chalk.gray(`      state:   ${stateParts.join(', ')}`));
    console.log(chalk.gray(`      locator: ${locatorFor(r.role, r.name)}`));
  }
  if (results.length > limit) {
    console.log(chalk.gray(`  … and ${results.length - limit} more`));
  }
}

export function profileQuery(query: string, url: string | undefined, opts: ProfileOptions): void {
  const profile = url ? loadProfileFor(url, opts.config) : findHostProfile(opts.url, opts.config);
  if (!profile) {
    console.log(chalk.yellow(`No website profile found${url ? ` for ${url}` : ''}.`));
    console.log(chalk.yellow('Run `pw-cli-agent explore` first to build one.'));
    return;
  }
  const results = resolveElement(profile, { query, url });
  renderRegistryEntries(results, `Matches for "${query}"`);
}

export function profileRef(ref: string, url: string | undefined, opts: ProfileOptions): void {
  const profile = url ? loadProfileFor(url, opts.config) : findHostProfile(opts.url, opts.config);
  if (!profile) {
    console.log(chalk.yellow('No website profile found.'));
    return;
  }
  const results = resolveRef(profile, ref, url);
  renderRegistryEntries(results, `Ref ${ref}`);
}

export function profilePages(opts: ProfileOptions): void {
  const profile = opts.url ? findHostProfile(opts.url, opts.config) : listWebsiteProfiles(opts.config.outputDir)[0] ?? null;
  if (!profile) {
    console.log(chalk.yellow('No website profiles found. Run `pw-cli-agent explore` first.'));
    return;
  }
  console.log(chalk.bold(`\nPages for ${profile.host}:`));
  console.log('');
  for (const p of profile.pages) {
    console.log(chalk.cyan(`  ${p.url}`));
    console.log(chalk.gray(`    ${p.title}`));
    console.log(chalk.gray(`    elements: ${p.elementCount}, links: ${p.linkCount}`));
    console.log(chalk.gray(`    last visited: ${p.lastVisited.slice(0, 10)}`));
  }
}

export function profileList(config: Config): void {
  const profiles = listWebsiteProfiles(config.outputDir);
  if (profiles.length === 0) {
    console.log(chalk.yellow('No website profiles found. Run `pw-cli-agent explore` first.'));
    return;
  }
  console.log(chalk.bold(`\nWebsite profiles (${profiles.length}):`));
  console.log('');
  for (const p of profiles) {
    console.log(chalk.cyan(`  ${p.host}`));
    console.log(chalk.gray(`    base URL: ${p.baseUrl}`));
    console.log(chalk.gray(`    pages: ${p.pages.length}, elements: ${p.registry.length}`));
    console.log(chalk.gray(`    updated: ${p.updatedAt.slice(0, 19)}`));
  }
  console.log('');
}

export function profileMap(opts: ProfileOptions): void {
  const profile = opts.url ? findHostProfile(opts.url, opts.config) : listWebsiteProfiles(opts.config.outputDir)[0] ?? null;
  if (!profile) {
    console.log(chalk.yellow('No website profiles found. Run `pw-cli-agent explore` first.'));
    return;
  }
  const map = writeSiteMap(profile, opts.config.outputDir);
  const mapPath = siteMapFileFor(profile.host, opts.config.outputDir);
  const detailDir = routeDetailDir(profile.host, opts.config.outputDir);
  console.log(chalk.bold(`\nSite map: ${map.site} (version ${map.map_version})`));
  console.log('');
  let total = 0;
  for (const r of map.routes) {
    const count = countMapElements(r.elements);
    total += count;
    console.log(chalk.cyan(`  ${r.path}`));
    console.log(chalk.gray(`    ${r.title}`));
    console.log(chalk.gray(`    elements: ${count}`));
  }
  console.log('');
  console.log(chalk.gray(`  Total: ${map.routes.length} routes, ${total} elements`));
  console.log(chalk.gray(`  Site map:   ${mapPath}`));
  console.log(chalk.gray(`  Route detail files: ${detailDir}/`));
  console.log(chalk.gray(`  Query: node scripts/query-site-map.mjs "${mapPath}" <query>`));
  console.log('');
}

function countMapElements(elements: SiteMapElement[]): number {
  let n = 0;
  const walk = (els: SiteMapElement[]): void => { for (const e of els) { n++; walk(e.children); } };
  walk(elements);
  return n;
}
