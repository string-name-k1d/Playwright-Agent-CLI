import chalk from 'chalk';
import { readFileSync, writeFileSync, existsSync, statSync, mkdirSync, copyFileSync, readdirSync, rmSync, renameSync } from 'node:fs';
import { join, basename } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { agentRun, extractStructuredOutput } from '../lib/agent-provider.js';
import { ensureArtifactsDir } from '../lib/artifacts.js';
import { healerPrompt } from '../lib/prompt-templates.js';
import { Config, httpCredentialsFor } from '../config.js';

const execFileAsync = promisify(execFile);

export interface TestOptions {
  execute?: string;
  headed?: boolean;
  retries?: number;
  workers?: number;
  snapshot?: string;
  url?: string;
  storageState?: string;
  config: Config;
}

export interface TestResult {
  passed: boolean;
  output: string;
  reportDir?: string;
}

function timestamp(): string {
  return new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
}

export function saveTestResult(result: TestResult, testFile: string, outputDir: string, runDir?: string): string {
  const resultsDir = join(outputDir, 'results');
  if (!existsSync(resultsDir)) mkdirSync(resultsDir, { recursive: true });

  if (!runDir) {
    runDir = join(resultsDir, `run-${timestamp()}`);
    mkdirSync(runDir, { recursive: true });
  }

  const passed = (result.output.match(/✓/g) ?? []).length;
  const failed = (result.output.match(/✘/g) ?? []).length;
  const failedTests = [...result.output.matchAll(/✘.*?›\s*(.*)/g)].map(m => m[1].trim());
  const passedTests = [...result.output.matchAll(/✓.*?›\s*(.*)/g)].map(m => m[1].trim());

  // Flatten error-context.md files into errors/
  const testResults = join(RUN_DIR, 'test-results');
  if (existsSync(testResults)) {
    const errorsDir = join(runDir, 'errors');
    for (const dir of readdirSync(testResults).filter(d => !d.startsWith('.'))) {
      const errCtx = join(testResults, dir, 'error-context.md');
      if (existsSync(errCtx)) {
        if (!existsSync(errorsDir)) mkdirSync(errorsDir, { recursive: true });
        // Use a readable name from the dir: strip hash prefix, replace dashes with spaces
        const readableName = dir.replace(/^[a-z0-9]+-[a-z0-9]+-/, '').replace(/-/g, ' ');
        copyFileSync(errCtx, join(errorsDir, `${readableName}.md`));
      }
    }
  }

  // Copy screenshots to flat dir (only once, skip nested duplication)
  const screenshotsDir = join(runDir, 'screenshots');
  if (existsSync(testResults)) {
    copyScreenshots(testResults, screenshotsDir);
  }

  // Append to summary
  const summaryPath = join(runDir, 'summary.md');
  const testStatus = result.passed ? 'PASSED' : 'FAILED';
  const line = `| ${testFile} | ${testStatus} | ${passed} passed, ${failed} failed |`;
  if (!existsSync(summaryPath)) {
    writeFileSync(summaryPath, [
      `# Test Run`,
      '',
      `| Test File | Status | Results |`,
      `|-----------|--------|---------|`,
      line,
      '',
    ].join('\n'), 'utf-8');
  } else {
    const existing = readFileSync(summaryPath, 'utf-8');
    // Insert before the trailing newlines
    const insertAt = existing.lastIndexOf('\n---\n') !== -1
      ? existing.lastIndexOf('\n---\n')
      : existing.length;
    writeFileSync(summaryPath, existing.slice(0, insertAt) + line + '\n' + existing.slice(insertAt), 'utf-8');
  }

  return runDir;
}

function copyScreenshots(testResultsDir: string, destDir: string): void {
  if (!existsSync(testResultsDir)) return;
  mkdirSync(destDir, { recursive: true });
  const entries = readdirSync(testResultsDir, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const screenshotsDir = join(testResultsDir, entry.name, 'screenshots');
    if (!existsSync(screenshotsDir)) continue;
    const files = readdirSync(screenshotsDir).filter(f => f.endsWith('.png'));
    for (const f of files) {
      copyFileSync(join(screenshotsDir, f), join(destDir, f));
    }
  }
}

