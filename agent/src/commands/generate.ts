import chalk from 'chalk';
import { readFileSync } from 'node:fs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { opencodeRun, extractStructuredOutput } from '../lib/opencode.js';
import { saveTest, ensureArtifactsDir, readArtifact, extractCodeBlocks, saveExtractedTests, wrapInTest } from '../lib/artifacts.js';
import { generatorPrompt } from '../lib/prompt-templates.js';
import { loadReferences, formatReferencesForPrompt } from '../lib/reference-loader.js';
import { Config } from '../config.js';

const execFileAsync = promisify(execFile);

export interface GenerateOptions {
  url?: string;
  plan?: string;
  codegen?: boolean;
  extract?: boolean;
  headed?: boolean;
  reference?: string;
  config: Config;
}

export interface GenerateResult {
  files: string[];
}

export async function generateFromPlan(
  planContent: string,
  url: string | undefined,
  config: Config,
  referenceContent?: string
): Promise<string> {
  console.log(chalk.cyan('Generating test code from plan...'));

  const context = url ? `Target URL: ${url}` : undefined;
  const prompt = generatorPrompt(planContent, context, referenceContent);
  const result = await opencodeRun(prompt, {
    model: config.opencodeModel,
    timeout: 300000,
  });

  const output = extractStructuredOutput(result);
  const raw = typeof output === 'string' ? output : result.output;

  // Debug: log raw output length and first 200 chars
  console.log(chalk.gray(`  OpenCode output: ${raw.length} chars`));
  console.log(chalk.gray(`  Preview: ${raw.slice(0, 200).replace(/\n/g, '\\n')}`));

  // Strategy 1: Extract the largest fenced code block
  const codeBlockRegex = /```(?:ts|typescript|javascript|js|playwright-test)?\s*\n([\s\S]*?)```/g;
  let bestBlock = '';
  let match;
  while ((match = codeBlockRegex.exec(raw)) !== null) {
    const block = match[1].trim();
    if (block.length > bestBlock.length) bestBlock = block;
  }
  if (bestBlock) return bestBlock;

  // Strategy 2: Find any line with import/test/const and take from earliest match
  const lines = raw.split('\n');
  let startIdx = -1;
  for (let i = 0; i < lines.length; i++) {
    const t = lines[i].trim();
    if (t.startsWith('import ') || t.startsWith("import {") || t.startsWith('test(') || t.startsWith('test.describe') || t.startsWith('test.beforeEach') || t.startsWith('test.afterEach') || t.startsWith('test.fixme')) {
      startIdx = i;
      break;
    }
  }
  if (startIdx >= 0) {
    // Find the end — stop at the last non-empty line
    let endIdx = lines.length - 1;
    while (endIdx > startIdx && lines[endIdx].trim() === '') endIdx--;
    return lines.slice(startIdx, endIdx + 1).join('\n').trim();
  }

  if (result.exitCode !== 0) {
    throw new Error(`OpenCode generation failed (exit ${result.exitCode}): ${raw.slice(0, 500)}`);
  }

  // Strategy 3: No code found at all
  const preview = raw.slice(0, 500).replace(/\n/g, '\n  ');
  throw new Error(
    `No code found in OpenCode output (exit ${result.exitCode}).\n` +
    `  Output preview:\n  ${preview}`
  );
}

export async function extractTestsFromPlan(
  planContent: string,
  outputDir: string,
  url?: string
): Promise<string[]> {
  console.log(chalk.cyan('Extracting test code from plan...\n'));
  const blocks = extractCodeBlocks(planContent, url);

  if (blocks.length === 0) {
    throw new Error('No Playwright test code blocks found in plan');
  }

  const saved = saveExtractedTests(blocks, outputDir);
  console.log(chalk.green(`Extracted ${saved.length} test file(s):`));
  for (const p of saved) console.log(chalk.gray(`  ${p}`));
  console.log('');
  return saved;
}

export async function launchCodegen(url: string, headed: boolean): Promise<void> {
  console.log(chalk.cyan(`\nLaunching codegen for: ${url}\n`));
  const args = ['codegen', '--target=playwright-test'];
  if (headed) args.push('--headed');
  args.push(url);

  try {
    await execFileAsync('npx', ['playwright', ...args], {
      timeout: 600000,
      stdio: 'inherit',
    } as any);
  } catch {
    console.log(chalk.gray('Codegen session ended'));
  }
}

export async function generateCommand(opts: GenerateOptions): Promise<GenerateResult> {
  ensureArtifactsDir(opts.config.outputDir);

  // Load user references if provided
  let referenceContent: string | undefined;
  if (opts.reference) {
    const references = loadReferences(opts.reference);
    if (references.length > 0) {
      console.log(chalk.cyan(`Loaded ${references.length} reference(s) from: ${opts.reference}`));
      for (const ref of references) {
        console.log(chalk.gray(`  - ${ref.name} (${ref.steps.length} steps, ${ref.screenshots.length} screenshots)`));
      }
      referenceContent = formatReferencesForPrompt(references);
    } else {
      console.log(chalk.yellow(`No references found at: ${opts.reference}`));
    }
  }

  if (opts.codegen) {
    if (!opts.url) {
      console.error(chalk.red('--url is required with --codegen'));
      process.exit(1);
    }
    await launchCodegen(opts.url, opts.headed ?? opts.config.headed);
    return { files: [] };
  }

  if (opts.plan) {
    const planContent = readArtifact('plans', opts.plan, opts.config.outputDir);

    if (opts.extract) {
      const blocks = extractCodeBlocks(planContent);
      if (blocks.length > 0) {
        const saved = saveExtractedTests(blocks, opts.config.outputDir);
        console.log(chalk.green(`Extracted ${saved.length} test file(s):`));
        for (const p of saved) console.log(chalk.gray(`  ${p}`));
        console.log('');
        return { files: saved };
      }
      console.log(chalk.yellow('No code blocks found in plan — falling back to opencode generation\n'));
    }

    const testCode = await generateFromPlan(planContent, opts.url, opts.config, referenceContent);
    const wrappedCode = wrapInTest(testCode, `generated-${Date.now()}`);
    const testFilename = `generated-${Date.now()}.spec.ts`;
    const testPath = saveTest(wrappedCode, testFilename, opts.config.outputDir);
    console.log(chalk.green(`Test generated: ${testPath}`));
    return { files: [testPath] };
  }

  console.error(chalk.red('Specify --plan <file> (with optional --extract) or --codegen'));
  process.exit(1);
}
