import * as readline from 'node:readline';
import chalk from 'chalk';
import { existsSync, mkdirSync, copyFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pwOpen, pwSnapshot, pwClose, pwGoto, pwClick, pwFill, pwScreenshot, parseSnapshotPageInfo } from '../lib/pw-cli.js';
import { ensureArtifactsDir } from '../lib/artifacts.js';
import { registerExploreEntry, type ExploreEntry } from '../lib/explore-registry.js';
import { saveSiteProfile } from '../lib/site-profile.js';
import { parseSnapshotElements } from '../lib/snapshot-parser.js';
import { Config, resolveProfile } from '../config.js';

export interface GuideOptions {
  url?: string;
  headed?: boolean;
  profile?: string;
  config: Config;
}

interface SessionStep {
  action: string;
  detail: string;
  url: string;
  title: string;
  timestamp: string;
  elementCount: number;
}

function printCommands(): void {
  console.log(chalk.bold('\nCommands:'));
  console.log(chalk.cyan('  go <url>           ') + chalk.gray('Navigate to URL'));
  console.log(chalk.cyan('  click <ref>        ') + chalk.gray('Click element by ref (e.g. click e5)'));
  console.log(chalk.cyan('  fill <ref> <text>  ') + chalk.gray('Fill input field'));
  console.log(chalk.cyan('  snap               ') + chalk.gray('Take & save snapshot'));
  console.log(chalk.cyan('  screenshot         ') + chalk.gray('Capture PNG screenshot'));
  console.log(chalk.cyan('  ls                 ') + chalk.gray('Show page elements'));
  console.log(chalk.cyan('  links              ') + chalk.gray('Show all links'));
  console.log(chalk.cyan('  history            ') + chalk.gray('Show browsing history'));
  console.log(chalk.cyan('  annotate <text>    ') + chalk.gray('Add annotation note'));
  console.log(chalk.cyan('  done               ') + chalk.gray('Finish session & save profile'));
  console.log(chalk.cyan('  help               ') + chalk.gray('Show this help'));
  console.log('');
}

function showElements(snapshot: string): void {
  const parsed = parseSnapshotElements(snapshot);

  if (parsed.links.length > 0) {
    console.log(chalk.bold('\n  Links:'));
    for (const l of parsed.links.slice(0, 20)) {
      console.log(chalk.gray(`    [${l.ref}] ${l.name} → ${l.url}`));
    }
  }
  if (parsed.buttons.length > 0) {
    console.log(chalk.bold('\n  Buttons:'));
    for (const b of parsed.buttons.slice(0, 15)) {
      console.log(chalk.gray(`    [${b.ref}] ${b.name}`));
    }
  }
  if (parsed.inputs.length > 0) {
    console.log(chalk.bold('\n  Inputs:'));
    for (const i of parsed.inputs.slice(0, 15)) {
      console.log(chalk.gray(`    [${i.ref}] ${i.name} (${i.role})`));
    }
  }
  if (parsed.headings.length > 0) {
    console.log(chalk.bold('\n  Headings:'));
    for (const h of parsed.headings.slice(0, 10)) {
      console.log(chalk.gray(`    ${'  '.repeat(Math.max(0, h.level - 1))}h${h.level}: ${h.name}`));
    }
  }
}

function showLinks(snapshot: string): void {
  const parsed = parseSnapshotElements(snapshot);
  if (parsed.links.length === 0) {
    console.log(chalk.gray('  No links found.'));
    return;
  }
  console.log(chalk.bold('\n  Links:'));
  for (const l of parsed.links) {
    console.log(chalk.gray(`    [${l.ref}] ${l.name}`));
    console.log(chalk.gray(`           → ${l.url}`));
  }
  console.log('');
}