export const RUN_DIR = join(process.cwd(), 'run');
const PLAYWRIGHT_CONFIG = join(process.cwd(), 'playwright.config.ts');

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Expands a simple `*`-glob (relative to cwd) into matching file paths. */
export function expandGlob(pattern: string): string[] {
  const parts = pattern.split('/');
  const filePattern = parts.pop()!;
  const dir = join(process.cwd(), ...parts);
  if (!existsSync(dir)) return [];
  const regex = new RegExp(`^${escapeRegExp(filePattern).replace(/\\\*/g, '.*')}$`);
  return readdirSync(dir)
    .filter((f) => regex.test(f))
    .map((f) => join(dir, f))
    .sort();
}

export function ensurePlaywrightConfig(
  targetUrl?: string,
  storageState?: string,
  httpCredentials?: { username: string; password: string },
): void {
  const useOptions: Record<string, unknown> = {
    actionTimeout: 10000,
    navigationTimeout: 30000,
  };

  if (httpCredentials) {
    useOptions.httpCredentials = httpCredentials;
  }

  // Resolve targetUrl: explicit param → existing config → env
  const resolvedUrl = targetUrl || (() => {
    if (existsSync(PLAYWRIGHT_CONFIG)) {
      try {
        const content = readFileSync(PLAYWRIGHT_CONFIG, 'utf-8');
        const match = content.match(/baseURL:\s*["']([^"']+)["']/);
        if (match) return match[1];
      } catch {}
    }
    return process.env.TARGET_URL;
  })();
  if (resolvedUrl) useOptions.baseURL = resolvedUrl;

  if (storageState) {
    const absPath = storageState.startsWith('/') ? storageState : join(process.cwd(), storageState);
    if (existsSync(absPath)) {
      // If it's a directory (Chromium profile), look for state.json inside
      let stateFile = absPath;
      try {
        if (statSync(absPath).isDirectory()) {
          const candidate = join(absPath, 'state.json');
          if (existsSync(candidate)) {
            stateFile = candidate;
          } else {
            console.log(chalk.yellow(`  ⚠ Profile is a directory but no state.json found inside: ${absPath}`));
            console.log(chalk.gray('    Run `login` again to export storageState'));
          }
        }
      } catch {}
      if (existsSync(stateFile)) {
        useOptions.storageState = stateFile;
      }
    }
  }

  const lines = [
    "import { defineConfig } from '@playwright/test';",
    'export default defineConfig({',
    '  use: {',
  ];
  for (const [key, value] of Object.entries(useOptions)) {
    lines.push(`    ${key}: ${JSON.stringify(value)},`);
  }
  lines.push('  },');
  lines.push('  timeout: 30000,');
  lines.push('});');
  lines.push('');

  writeFileSync(PLAYWRIGHT_CONFIG, lines.join('\n'), 'utf-8');
  console.log(chalk.gray(
    `  Config: playwright.config.ts (${resolvedUrl ? `baseURL=${resolvedUrl}` : 'baseURL unset'}${storageState ? ', storageState set' : ''})`
  ));
}

export function cleanupRunDir(): void {
  if (existsSync(RUN_DIR)) {
    rmSync(RUN_DIR, { recursive: true, force: true });
  }
}

