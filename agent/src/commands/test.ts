import chalk from 'chalk';
import { readFileSync, writeFileSync, existsSync, mkdirSync, copyFileSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { opencodeRun, extractStructuredOutput } from '../lib/opencode.js';
import { saveTest, ensureArtifactsDir, readArtifact, extractCodeBlocks, saveExtractedTests } from '../lib/artifacts.js';
import { generatorPrompt, healerPrompt } from '../lib/prompt-templates.js';
import { Config } from '../config.js';

const execFileAsync = promisify(execFile);

export interface TestOptions {
  url?: string;
  plan?: string;
  generate?: boolean;
  execute?: string;
  extract?: boolean;
  headed?: boolean;
  retries?: number;
  config: Config;
}

interface TestResult {
  passed: boolean;
  output: string;
  reportDir?: string;
}

function timestamp(): string {
  return new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
}

function saveTestResult(result: TestResult, testFile: string, outputDir: string): string {
  const resultsDir = join(outputDir, 'results');
  if (!existsSync(resultsDir)) mkdirSync(resultsDir, { recursive: true });

  const runId = `run-${timestamp()}`;
  const runDir = join(resultsDir, runId);
  mkdirSync(runDir, { recursive: true });

  // Save full output
  writeFileSync(join(runDir, 'output.txt'), result.output, 'utf-8');

  // Extract test results summary from output
  const passed = (result.output.match(/✓/g) ?? []).length;
  const failed = (result.output.match(/✘/g) ?? []).length;
  const failedTests = [...result.output.matchAll(/✘.*?›\s*(.*)/g)].map(m => m[1].trim());
  const passedTests = [...result.output.matchAll(/✓.*?›\s*(.*)/g)].map(m => m[1].trim());

  // Copy playwright report from run/ directory
  let reportRelative = '';
  const playwrightReport = join(RUN_DIR, 'playwright-report');
  if (existsSync(playwrightReport)) {
    const destReport = join(runDir, 'playwright-report');
    copyDirectorySync(playwrightReport, destReport);
    result.reportDir = destReport;
    reportRelative = `[HTML Report](playwright-report/index.html)`;
  }

  // Copy test result artifacts from run/ directory
  const testResults = join(RUN_DIR, 'test-results');
  if (existsSync(testResults)) {
    copyDirectorySync(testResults, join(runDir, 'test-results'));
  }

  // Clean up run/ directory
  cleanupRunDir();

  // Save concise summary
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

const RUN_DIR = join(process.cwd(), 'run');

function cleanupRunDir(): void {
  if (existsSync(RUN_DIR)) {
    rmSync(RUN_DIR, { recursive: true, force: true });
  }
}

async function runPlaywrightTest(file: string, headed: boolean): Promise<TestResult> {
  // Clean previous run artifacts from CWD
  cleanupRunDir();
  mkdirSync(RUN_DIR, { recursive: true });

  const args = ['playwright', 'test', file, '--reporter=list,html', '--output=run/test-results'];
  if (headed) args.push('--headed');

  try {
    const { stdout, stderr } = await execFileAsync('npx', args, {
      timeout: 120000,
      maxBuffer: 10 * 1024 * 1024,
      env: { ...process.env, PLAYWRIGHT_HTML_REPORT: join(RUN_DIR, 'playwright-report') },
    });
    return { passed: true, output: stdout + stderr };
  } catch (err: any) {
    return { passed: false, output: err.stdout + err.stderr + err.message };
  }
}

async function generateFromPlan(
  planContent: string,
  url: string | undefined,
  config: Config
): Promise<string> {
  console.log(chalk.cyan('Generating test code from plan...'));

  let context: string | undefined;
  if (url) {
    context = `Target URL: ${url}`;
  }

  const prompt = generatorPrompt(planContent, context);
  const result = await opencodeRun(prompt, {
    model: config.opencodeModel,
    timeout: 120000,
  });

  if (result.exitCode !== 0) {
    console.error(chalk.red(`OpenCode generation failed: ${result.output}`));
    process.exit(1);
  }

  const output = extractStructuredOutput(result);
  const code = typeof output === 'string' ? output : result.output;

  const codeMatch = code.match(/```(?:typescript|ts)?\n([\s\S]*?)```/);
  return codeMatch ? codeMatch[1].trim() : code;
}

async function healTest(
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

export async function testCommand(opts: TestOptions): Promise<void> {
  ensureArtifactsDir(opts.config.outputDir);
  const maxRetries = opts.retries ?? opts.config.maxRetries;

  if (opts.generate) {
    if (!opts.url) {
      console.error(chalk.red('--url is required with --generate'));
      process.exit(1);
    }
    console.log(chalk.cyan(`\nLaunching codegen for: ${opts.url}\n`));
    const args = ['codegen', '--target=playwright-test'];
    if (opts.headed ?? opts.config.headed) args.push('--headed');
    args.push(opts.url);

    try {
      await execFileAsync('npx', ['playwright', ...args], {
        timeout: 600000,
        stdio: 'inherit',
      } as any);
    } catch {
      console.log(chalk.gray('Codegen session ended'));
    }
    return;
  }

  if (opts.execute) {
    console.log(chalk.cyan(`\nExecuting test: ${opts.execute}\n`));
    const result = await runPlaywrightTest(opts.execute, opts.headed ?? opts.config.headed);
    console.log(result.output);

    const resultPath = saveTestResult(result, opts.execute, opts.config.outputDir);
    console.log(chalk.gray(`Results saved: ${resultPath}`));
    if (result.reportDir) {
      console.log(chalk.gray(`HTML report: ${resultPath}/playwright-report/index.html`));
    }

    console.log(result.passed
      ? chalk.green.bold('\nTest passed ✓\n')
      : chalk.red.bold('\nTest failed ✗\n'));
    process.exit(result.passed ? 0 : 1);
  }

  if (opts.plan) {
    const planContent = readArtifact('plans', opts.plan, opts.config.outputDir);

    if (opts.extract) {
      console.log(chalk.cyan('Extracting test code from plan...\n'));
      const blocks = extractCodeBlocks(planContent);

      if (blocks.length === 0) {
        console.error(chalk.red('No Playwright test code blocks found in plan'));
        process.exit(1);
      }

      const saved = saveExtractedTests(blocks, opts.config.outputDir);
      console.log(chalk.green(`Extracted ${saved.length} test file(s):`));
      for (const p of saved) console.log(chalk.gray(`  ${p}`));
      console.log('');
      return;
    }

    let testCode = await generateFromPlan(planContent, opts.url, opts.config);

    const testFilename = `generated-${Date.now()}.spec.ts`;
    const testPath = saveTest(testCode, testFilename, opts.config.outputDir);
    console.log(chalk.green(`Test generated: ${testPath}`));

    let lastError = '';
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      if (attempt > 0) {
        console.log(chalk.yellow(`\nRetry ${attempt}/${maxRetries}...`));
        testCode = await healTest(testCode, lastError, opts.config);
        writeFileSync(testPath, testCode, 'utf-8');
      }

      console.log(chalk.cyan(`\nRunning test (attempt ${attempt + 1})...\n`));
      const result = await runPlaywrightTest(testPath, opts.headed ?? opts.config.headed);
      console.log(result.output);

      const resultPath = saveTestResult(result, testPath, opts.config.outputDir);
      console.log(chalk.gray(`Results saved: ${resultPath}`));

      if (result.passed) {
        console.log(chalk.green.bold('\nTest passed ✓\n'));
        return;
      }
      lastError = result.output;
    }

    console.error(chalk.red.bold(`\nTest failed after ${maxRetries + 1} attempts ✗\n`));
    process.exit(1);
  }

  console.error(chalk.red('Specify --generate, --execute <file>, or --plan <file>'));
  process.exit(1);
}
