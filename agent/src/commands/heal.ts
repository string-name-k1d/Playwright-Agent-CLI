import chalk from 'chalk';
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { exploreCommand } from './explore.js';
import { savePlan, ensureArtifactsDir, getLatestFile } from '../lib/artifacts.js';
import { healerPlanPrompt } from '../lib/prompt-templates.js';
import { agentRun, extractMarkdown } from '../lib/agent-provider.js';
import { Config } from '../config.js';
import { getLatestEntryForUrl, searchExploreEntries, getSnapshotContent, type ExploreEntry } from '../lib/explore-registry.js';

const MAX_REEXPLORE_DEPTH = 3;

function extractReexploreUrls(planContent: string): string[] {
  const urls: string[] = [];
  const pattern = /\[re-explore:\s*(.+?)\]/g;
  let m;
  while ((m = pattern.exec(planContent)) !== null) {
    const raw = m[1].trim();
    const clean = raw.replace(/[,\]\s\])]+$/, '');
    if (clean && !urls.includes(clean)) urls.push(clean);
  }
  return urls;
}

function resolveUrl(raw: string, baseUrl?: string): string {
  if (raw.startsWith('http://') || raw.startsWith('https://')) return raw;
  if (raw.startsWith('/') && baseUrl) {
    try {
      const base = new URL(baseUrl);
      return `${base.origin}${raw}`;
    } catch {}
  }
  if (baseUrl) {
    try {
      return new URL(raw, baseUrl).href;
    } catch {}
  }
  return raw;
}

export interface FailedTest {
  name: string;
  file: string;
  errorContext: string;
  testSource: string;
}

export interface HealResult {
  planPath: string;
  failureCount: number;
}

interface ElementNotFoundInfo {
  locator: string;
  pageUrl?: string;
  testName: string;
}

export function parseFailures(resultsDir: string): FailedTest[] {
  const failures: FailedTest[] = [];

  if (!existsSync(resultsDir)) return failures;

  const runDirs = readdirSync(resultsDir)
    .filter(d => d.startsWith('run-'))
    .map(d => ({
      name: d,
      time: statMs(join(resultsDir, d)),
    }))
    .sort((a, b) => b.time - a.time);

  if (runDirs.length === 0) return failures;

  // Scan run dirs (newest first) for error files, stopping at the first
  // dir that has any.  This avoids a race where the newest run dir was
  // just created but its errors/ has not been populated yet.
  for (const runDir of runDirs) {
    const runPath = join(resultsDir, runDir.name);

    // New flat structure: errors/*.md
    const errorsDir = join(runPath, 'errors');
    if (existsSync(errorsDir)) {
      const mdFiles = readdirSync(errorsDir).filter(f => f.endsWith('.md'));
      if (mdFiles.length > 0) {
        for (const file of mdFiles) {
          const errorContext = readFileSync(join(errorsDir, file), 'utf-8');
          const nameMatch = errorContext.match(/Name:\s*(.+?)(?:\n|$)/);
          const name = nameMatch ? nameMatch[1].trim() : file.replace(/\.md$/, '').replace(/-/g, ' ');
          const fileMatch = errorContext.match(/Location:\s*(.+?)(?:\n|$)/);
          const testFile = fileMatch ? fileMatch[1].trim() : '';
          const tsBlocks = [...errorContext.matchAll(/```ts?\n([\s\S]*?)```/g)];
          const testSource = tsBlocks.length > 0 ? tsBlocks[tsBlocks.length - 1][1].trim() : '';
          failures.push({ name, file: testFile, errorContext, testSource });
        }
        return failures;
      }
    }

    // Legacy fallback: test-results/*/error-context.md
    const testResultsDir = join(runPath, 'test-results');
    if (!existsSync(testResultsDir)) continue;
    const testDirs = readdirSync(testResultsDir).filter(d => !d.startsWith('.'));
    for (const dir of testDirs) {
      const errorCtxPath = join(testResultsDir, dir, 'error-context.md');
      if (!existsSync(errorCtxPath)) continue;
      const errorContext = readFileSync(errorCtxPath, 'utf-8');
      const nameMatch = errorContext.match(/Name:\s*(.+?)(?:\n|$)/);
      const name = nameMatch ? nameMatch[1].trim() : dir;
      const fileMatch = errorContext.match(/Location:\s*(.+?)(?:\n|$)/);
      const file = fileMatch ? fileMatch[1].trim() : '';
      const tsBlocks = [...errorContext.matchAll(/```ts?\n([\s\S]*?)```/g)];
      const testSource = tsBlocks.length > 0 ? tsBlocks[tsBlocks.length - 1][1].trim() : '';
      failures.push({ name, file, errorContext, testSource });
    }
    if (failures.length > 0) return failures;
  }

  return failures;
}

