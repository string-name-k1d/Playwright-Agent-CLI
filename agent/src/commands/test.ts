import chalk from 'chalk';
import { readFileSync, writeFileSync, existsSync, statSync, mkdirSync, copyFileSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { opencodeRun, extractStructuredOutput } from '../lib/opencode.js';
import { ensureArtifactsDir } from '../lib/artifacts.js';
import { healerPrompt } from '../lib/prompt-templates.js';
import { Config } from '../config.js';

const execFileAsync = promisify(execFile);

export interface TestOptions {
  execute?: string;
  headed?: boolean;
  retries?: number;
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

export function saveTestResult(result: TestResult, testFile: string, outputDir: string): string {
  const resultsDir = join(outputDir, 'results');
  if (!existsSync(resultsDir)) mkdirSync(resultsDir, { recursive: true });

  const runId = `run-${timestamp()}`;
  const runDir = join(resultsDir, runId);
  mkdirSync(runDir, { recursive: true });

  writeFileSync(join(runDir, 'output.txt'), result.output, 'utf-8');

  const passed = (result.output.match(/✓/g) ?? []).length;
  const failed = (result.output.match(/✘/g) ?? []).length;
  const failedTests = [...result.output.matchAll(/✘.*?›\s*(.*)/g)].map(m => m[1].trim());
  const passedTests = [...result.output.matchAll(/✓.*?›\s*(.*)/g)].map(m => m[1].trim());

  let reportRelative = '';
  const playwrightReport = join(RUN_DIR, 'playwright-report');
  if (existsSync(playwrightReport)) {
    const destReport = join(runDir, 'playwright-report');
    copyDirectorySync(playwrightReport, destReport);
    result.reportDir = destReport;
    reportRelative = `[HTML Report](playwright-report/index.html)`;
  }

  const testResults = join(RUN_DIR, 'test-results');
  if (existsSync(testResults)) {
    copyDirectorySync(testResults, join(runDir, 'test-results'));

    // Also copy screenshots to top-level screenshots/ in the run dir
    const screenshotsDir = join(runDir, 'screenshots');
    copyScreenshots(testResults, screenshotsDir);
  }

  cleanupRunDir();

  const summary = [
    `# Test Run: ${runId}`,
    '',
    `| Field | Value |`,
    `|-------|-------|`,
    `| **Test File** | ${testFile} |`,
    `| **Status** | ${result.passed ? 'PASSED' : 'FAILED'} |`,
    `| **Passed** | ${passed} |`,
    `| **Failed** | ${failed} |`,
    `| **Timestamp** | ${new Date().toISOString()} |`,
    '',
  ];

  if (passedTests.length > 0) {
    summary.push('## Passed');
    for (const t of passedTests) summary.push(`- ${t}`);
    summary.push('');
  }

  if (failedTests.length > 0) {
    summary.push('## Failed');
    for (const t of failedTests) summary.push(`- ${t}`);
    summary.push('');
  }

  summary.push('## Files');
  summary.push(`- Test: \`${testFile}\``);
  summary.push(`- Output: \`output.txt\``);
  if (reportRelative) summary.push(`- ${reportRelative}`);
  summary.push(`- Screenshots: \`screenshots/\``);
  summary.push('');

  writeFileSync(join(runDir, 'summary.md'), summary.join('\n'), 'utf-8');

  return runDir;
}

function copyDirectorySync(src: string, dest: string): void {
  mkdirSync(dest, { recursive: true });
  const entries = readdirSync(src, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = join(src, entry.name);
    const destPath = join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDirectorySync(srcPath, destPath);
    } else {
      copyFileSync(srcPath, destPath);
    }
  }
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

function ensurePlaywrightConfig(targetUrl?: string, storageState?: string): void {
  const useOptions: Record<string, unknown> = {
    actionTimeout: 30000,
    navigationTimeout: 60000,
  };

  // Resolve targetUrl: explicit param → existing config → default
  const resolvedUrl = targetUrl || (() => {
    if (existsSync(PLAYWRIGHT_CONFIG)) {
      try {
        const content = readFileSync(PLAYWRIGHT_CONFIG, 'utf-8');
        const match = content.match(/baseURL:\s*["']([^"']+)["']/);
        if (match) return match[1];
      } catch {}
    }
    return 'http://mtpc_test';
  })();
  useOptions.baseURL = resolvedUrl;

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
    if (typeof value === 'string') {
      lines.push(`    ${key}: ${JSON.stringify(value)},`);
    } else {
      lines.push(`    ${key}: ${value},`);
    }
  }
  lines.push('  },');
  lines.push('  timeout: 60000,');
  lines.push('});');
  lines.push('');

  writeFileSync(PLAYWRIGHT_CONFIG, lines.join('\n'), 'utf-8');
  console.log(chalk.gray(`  Config: playwright.config.ts (baseURL=${resolvedUrl}${storageState ? ', storageState set' : ''})`));
}

export function cleanupRunDir(): void {
  if (existsSync(RUN_DIR)) {
    rmSync(RUN_DIR, { recursive: true, force: true });
  }
}

export async function runPlaywrightTest(file: string, headed: boolean, targetUrl?: string, storageState?: string): Promise<TestResult> {
  cleanupRunDir();
  mkdirSync(RUN_DIR, { recursive: true });

  ensurePlaywrightConfig(targetUrl, storageState);

  const args = ['playwright', 'test', file, '--reporter=list,html', '--output=run/test-results'];
  if (headed) args.push('--headed');

  try {
    const { stdout, stderr } = await execFileAsync('npx', args, {
      timeout: 300000,
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
  const result = await opencodeRun(prompt, {
    model: config.opencodeModel,
    timeout: 120000,
  });

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
  const result = await runPlaywrightTest(opts.execute, opts.headed ?? opts.config.headed, opts.url ?? opts.config.targetUrl, opts.storageState);
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
