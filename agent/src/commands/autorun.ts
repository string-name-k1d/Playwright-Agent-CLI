import chalk from 'chalk';
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { join, isAbsolute, basename } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { exploreCommand } from './explore.js';
import { planCommand } from './plan.js';
import { extractTestsFromPlan, generateFromPlan, launchCodegen, annotateCodegenOutput, resolveStorageState } from './generate.js';
import { runPlaywrightTest, saveTestResult, cleanupRunDir, RUN_DIR } from './test.js';
import { healCommand } from './heal.js';
import { ensureArtifactsDir, getLatestFile, parsePlanTestCases, computeDependencyLevels, extractCodeBlocks } from '../lib/artifacts.js';
import { hostFromUrl, profileFileFor } from '../lib/website-profile.js';
import { siteMapFileFor, loadSiteMap } from '../lib/site-map.js';
import { refreshWebsiteProfile } from '../lib/profile-refresh.js';
import { Config, resolveProfile, httpCredentialsFor } from '../config.js';

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
  codegen?: boolean | string;
  codegenPath?: string;
  snapshotPath?: string;
  planPath?: string;
  testFiles: string[];
  batchSize?: number;
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

async function doPlan(snapshotPath: string, url: string, config: Config, prompt?: string, promptFile?: string, codegenPath?: string): Promise<string> {
  step('Plan');
  await planCommand({ snapshot: snapshotPath, url, prompt, promptFile, codegenFile: codegenPath, config });
  const plan = getLatestFile('plans', config.outputDir);
  if (!plan) throw new Error('No plan produced');
  substep(`Plan: ${plan}`);
  return plan;
}

async function doCodegen(url: string, config: Config, profile?: string): Promise<string> {
  step('Codegen');
  console.log(chalk.gray('  Record the target flow in the browser (noVNC: http://localhost:6080/vnc.html, VNC: localhost:5900).'));
  console.log(chalk.gray('  Close codegen when done — the script is saved, annotated with element refs, and used as'));
  console.log(chalk.gray('  reference material by the AI generator when producing tests from the plan.'));
  const testsDir = join(config.outputDir, 'tests');
  mkdirSync(testsDir, { recursive: true });
  const outputPath = join(testsDir, `codegen-${Date.now()}.spec.ts`);
  const storageState = resolveStorageState(profile);
  await launchCodegen(url, storageState, outputPath);
  annotateCodegenOutput(outputPath, config.outputDir);
  substep(`Codegen script: ${outputPath}`);
  return outputPath;
}

