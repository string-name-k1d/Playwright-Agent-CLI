import chalk from 'chalk';
import { pwVersion } from '../lib/pw-cli.js';
import { PlaywrightSession } from '../lib/playwright-session.js';
import { opencodeVersion } from '../lib/opencode.js';
import { looksLikeLoginPage } from '../lib/login-page.js';
import { resolveProfile, httpCredentialsFor } from '../config.js';

export interface CheckOptions {
  url?: string;
  screenshot?: boolean;
  profile?: string;
  config?: import('../config.js').Config;
}

export async function checkCommand(opts: CheckOptions): Promise<void> {
  console.log(chalk.bold('\nEnvironment Check\n'));

  let allPassed = true;

  console.log(chalk.cyan('Checking playwright-cli...'));
  try {
    const version = await pwVersion();
    if (version) {
      console.log(chalk.green(`  ✓ playwright-cli found: ${version}`));
    } else {
      console.log(chalk.red('  ✗ playwright-cli not found'));
      allPassed = false;
    }
  } catch {
    console.log(chalk.red('  ✗ playwright-cli not found — install with: npm install -g @playwright/cli@latest'));
    allPassed = false;
  }

  console.log(chalk.cyan('Checking opencode...'));
  const oc = await opencodeVersion();
  if (oc.available) {
    const modeLabel = oc.mode === 'http' ? ' (HTTP server)' : ' (CLI)';
    console.log(chalk.green(`  ✓ opencode found: ${oc.version}${modeLabel}`));
  } else {
    if (oc.mode === 'http') {
      console.log(chalk.red('  ✗ opencode server unreachable — leave OPENCODE_SERVER_URL empty to use the local CLI mode (opencode serve is currently broken: "Unexpected error / ServeError")'));
    } else {
      console.log(chalk.red('  ✗ opencode not found — install with: npm install -g opencode-ai'));
    }
    allPassed = false;
  }

  if (opts.url) {
    const profile = resolveProfile(opts.profile, opts.config);
    console.log(chalk.cyan(`Checking site: ${opts.url}`));
    if (profile) {
      console.log(chalk.gray(`  Using browser profile: ${profile}`));
    }
    const creds = httpCredentialsFor(opts.config);
    const session = new PlaywrightSession();
    try {
      await session.launch(opts.url, {
        profile,
        headless: !(opts.config?.headed ?? false),
        ...(creds ? { httpCredentials: creds } : {}),
      });
      const info = await session.getPageInfo();
      console.log(chalk.green(`  ✓ Site loaded successfully${info.url ? ` (${info.url})` : ''}`));
      if (info.title) console.log(chalk.gray(`  Title: ${info.title}`));

      if (info.url && looksLikeLoginPage(info.url)) {
        console.log(chalk.yellow('  ⚠ Loaded page is a login/SSO page — the browser profile is not authenticated for this site.'));
        console.log(chalk.yellow('    Run `import-session --capture --url <site>` (complete the login via noVNC) or import host cookies with `import-session --cookies <file>`.'));
      }

      const snap = await session.getAccessibilitySnapshot().catch(() => '');
      if (snap && snap.trim().length > 0) {
        console.log(chalk.green('  ✓ Snapshot captured'));
      } else {
        console.log(chalk.yellow('  ⚠ Snapshot failed but site loaded'));
      }

      if (opts.screenshot) {
        const path = await session.screenshot(`check-${Date.now()}.png`);
        console.log(chalk.green(`  ✓ Screenshot saved: ${path}`));
      }
    } catch (err: any) {
      console.log(chalk.red(`  ✗ Failed to load site: ${err.message}`));
      allPassed = false;
    } finally {
      await session.close();
    }
  }

  console.log(allPassed
    ? chalk.green.bold('\nAll checks passed ✓\n')
    : chalk.red.bold('\nSome checks failed ✗\n'));

  process.exit(allPassed ? 0 : 1);
}
