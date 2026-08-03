import chalk from 'chalk';
import { join, basename } from 'node:path';
import { PlaywrightSession } from '../lib/playwright-session.js';
import { ensureArtifactsDir } from '../lib/artifacts.js';
import { registerExploreEntry, type ExploreEntry } from '../lib/explore-registry.js';
import { saveSiteProfile } from '../lib/site-profile.js';
import { updateWebsiteProfile, profileFileFor } from '../lib/website-profile.js';
import { Config, resolveProfile } from '../config.js';

export interface ExploreOptions {
  url: string;
  depth?: number;
  screenshot?: boolean;
  headed?: boolean;
  profile?: string;
  config: Config;
}

export interface ExploreResult {
  entry: ExploreEntry;
  snapshotPath: string;
}

export async function exploreCommand(opts: ExploreOptions): Promise<ExploreResult> {
  ensureArtifactsDir(opts.config.outputDir);

  const profile = resolveProfile(opts.profile, opts.config);
  console.log(chalk.cyan(`\nOpening: ${opts.url}\n`));

  const session = new PlaywrightSession();
  try {
    await session.launch(opts.url, {
      profile,
      headless: !(opts.headed ?? opts.config.headed),
    });
  } catch (err: any) {
    console.error(chalk.red(`Failed to open site: ${err.message}`));
    process.exit(1);
  }

  console.log(chalk.green('Browser opened'));

  await session.prepareForExploration();

  const pageInfo = await session.getPageInfo();
  const destDir = join(opts.config.outputDir, 'explore');
  const snapshotPath = await session.saveSnapshot(destDir);
  const snapFilename = basename(snapshotPath);
  console.log(chalk.green(`Snapshot captured: ${snapFilename}`));
  if (pageInfo.url) console.log(chalk.gray(`  URL: ${pageInfo.url}`));
  if (pageInfo.title) console.log(chalk.gray(`  Title: ${pageInfo.title}`));

  const entry = registerExploreEntry(
    pageInfo.url || opts.url,
    pageInfo.title || 'Untitled',
    snapshotPath,
    snapFilename,
    opts.config.outputDir
  );
  console.log(chalk.gray(`  Elements: ${entry.elementCount}, Links: ${entry.linkCount}`));

  // Update the per-site structured profile (element trees + registry)
  const siteProfile = updateWebsiteProfile(entry, opts.config.outputDir);
  const siteProfilePath = profileFileFor(siteProfile.baseUrl || entry.url, opts.config.outputDir);
  console.log(chalk.gray(`  Website profile: ${siteProfilePath}`));

  if (opts.screenshot) {
    const imgFilename = `explore-${Date.now()}.png`;
    try {
      const saved = await session.screenshot(imgFilename);
      console.log(chalk.green(`Screenshot saved: ${saved}`));
    } catch (err: any) {
      console.log(chalk.yellow(`Screenshot failed: ${err.message}`));
    }
  }

  await session.close();

  // Regenerate site profile
  const profilePath = saveSiteProfile(opts.config.outputDir);
  if (profilePath) {
    console.log(chalk.gray(`  Site profile: ${profilePath}`));
  }

  console.log(chalk.green('\nExploration complete\n'));

  return { entry, snapshotPath };
}
