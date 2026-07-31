import chalk from 'chalk';
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { exploreCommand } from './explore.js';
import { planCommand } from './plan.js';
import { extractTestsFromPlan, generateFromPlan } from './generate.js';
import { runPlaywrightTest, saveTestResult, cleanupRunDir, RUN_DIR } from './test.js';
import { healCommand } from './heal.js';
import { ensureArtifactsDir, getLatestFile, wrapInTest, parsePlanTestCases, computeDependencyLevels, extractCodeBlocks } from '../lib/artifacts.js';
import { Config, resolveProfile } from '../config.js';

const execFileAsync = promisify(execFile);

interface AutorunState {
  runId: string;
  step: string;
  iteration: number;
  maxIterations: number;
  url: string;
  headed: boolean;
  prompt?: string;
  promptFile?: string;
  profile?: string;
  snapshotPath?: string;
  planPath?: string;
  testFiles: string[];
  allPassed: boolean;
  exploredUrls: string[];
  startedAt: string;
  updatedAt: string;
}

const AUTORUN_DIR = join(process.cwd(), 'artifacts', 'results');

function getStatePath(runId: string): string {
  return join(AUTORUN_DIR, `autorun-${runId}`, 'state.json');
}

function saveState(state: AutorunState): void {
  const dir = join(AUTORUN_DIR, `autorun-${state.runId}`);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  state.updatedAt = new Date().toISOString();
  writeFileSync(getStatePath(state.runId), JSON.stringify(state, null, 2), 'utf-8');
}

function loadState(runId: string): AutorunState | null {
  const path = getStatePath(runId);
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, 'utf-8'));
}

function banner(msg: string): void {
  console.log(chalk.bold('\n═══════════════════════════════════════════════'));
  console.log(chalk.bold(`  pw-cli-agent · ${msg}`));
  console.log(chalk.bold('═══════════════════════════════════════════════\n'));
}

function step(msg: string): void {
  console.log(chalk.cyan.bold(`\n── ${msg} ──`));
  console.log(chalk.gray('─'.repeat(60)));
}

function substep(msg: string): void {
  console.log(chalk.gray(`  → ${msg}`));
}

function cleanupAutorunRun(): void {
  if (existsSync(RUN_DIR)) {
    rmSync(RUN_DIR, { recursive: true, force: true });
  }
}

// ── Pipeline steps ──────────────────────────────────────────────

async function doExplore(url: string, headed: boolean, config: Config, profile?: string): Promise<string> {
  step('Explore');
  await exploreCommand({ url, headed, config, profile });
  const snap = getLatestFile('explore', config.outputDir);
  if (!snap) throw new Error('No snapshot produced');
  substep(`Snapshot: ${snap}`);
  return snap;
}

async function doPlan(snapshotPath: string, url: string, config: Config, prompt?: string, promptFile?: string): Promise<string> {
  step('Plan');
  await planCommand({ snapshot: snapshotPath, url, prompt, promptFile, config });
  const plan = getLatestFile('plans', config.outputDir);
  if (!plan) throw new Error('No plan produced');
  substep(`Plan: ${plan}`);
  return plan;
}

async function doGenerate(planPath: string, url: string | undefined, config: Config): Promise<string[]> {
  step('Generate');
  const planContent = readFileSync(planPath, 'utf-8');

  // Try extracting code blocks first
  try {
    const files = await extractTestsFromPlan(planContent, config.outputDir, url);
    if (files.length > 0) {
      substep(`Extracted ${files.length} test file(s)`);
      return files;
    }
  } catch {
    // No code blocks found — fall through to opencode generation
  }

  // Fallback to opencode generation
  console.log(chalk.yellow('No code blocks in plan — generating via opencode...'));
  const testCode = await generateFromPlan(planContent, url, config);
  const wrappedCode = wrapInTest(testCode, `generated-${Date.now()}`);
  const testFilename = `generated-${Date.now()}.spec.ts`;
  const { saveTest } = await import('../lib/artifacts.js');
  const testPath = saveTest(wrappedCode, testFilename, config.outputDir);
  substep(`Generated: ${testPath}`);
  return [testPath];
}

