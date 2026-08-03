import chalk from 'chalk';
import { readFileSync, readdirSync, writeFileSync, existsSync, statSync, mkdirSync } from 'node:fs';
import { join, basename } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { opencodeRun, extractStructuredOutput } from '../lib/opencode.js';
import { saveTest, ensureArtifactsDir, readArtifact, extractCodeBlocks, saveExtractedTests, wrapInTest, getLatestFile } from '../lib/artifacts.js';
import { generatorPrompt } from '../lib/prompt-templates.js';
import { loadReferences, formatReferencesForPrompt } from '../lib/reference-loader.js';
import { annotateCodegenSpec } from '../lib/codegen-annotator.js';
import { Config, resolveProfile } from '../config.js';

const execFileAsync = promisify(execFile);

export interface GenerateOptions {
  url?: string;
  plan?: string;
  codegen?: boolean;
  extract?: boolean;
  headed?: boolean;
  profile?: string;
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
  referenceContent?: string,
  codegenFile?: string
): Promise<string> {
  console.log(chalk.cyan('Generating test code from plan...'));

  const context = url ? `Target URL: ${url}` : undefined;

  // Auto-inline any codegen-recorded scripts as reference material so the
  // generator can use real recorded interactions (with [eN] ref annotations).
  let finalReference = referenceContent;
  const codegen = loadCodegenReferences(config.outputDir, codegenFile);
  if (codegen.count > 0) {
    finalReference = finalReference ? `${finalReference}\n\n${codegen.text}` : codegen.text;
    console.log(chalk.gray(`  Inlined ${codegen.count} codegen script(s) as reference material`));
  }

  const prompt = generatorPrompt(planContent, context, finalReference);
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

export async function launchCodegen(url: string, storageState?: string, outputPath?: string): Promise<void> {
  console.log(chalk.cyan(`\nLaunching codegen for: ${url}\n`));
  if (storageState) {
    console.log(chalk.gray(`  Auth: ${storageState} (loaded via --load-storage)`));
  } else {
    console.log(chalk.yellow('  ⚠ No saved auth found — run `login` first to access protected pages'));
  }
  console.log(chalk.gray('  Codegen view: http://localhost:6080/vnc.html (noVNC)'));
  console.log(chalk.gray('  VNC client:   localhost:5900'));
  if (outputPath) {
    console.log(chalk.gray(`  Output file: ${outputPath}`));
  }
  console.log(chalk.gray('\n  Perform your actions in the browser, then close codegen — the generated script is saved to the output file.\n'));
  const args = ['codegen', '--target=playwright-test'];
  if (storageState) args.push('--load-storage', storageState);
  if (outputPath) args.push('--output', outputPath);
  args.push(url);

  try {
    await execFileAsync('npx', ['playwright', ...args], {
      timeout: 600000,
      stdio: 'inherit',
      env: { ...process.env, DISPLAY: process.env.DISPLAY || ':99' },
    } as any);
  } catch {
    // Codegen exits with an error on session close when saving output; not fatal
  }
  if (outputPath) {
    if (existsSync(outputPath)) {
      console.log(chalk.green(`\n✓ Codegen session ended`));
      console.log(chalk.green(`  Generated script saved: ${outputPath}`));
    } else {
      console.log(chalk.yellow(`\n  Codegen session ended — no script saved (${outputPath})`));
    }
  }
}

/**
 * Resolves the storageState file from a profile (directory or storageState file).
 * Directories (Chromium persistent profiles) are checked for a state.json inside.
 */
export function resolveStorageState(profile?: string): string | undefined {
  if (!profile) return undefined;
  const abs = profile.startsWith('/') ? profile : join(process.cwd(), profile);
  try {
    if (statSync(abs).isDirectory()) {
      const candidate = join(abs, 'state.json');
      return existsSync(candidate) ? candidate : undefined;
    }
  } catch {}
  return existsSync(abs) ? abs : undefined;
}

/**
 * Collects all saved codegen scripts (codegen-*.spec.ts) from the tests
 * output directory and formats them as AI reference material. An optional
 * extra file (e.g. an existing codegen/exploration script passed via
 * `--codegen <file>`) is inlined first when present.
 */
function loadCodegenReferences(outputDir: string, extraFile?: string): { text: string; count: number } {
  const testsDir = join(outputDir, 'tests');
  let files: string[];
  try {
    files = readdirSync(testsDir).filter((f) => /^codegen-.*\.spec\.ts$/.test(f));
  } catch {
    files = [];
  }
  files.sort();
  const extraName = extraFile ? basename(extraFile) : '';
  const inDir = new Set(files);
  if (extraName && !inDir.has(extraName)) files.unshift(extraName);
  if (files.length === 0) return { text: '', count: 0 };

  const sections = [
    'CODEGEN-RECORDED SCRIPTS (recorded via Playwright codegen against the live site):',
    'These scripts were captured from real user actions in the browser. Treat them as the authoritative source',
    'for locators, interaction order, and expected results. Each action line is annotated with [eN] refs from the',
    'accessibility snapshot where they could be resolved. IMPORTANT: [eN] refs are INFORMATIONAL COMMENTS ONLY -',
    'they are NOT real DOM attributes and must never be used as selectors. Translate them into getByRole()/',
    'getByText() locators; when a ref list shows multiple matches for a repeating element, disambiguate with .nth().',
    '',
  ];
  let count = 0;
  for (const f of files) {
    const path = f === extraName && extraFile ? extraFile : join(testsDir, f);
    let content: string;
    try {
      content = readFileSync(path, 'utf-8');
    } catch {
      continue;
    }
    sections.push(`--- ${f} ---`);
    sections.push(content);
    sections.push('');
    count++;
  }
  return { text: sections.join('\n'), count };
}

/**
 * Post-processes a freshly saved codegen script, annotating its locators with
 * [eN] refs resolved from the latest explore snapshot (repeating elements get
 * the full ref list plus a .nth() hint).
 */
export function annotateCodegenOutput(outputPath: string, outputDir: string): void {
  if (!existsSync(outputPath)) return;
  const snapshotPath = getLatestFile('explore', outputDir);
  if (!snapshotPath) return;
  try {
    const snapshot = readFileSync(snapshotPath, 'utf-8');
    const code = readFileSync(outputPath, 'utf-8');
    const annotated = annotateCodegenSpec(code, snapshot);
    if (annotated !== code) {
      writeFileSync(outputPath, annotated, 'utf-8');
      console.log(chalk.gray(`  Annotated ${basename(outputPath)} with element refs (from ${basename(snapshotPath)})`));
    }
  } catch (err) {
    console.log(chalk.gray(`  Skipped ref annotation: ${(err as Error).message}`));
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
    const profile = resolveProfile(opts.profile, opts.config);
    if (profile) {
      console.log(chalk.gray(`  Profile: ${profile}`));
    }
    const storageState = resolveStorageState(profile);
    const testsDir = join(opts.config.outputDir, 'tests');
    mkdirSync(testsDir, { recursive: true });
    const outputPath = join(testsDir, `codegen-${Date.now()}.spec.ts`);
    await launchCodegen(opts.url, storageState, outputPath);
    annotateCodegenOutput(outputPath, opts.config.outputDir);
    return { files: [outputPath] };
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
