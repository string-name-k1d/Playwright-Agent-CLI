import chalk from 'chalk';
import { readFileSync, writeFileSync } from 'node:fs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { opencodeRun, extractStructuredOutput } from '../lib/opencode.js';
import { saveTest, ensureArtifactsDir, readArtifact } from '../lib/artifacts.js';
import { generatorPrompt, healerPrompt } from '../lib/prompt-templates.js';
import { Config } from '../config.js';

const execFileAsync = promisify(execFile);

export interface TestOptions {
  url?: string;
  plan?: string;
  generate?: boolean;
  execute?: string;
  headed?: boolean;
  retries?: number;
  config: Config;
}

async function runPlaywrightTest(file: string, headed: boolean): Promise<{ passed: boolean; output: string }> {
  const args = ['test', file];
  if (headed) args.push('--headed');

  try {
    const { stdout, stderr } = await execFileAsync('npx', args, {
      timeout: 120000,
      maxBuffer: 10 * 1024 * 1024,
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
    console.log(result.passed
      ? chalk.green.bold('\nTest passed ✓\n')
      : chalk.red.bold('\nTest failed ✗\n'));
    process.exit(result.passed ? 0 : 1);
  }

  if (opts.plan) {
    const planContent = readArtifact('plans', opts.plan, opts.config.outputDir);
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