export async function runPlaywrightTest(
  file: string | string[],
  headed: boolean,
  targetUrl?: string,
  storageState?: string,
  retries?: number,
  workers?: number,
  fileLevels?: Map<string, number>,
  httpCredentials?: { username: string; password: string },
): Promise<TestResult> {
  cleanupRunDir();
  mkdirSync(RUN_DIR, { recursive: true });

  ensurePlaywrightConfig(targetUrl, storageState, httpCredentials);

  const files = (Array.isArray(file) ? file : [file]).flatMap((f) =>
    f.includes('*') ? expandGlob(f) : [f]
  );
  if (files.length === 0) {
    throw new Error(`No test files matched: ${file}`);
  }

  // When dependency levels are provided, run files in waves: files at the
  // same level run in parallel, but a wave starts only after every lower
  // level (the tests it depends on) has finished.
  if (fileLevels && fileLevels.size > 0) {
    const groups = new Map<number, string[]>();
    for (const f of files) {
      const level = fileLevels.get(f) ?? 0;
      if (!groups.has(level)) groups.set(level, []);
      groups.get(level)!.push(f);
    }
    const sortedLevels = [...groups.keys()].sort((a, b) => a - b);
    const outputs: string[] = [];
    let passed = true;
    let waveIndex = 0;

    for (const level of sortedLevels) {
      const groupFiles = groups.get(level)!;
      const waveDir = join(RUN_DIR, `wave-${waveIndex}`);
      const args = ['playwright', 'test', ...groupFiles, '--reporter=list,html', `--output=${waveDir}`];
      if (headed) args.push('--headed');
      if (retries && retries > 0) args.push(`--retries=${retries}`);
      if (workers && workers > 0) args.push(`--workers=${workers}`);

      const header = `\n=== Wave ${level} — ${groupFiles.length} file(s): ${groupFiles.map(f => basename(f)).join(', ')} ===\n`;
      let waveOutput: string;
      try {
        const { stdout, stderr } = await execFileAsync('npx', args, {
          timeout: 120000,
          maxBuffer: 10 * 1024 * 1024,
          env: { ...process.env, PLAYWRIGHT_HTML_REPORT: join(RUN_DIR, `playwright-report-${waveIndex}`) },
        });
        waveOutput = stdout + stderr;
      } catch (err: any) {
        passed = false;
        waveOutput = (err.stdout ?? '') + (err.stderr ?? '') + (err.message ?? '');
      }
      outputs.push(header + waveOutput);
      waveIndex++;
    }

    // Merge per-wave test-results back into the standard RUN_DIR/test-results
    // layout so saveTestResult / parseFailures keep working unchanged.
    const mergedDir = join(RUN_DIR, 'test-results');
    mkdirSync(mergedDir, { recursive: true });
    for (let i = 0; i < waveIndex; i++) {
      const waveResults = join(RUN_DIR, `wave-${i}`, 'test-results');
      if (!existsSync(waveResults)) continue;
      for (const entry of readdirSync(waveResults).filter(d => !d.startsWith('.'))) {
        const dest = join(mergedDir, entry);
        if (existsSync(dest)) continue;
        try {
          renameSync(join(waveResults, entry), dest);
        } catch {
          // Ignore individual move failures; keep whatever was already merged
        }
      }
    }

    return { passed, output: outputs.join('\n') };
  }

  const args = ['playwright', 'test', ...files, '--reporter=list,html', '--output=run/test-results'];
  if (headed) args.push('--headed');
  if (retries && retries > 0) args.push(`--retries=${retries}`);
  if (workers && workers > 0) args.push(`--workers=${workers}`);

  try {
    const { stdout, stderr } = await execFileAsync('npx', args, {
      timeout: 1200000,
      maxBuffer: 10 * 1024 * 1024,
      env: { ...process.env, PLAYWRIGHT_HTML_REPORT: join(RUN_DIR, 'playwright-report') },
    });
    return { passed: true, output: stdout + stderr };
  } catch (err: any) {
    return { passed: false, output: err.stdout + err.stderr + err.message };
  }
}

export async function healTest(
  testCode: string,
  errorOutput: string,
  config: Config,
  snapshotContent?: string
): Promise<string> {
  console.log(chalk.yellow('Attempting self-heal...'));

  const prompt = healerPrompt(testCode, errorOutput, snapshotContent);
  const result = await agentRun(prompt, { timeout: 120000 }, config);

  if (result.exitCode !== 0) return testCode;

  const output = extractStructuredOutput(result);
  const response = typeof output === 'string' ? output : result.output;
  const codeMatch = response.match(/```(?:typescript|ts)?\n([\s\S]*?)```/);
  return codeMatch ? codeMatch[1].trim() : testCode;
}

export async function testCommand(opts: TestOptions): Promise<TestResult> {
  ensureArtifactsDir(opts.config.outputDir);

  if (!opts.execute) {
    console.error(chalk.red('Specify --execute <file>'));
    console.log(chalk.gray('Use `generate` to create test files, `test` to execute them.'));
    return { passed: false, output: 'No --execute file specified' };
  }

  console.log(chalk.cyan(`\nExecuting test: ${opts.execute}\n`));
  const result = await runPlaywrightTest(
    opts.execute,
    opts.headed ?? opts.config.headed,
    opts.url ?? opts.config.targetUrl,
    opts.storageState,
    opts.retries,
    opts.workers,
    undefined,
    httpCredentialsFor(opts.config),
  );
  console.log(result.output);

  const resultPath = saveTestResult(result, opts.execute, opts.config.outputDir);
  console.log(chalk.gray(`Results saved: ${resultPath}`));
  if (result.reportDir) {
    console.log(chalk.gray(`HTML report: ${resultPath}/playwright-report/index.html`));
  }

  console.log(result.passed
    ? chalk.green.bold('\nTest passed ✓\n')
    : chalk.red.bold('\nTest failed ✗\n'));
  return result;
}
