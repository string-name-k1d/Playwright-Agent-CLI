import chalk from 'chalk';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { URL } from 'node:url';
import { join } from 'node:path';
import { mkdirSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { chromium } from 'playwright';
import { Config, httpCredentialsFor } from '../config.js';

const execFileAsync = promisify(execFile);

export interface LoginOptions {
  url?: string;
  user?: string;
  uli?: string;
  drushCmd?: string;
  headed?: boolean;
  profile: string;
  config: Config;
}

function rewriteUliHost(uli: string, targetUrl: string): string {
  try {
    const uliUrl = new URL(uli);
    const target = new URL(targetUrl);
    if (uliUrl.hostname === 'default' || uliUrl.hostname === 'localhost') {
      uliUrl.hostname = target.hostname;
      if (target.port) uliUrl.port = target.port;
      uliUrl.protocol = target.protocol;
      return uliUrl.toString();
    }
  } catch {}
  return uli;
}

async function generateUli(url: string, user: string, drushCmd: string): Promise<string> {
  const parts = drushCmd.split(/\s+/);
  const cmd = parts[0];
  const cmdArgs = parts.slice(1);

  const args = [...cmdArgs, 'uli', user, `--uri=${url}`, '--no-browser', '--raw'];
  console.log(chalk.gray(`  Running: ${cmd} ${args.join(' ')}`));

  try {
    const { stdout, stderr } = await execFileAsync(cmd, args, {
      timeout: 30000,
    });
    const output = (stdout + stderr).trim();
    const urlMatch = output.match(/(https?:\/\/\S+)/);
    if (urlMatch) return urlMatch[1];
    throw new Error(`No URL found in drush output: ${output}`);
  } catch (err: any) {
    throw new Error(`drush uli failed: ${err.message}`);
  }
}

export async function loginCommand(opts: LoginOptions): Promise<void> {
  console.log(chalk.bold('\n═══════════════════════════════════════════════'));
  console.log(chalk.bold('  pw-cli-agent · login'));
  console.log(chalk.bold('═══════════════════════════════════════════════\n'));

  const targetUrl = opts.url ?? opts.config.targetUrl;
  if (!targetUrl) {
    console.error(chalk.red('Error: --url is required (or set TARGET_URL in .env)'));
    process.exit(1);
  }

  let loginUrl: string;

  if (opts.uli) {
    loginUrl = rewriteUliHost(opts.uli, targetUrl);
    console.log(chalk.cyan(`Using provided ULI: ${loginUrl}`));
  } else if (opts.user) {
    const drushCmd = opts.drushCmd?.trim();
    if (!drushCmd) {
      console.error(chalk.red('Error: --drush-cmd is required when using --user'));
      console.error(chalk.gray('Example: --drush-cmd "docker exec <container> drush"'));
      process.exit(1);
    }
    console.log(chalk.cyan(`Generating one-time login for user: ${opts.user}`));
    const rawUli = await generateUli(targetUrl, opts.user, drushCmd);
    loginUrl = rewriteUliHost(rawUli, targetUrl);
    console.log(chalk.green(`  ✓ ULI generated: ${loginUrl}`));
  } else {
    console.error(chalk.red('Error: --user or --uli is required'));
    process.exit(1);
  }

  // Ensure profile directory exists
  const absProfile = opts.profile.startsWith('/') ? opts.profile : join(process.cwd(), opts.profile);
  mkdirSync(absProfile, { recursive: true });

  // Use Playwright API directly — same approach as auto_playwright
  console.log(chalk.cyan('\nLaunching browser and authenticating...'));
  const creds = httpCredentialsFor(opts.config);
  let context;
  try {
    // Clear stale Chrome lock files and disable the singleton handoff so a
    // previously killed/crashed browser never blocks this launch. rmSync
    // directly (no existsSync guard) so broken SingletonLock symlinks from
    // older containers are removed too.
    try {
      for (const f of ['SingletonLock', 'SingletonSocket', 'SingletonCookie']) {
        rmSync(join(absProfile, f), { force: true });
      }
    } catch {}
    context = await chromium.launchPersistentContext(absProfile, {
      headless: !opts.headed,
      args: ['--no-sandbox', '--disable-gpu', '--no-singleton'],
      ignoreHTTPSErrors: true,
      ...(creds ? { httpCredentials: creds } : {}),
    });

    const page = context.pages()[0] || await context.newPage();

    // Navigate to ULI — auto-authenticates via one-time login token
    await page.goto(loginUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(3000); // Wait for redirect chain to complete

    const currentUrl = page.url;
    const title = await page.title();
    console.log(chalk.gray(`  URL: ${currentUrl}`));
    console.log(chalk.gray(`  Title: ${title}`));

    // Take verification screenshot
    const screenshotPath = join(absProfile, 'login.png');
    await page.screenshot({ path: screenshotPath, fullPage: true }).catch(() => {});
    console.log(chalk.green('  ✓ Screenshot saved'));

    // Save storageState JSON — the critical part
    const statePath = join(absProfile, 'state.json');
    await context.storageState({ path: statePath });
    console.log(chalk.green(`  ✓ StorageState saved: ${statePath}`));

    // Verify cookies were captured
    const state = JSON.parse(readFileSync(statePath, 'utf-8'));
    const cookieCount = state.cookies?.length ?? 0;
    console.log(chalk.gray(`  Cookies: ${cookieCount}`));
    if (cookieCount === 0) {
      console.log(chalk.yellow('  ⚠ No cookies captured — login may have failed'));
    }
  } catch (err: any) {
    console.error(chalk.red(`Login failed: ${err.message}`));
    process.exit(1);
  } finally {
    if (context) await context.close();
  }

  console.log(chalk.green.bold(`\n✓ Login complete`));
  console.log(chalk.gray(`  Profile: ${absProfile}`));
  console.log(chalk.gray(`  StorageState: ${join(absProfile, 'state.json')}`));
  console.log(chalk.gray(`  Use --profile ${opts.profile} with other commands to reuse this session\n`));
}