async function doTest(testFiles: string[], headed: boolean, config: Config, storageState?: string, planPath?: string): Promise<boolean> {
  step('Test');

  // Map test files to dependency levels from the plan so dependent tests
  // run after the tests they depend on (parallel within each level).
  let fileLevels: Map<string, number> | undefined;
  if (planPath) {
    try {
      const planContent = readFileSync(planPath, 'utf-8');
      const testCases = parsePlanTestCases(planContent);
      if (testCases.length > 0) {
        const levels = computeDependencyLevels(testCases);
        const blocks = extractCodeBlocks(planContent);
        fileLevels = new Map();
        for (const block of blocks) {
          if (!block.testId) continue;
          const level = levels.get(block.testId) ?? 0;
          const match = testFiles.find(f => f.endsWith(block.filename));
          if (match) fileLevels.set(match, level);
        }
        if (fileLevels.size === 0) fileLevels = undefined;
      }
    } catch {
      fileLevels = undefined;
    }
  }
  if (fileLevels) {
    substep('Tests have dependencies — running in dependency-ordered waves (parallel within each wave)');
  }

  // Create a single run directory for all tests in this iteration
  const resultsDir = join(config.outputDir, 'results');
  if (!existsSync(resultsDir)) mkdirSync(resultsDir, { recursive: true });
  const runId = `run-${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}`;
  const sharedRunDir = join(resultsDir, runId);
  mkdirSync(sharedRunDir, { recursive: true });

  // Run all test files in a single parallel Playwright invocation
  substep(`Running ${testFiles.length} file(s) with parallel workers...`);
  cleanupAutorunRun();
  mkdirSync(RUN_DIR, { recursive: true });

  try {
    const result = await runPlaywrightTest(testFiles, headed, undefined, storageState, undefined, undefined, fileLevels);
    console.log(result.output);

    // Save combined result under each test file for compatibility
    for (const testFile of testFiles) {
      saveTestResult(result, testFile, config.outputDir, sharedRunDir);
    }
    substep(`Results: ${sharedRunDir}`);

    return result.passed;
  } catch (err: any) {
    console.error(chalk.red(`Test error: ${err.message}`));
    return false;
  } finally {
    cleanupAutorunRun();
  }
}

async function doHeal(url: string | undefined, headed: boolean, config: Config, snapshotPath?: string, profile?: string, testFiles?: string[], planPath?: string): Promise<string> {
  step('Heal');
  const result = await healCommand({
    url,
    headed,
    snapshotPath,
    quiet: true,
    profile,
    config,
    testFiles,
    planPath,
  });

  if (result.failureCount === 0) {
    substep('No failures to heal');
    return '';
  }

  substep(`Healing plan: ${result.planPath}`);
  return result.planPath;
}

// ── Main loop ───────────────────────────────────────────────────

export interface AutorunOptions {
  url: string;
  headed?: boolean;
  prompt?: string;
  promptFile?: string;
  maxIterations?: number;
  resume?: string;
  profile?: string;
  config: Config;
}

