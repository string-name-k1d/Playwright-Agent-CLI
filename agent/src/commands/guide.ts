import * as readline from 'node:readline';
import chalk from 'chalk';
import { writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { PlaywrightSession } from '../lib/playwright-session.js';
import { ensureArtifactsDir, saveSnapshot } from '../lib/artifacts.js';
import { registerExploreEntry, type ExploreEntry } from '../lib/explore-registry.js';
import { saveSiteProfile } from '../lib/site-profile.js';
import { updateWebsiteProfile, loadWebsiteProfile, resolveElement } from '../lib/website-profile.js';
import { parseSnapshotElements } from '../lib/snapshot-parser.js';
import { Config, resolveProfile, httpCredentialsFor } from '../config.js';

export interface GuideOptions {
  url?: string;
  headed?: boolean;
  profile?: string;
  config: Config;
  repl?: boolean;
}

interface SessionStep {
  action: string;
  detail: string;
  url: string;
  title: string;
  timestamp: string;
  elementCount: number;
}

function updateProfile(entry: ExploreEntry, baseDir: string): void {
  try {
    updateWebsiteProfile(entry, baseDir);
  } catch {}
}

function printCommands(): void {
  console.log(chalk.bold('\nCommands:'));
  console.log(chalk.cyan('  go <url>           ') + chalk.gray('Navigate to URL'));
  console.log(chalk.cyan('  click <ref|text>   ') + chalk.gray('Click element (e.g. click e6, click "Button text")'));
  console.log(chalk.cyan('  fill <ref|text> <v>') + chalk.gray('Fill input (e.g. fill e5 "Hello")'));
  console.log(chalk.cyan('  snap               ') + chalk.gray('Take & save snapshot'));
  console.log(chalk.cyan('  screenshot         ') + chalk.gray('Capture PNG screenshot'));
  console.log(chalk.cyan('  ls                 ') + chalk.gray('Show page elements'));
  console.log(chalk.cyan('  links              ') + chalk.gray('Show all links'));
  console.log(chalk.cyan('  history            ') + chalk.gray('Show browsing history'));
  console.log(chalk.cyan('  annotate <text>    ') + chalk.gray('Add annotation note'));
  console.log(chalk.cyan('  done               ') + chalk.gray('Finish session & save profile'));
  console.log(chalk.cyan('  help               ') + chalk.gray('Show this help'));
  console.log(chalk.gray('\nTip: use [ref] tags like e6 from the snapshot to target elements precisely.'));
  console.log(chalk.gray('Use quotes for multi-word text: click "MTPC Administration"'));
  console.log('');
}

function indentDepth(line: string): number {
  return (line.match(/^ */)?.[0]?.length ?? 0) / 2;
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
      const val = i.value !== undefined ? ` = "${i.value}"` : '';
      console.log(chalk.gray(`    [${i.ref}] ${i.name} (${i.role})${val}`));
    }
  }
  if (parsed.headings.length > 0) {
    console.log(chalk.bold('\n  Headings:'));
    for (const h of parsed.headings.slice(0, 10)) {
      console.log(chalk.gray(`    ${'  '.repeat(Math.max(0, h.level - 1))}h${h.level}: ${h.name}`));
    }
  }
  if (parsed.cells.length > 0) {
    console.log(chalk.bold('\n  Table content:'));
    const lines = snapshot.split('\n');
    const rowGroups: Array<Array<{ ref: string; role: string; name: string; text: string[] }>> = [];
    let currentRow: { ref: string; role: string; name: string; text: string[] }[] = [];
    let prevRowLine = -1;
    for (const c of parsed.cells) {
      const cellIdx = lines.findIndex(l => l.includes(`[ref=${c.ref}]`));
      if (cellIdx === -1) continue;
      // Scan up to find the owning `- row` line index
      const cellDepth = indentDepth(lines[cellIdx]);
      let thisRowLine = -1;
      for (let k = cellIdx - 1; k >= 0; k--) {
        if (indentDepth(lines[k]) < cellDepth) {
          if (/^- row\b/.test(lines[k].trim())) thisRowLine = k;
          break;
        }
      }
      if (thisRowLine !== prevRowLine && currentRow.length > 0) {
        rowGroups.push(currentRow);
        currentRow = [];
      }
      prevRowLine = thisRowLine;
      // Collect child text (unique)
      const seen = new Set<string>();
      const text: string[] = [];
      for (let j = cellIdx + 1; j < Math.min(cellIdx + 8, lines.length); j++) {
        if (indentDepth(lines[j]) <= cellDepth) break;
        const textMatch = lines[j].match(/"([^"]+)"/);
        if (textMatch && !seen.has(textMatch[1])) {
          seen.add(textMatch[1]);
          text.push(textMatch[1]);
        }
      }
      currentRow.push({ ref: c.ref, role: c.role, name: c.name, text });
    }
    if (currentRow.length > 0) rowGroups.push(currentRow);

    for (const row of rowGroups.slice(0, 20)) {
      const rowText = row.map(c => {
        const parts = c.text.length > 0 ? c.text : (c.name ? [c.name] : []);
        return parts.join(', ');
      }).filter(Boolean);
      if (rowText.length > 0) {
        console.log(chalk.gray(`    ${rowText.join('  │  ')}`));
      }
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
  console.log(chalk.gray(`  Profile: ${profile ?? 'none'}`));
  if (!opts.repl) console.log(chalk.gray('  Mode:    codegen (page.pause)'));
  if (opts.repl) console.log(chalk.gray('  Mode:    REPL (manual commands)'));

  console.log('');
  if (!profile) {
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
  }

  console.log(chalk.cyan('Launching browser...'));
  const session = new PlaywrightSession();
  try {
    await session.launch(url, { profile, httpCredentials: httpCredentialsFor(opts.config) });
  } catch (err: any) {
    console.error(chalk.red(`Failed to launch browser: ${err.message}`));
    process.exit(1);
  }

  console.log(chalk.green('Browser opened (headed, in-process)\n'));

  const pageInfo = await session.getPageInfo();
  let currentYaml = await session.getAccessibilitySnapshot();
  let currentUrl = pageInfo.url || url;
  let currentTitle = pageInfo.title || 'Untitled';

  const destDir = join(opts.config.outputDir, 'explore');
  if (!existsSync(destDir)) mkdirSync(destDir, { recursive: true });

  const snapshotPath = await session.saveSnapshot(destDir);
  const initialEntry = registerExploreEntry(currentUrl, currentTitle, snapshotPath, snapshotPath.split(/[/\\]/).pop()!, opts.config.outputDir);
  updateProfile(initialEntry, opts.config.outputDir);

  const steps: SessionStep[] = [{
    action: 'navigate',
    detail: url,
    url: currentUrl,
    title: currentTitle,
    timestamp: new Date().toISOString(),
    elementCount: initialEntry.elementCount,
  }];

  console.log(chalk.green(`Page: ${currentTitle}`));
  console.log(chalk.gray(`URL:  ${currentUrl}\n`));
  if (currentYaml) showElements(currentYaml);

  if (!opts.repl) {
    console.log(chalk.cyan('\nOpening Playwright Inspector (codegen mode)...'));
    console.log(chalk.gray('  Interact with the page freely — the Inspector will record all actions.'));
    console.log(chalk.gray('  Close the Inspector or press Ctrl+C to finish the session.\n'));
    console.log(chalk.gray('  VNC:   http://localhost:6080/vnc.html (view browser window)\n'));

    try {
      if (session.currentPage) {
        await session.currentPage.pause();
      }
    } catch {}
    console.log(chalk.green('\nInspector closed. Saving session...\n'));

    // Wait for the page to finish loading after codegen closes
    try {
      const p = session.currentPage;
      if (p && !p.isClosed()) {
        await p.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
        await p.waitForTimeout(1000);
      }
    } catch {}

    // Update current page info from the actual page state
    const finalInfo = await session.getPageInfo();
    currentUrl = finalInfo.url || currentUrl;
    currentTitle = finalInfo.title || currentTitle;

    // Take a single snapshot of the current page
    try {
      const finalYaml = await session.getAccessibilitySnapshot();
      if (finalYaml) {
      const finalPath = await session.saveSnapshot(destDir);
      const finalEntry = registerExploreEntry(currentUrl, currentTitle, finalPath, finalPath.split(/[/\\]/).pop()!, opts.config.outputDir);
      updateProfile(finalEntry, opts.config.outputDir);
      currentYaml = finalYaml;
      }
    } catch (e: any) {
      console.log(chalk.yellow(`  Snapshot unavailable: ${e.message}`));
    }

    // Record page transitions as navigation steps from the Inspector session
    const seenUrls = new Set<string>();
    const initialUrl = url.replace(/\/+$/, '');
    for (const p of session.visitedPages) {
      const pageUrl = p.url.replace(/\/+$/, '');
      if (seenUrls.has(pageUrl)) continue;
      seenUrls.add(pageUrl);
      if (pageUrl === initialUrl) continue;
      steps.push({
        action: 'navigate',
        detail: p.url,
        url: p.url,
        title: p.title,
        timestamp: p.timestamp,
        elementCount: 0,
      });
    }
  } else {
    console.log(chalk.gray('  VNC:   http://localhost:6080/vnc.html (view browser window)\n'));

    // Custom argument parser: respects single and double quotes so
    // multi-word arguments like click "MTPC Administration" work correctly.
    // Returns [command, ...args] where each element is a single token or quoted string.
    function parseArgs(input: string): string[] {
      const output: string[] = [];
      let current = '';
      let inQuote: string | null = null;
      for (const ch of input.trim()) {
        if (inQuote) {
          if (ch === inQuote) { inQuote = null; continue; }
          current += ch;
        } else if (ch === '"' || ch === "'") {
          inQuote = ch;
        } else if (ch === ' ' || ch === '\t') {
          if (current) { output.push(current); current = ''; }
        } else {
          current += ch;
        }
      }
      if (current) output.push(current);
      return output;
    }

    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    const prompt = () => new Promise<string | null>(resolve => {
      try {
        rl.question(chalk.cyan('guide> '), resolve);
      } catch {
        resolve(null);
      }
    });

    let running = true;
    while (running) {
      const input = await prompt();
      if (input === null) break;

      const trimmed = input.trim();
      if (!trimmed) continue;

      const parts = parseArgs(trimmed);
      const cmd = parts[0]?.toLowerCase() || '';
      const args = parts.slice(1);

      switch (cmd) {
        case 'go': {
          const targetUrl = args.join(' ');
          if (!targetUrl) {
            console.log(chalk.yellow('Usage: go <url>'));
            break;
          }
          let resolvedUrl = targetUrl;
          try {
            resolvedUrl = new URL(targetUrl, currentUrl).href;
          } catch {}

          console.log(chalk.gray(`  Navigating to ${resolvedUrl}...`));
          await session.goto(resolvedUrl);

          currentYaml = await session.getAccessibilitySnapshot();
          const info = await session.getPageInfo();
          currentUrl = info.url || resolvedUrl;
          currentTitle = info.title || 'Untitled';

          const newPath = await session.saveSnapshot(destDir);
          const entry = registerExploreEntry(currentUrl, currentTitle, newPath, newPath.split(/[/\\]/).pop()!, opts.config.outputDir);
          updateProfile(entry, opts.config.outputDir);

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
          if (currentYaml) showElements(currentYaml);
          break;
        }

        case 'click': {
          const target = args[0];
          if (!target) {
            console.log(chalk.yellow('Usage: click <ref|text> (e.g. click e5 or click "Login")'));
            break;
          }

          console.log(chalk.gray(`  Clicking "${target}"...`));
          try {
            if (target.match(/^e\d+$/)) {
              const elements = parseSnapshotElements(currentYaml);
              const match = elements.elements.find(el => el.ref === target);
              if (!match) {
                console.log(chalk.red(`  Element [${target}] not found in snapshot.`));
                break;
              }
              const same = elements.elements.filter(e => e.role === match.role && e.name === match.name);
              const nth = same.length > 1 ? same.indexOf(match) : undefined;
              await session.clickElement(match, nth);
            } else {
              const elements = parseSnapshotElements(currentYaml);
              const clickableRoles = new Set(['button', 'link', 'checkbox', 'radio', 'menuitem', 'option', 'tab', 'treeitem', 'switch', 'combobox', 'listbox']);
              const matches = elements.elements.filter(el => el.name === target && clickableRoles.has(el.role));
              if (matches.length === 1) {
                await session.clickElement(matches[0]);
              } else if (matches.length > 1) {
                // Ambiguous in the fresh snapshot — try the website profile to disambiguate.
                const profile = loadWebsiteProfile(currentUrl, opts.config.outputDir);
                const profHits = profile ? resolveElement(profile, { name: target, url: currentUrl }) : [];
                if (profHits.length === 1) {
                  const m = profHits[0];
                  console.log(chalk.gray(`  [profile] [${m.ref}] ${m.role} "${m.name}" — ${m.path}`));
                  await session.clickElement({ ref: m.ref, role: m.role, name: m.name });
                } else {
                  console.log(chalk.yellow(`  Multiple elements named "${target}":`));
                  for (const m of matches) {
                    console.log(chalk.gray(`    [${m.ref}] ${m.role}: "${m.name}"`));
                  }
                  console.log(chalk.gray('  Use click with the [ref] tag instead.'));
                  break;
                }
              } else {
                await session.click(`text="${target}"`);
              }
            }
          } catch (err: any) {
            console.log(chalk.red(`  Click failed: ${err.message}`));
            break;
          }

          currentYaml = await session.getAccessibilitySnapshot();
          const info = await session.getPageInfo();
          const oldUrl = currentUrl;
          currentUrl = info.url || currentUrl;
          currentTitle = info.title || currentTitle;

          const newPath = await session.saveSnapshot(destDir);
          const entry = registerExploreEntry(currentUrl, currentTitle, newPath, newPath.split(/[/\\]/).pop()!, opts.config.outputDir);
          updateProfile(entry, opts.config.outputDir);

          steps.push({
            action: 'click',
            detail: target,
            url: currentUrl,
            title: currentTitle,
            timestamp: new Date().toISOString(),
            elementCount: entry.elementCount,
          });

          const changed = currentUrl !== oldUrl;
          console.log(chalk.green(`${changed ? 'Navigated to' : 'Clicked on'}: ${currentTitle}`));
          console.log(chalk.gray(`URL: ${currentUrl}`));
          if (currentYaml) showElements(currentYaml);
          break;
        }

        case 'fill': {
          const ref = args[0];
          const text = args.slice(1).join(' ');
          if (!ref || !text) {
            console.log(chalk.yellow('Usage: fill <ref|text> <value>'));
            break;
          }

          let selector: string;
          if (ref.match(/^e\d+$/)) {
            const elements = parseSnapshotElements(currentYaml);
            const match = elements.elements.find(el => el.ref === ref);
            if (!match) {
              console.log(chalk.red(`  Element [${ref}] not found in snapshot.`));
              break;
            }
            const role = match.role;
            const name = match.name;
            if (role && name) {
              selector = `[role="${role}"]:has-text("${name}")`;
            } else {
              selector = `input:has-text("${name || ref}")`;
            }
          } else {
            selector = `input:has-text("${ref}")`;
          }

          console.log(chalk.gray(`  Filling with "${text}"...`));
          try {
            await session.fill(selector, text);
            console.log(chalk.green('  Filled.'));
          } catch (err: any) {
            console.log(chalk.red(`  Fill failed: ${err.message}`));
            break;
          }

          steps.push({
            action: 'fill',
            detail: `${ref} = "${text}"`,
            url: currentUrl,
            title: currentTitle,
            timestamp: new Date().toISOString(),
            elementCount: 0,
          });
          break;
        }

        case 'snap': {
          currentYaml = await session.getAccessibilitySnapshot();
          const info = await session.getPageInfo();
          currentUrl = info.url || currentUrl;
          currentTitle = info.title || currentTitle;

          const newPath = await session.saveSnapshot(destDir);
          const snapEntry = registerExploreEntry(currentUrl, currentTitle, newPath, newPath.split(/[/\\]/).pop()!, opts.config.outputDir);
          updateProfile(snapEntry, opts.config.outputDir);

          steps.push({
            action: 'snapshot',
            detail: 'manual snapshot',
            url: currentUrl,
            title: currentTitle,
            timestamp: new Date().toISOString(),
            elementCount: 0,
          });

          const filename = newPath.split(/[/\\]/).pop();
          console.log(chalk.green(`Snapshot saved: ${filename}`));
          if (currentYaml) showElements(currentYaml);
          break;
        }

        case 'screenshot': {
          const filename = `screenshot-${Date.now()}.png`;
          const path = await session.screenshot(filename);
          console.log(chalk.green(`Screenshot saved: ${path}`));
          break;
        }

        case 'ls':
          if (currentYaml) {
            showElements(currentYaml);
          } else {
            console.log(chalk.gray('No snapshot available.'));
          }
          break;

        case 'links':
          if (currentYaml) {
            showLinks(currentYaml);
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
          console.log(chalk.yellow(`  Unknown command: ${cmd}. Type "help" for commands.`));
      }
    }
    rl.close();
  }

  const pageInfoFinal = await session.getPageInfo();
  currentUrl = pageInfoFinal.url || currentUrl;
  currentTitle = pageInfoFinal.title || currentTitle;

  try {
    const finalYaml = await session.getAccessibilitySnapshot();
    if (finalYaml) {
      const finalPath = await session.saveSnapshot(destDir);
      const finalEntry2 = registerExploreEntry(currentUrl, currentTitle, finalPath, finalPath.split(/[/\\]/).pop()!, opts.config.outputDir);
      updateProfile(finalEntry2, opts.config.outputDir);
    }
  } catch {}

  const sessionLines: string[] = [];
  sessionLines.push(`# Guided Browsing Session`);
  sessionLines.push('');
  sessionLines.push(`- **Started:** ${steps[0]?.timestamp ?? new Date().toISOString()}`);
  const uniqueUrls = new Set(session.visitedPages.map(p => p.url));
  steps.forEach(s => uniqueUrls.add(s.url));
  sessionLines.push(`- **Pages visited:** ${uniqueUrls.size}`);
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
  if (session.visitedPages.length > 0) {
    sessionLines.push(`## Auto-Tracked Pages`);
    sessionLines.push('');
    for (const p of session.visitedPages) {
      sessionLines.push(`- ${p.title} — ${p.url}`);
    }
    sessionLines.push('');
  }

  const sessionFile = join(opts.config.outputDir, `guided-session-${Date.now()}.md`);
  writeFileSync(sessionFile, sessionLines.join('\n'), 'utf-8');
  console.log(chalk.gray(`\nSession saved: ${sessionFile}`));

  const profilePath = saveSiteProfile(opts.config.outputDir);
  if (profilePath) {
    console.log(chalk.gray(`Site profile updated: ${profilePath}`));
  }

  await session.close();
  console.log(chalk.green('\nGuided session complete\n'));
}
