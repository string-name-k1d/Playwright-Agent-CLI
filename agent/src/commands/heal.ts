import chalk from 'chalk';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { exploreCommand } from './explore.js';
import { savePlan, ensureArtifactsDir, getLatestFile } from '../lib/artifacts.js';
import { healerPlanPrompt } from '../lib/prompt-templates.js';
import { opencodeRun, extractMarkdown } from '../lib/opencode.js';
import { Config } from '../config.js';
import { searchExploreEntries, getSnapshotContent, type ExploreEntry } from '../lib/explore-registry.js';

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

  const latestRun = join(resultsDir, runDirs[0].name);
  const testResultsDir = join(latestRun, 'test-results');

  if (!existsSync(testResultsDir)) return failures;

  const testDirs = readdirSync(testResultsDir).filter(d => !d.startsWith('.'));
  for (const dir of testDirs) {
    const errorCtxPath = join(testResultsDir, dir, 'error-context.md');
    if (!existsSync(errorCtxPath)) continue;

    const errorContext = readFileSync(errorCtxPath, 'utf-8');

    const nameMatch = errorContext.match(/Name:\s*(.+?)(?:\n|$)/);
    const name = nameMatch ? nameMatch[1].trim() : dir;

    const sourceMatch = errorContext.match(/```ts?\n([\s\S]*?)```/);
    const testSource = sourceMatch ? sourceMatch[1].trim() : '';

    const fileMatch = errorContext.match(/Location:\s*(.+?)(?:\n|$)/);
    const file = fileMatch ? fileMatch[1].trim() : '';

    failures.push({ name, file, errorContext, testSource });
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
    const { statSync } = require('node:fs');
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
  const failures = parseFailures(resultsDir);

  if (failures.length === 0) {
    log(chalk.yellow('  No test failures found in latest run.'));
    return { planPath: '', failureCount: 0 };
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

  // ── Step 4: Generate healing plan ───────────────────────────────
  step(4, 4, 'Heal — generating corrected plan via AI');

  const failureContext = failures.map(f => {
    const errorMatch = f.errorContext.match(/# Error details\n\n```([\s\S]*?)```/);
    const errorSnippet = errorMatch ? errorMatch[1].trim().slice(0, 2000) : f.errorContext.slice(0, 2000);
    const sourceLines = f.testSource.split('\n').filter(l => l.includes('expect') || l.includes('await')).slice(0, 10);
    const sourceSnippet = sourceLines.join('\n');

    // Detect element-not-found in this specific failure
    const isElementNotFound = elementErrors.some(e => e.testName === f.name);
    const elementNotFoundNote = isElementNotFound
      ? '\n\n**Note:** This failure involves an element-not-found error. The page snapshot has been re-explored. Use the FRESH snapshot to find the correct element refs.'
      : '';

    return `### ${f.name}\n\n**Error:**\n\`\`\`\n${errorSnippet}\n\`\`\`\n\n**Key assertions:**\n\`\`\`ts\n${sourceSnippet}\n\`\`\`${elementNotFoundNote}`;
  }).join('\n\n---\n\n');

  // Combine all snapshots
  const combinedSnapshots = snapshotContents.length === 1
    ? snapshotContents[0]
    : snapshotContents.map((s, i) => `### Snapshot ${i + 1}\n\n${s}`).join('\n\n---\n\n');

  const prompt = healerPlanPrompt(combinedSnapshots, failureContext);
  const result = await opencodeRun(prompt, {
    model: opts.model ?? opts.config.opencodeModel,
    timeout: 300000,
  });

  const plan = extractMarkdown(result);

  if (!plan || plan.length < 20) {
    if (result.exitCode !== 0) {
      log(chalk.red(`  OpenCode failed (exit ${result.exitCode})`));
    } else {
      log(chalk.red('  Healing plan output too short or empty'));
    }
    return { planPath: '', failureCount: 0 };
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