export async function autorunCommand(opts: AutorunOptions): Promise<void> {
  ensureArtifactsDir(opts.config.outputDir);

  let state: AutorunState;

  if (opts.resume) {
    const loaded = loadState(opts.resume);
    if (!loaded) {
      console.error(chalk.red(`No saved state found for run: ${opts.resume}`));
      process.exit(1);
    }
    state = loaded;
    banner(`autorun · resume ${opts.resume}`);
    console.log(chalk.gray(`  Resuming from step: ${state.step}, iteration: ${state.iteration}`));

    // If resuming from 'test' and tests failed, skip to heal
    if (state.step === 'test' && !state.allPassed) {
      console.log(chalk.yellow('  Tests failed — redirecting to heal'));
      state.step = 'heal';
    }
  } else {
    const runId = Date.now().toString(36);

    // Extract URL from prompt — prefer prompt URL over --url if present
    let url: string = opts.url;
    if (opts.prompt) {
      const urlRegex = /https?:\/\/[^\s"'),]+/g;
      const match = opts.prompt.match(urlRegex);
      if (match && match.length > 0) {
        url = match[0];
        console.log(chalk.gray(`  Extracted URL from prompt: ${url}`));
      }
    }

    state = {
      runId,
      step: 'explore',
      iteration: 1,
      maxIterations: opts.maxIterations ?? 3,
      url,
      headed: opts.headed ?? false,
      prompt: opts.prompt,
      promptFile: opts.promptFile,
      profile: opts.profile,
      testFiles: [],
      allPassed: false,
      exploredUrls: [],
      startedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    banner('autorun');
    console.log(chalk.gray(`  Run ID: ${state.runId}`));
    console.log(chalk.gray(`  URL:    ${state.url}`));
    console.log(chalk.gray(`  Model:  ${opts.config.opencodeModel ?? 'default'}`));
    console.log(chalk.gray(`  Max iterations: ${state.maxIterations}`));
  }

  const startTime = Date.now();
  const config = { ...opts.config };
  const profile = resolveProfile(opts.profile, config);
  if (profile) {
    console.log(chalk.gray(`  Profile: ${profile}`));
  }

  try {
    // ── Explore initial URL (planner will request additional pages) ──
    if (state.step === 'explore') {
      state.snapshotPath = await doExplore(state.url, state.headed, config, profile);
      state.exploredUrls.push(state.url);
      state.step = 'plan';
      saveState(state);
    }

    // ── Loop: plan → generate → test → heal ──────────────────────
    while (state.iteration <= state.maxIterations) {
      console.log(chalk.bold(`\n╔═══════════════════════════════════════════════╗`));
      console.log(chalk.bold(`║  Iteration ${state.iteration}/${state.maxIterations}`));
      console.log(chalk.bold(`╚═══════════════════════════════════════════════╝`));

      // Heal (if resuming from heal step or after test failure)
      if (state.step === 'heal') {
        if (state.iteration < state.maxIterations) {
          const healPlanPath = await doHeal(state.url, state.headed, config, state.snapshotPath, state.profile, state.testFiles, state.planPath);
          if (healPlanPath) {
            state.planPath = healPlanPath;
          }
          state.step = 'generate';
          state.iteration++;
          saveState(state);
        } else {
          console.log(chalk.yellow(`\nMax iterations (${state.maxIterations}) reached`));
          break;
        }
      }

      // Plan
      if (state.step === 'plan') {
        if (!state.snapshotPath) {
          console.error(chalk.red('No snapshot path — cannot plan'));
          break;
        }
        state.planPath = await doPlan(
          state.snapshotPath, state.url, config,
          state.prompt, state.promptFile
        );
        state.step = 'generate';
        saveState(state);
      }

      // Generate
      if (state.step === 'generate') {
        if (!state.planPath) {
          console.error(chalk.red('No plan path — cannot generate'));
          break;
        }
        state.testFiles = await doGenerate(state.planPath, state.url, config);
        if (state.testFiles.length === 0) {
          console.error(chalk.red('No test files produced — aborting'));
          break;
        }
        state.step = 'test';
        saveState(state);
      }

      // Test
      if (state.step === 'test') {
        state.allPassed = await doTest(state.testFiles, state.headed, config, profile, state.planPath);
        saveState(state);

        if (state.allPassed) {
          console.log(chalk.green.bold('\n✓ All tests passed — stopping loop\n'));
          break;
        }
      }

      // Heal (if not last iteration)
      if (state.iteration < state.maxIterations) {
        if (state.step === 'test' || state.step === 'heal') {
          const healPlanPath = await doHeal(state.url, state.headed, config, state.snapshotPath, state.profile, state.testFiles, state.planPath);
          if (healPlanPath) {
            state.planPath = healPlanPath;
          }
          state.step = 'generate';
          state.iteration++;
          saveState(state);
        }
      } else {
        console.log(chalk.yellow(`\nMax iterations (${state.maxIterations}) reached`));
        break;
      }
    }
  } catch (err: any) {
    console.error(chalk.red(`\nAutorun failed: ${err.message}`));
    saveState(state);
    process.exit(1);
  }

  // ── Final summary ──────────────────────────────────────────────
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

  state.allPassed = state.allPassed || false;
  saveState(state);

  console.log(chalk.bold('\n═══════════════════════════════════════════════'));
  if (state.allPassed) {
    console.log(chalk.green.bold('  ✓ All tests passed'));
  } else {
    console.log(chalk.red.bold('  ✗ Some tests failed'));
  }
  console.log(chalk.gray(`  Run ID:   ${state.runId}`));
  console.log(chalk.gray(`  Iters:    ${state.iteration}/${state.maxIterations}`));
  console.log(chalk.gray(`  Elapsed:  ${elapsed}s`));
  console.log(chalk.gray(`  Resume:   pw-cli-agent autorun --resume ${state.runId}`));
  console.log(chalk.gray(`  Artifacts: ${config.outputDir}`));
  console.log(chalk.bold('═══════════════════════════════════════════════\n'));

  process.exit(state.allPassed ? 0 : 1);
}