export function detectElementNotFoundErrors(failures: FailedTest[]): ElementNotFoundInfo[] {
  const results: ElementNotFoundInfo[] = [];

  const elementNotFoundPatterns = [
    /element\(.+\)\s+not found/gi,
    /locator\(.+\)\s+not found/gi,
    /getByRole\(.+\).+not found/gi,
    /getByText\(.+\).+not found/gi,
    /getByTestId\(.+\).+not found/gi,
    /page\.getBy.+not found/gi,
    /Error:.+(?:locator|element|button|link|text).+(?:not visible|not attached|not enabled|not found)/gi,
    /expect\(.+\).+toBeVisible/gi,
    /Timeout \d+ms exceeded/gi,
  ];

  for (const failure of failures) {
    const combined = failure.errorContext + '\n' + failure.testSource;

    for (const pattern of elementNotFoundPatterns) {
      pattern.lastIndex = 0;
      const matches = combined.matchAll(pattern);
      for (const match of matches) {
        const locator = match[0].slice(0, 200);

        const urlMatch = failure.errorContext.match(/navigating to "([^"]+)"/);
        const pageUrl = urlMatch?.[1];

        results.push({
          locator,
          pageUrl,
          testName: failure.name,
        });
      }
    }
  }

  return results;
}

function statMs(path: string): number {
  try {
    return statSync(path).mtimeMs;
  } catch {
    return 0;
  }
}

function step(n: number, total: number, msg: string): void {
  console.log(chalk.cyan.bold(`\n[${n}/${total}] ${msg}`));
  console.log(chalk.gray('─'.repeat(60)));
}

function substep(msg: string): void {
  console.log(chalk.gray(`  → ${msg}`));
}

export interface HealOptions {
  url?: string;
  model?: string;
  headed?: boolean;
  snapshotPath?: string;
  quiet?: boolean;
  profile?: string;
  config: Config;
  testFiles?: string[];
  planPath?: string;
}