export async function guideCommand(opts: GuideOptions): Promise<void> {
  ensureArtifactsDir(opts.config.outputDir);

  const profile = resolveProfile(opts.profile, opts.config);
  const url = opts.url ?? opts.config.targetUrl;

  if (!url) {
    console.error(chalk.red('Error: --url is required (or set TARGET_URL in .env)'));
    process.exit(1);
  }

  console.log(chalk.bold('\n═══════════════════════════════════════════════'));
  console.log(chalk.bold('  pw-cli-agent · guided browsing session'));
  console.log(chalk.bold('═══════════════════════════════════════════════\n'));
  console.log(chalk.gray(`  URL:     ${url}`));
  console.log(chalk.gray(`  Profile: ${profile ?? 'none'}\n`));

  // Guide requires a visible browser — check for display
  const hasDisplay = !!process.env.DISPLAY || !!process.env.WAYLAND_DISPLAY;
  if (!hasDisplay) {
    console.error(chalk.red('Error: Guided browsing requires a display server (X11/Wayland).'));
    console.error(chalk.red(''));
    console.error(chalk.red('No DISPLAY or WAYLAND_DISPLAY environment variable is set.'));
    console.error(chalk.red(''));
    console.error(chalk.red('To fix this:'));
    console.error(chalk.red('  Docker:  Run with xvfb-run, or add to docker-compose:'));
    console.error(chalk.red('             environment: [DISPLAY=:99]'));
    console.error(chalk.red('           and start Xvfb: Xvfb :99 -screen 0 1280x1024x24 &'));
    console.error(chalk.red('  Linux:   export DISPLAY=:0'));
    console.error(chalk.red('  WSL:     Use an X server like VcXsrv or WSLg'));
    process.exit(1);
  }

  // Open browser — always headed for interactive guide, no persistent (we manage the session)
  console.log(chalk.cyan('Opening browser...'));
  const openResult = await pwOpen(url, {
    headed: true,
    cliPath: opts.config.playwrightCliPath,
    profile,
    persistent: false,
  });

  if (openResult.exitCode !== 0) {
    console.error(chalk.red(`Failed to open browser: ${openResult.stderr}`));
    process.exit(1);
  }

  console.log(chalk.green('Browser opened (headed mode)\n'));

  // Wait for browser to fully initialize and page to load
  await new Promise(r => setTimeout(r, 2000));

  // Take initial snapshot
  const snapFilename = `explore-${Date.now()}.yaml`;
  const snapResult = await pwSnapshot(snapFilename, {
    depth: opts.config.snapshotDepth,
    cliPath: opts.config.playwrightCliPath,
  });

  let currentSnapshot = snapResult.exitCode === 0 ? snapResult.stdout : '';
  const pageInfo = parseSnapshotPageInfo(snapResult.stdout);
  let currentUrl = pageInfo.url ?? url;
  let currentTitle = pageInfo.title ?? 'Untitled';

  console.log(chalk.green(`Page: ${currentTitle}`));
  console.log(chalk.gray(`URL:  ${currentUrl}\n`));

  // Register initial page in registry
  const destDir = join(opts.config.outputDir, 'explore');
  if (!existsSync(destDir)) mkdirSync(destDir, { recursive: true });
  const destPath = join(destDir, snapFilename);

  // Copy snapshot file
  try {
    const pwCliDir = join(process.cwd(), '.playwright-cli');
    const ymlFiles = readdirSync(pwCliDir)
      .filter(f => f.endsWith('.yml') && f.startsWith('page-'))
      .map(f => ({ name: f, time: statSync(join(pwCliDir, f)).mtimeMs }))
      .sort((a, b) => b.time - a.time);
    if (ymlFiles.length > 0) {
      copyFileSync(join(pwCliDir, ymlFiles[0].name), destPath);
    }
  } catch {}

  const initialEntry = registerExploreEntry(currentUrl, currentTitle, destPath, snapFilename, opts.config.outputDir);

  const steps: SessionStep[] = [{
    action: 'navigate',
    detail: url,
    url: currentUrl,
    title: currentTitle,
    timestamp: new Date().toISOString(),
    elementCount: initialEntry.elementCount,
  }];

  // Show elements on initial page
  if (currentSnapshot) showElements(currentSnapshot);

  // Interactive loop
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const prompt = () => new Promise<string>(resolve => rl.question(chalk.cyan('guide> '), resolve));

  let running = true;
  while (running) {
    const input = (await prompt()).trim();
    if (!input) continue;

    const parts = input.split(/\s+/);
    const cmd = parts[0].toLowerCase();
    const args = parts.slice(1);

    switch (cmd) {
      case 'go': {
        const targetUrl = args.join(' ');
        if (!targetUrl) {
          console.log(chalk.yellow('Usage: go <url>'));
          break;
        }
        // Resolve relative URLs
        let resolvedUrl = targetUrl;
        try {
          resolvedUrl = new URL(targetUrl, currentUrl).href;
        } catch {}

        console.log(chalk.gray(`  Navigating to ${resolvedUrl}...`));
        await pwGoto(resolvedUrl, { cliPath: opts.config.playwrightCliPath });
        await new Promise(r => setTimeout(r, 2000)); // wait for page load

        // Snapshot new page
        const newSnap = `explore-${Date.now()}.yaml`;
        const result = await pwSnapshot(newSnap, {
          depth: opts.config.snapshotDepth,
          cliPath: opts.config.playwrightCliPath,
        });

        if (result.exitCode === 0) {
          currentSnapshot = result.stdout;
          const info = parseSnapshotPageInfo(result.stdout);
          currentUrl = info.url ?? resolvedUrl;
          currentTitle = info.title ?? 'Untitled';

          // Save and register
          const newDest = join(destDir, newSnap);
          try {
            const pwCliDir = join(process.cwd(), '.playwright-cli');
            const ymlFiles = readdirSync(pwCliDir)
              .filter(f => f.endsWith('.yml') && f.startsWith('page-'))
              .map(f => ({ name: f, time: statSync(join(pwCliDir, f)).mtimeMs }))
              .sort((a, b) => b.time - a.time);
            if (ymlFiles.length > 0) {
              copyFileSync(join(pwCliDir, ymlFiles[0].name), newDest);
            }
          } catch {}

          const entry = registerExploreEntry(currentUrl, currentTitle, newDest, newSnap, opts.config.outputDir);

          steps.push({
            action: 'navigate',
            detail: targetUrl,
            url: currentUrl,
            title: currentTitle,
            timestamp: new Date().toISOString(),
            elementCount: entry.elementCount,
          });

          console.log(chalk.green(`Page: ${currentTitle}`));
          console.log(chalk.gray(`URL:  ${currentUrl}`));
          showElements(currentSnapshot);
        } else {
          console.log(chalk.red(`Snapshot failed: ${result.stderr}`));
        }
        break;
      }

      case 'click': {
        const ref = args[0];
        if (!ref) {
          console.log(chalk.yellow('Usage: click <ref> (e.g. click e5)'));
          break;
        }
        console.log(chalk.gray(`  Clicking [${ref}]...`));
        const clickResult = await pwClick(ref, { cliPath: opts.config.playwrightCliPath });
        if (clickResult.exitCode !== 0) {
          console.log(chalk.red(`  Click failed: ${clickResult.stderr}`));
          break;
        }
        await new Promise(r => setTimeout(r, 2000));

        // Snapshot after click
        const newSnap = `explore-${Date.now()}.yaml`;
        const result = await pwSnapshot(newSnap, {
          depth: opts.config.snapshotDepth,
          cliPath: opts.config.playwrightCliPath,
        });

        if (result.exitCode === 0) {
          const oldUrl = currentUrl;
          currentSnapshot = result.stdout;
          const info = parseSnapshotPageInfo(result.stdout);
          currentUrl = info.url ?? currentUrl;
          currentTitle = info.title ?? currentTitle;

          // Save and register if page changed
          const newDest = join(destDir, newSnap);
          try {

            const pwCliDir = join(process.cwd(), '.playwright-cli');
            const ymlFiles = readdirSync(pwCliDir)
              .filter(f => f.endsWith('.yml') && f.startsWith('page-'))
              .map(f => ({ name: f, time: statSync(join(pwCliDir, f)).mtimeMs }))
              .sort((a, b) => b.time - a.time);
            if (ymlFiles.length > 0) {
              copyFileSync(join(pwCliDir, ymlFiles[0].name), newDest);
            }
          } catch {}

          const entry = registerExploreEntry(currentUrl, currentTitle, newDest, newSnap, opts.config.outputDir);

          steps.push({
            action: 'click',
            detail: `[${ref}]`,
            url: currentUrl,
            title: currentTitle,
            timestamp: new Date().toISOString(),
            elementCount: entry.elementCount,
          });

          const changed = currentUrl !== oldUrl;
          console.log(chalk.green(`${changed ? 'Navigated to' : 'Clicked on'}: ${currentTitle}`));
          console.log(chalk.gray(`URL: ${currentUrl}`));
          showElements(currentSnapshot);
        }
        break;
      }

      case 'fill': {
        const ref = args[0];
        const text = args.slice(1).join(' ');
        if (!ref || !text) {
          console.log(chalk.yellow('Usage: fill <ref> <text>'));
          break;
        }
        console.log(chalk.gray(`  Filling [${ref}] with "${text}"...`));
        const fillResult = await pwFill(ref, text, { cliPath: opts.config.playwrightCliPath });
        if (fillResult.exitCode !== 0) {
          console.log(chalk.red(`  Fill failed: ${fillResult.stderr}`));
        } else {
          console.log(chalk.green('  Filled.'));
          steps.push({
            action: 'fill',
            detail: `[${ref}] = "${text}"`,
            url: currentUrl,
            title: currentTitle,
            timestamp: new Date().toISOString(),
            elementCount: 0,
          });
        }
        break;
      }

      case 'snap': {
        const newSnap = `explore-${Date.now()}.yaml`;
        const result = await pwSnapshot(newSnap, {
          depth: opts.config.snapshotDepth,
          cliPath: opts.config.playwrightCliPath,
        });
        if (result.exitCode === 0) {
          currentSnapshot = result.stdout;
          const info = parseSnapshotPageInfo(result.stdout);
          currentUrl = info.url ?? currentUrl;
          currentTitle = info.title ?? currentTitle;

          const newDest = join(destDir, newSnap);
          try {

            const pwCliDir = join(process.cwd(), '.playwright-cli');
            const ymlFiles = readdirSync(pwCliDir)
              .filter(f => f.endsWith('.yml') && f.startsWith('page-'))
              .map(f => ({ name: f, time: statSync(join(pwCliDir, f)).mtimeMs }))
              .sort((a, b) => b.time - a.time);
            if (ymlFiles.length > 0) {
              copyFileSync(join(pwCliDir, ymlFiles[0].name), newDest);
            }
          } catch {}

          registerExploreEntry(currentUrl, currentTitle, newDest, newSnap, opts.config.outputDir);

          steps.push({
            action: 'snapshot',
            detail: 'manual snapshot',
            url: currentUrl,
            title: currentTitle,
            timestamp: new Date().toISOString(),
            elementCount: 0,
          });

          console.log(chalk.green(`Snapshot saved: ${newSnap}`));
          showElements(currentSnapshot);
        } else {
          console.log(chalk.red(`Snapshot failed: ${result.stderr}`));
        }
        break;
      }

      case 'screenshot': {
        const imgFilename = `explore-${Date.now()}.png`;
        const result = await pwScreenshot(imgFilename, { cliPath: opts.config.playwrightCliPath });
        if (result.exitCode === 0) {
          console.log(chalk.green(`Screenshot saved: ${imgFilename}`));
        } else {
          console.log(chalk.red(`Screenshot failed: ${result.stderr}`));
        }
        break;
      }

      case 'ls':
        if (currentSnapshot) {
          showElements(currentSnapshot);
        } else {
          console.log(chalk.gray('No snapshot available.'));
        }
        break;

      case 'links':
        if (currentSnapshot) {
          showLinks(currentSnapshot);
        } else {
          console.log(chalk.gray('No snapshot available.'));
        }
        break;

      case 'history': {
        console.log(chalk.bold('\n  Browsing History:'));
        for (let i = 0; i < steps.length; i++) {
          const s = steps[i];
          console.log(chalk.gray(`  ${i + 1}. [${s.action}] ${s.detail}`));
          console.log(chalk.gray(`     ${s.title} — ${s.url}`));
        }
        console.log('');
        break;
      }

      case 'annotate': {
        const note = args.join(' ');
        if (!note) {
          console.log(chalk.yellow('Usage: annotate <text>'));
          break;
        }
        steps.push({
          action: 'annotate',
          detail: note,
          url: currentUrl,
          title: currentTitle,
          timestamp: new Date().toISOString(),
          elementCount: 0,
        });
        console.log(chalk.green(`  Annotation added: "${note}"`));
        break;
      }

      case 'done':
        running = false;
        break;

      case 'help':
        printCommands();
        break;

      default:
        console.log(chalk.gray(`  Unknown command: ${cmd}. Type "help" for commands.`));
    }
  }

  rl.close();

  // Save session summary to a guided session file
  const sessionLines: string[] = [];
  sessionLines.push(`# Guided Browsing Session`);
  sessionLines.push('');
  sessionLines.push(`- **Started:** ${steps[0]?.timestamp ?? new Date().toISOString()}`);
  sessionLines.push(`- **Pages visited:** ${new Set(steps.map(s => s.url)).size}`);
  sessionLines.push(`- **Actions:** ${steps.length}`);
  sessionLines.push('');
  sessionLines.push(`## Steps`);
  sessionLines.push('');
  for (let i = 0; i < steps.length; i++) {
    const s = steps[i];
    sessionLines.push(`${i + 1}. **${s.action}** — ${s.detail}`);
    sessionLines.push(`   - Page: ${s.title}`);
    sessionLines.push(`   - URL: ${s.url}`);
    sessionLines.push('');
  }


  const sessionFile = join(opts.config.outputDir, `guided-session-${Date.now()}.md`);
  writeFileSync(sessionFile, sessionLines.join('\n'), 'utf-8');
  console.log(chalk.gray(`\nSession saved: ${sessionFile}`));

  // Regenerate site profile
  const profilePath = saveSiteProfile(opts.config.outputDir);
  if (profilePath) {
    console.log(chalk.gray(`Site profile updated: ${profilePath}`));
  }

  await pwClose({ cliPath: opts.config.playwrightCliPath });
  console.log(chalk.green('\nGuided session complete\n'));
}
