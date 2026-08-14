import chalk from 'chalk';
import { join, basename } from 'node:path';
import { PlaywrightSession } from '../lib/playwright-session.js';
import { ensureArtifactsDir } from '../lib/artifacts.js';
import { registerExploreEntry, type ExploreEntry } from '../lib/explore-registry.js';
import { saveSiteProfile } from '../lib/site-profile.js';
import { updateWebsiteProfile, profileFileFor } from '../lib/website-profile.js';
import { isRedirectedToLogin } from '../lib/login-page.js';
import { Config, resolveProfile, httpCredentialsFor } from '../config.js';

export interface ExploreOptions {
  url: string;
  depth?: number;
  screenshot?: boolean;
  headed?: boolean;
  profile?: string;
  config: Config;
  /**
   * Expanded (interactive) exploration: after loading the page, click every
   * reveal-style control ("List additional actions", "Toggle Actions",
   * dropbuttons, closed tabs, collapsed <details>) so the components hidden
   * behind droplists are captured in the snapshot. Used when a plan/prompt
   * needs elements that are not in the DOM until a droplist is opened.
   */
  expanded?: boolean;
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
      httpCredentials: httpCredentialsFor(opts.config),
    });
    console.log(chalk.green('Browser opened'));

    const pageInfo = await session.getPageInfo();

    // If the profile is not authenticated, the site redirects to the CAS/SSO
    // login page. Abort instead of snapshotting the login page — otherwise the
    // plan/generate pipeline would generate tests for login-page elements.
    if (pageInfo.url && isRedirectedToLogin(opts.url, pageInfo.url)) {
      console.error(chalk.red(`\n✗ Redirected to a login/SSO page (not ${opts.url}):`));
      console.error(chalk.red(`  ${pageInfo.url}`));
      console.error(chalk.yellow('\n  The browser profile is not authenticated for this site.'));
      console.error(chalk.yellow('  Run `import-session --capture --url <site>` and complete the login'));
      console.error(chalk.yellow('  via noVNC (http://localhost:6080/vnc.html), or import host cookies with'));
      console.error(chalk.yellow('  `import-session --cookies <file> --url <site>`.\n'));
      throw new Error(`unauthenticated: redirected to login page ${pageInfo.url}`);
    }

    await session.prepareForExploration();

    if (opts.expanded) {
      console.log(chalk.gray('  Expanded exploration — interacting with droplists/tabs to reveal hidden components...'));
      await session.expandReveals();
      console.log(chalk.gray('  Reveal controls expanded.'));
    }

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

    // Regenerate site profile
    const profilePath = saveSiteProfile(opts.config.outputDir);
    if (profilePath) {
      console.log(chalk.gray(`  Site profile: ${profilePath}`));
    }

    console.log(chalk.green('\nExploration complete\n'));

    return { entry, snapshotPath };
  } finally {
    // Always close the browser so a failed/aborted run never leaves a
    // Chromium process holding the profile lock for the next run.
    await session.close();
  }
}
