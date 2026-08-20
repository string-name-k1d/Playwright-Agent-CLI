import chalk from 'chalk';
import { join, basename } from 'node:path';
import { PlaywrightSession } from './playwright-session.js';
import { ensureArtifactsDir } from './artifacts.js';
import { registerExploreEntry, type ExploreEntry } from './explore-registry.js';
import { updateWebsiteProfile, loadWebsiteProfile, profileFileFor, hostFromUrl, normalizeUrl } from './website-profile.js';
import { saveSiteProfile } from './site-profile.js';
import type { Config } from '../config.js';

export interface ProfileRefreshOptions {
  url: string;
  headed?: boolean;
  profile?: string;
  config: Config;
}

export interface ProfileRefreshResult {
  discovered: number;
  added: number;
  total: number;
}

/**
 * Discovers newly-created pages after tests pass and merges them into the
 * per-website profile. Uses the authenticated admin/content listing to find
 * node URLs (aliases + canonical /node/N), then explores any URL not yet in
 * the profile and updates the site map.
 */
export async function refreshWebsiteProfile(opts: ProfileRefreshOptions): Promise<ProfileRefreshResult> {
  ensureArtifactsDir(opts.config.outputDir);

  const host = hostFromUrl(opts.url);
  const baseUrl = opts.url.replace(/\/+$/, '');
  const existing = loadWebsiteProfile(opts.url, opts.config.outputDir);
  const known = new Set((existing?.pages ?? []).map(p => normalizeUrl(p.url)));

  console.log(chalk.cyan('\nRefreshing website profile after test run...\n'));

  const session = new PlaywrightSession();
  let candidates: string[] = [];

  try {
    await session.launch(opts.url, {
      profile: opts.profile,
      headless: !(opts.headed ?? opts.config.headed),
      siteAdapter: opts.config.siteAdapter,
    });

    // Collect node URLs from the content administration listing.
    // The listing is sorted newest-first, so the most recently created pages
    // appear first — that's what a just-completed test run would have created.
    const listUrl = `${baseUrl}/admin/content`;
    console.log(chalk.gray(`  Listing content: ${listUrl}`));
    await session.goto(listUrl);
    await session.waitForTimeout(1500);

    candidates = await session.evaluate(() => {
      const found = new Set<string>();
      for (const tr of document.querySelectorAll('table tbody tr')) {
        const links = tr.querySelectorAll('a[href]');
        for (const a of links) {
          const href = a.getAttribute('href') ?? '';
          if (!href.startsWith('/')) continue;
          if (href.includes('/admin/') || href.includes('destination=') || href.includes('/devel/') || href.includes('/entity_clone/') || href.includes('/user/')) continue;
          found.add(href.split('?')[0].replace(/\/edit.*$/, ''));
          break; // first qualifying link in the row is the title alias
        }
      }
      // Fall back to raw link scan if the row-scoped query matched nothing.
      if (found.size === 0) {
        for (const a of document.querySelectorAll('a[href]')) {
          const href = a.getAttribute('href') ?? '';
          if (/^\/node\/\d+$/.test(href) || /^\/node\/\d+\/edit/.test(href)) {
            found.add(href.split('?')[0].replace(/\/edit.*$/, ''));
          } else if (href.startsWith('/') && !href.includes('/admin/') && !href.includes('destination=') && !href.includes('/devel/') && !href.includes('/entity_clone/') && !href.includes('/user/')) {
            found.add(href.split('?')[0]);
          }
        }
      }
      return [...found].slice(0, 10);
    });
  } catch (err: any) {
    console.log(chalk.yellow(`  Content listing failed: ${err.message} — falling back to homepage links`));
    candidates = [];
  }

  // Resolve relative candidates against the base URL.
  const resolved = new Set<string>([baseUrl]);
  for (const c of candidates) {
    try {
      resolved.add(new URL(c, baseUrl).href);
    } catch {
      // skip unparseable
    }
  }

  const toVisit = [...resolved]
    .map(u => normalizeUrl(u))
    .filter(u => !known.has(u));

  console.log(chalk.gray(`  Found ${resolved.size} candidate URL(s), ${toVisit.length} new page(s) to explore`));

  const added: string[] = [];
  for (const url of toVisit) {
    try {
      await session.goto(url);
      await session.waitForTimeout(800);
      const info = await session.getPageInfo();
      const destDir = join(opts.config.outputDir, 'explore');
      const snapshotPath = await session.saveSnapshot(destDir);
      const snapFilename = basename(snapshotPath);
      const entry: ExploreEntry = registerExploreEntry(
        info.url || url,
        info.title || 'Untitled',
        snapshotPath,
        snapFilename,
        opts.config.outputDir
      );
      updateWebsiteProfile(entry, opts.config.outputDir);
      added.push(normalizeUrl(info.url || url));
      console.log(chalk.green(`  + ${info.url || url} — ${info.title || 'Untitled'}`));
    } catch (err: any) {
      console.log(chalk.yellow(`  ~ Failed to explore ${url}: ${err.message}`));
    }
  }

  await session.close();

  // Regenerate site profile
  const profilePath = saveSiteProfile(opts.config.outputDir);
  if (profilePath) console.log(chalk.gray(`  Site profile: ${profilePath}`));

  const finalProfile = loadWebsiteProfile(opts.url, opts.config.outputDir);
  const total = finalProfile?.pages.length ?? existing?.pages.length ?? 0;
  console.log(chalk.gray(`  Website profile: ${profileFileFor(opts.url, opts.config.outputDir)} (${total} pages)`));

  return { discovered: resolved.size, added: added.length, total };
}
