import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const PROMPTS_DIR = 'templates/prompts';

/**
 * Resolves the prompts directory, preferring the project cwd (which is where
 * artifacts/, templates/, etc. live) and falling back to a path relative to
 * this module (works from src/ under tsx and dist/ after a tsc build).
 */
function promptsDir(): string {
  const fromCwd = join(process.cwd(), PROMPTS_DIR);
  if (existsSync(fromCwd)) return fromCwd;
  const fromModule = join(dirname(fileURLToPath(import.meta.url)), '..', '..', PROMPTS_DIR);
  if (existsSync(fromModule)) return fromModule;
  throw new Error(`Prompt templates not found (looked in ${fromCwd} and ${fromModule})`);
}

/** Loads a prompt template file from templates/prompts/<name>.md. */
function loadPrompt(name: string): string {
  const filePath = join(promptsDir(), `${name}.md`);
  return readFileSync(filePath, 'utf-8');
}

/** Replaces {{key}} placeholders in a template with the supplied values. */
function fillPrompt(template: string, vars: Record<string, string>): string {
  let out = template;
  for (const [key, value] of Object.entries(vars)) {
    out = out.split(`{{${key}}}`).join(value ?? '');
  }
  return out;
}

/**
 * Generates a prompt for the AI explorer to identify testable user flows from a snapshot.
 * @param snapshotContent - Playwright accessibility snapshot content
 * @returns Formatted prompt string for the AI
 */
export function explorerPrompt(snapshotContent: string): string {
  return fillPrompt(loadPrompt('explorer'), { snapshotContent });
}

/**
 * Generates a prompt for the AI planner to create a structured test plan.
 *
 * @param snapshotContent - Playwright accessibility snapshot of the page
 * @param context - Additional context (element maps, multi-page snapshots, site structure)
 * @param requirements - User-provided requirements or targets to test
 * @param referenceContent - User-provided test procedures and screenshots (from --reference flag)
 * @returns Formatted prompt string for the AI planner
 */
export function plannerPrompt(
  snapshotContent: string,
  context?: string,
  requirements?: string,
  referenceContent?: string
): string {
  const requirementsSection = requirements
    ? `\n\n## Requirements / Targets to Test (MANDATORY — COVER EVERY ITEM)\n${requirements}\n\nYour test plan MUST cover every requirement above. Map each requirement to at least one test case (TC-N).\n- If a requirement needs a page NOT in the snapshots below, add it to "## Pages to Explore" so the system explores it — do NOT skip or guess.\n- Prefer concrete, executable requirements over generic ones.`
    : '';
  const referenceSection = referenceContent
    ? `\n\n## User-Provided Reference Procedures (primary source for steps)\n${referenceContent}\n\nIMPORTANT: Use the user-provided test procedures above as the primary source for test steps and expected behavior.`
    : '';
  const contextSection = context
    ? `\n\nADDITIONAL CONTEXT (element maps, multi-page snapshots, site structure):\n${context}`
    : '';

  return fillPrompt(loadPrompt('planner'), {
    requirementsSection,
    referenceSection,
    snapshotContent,
    contextSection,
  });
}

/**
 * Generates a prompt for the AI to generate Playwright test code from a plan.
 *
 * @param planContent - The test plan content (markdown with test cases)
 * @param context - Additional context (e.g., target URL)
 * @param referenceContent - User-provided test procedures and screenshots (from --reference flag)
 * @param scopeNote - Optional note describing which subset of the plan this
 *   call must generate (e.g. "Generate ONLY test cases TC-1..TC-10 — batch 1/5
 *   of the full plan"). Keeps each agent request small so batches stay fast.
 * @returns Formatted prompt string for the AI generator
 */
export function generatorPrompt(
  planContent: string,
  context?: string,
  referenceContent?: string,
  scopeNote?: string
): string {
  const contextSection = context ? `\n\nADDITIONAL CONTEXT:\n${context}` : '';
  const referenceSection = referenceContent
    ? `\n\n${referenceContent}\n\nIMPORTANT: Use the user-provided test procedures above as the primary source for test steps, expected behavior, and assertions.`
    : '';
  const scopeSection = scopeNote ? `\n\nSCOPE:\n${scopeNote}\n` : '';

  return fillPrompt(loadPrompt('generator'), {
    testCases: planContent,
    contextSection,
    referenceSection,
    scopeSection,
  });
}

/**
 * Generates a prompt for the AI healer to fix a single failing test.
 *
 * @param testCode - The failing test code
 * @param errorOutput - The error output from the test run
 * @param snapshotContent - Optional fresh snapshot of the page at failure time
 * @returns Formatted prompt string for the AI healer
 */
export function healerPrompt(
  testCode: string,
  errorOutput: string,
  snapshotContent?: string
): string {
  const snapshotSection = snapshotContent
    ? `\n\nCURRENT PAGE SNAPSHOT:\n${snapshotContent}`
    : '';

  return fillPrompt(loadPrompt('healer'), {
    testCode,
    errorOutput,
    snapshotSection,
  });
}

/**
 * Generates a prompt for the AI healer to fix multiple failing tests and generate a corrected plan.
 *
 * @param snapshotContent - Fresh accessibility snapshot of the page after failures
 * @param failureContext - Detailed failure context including errors, test source, and snapshots
 * @param originalPlan - The original test plan (all test cases — passing and failing)
 * @returns Formatted prompt string for the AI healer plan
 */
export function healerPlanPrompt(
  snapshotContent: string,
  failureContext: string,
  originalPlan?: string
): string {
  const originalPlanSection = originalPlan
    ? `\nORIGINAL TEST PLAN (ALL test cases — passing and failing):
${originalPlan}
`
    : '';

  return fillPrompt(loadPrompt('healer-plan'), {
    snapshotContent,
    failureContext,
    originalPlanSection,
  });
}