export async function healCommand(opts: HealOptions): Promise<HealResult> {
  ensureArtifactsDir(opts.config.outputDir);
  const log = opts.quiet ? () => {} : console.log;

  if (!opts.quiet) {
    console.log(chalk.bold('\n═══════════════════════════════════════════════'));
    console.log(chalk.bold('  pw-cli-agent · heal'));
    console.log(chalk.bold('═══════════════════════════════════════════════\n'));
  }

  // ── Step 1: Find failures ───────────────────────────────────────
  step(1, 4, 'Analyzing — finding test failures');

  const resultsDir = join(opts.config.outputDir, 'results');
  let failures = parseFailures(resultsDir);

  // Filter to only failures from current test files
  if (opts.testFiles && opts.testFiles.length > 0) {
    const currentFiles = new Set(opts.testFiles.map(f => f.replace(/\\/g, '/')));
    failures = failures.filter(f => {
      const normalizedFile = f.file.replace(/\\/g, '/');
      return [...currentFiles].some(cf => normalizedFile.includes(cf) || cf.includes(normalizedFile));
    });
  }

  if (failures.length === 0) {
    log(chalk.yellow('  No test failures found in latest run.'));
    return { planPath: '', failureCount: 0 };
  }

  // Load the original plan so the healer can preserve passing tests
  let originalPlan: string | undefined;
  if (opts.planPath) {
    try {
      originalPlan = readFileSync(opts.planPath, 'utf-8');
      substep(`Original plan: ${opts.planPath}`);
    } catch {
      log(chalk.yellow(`  Could not read original plan: ${opts.planPath}`));
    }
  }

  substep(`Found ${failures.length} failing test(s):`);
  for (const f of failures) {
    substep(chalk.red(`  ✗ ${f.name}`));
  }

  // ── Step 2: Detect element-not-found and re-explore pages ──────
  const elementErrors = detectElementNotFoundErrors(failures);
  const pagesToExplore = new Map<string, string>();

  if (elementErrors.length > 0) {
    step(2, 4, `Re-explore — detected ${elementErrors.length} element-not-found error(s)`);

    for (const err of elementErrors) {
      if (err.pageUrl && !pagesToExplore.has(err.pageUrl)) {
        pagesToExplore.set(err.pageUrl, err.locator);
      }
    }

    // Also explore the main URL if provided
    const mainUrl = opts.url ?? opts.config.targetUrl;
    if (mainUrl && !pagesToExplore.has(mainUrl)) {
      pagesToExplore.set(mainUrl, 'main page');
    }

    for (const [url, locator] of pagesToExplore) {
      substep(`Exploring: ${url} (element: ${locator.slice(0, 60)})`);
      try {
        await exploreCommand({ url, headed: opts.headed, config: opts.config, profile: opts.profile });
      } catch (err: any) {
        console.log(chalk.yellow(`  Failed to explore ${url}: ${err.message}`));
      }
    }
  } else {
    step(2, 4, 'Re-explore — capturing fresh page snapshot');
    const url = opts.url ?? opts.config.targetUrl;
    if (url) {
      await exploreCommand({ url, headed: opts.headed, config: opts.config, profile: opts.profile });
    }
  }

  // ── Step 3: Collect snapshots ───────────────────────────────────
  step(3, 4, 'Collecting snapshots');

  const snapshotContents: string[] = [];

  if (opts.snapshotPath) {
    snapshotContents.push(readFileSync(opts.snapshotPath, 'utf-8'));
    substep(`Using provided snapshot: ${opts.snapshotPath}`);
  }

  // Get latest snapshot for each explored URL
  for (const url of pagesToExplore.keys()) {
    const entries = searchExploreEntries(url, opts.config.outputDir);
    if (entries.length > 0) {
      const latest = entries.sort((a, b) =>
        new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
      )[0];
      const content = getSnapshotContent(latest);
      if (!snapshotContents.includes(content)) {
        snapshotContents.push(content);
        substep(`Snapshot for ${url}: ${latest.snapshotFileName}`);
      }
    }
  }

  // Fallback: use latest snapshot
  if (snapshotContents.length === 0) {
    const latest = getLatestFile('explore', opts.config.outputDir);
    if (latest) {
      snapshotContents.push(readFileSync(latest, 'utf-8'));
      substep(`Using latest snapshot: ${latest}`);
    }
  }

  if (snapshotContents.length === 0) {
    console.error(chalk.red('  No snapshots available — aborting'));
    process.exit(1);
  }

  // ── Build failure context from all failures ────────────────────
  const failureContext = failures.map(f => {
    const codeBlocks = [...f.errorContext.matchAll(/```(\w*)\n([\s\S]*?)```/g)];
    const errorBlock = codeBlocks.find(m => m[1] === '' || m[1] === 'text');
    const errorSnippet = errorBlock ? errorBlock[2].trim().slice(0, 3000) : '';
    const snapshotBlock = codeBlocks.find(m => m[1] === 'yaml');
    const snapshotSnippet = snapshotBlock ? snapshotBlock[2].trim().slice(0, 4000) : '';
    const testSourceFull = f.testSource || '';
    const isElementNotFound = elementErrors.some(e => e.testName === f.name);
    const elementNotFoundNote = isElementNotFound
      ? '\n\n**Note:** This failure involves an element-not-found error. The page snapshot has been re-explored. Use the FRESH snapshot to find the correct element refs.'
      : '';
    const parts: string[] = [];
    parts.push(`### ${f.name}`);
    parts.push(`**File:** ${f.file}`);
    if (errorSnippet) parts.push(`\n**Error message:**\n\`\`\`\n${errorSnippet}\n\`\`\``);
    if (testSourceFull) parts.push(`\n**Failing test source:**\n\`\`\`ts\n${testSourceFull}\n\`\`\``);
    if (snapshotSnippet) parts.push(`\n**Page snapshot at failure time:**\n\`\`\`yaml\n${snapshotSnippet}\n\`\`\``);
    if (elementNotFoundNote) parts.push(elementNotFoundNote);
    return parts.join('\n');
  }).join('\n\n---\n\n');

  // ── Step 4: Generate healing plan (with re-explore loop) ───────
  step(4, 4, 'Heal — generating corrected plan via AI');

  const baseUrl = opts.url ?? opts.config.targetUrl;
  let plan = '';
  let allSnapshotContents = [...snapshotContents];
  const allSnapshotContentsStr = new Set(snapshotContents);

  for (let depth = 0; depth <= MAX_REEXPLORE_DEPTH; depth++) {
    if (depth > 0) {
      step(4, 4, `Heal re-explore iteration ${depth}/${MAX_REEXPLORE_DEPTH}`);
    }

    const combinedSnapshots = allSnapshotContents.length === 1
      ? allSnapshotContents[0]
      : allSnapshotContents.map((s, i) => `### Snapshot ${i + 1}\n\n${s}`).join('\n\n---\n\n');

    const prompt = healerPlanPrompt(combinedSnapshots, failureContext, originalPlan);
    const result = await agentRun(prompt, { timeout: 300000 }, opts.config);

    plan = extractMarkdown(result);

    if (!plan || plan.length < 20) {
      if (result.exitCode !== 0) {
        log(chalk.red(`  Agent backend (${result.provider}) failed (exit ${result.exitCode})`));
      } else {
        log(chalk.red('  Healing plan output too short or empty'));
      }
      return { planPath: '', failureCount: 0 };
    }

    // Check if healer requested re-exploration of additional URLs
    const reexploreUrls = extractReexploreUrls(plan);
    if (reexploreUrls.length === 0) {
      log(chalk.gray('  No re-exploration requested by healer'));
      break;
    }

    if (depth >= MAX_REEXPLORE_DEPTH) {
      log(chalk.yellow(`  Max re-explore depth (${MAX_REEXPLORE_DEPTH}) reached, skipping ${reexploreUrls.length} pending URL(s)`));
      break;
    }

    log(chalk.cyan(`\nHealer requested ${reexploreUrls.length} page(s) to re-explore:\n`));
    let explored = false;
    for (const raw of reexploreUrls) {
      const resolved = resolveUrl(raw, baseUrl);
      const existing = getLatestEntryForUrl(resolved, opts.config.outputDir);
      if (existing) {
        const content = getSnapshotContent(existing);
        if (!allSnapshotContentsStr.has(content)) {
          allSnapshotContents.push(content);
          allSnapshotContentsStr.add(content);
          log(chalk.gray(`  Already explored fresh: ${resolved} — added to context`));
          explored = true;
        } else {
          log(chalk.gray(`  Already in context: ${resolved}`));
        }
        continue;
      }
      log(chalk.gray(`  Re-exploring: ${resolved}`));
      try {
        const result = await exploreCommand({ url: resolved, headed: opts.headed, config: opts.config, profile: opts.profile });
        const entry = searchExploreEntries(resolved, opts.config.outputDir).sort(
          (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
        )[0];
        if (entry) {
          const content = getSnapshotContent(entry);
          allSnapshotContents.push(content);
          allSnapshotContentsStr.add(content);
          explored = true;
        }
      } catch (err: any) {
        log(chalk.yellow(`  Failed to re-explore ${resolved}: ${err.message}`));
      }
    }

    if (!explored) {
      log(chalk.gray('  No new pages to re-explore — plan is stable'));
      break;
    }
  }

  const filename = `heal-${Date.now()}.md`;
  const savedPath = savePlan(plan, filename, opts.config.outputDir);

  log(chalk.green(`\n  Healing plan saved: ${savedPath}`));
  if (!opts.quiet) {
    substep(chalk.gray('Plan preview:'));
    console.log(chalk.gray(plan.slice(0, 2000)));
    if (plan.length > 2000) console.log(chalk.gray('\n  ... (truncated)'));
  }

  return { planPath: savedPath, failureCount: failures.length };
}