async function doGenerate(planPath: string, url: string | undefined, config: Config, codegenPath?: string, batchSize?: number): Promise<string[]> {
  step('Generate');
  const planContent = readFileSync(planPath, 'utf-8');

  // When an existing codegen/exploration file is supplied as a reference,
  // skip extraction and force opencode generation so the recorded script is
  // inlined as authoritative reference material for locators/interactions.
  if (codegenPath) {
    console.log(chalk.gray(`  Using existing codegen/exploration file as reference: ${codegenPath}`));
    const files = await generateFromPlan(planContent, url, config, undefined, codegenPath, batchSize);
    substep(`Generated ${files.length} test file(s)`);
    return files;
  }

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
  const files = await generateFromPlan(planContent, url, config, undefined, undefined, batchSize);
  substep(`Generated ${files.length} test file(s)`);
  return files;
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
    const result = await runPlaywrightTest(testFiles, headed, undefined, storageState, undefined, undefined, fileLevels, httpCredentialsFor(config));
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
  codegen?: boolean | string;
  batchSize?: number;
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
      codegen: opts.codegen,
      batchSize: opts.batchSize,
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
    if (state.batchSize) console.log(chalk.gray(`  Generation batch size: ${state.batchSize}`));
    if (state.codegen) console.log(chalk.gray(`  Codegen: ${typeof state.codegen === 'string' ? `use existing file as reference: ${state.codegen}` : 'record a flow (ref-annotated) before planning'}`));
  }

  const startTime = Date.now();
  const config = { ...opts.config };
  // Resolve the profile (explicit flag > persisted state > auto-detected ./auth-profile)
  // and persist it so every step (explore, codegen, test, heal) uses the same auth.
  const profile = resolveProfile(opts.profile ?? state.profile, config);
  if (profile) {
    if (!state.profile) state.profile = profile;
    console.log(chalk.gray(`  Profile: ${profile}`));
  }

  try {
    // ── Explore initial URL (planner will request additional pages) ──
    if (state.step === 'explore') {
      state.snapshotPath = await doExplore(state.url, state.headed, config, profile);
      state.exploredUrls.push(state.url);
      // Profile-exploration integration: surface the per-site profile + site
      // map that were (re)built from this explore so subsequent plan/generate
      // steps have structured route + selector context.
      const host = hostFromUrl(state.url);
      substep(`Website profile: ${profileFileFor(state.url, config.outputDir)}`);
      const map = loadSiteMap(host, config.outputDir);
      if (map) {
        substep(`Site map: ${map.routes.length} route(s) — ${siteMapFileFor(host, config.outputDir)}`);
      } else {
        substep('Site map: not available yet (regenerates as pages are explored)');
      }
      state.step = state.codegen ? 'codegen' : 'plan';
      saveState(state);
    }

    // ── Loop: plan → generate → test → heal ──────────────────────
    while (state.iteration <= state.maxIterations) {
      console.log(chalk.bold(`\n╔═══════════════════════════════════════════════╗`));
      console.log(chalk.bold(`║  Iteration ${state.iteration}/${state.maxIterations}`));
      console.log(chalk.bold(`╚═══════════════════════════════════════════════╝`));

      // Optional one-time codegen (runs before planning, once). When a file
      // path is given, use the existing codegen/exploration file as reference
      // instead of recording a new flow.
      if (state.step === 'codegen') {
        if (!state.snapshotPath) {
          console.error(chalk.red('No snapshot path — cannot record codegen'));
          break;
        }
        if (typeof state.codegen === 'string' && state.codegen.trim() !== '') {
          const file = state.codegen;
          const resolved = isAbsolute(file) ? file : join(process.cwd(), file);
          if (!existsSync(resolved)) {
            console.error(chalk.red(`Codegen reference file not found: ${file}`));
            break;
          }
          annotateCodegenOutput(resolved, config.outputDir);
          state.codegenPath = resolved;
          substep(`Using existing codegen/exploration file as reference: ${resolved}`);
        } else {
          state.codegenPath = await doCodegen(state.url, config, profile);
        }
        state.step = 'plan';
        saveState(state);
      }

      // Heal (if resuming from heal step or after test failure)
      if (state.step === 'heal') {
        if (state.iteration < state.maxIterations) {
          const healPlanPath = await doHeal(state.url, state.headed, config, state.snapshotPath, profile, state.testFiles, state.planPath);
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
          state.prompt, state.promptFile, state.codegenPath
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
        state.testFiles = await doGenerate(state.planPath, state.url, config, state.codegenPath, state.batchSize);
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
          console.log(chalk.green.bold('\n✓ All tests passed — refreshing website profile\n'));
          try {
            const refresh = await refreshWebsiteProfile({
              url: state.url,
              headed: state.headed,
              profile,
              config,
            });
            substep(`Profile refresh: ${refresh.added} new page(s) added (${refresh.total} total)`);
          } catch (err: any) {
            console.log(chalk.yellow(`  Profile refresh failed: ${err.message}`));
          }
          break;
        }
      }

      // Heal (if not last iteration)
      if (state.iteration < state.maxIterations) {
        if (state.step === 'test' || state.step === 'heal') {
          const healPlanPath = await doHeal(state.url, state.headed, config, state.snapshotPath, profile, state.testFiles, state.planPath);
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
