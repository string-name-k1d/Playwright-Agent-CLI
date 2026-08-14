import { writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { getExploreEntries, getSnapshotElements, type ExploreEntry } from './explore-registry.js';
import { parseSnapshotElements, getElementSummary, type SnapshotElements } from './snapshot-parser.js';
import { listWebsiteProfiles } from './website-profile.js';

const PROFILE_FILE = 'site-profile.md';

/**
 * Represents the aggregated site profile built from all explore entries.
 * Contains navigation, forms, buttons, headings, and page details.
 */
export interface SiteProfile {
  baseUrl: string;
  pageCount: number;
  pages: { url: string; title: string; headings: string[]; elementCount: number; linkCount: number; lastVisited: string }[];
  forms: { url: string; inputs: { name: string; role: string }[] }[];
  navigation: { name: string; url: string }[];
  buttons: { name: string; url?: string }[];
  headings: string[];
  totalElements: number;
  totalLinks: number;
  firstExplored: string;
  lastExplored: string;
}

function normalizeUrl(url: string): string {
  try {
    const u = new URL(url);
    return `${u.origin}${u.pathname}`.replace(/\/+$/, '');
  } catch {
    return url.replace(/\/+$/, '');
  }
}

function extractBaseUrl(entries: ExploreEntry[]): string {
  for (const e of entries) {
    try {
      const u = new URL(e.url);
      return `${u.origin}`;
    } catch {}
  }
  return '';
}

/**
 * Builds a site profile by aggregating all explore entries.
 * Deduplicates pages by URL and extracts navigation, forms, buttons, and headings.
 *
 * @param baseDir - Base directory containing the explore registry
 * @returns SiteProfile object or null if no entries exist
 */
export function buildSiteProfile(baseDir: string): SiteProfile | null {
  const entries = getExploreEntries(baseDir);
  if (entries.length === 0) return null;

  const baseUrl = extractBaseUrl(entries);
  const now = new Date().toISOString();

  // Deduplicate by normalized URL, keep latest entry per URL
  const byUrl = new Map<string, { entry: ExploreEntry; elements: SnapshotElements }>();
  for (const entry of entries) {
    const key = normalizeUrl(entry.url);
    if (!byUrl.has(key)) {
      const elements = getSnapshotElements(entry);
      byUrl.set(key, { entry, elements });
    }
  }

  const pages: SiteProfile['pages'] = [];
  const allNavigation: { name: string; url: string }[] = [];
  const allButtons: { name: string; url?: string }[] = [];
  const allHeadings: string[] = [];
  const forms: SiteProfile['forms'] = [];
  let totalElements = 0;
  let totalLinks = 0;
  let earliest = now;

  for (const [url, { entry, elements }] of byUrl) {
    if (entry.timestamp < earliest) earliest = entry.timestamp;

    pages.push({
      url,
      title: entry.title,
      headings: elements.headings.map(h => h.name),
      elementCount: elements.elements.length,
      linkCount: elements.links.length,
      lastVisited: entry.timestamp,
    });

    // Collect navigation links
    for (const link of elements.links) {
      if (link.url && !allNavigation.some(n => n.url === link.url)) {
        allNavigation.push({ name: link.name, url: link.url });
      }
    }

    // Collect buttons
    for (const btn of elements.buttons) {
      if (!allButtons.some(b => b.name === btn.name)) {
        allButtons.push({ name: btn.name });
      }
    }

    // Collect headings
    for (const h of elements.headings) {
      if (h.name && !allHeadings.includes(h.name)) {
        allHeadings.push(h.name);
      }
    }

    // Detect forms (pages with inputs)
    if (elements.inputs.length > 0) {
      forms.push({
        url,
        inputs: elements.inputs.map(i => ({ name: i.name, role: i.role })),
      });
    }

    totalElements += elements.elements.length;
    totalLinks += elements.links.length;
  }

  return {
    baseUrl,
    pageCount: pages.length,
    pages: pages.sort((a, b) => a.url.localeCompare(b.url)),
    forms,
    navigation: allNavigation.slice(0, 50),
    buttons: allButtons.slice(0, 30),
    headings: allHeadings.slice(0, 40),
    totalElements,
    totalLinks,
    firstExplored: earliest,
    lastExplored: now,
  };
}

/**
 * Builds and saves the site profile as a markdown file.
 * Regenerated after each explore run to keep the profile up-to-date.
 *
 * @param baseDir - Base directory containing the explore registry
 * @returns Path to the saved profile file, or null if no entries exist
 */
export function saveSiteProfile(baseDir: string): string | null {
  const profile = buildSiteProfile(baseDir);
  if (!profile) return null;

  const lines: string[] = [];

  lines.push(`# Site Profile`);
  lines.push('');
  lines.push(`> Auto-generated from ${profile.pageCount} explored page(s). Last updated: ${new Date().toISOString().slice(0, 19)}`);
  lines.push('');

  // Site overview
  lines.push(`## Overview`);
  lines.push('');
  lines.push(`| Property | Value |`);
  lines.push(`|----------|-------|`);
  lines.push(`| Base URL | ${profile.baseUrl} |`);
  lines.push(`| Pages Explored | ${profile.pageCount} |`);
  lines.push(`| Total Elements | ${profile.totalElements} |`);
  lines.push(`| Total Links | ${profile.totalLinks} |`);
  lines.push(`| First Explored | ${profile.firstExplored.slice(0, 19)} |`);
  lines.push(`| Last Explored | ${profile.lastExplored.slice(0, 19)} |`);
  lines.push('');

  // Discovered pages
  lines.push(`## Discovered Pages`);
  lines.push('');
  lines.push(`| URL | Title | Elements | Links | Last Visited |`);
  lines.push(`|-----|-------|----------|-------|--------------|`);
  for (const p of profile.pages) {
    lines.push(`| ${p.url} | ${p.title} | ${p.elementCount} | ${p.linkCount} | ${p.lastVisited.slice(0, 10)} |`);
  }
  lines.push('');

  // Navigation structure
  if (profile.navigation.length > 0) {
    lines.push(`## Navigation`);
    lines.push('');
    lines.push(`| Link | URL |`);
    lines.push(`|------|-----|`);
    for (const n of profile.navigation.slice(0, 30)) {
      lines.push(`| ${n.name} | ${n.url} |`);
    }
    lines.push('');
  }

  // Forms
  if (profile.forms.length > 0) {
    lines.push(`## Forms`);
    lines.push('');
    for (const f of profile.forms) {
      lines.push(`### ${f.url}`);
      lines.push('');
      lines.push(`| Input | Type |`);
      lines.push(`|-------|------|`);
      for (const i of f.inputs) {
        lines.push(`| ${i.name} | ${i.role} |`);
      }
      lines.push('');
    }
  }

  // Interactive elements
  if (profile.buttons.length > 0) {
    lines.push(`## Interactive Elements`);
    lines.push('');
    lines.push(`| Button/Action |`);
    lines.push(`|---------------|`);
    for (const b of profile.buttons) {
      lines.push(`| ${b.name} |`);
    }
    lines.push('');
  }

  // Page headings (site map)
  if (profile.headings.length > 0) {
    lines.push(`## Content Headings`);
    lines.push('');
    for (const h of profile.headings) {
      lines.push(`- ${h}`);
    }
    lines.push('');
  }

  // Per-page summaries
  lines.push(`## Page Details`);
  lines.push('');
  for (const p of profile.pages) {
    lines.push(`### ${p.title}`);
    lines.push(`- **URL:** ${p.url}`);
    lines.push(`- **Headings:** ${p.headings.join(', ') || 'none'}`);
    lines.push('');
  }

  // Per-site structured profiles (element trees + registry)
  const siteProfiles = listWebsiteProfiles(baseDir);
  if (siteProfiles.length > 0) {
    lines.push(`## Website Profiles`);
    lines.push('');
    lines.push(`Structured per-site profiles store hierarchical element trees (with [eN] refs), related-page links, and a searchable registry. Query them with:`);
    lines.push('');
    lines.push('```');
    lines.push(`pwcli profile tree <url>`);
    lines.push(`pwcli profile query <name|role|text> [url]`);
    lines.push(`pwcli profile ref <eN> [url]`);
    lines.push(`pwcli profile pages [url]`);
    lines.push(`pwcli profile ls`);
    lines.push(`pwcli profile map [url]`);
    lines.push('```');
    lines.push('');
    for (const sp of siteProfiles) {
      lines.push(`### ${sp.host}`);
      lines.push(`- **Profile:** \`website-profiles/${sp.host}/site_index.json\` (+ \`specs/\` per route)`);
      lines.push(`- **Base URL:** ${sp.baseUrl}`);
      lines.push(`- **Pages:** ${sp.pages.length}`);
      lines.push(`- **Elements indexed:** ${sp.registry.length}`);
      lines.push('');
      for (const p of sp.pages.slice(0, 10)) {
        lines.push(`  - [${p.title}](${p.url}) — ${p.elementCount} elements, ${p.linkCount} links`);
      }
      lines.push('');
    }
  }

  const content = lines.join('\n');
  const filePath = join(baseDir, PROFILE_FILE);
  writeFileSync(filePath, content, 'utf-8');
  return filePath;
}

export function getProfilePath(baseDir: string): string {
  return join(baseDir, PROFILE_FILE);
}
