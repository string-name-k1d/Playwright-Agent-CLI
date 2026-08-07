import chalk from 'chalk';
import { mkdirSync, readFileSync, existsSync, statSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { Config, httpCredentialsFor } from '../config.js';
import { looksLikeLoginPage } from '../lib/login-page.js';

export interface ImportSessionOptions {
  cookiesFile?: string;
  capture?: boolean;
  url?: string;
  headed?: boolean;
  profile: string;
  config: Config;
}

interface RawCookie {
  name: string;
  value: string;
  domain: string;
  path?: string;
  expires?: number;
  expirationDate?: number;
  httpOnly?: boolean;
  secure?: boolean;
  sameSite?: string;
}

interface NormalizedCookie {
  name: string;
  value: string;
  domain: string;
  path: string;
  expires?: number;
  httpOnly: boolean;
  secure: boolean;
  sameSite: 'Strict' | 'Lax' | 'None';
}

/**
 * Drupal session cookies: `SESS<hash>` on plain HTTP and `SSESS<hash>` on
 * HTTPS (which this UAT site uses). Match both.
 */
function isDrupalSessionCookie(c: { name: string }): boolean {
  return c.name.startsWith('SESS') || c.name.startsWith('SSESS');
}

function normalizeSameSite(value?: string): 'Strict' | 'Lax' | 'None' {
  const v = (value ?? '').toLowerCase();
  if (v === 'no_restriction') return 'None';
  if (v === 'strict') return 'Strict';
  if (v === 'none') return 'None';
  return 'Lax';
}

/**
 * Accepts a Cookie-Editor style JSON export (array of cookie objects with
 * `expirationDate`/`hostOnly`/`session`) or a Playwright storageState file
 * (object with a `cookies` array using `expires`).
 */
function parseCookies(content: string): RawCookie[] {
  const parsed = JSON.parse(content);
  const list: RawCookie[] = Array.isArray(parsed) ? parsed : Array.isArray(parsed?.cookies) ? parsed.cookies : [];
  return list.filter(c => c.name && c.domain);
}

function normalizeCookies(raw: RawCookie[]): NormalizedCookie[] {
  const out: NormalizedCookie[] = [];
  for (const c of raw) {
    const domain = typeof c.domain === 'string' && c.domain.startsWith('.') ? c.domain.slice(1) : c.domain;
    let expires = c.expires ?? c.expirationDate;
    if (expires === undefined || expires <= 0) expires = undefined;
    if (expires !== undefined && expires < Math.floor(Date.now() / 1000)) continue;
    out.push({
      name: c.name,
      value: c.value,
      domain,
      path: c.path || '/',
      expires,
      httpOnly: !!c.httpOnly,
      secure: !!c.secure,
      sameSite: normalizeSameSite(c.sameSite),
    });
  }
  return out;
}

export async function importSessionCommand(opts: ImportSessionOptions): Promise<void> {
  console.log(chalk.bold('\n═══════════════════════════════════════════════'));
  console.log(chalk.bold('  pw-cli-agent · import-session'));
  console.log(chalk.bold('═══════════════════════════════════════════════\n'));

  if (!opts.cookiesFile && !opts.capture) {
    console.error(chalk.red('Error: specify --cookies <file> to import an exported session, or --capture to log in interactively'));
    process.exit(1);
  }

  const targetUrl = opts.url ?? opts.config.targetUrl;
  if (!targetUrl) {
    console.error(chalk.red('Error: --url is required (or set TARGET_URL in .env)'));
    process.exit(1);
  }

  const absProfile = opts.profile.startsWith('/') ? opts.profile : join(process.cwd(), opts.profile);
  mkdirSync(absProfile, { recursive: true });

  let cookies: NormalizedCookie[] = [];
  if (opts.cookiesFile) {
    const absFile = opts.cookiesFile.startsWith('/') ? opts.cookiesFile : join(process.cwd(), opts.cookiesFile);
    if (!existsSync(absFile)) {
      console.error(chalk.red(`Error: cookies file not found: ${absFile}`));
      process.exit(1);
    }
    try {
      cookies = normalizeCookies(parseCookies(readFileSync(absFile, 'utf-8')));
    } catch (err: any) {
      console.error(chalk.red(`Error: failed to parse cookies file: ${err.message}`));
      process.exit(1);
    }
    if (cookies.length === 0) {
      console.error(chalk.red('Error: no usable cookies found in the export (expected an array of {name, value, domain, ...})'));
      process.exit(1);
    }
    const targetHost = new URL(targetUrl).hostname;
    const hostCookies = cookies.filter(c => c.domain === targetHost || c.domain.endsWith('.' + targetHost));
    console.log(chalk.cyan(`  Cookies loaded: ${cookies.length} (${hostCookies.length} for ${targetHost})`));
  }

  const creds = httpCredentialsFor(opts.config);
  const headed = opts.headed ?? opts.capture ?? false;

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
      headless: !headed,
      args: ['--no-sandbox', '--disable-gpu', '--enable-unsafe-swiftshader', '--no-singleton'],
      ignoreHTTPSErrors: true,
      ...(creds ? { httpCredentials: creds } : {}),
    });

    if (opts.cookiesFile) {
      await context.addCookies(cookies);
      console.log(chalk.green('  ✓ Cookies injected into browser profile'));
    }

    const page = context.pages()[0] || await context.newPage();

    if (opts.capture) {
      console.log(chalk.cyan(`\n  Open the browser at http://localhost:6080/vnc.html and log in.`));
      console.log(chalk.cyan('  This session will be saved as soon as an authenticated page is detected.'));
      console.log(chalk.cyan(`  (Target: ${targetUrl})\n`));
    }

    await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForTimeout(2000);

    const targetHost = new URL(targetUrl).hostname;
    const deadline = Date.now() + (opts.capture ? 900000 : 15000);
    let authed = false;
    let lastStatus = 0;
    while (Date.now() < deadline) {
      if (opts.capture) {
        const hostCookies = (await context.cookies()).filter(c => c.domain === targetHost || c.domain.endsWith('.' + targetHost));
        if (hostCookies.some(isDrupalSessionCookie)) {
          authed = true;
          break;
        }
        const now = Date.now();
        if (now - lastStatus >= 15000) {
          lastStatus = now;
          let t = '';
          try { t = await page.title(); } catch {}
          console.log(chalk.gray(`  waiting… ${page.url()}${t ? ` — ${t}` : ''}`));
        }
        await page.waitForTimeout(2000);
        continue;
      }
      if (!looksLikeLoginPage(page.url())) authed = true;
      break;
    }

    const finalUrl = page.url();
    let title = '';
    try { title = await page.title(); } catch {}
    console.log(chalk.gray(`  URL: ${finalUrl}`));
    console.log(chalk.gray(`  Title: ${title}`));

    const sessionCookies = (await context.cookies()).filter(c => c.domain === targetHost || c.domain.endsWith('.' + targetHost));
    const sessCookie = sessionCookies.find(isDrupalSessionCookie);

    if (opts.capture && !authed) {
      console.error(chalk.red('\n  Session not detected as authenticated within the 15-minute window.'));
      console.error(chalk.red('  Closing the browser — run again when ready to retry the login/2FA flow.'));
      process.exit(1);
    }

    const statePath = join(absProfile, 'state.json');
    await context.storageState({ path: statePath });
    console.log(chalk.green(`  ✓ StorageState saved: ${statePath}`));
    console.log(chalk.gray(`  Cookies: ${sessionCookies.length} on ${targetHost}`));

    if (sessCookie) {
      console.log(chalk.green(`  ✓ Found Drupal session cookie (${sessCookie.name}) — session appears active`));
    } else if (looksLikeLoginPage(finalUrl)) {
      console.log(chalk.yellow('  ⚠ Page looks like a login page — the session may not be authenticated yet.'));
    } else {
      console.log(chalk.yellow('  ⚠ No Drupal SESS/SSESS cookie found on the target host — double-check the export includes cookies for this site.'));
    }

    if (!existsSync(statePath)) {
      // keep directory listing meaningful
    } else {
      const size = statSync(statePath).size;
      console.log(chalk.gray(`  state.json: ${size} bytes`));
    }

    console.log(chalk.gray('\n  Other commands auto-detect ./auth-profile — no --profile needed.'));
    console.log(chalk.gray('  Verify with: pw-cli-agent check --url <target>\n'));
  } catch (err: any) {
    console.error(chalk.red(`Import failed: ${err.message}`));
    process.exit(1);
  } finally {
    if (context) await context.close();
  }

  console.log(chalk.green.bold('\n✓ Session imported\n'));
}
