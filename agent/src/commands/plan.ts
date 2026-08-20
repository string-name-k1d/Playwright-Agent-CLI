import chalk from 'chalk';
import { readFileSync, existsSync } from 'node:fs';
import { join, basename } from 'node:path';
import { agentRun, extractMarkdown, resolveProviderName } from '../lib/agent-provider.js';
import { savePlan, ensureArtifactsDir, getLatestFile, isValidPlan, stripPreamble } from '../lib/artifacts.js';
import { plannerPrompt } from '../lib/prompt-templates.js';
import { exploreCommand } from './explore.js';
import {
  getExploreEntries,
  getLatestEntryForUrl,
  searchExploreEntries,
  getSnapshotContent,
  getSnapshotElements,
  getUnvisitedLinks,
  buildRegistrySummary,
  findExploreElements,
  formatExploreElement,
  type ExploreEntry,
} from '../lib/explore-registry.js';
import { getElementSummary } from '../lib/snapshot-parser.js';
import { loadReferences, formatReferencesForPrompt, type TestReference } from '../lib/reference-loader.js';
import { hostFromUrl, loadWebsiteProfileForHost, listWebsiteProfiles } from '../lib/website-profile.js';
import { siteMapContextForPrompt } from '../lib/site-map.js';
import { intFromEnv, truncateForPrompt } from '../lib/prompt-budget.js';
import { Config } from '../config.js';

const MAX_EXPLORE_DEPTH = 3;
const PLAN_MAX_PROMPT_CHARS = intFromEnv('PW_CLI_PLAN_MAX_PROMPT_CHARS', 180_000);
const PLAN_MAX_REF_CHARS = intFromEnv('PW_CLI_PLAN_MAX_REFERENCE_CHARS', 40_000);
const PLAN_MAX_SNAPSHOTS = intFromEnv('PW_CLI_PLAN_MAX_SNAPSHOTS', 3);

function extractExploreUrls(planContent: string): string[] {
  const urls: string[] = [];
  const pattern = /\[explore:\s*(.+?)\]/g;
  let m;
  while ((m = pattern.exec(planContent)) !== null) {
    const raw = m[1].trim();
    const clean = raw.replace(/[,\]\s\])]+$/, '');
    if (clean && !urls.includes(clean)) urls.push(clean);
  }
  return urls;
}

/** Extracts `[explore-expanded: <url>]` markers — pages that need an interactive
 *  re-exploration (droplists/tabs clicked) to capture hidden components. */
function extractExpandedExploreUrls(planContent: string): string[] {
  const urls: string[] = [];
  const pattern = /\[explore-expanded:\s*(.+?)\]/g;
  let m;
  while ((m = pattern.exec(planContent)) !== null) {
    const raw = m[1].trim();
    const clean = raw.replace(/[,\]\s\])]+$/, '');
    if (clean && !urls.includes(clean)) urls.push(clean);
  }
  return urls;
}

/** True when a plan leans on components hidden behind droplists/reveals/tabs —
 *  e.g. "List additional actions", "Toggle Actions", "Advanced Options",
 *  dropbuttons — which are absent from the DOM until the control is opened. */
function hasRevealKeyElements(planContent: string): boolean {
  return /droplist|additional actions|toggle actions|advanced options|hidden\s+(?:button|option|menu|control|action)|dropbutton/i.test(planContent);
}

function resolveUrl(raw: string, baseUrl?: string): string {
  if (raw.startsWith('http://') || raw.startsWith('https://')) return raw;
  if (raw.startsWith('/') && baseUrl) {
    try {
      const base = new URL(baseUrl);
      return `${base.origin}${raw}`;
    } catch {}
  }
  if (baseUrl) {
    try {
      return new URL(raw, baseUrl).href;
    } catch {}
  }
  return raw;
}

export interface PlanOptions {
  snapshot?: string;
  url?: string;
  model?: string;
  output?: string;
  prompt?: string;
  promptFile?: string;
  search?: string;
  explore?: boolean;
  reference?: string;
  codegenFile?: string;
  config: Config;
}

export async function planCommand(opts: PlanOptions): Promise<void> {
  ensureArtifactsDir(opts.config.outputDir);

  // ── Handle --search: query explore registry ────────────────────
  if (opts.search) {
    const results = searchExploreEntries(opts.search, opts.config.outputDir);
    if (results.length === 0) {
      console.log(chalk.yellow(`No explore records matching: ${opts.search}`));
    } else {
      console.log(chalk.cyan(`\nFound ${results.length} matching explore record(s):\n`));
      for (const e of results) {
        console.log(chalk.gray(`  ${e.url}`));
        console.log(chalk.gray(`    Title: ${e.title}`));
        console.log(chalk.gray(`    Elements: ${e.elementCount}, Links: ${e.linkCount}`));
        console.log(chalk.gray(`    Headings: ${e.headingCount.slice(0, 5).join(', ')}`));
        const matches = findExploreElements(e, opts.search, opts.config.outputDir).slice(0, 8);
        if (matches.length > 0) {
          console.log(chalk.gray(`    Matches (${matches.length}):`));
          for (const m of matches) {
            console.log(chalk.gray(`      ${formatExploreElement(m)}`));
          }
        }
        console.log('');
      }
    }
    // Also print the full registry summary
    console.log(chalk.cyan(buildRegistrySummary(opts.config.outputDir)));
    return;
  }

  // ── Resolve primary snapshot ───────────────────────────────────
  let snapshotContent: string;
  let primaryEntry: ExploreEntry | null = null;

  if (opts.snapshot) {
    console.log(chalk.cyan(`Reading snapshot: ${opts.snapshot}`));
    snapshotContent = readFileSync(opts.snapshot, 'utf-8');
  } else if (opts.url) {
    // Check registry first for an existing snapshot
    primaryEntry = getLatestEntryForUrl(opts.url, opts.config.outputDir);
    if (primaryEntry) {
      console.log(chalk.cyan(`Using cached snapshot for: ${opts.url}`));
      snapshotContent = getSnapshotContent(primaryEntry);
    } else {
      console.log(chalk.cyan('No snapshot found — running explore...'));
      const result = await exploreCommand({ url: opts.url, config: opts.config });
      primaryEntry = result.entry;
      snapshotContent = readFileSync(result.snapshotPath, 'utf-8');
    }
  } else {
    const latest = getLatestFile('explore', opts.config.outputDir);
    if (!latest) {
      console.error(chalk.red('No snapshot found. Provide --snapshot or --url.'));
      process.exit(1);
    }
    console.log(chalk.cyan(`Using latest snapshot: ${latest}`));
    snapshotContent = readFileSync(latest, 'utf-8');
  }

  // ── Handle --explore: explore unvisited pages from links ───────
  const additionalSnapshots: string[] = [];

  if (opts.explore && primaryEntry) {
    const unvisited = getUnvisitedLinks(primaryEntry, opts.config.outputDir);
    if (unvisited.length > 0) {
      console.log(chalk.cyan(`\nFound ${unvisited.length} unvisited link(s). Exploring top pages...\n`));

      // Prioritize internal links, limit to 3 to avoid overwhelming
      const internalLinks = unvisited
        .filter(l => {
          try {
            const u = new URL(l.url, primaryEntry!.url);
            return u.origin === new URL(primaryEntry!.url).origin;
          } catch {
            return false;
          }
        })
        .slice(0, 3);

      for (const link of internalLinks) {
        let resolvedUrl: string;
        try {
          resolvedUrl = new URL(link.url, primaryEntry!.url).href;
        } catch {
          resolvedUrl = link.url;
        }

        console.log(chalk.gray(`  Exploring: ${link.name || resolvedUrl}`));
        try {
          const result = await exploreCommand({ url: resolvedUrl, config: opts.config });
          additionalSnapshots.push(getSnapshotContent(result.entry));
        } catch (err: any) {
          console.log(chalk.yellow(`  Failed to explore ${resolvedUrl}: ${err.message}`));
        }
      }
    } else {
      console.log(chalk.gray('No unvisited internal links found.'));
    }
  }

  // ── Extract URLs from prompt and explore them ──────────────────
  if (opts.prompt) {
    const urlRegex = /https?:\/\/[^\s"'),]+/g;
    const promptUrls = opts.prompt.match(urlRegex) ?? [];

    for (const rawUrl of promptUrls) {
      const existing = getLatestEntryForUrl(rawUrl, opts.config.outputDir);
      if (!existing) {
        console.log(chalk.gray(`\nExploring URL from prompt: ${rawUrl}`));
        try {
          const result = await exploreCommand({ url: rawUrl, config: opts.config });
          additionalSnapshots.push(getSnapshotContent(result.entry));
        } catch (err: any) {
          console.log(chalk.yellow(`  Failed: ${err.message}`));
        }
      }
    }
  }

  // ── Load user references ───────────────────────────────────────
  let referenceContent: string | undefined;
  if (opts.reference) {
    const references = loadReferences(opts.reference);
    if (references.length > 0) {
      console.log(chalk.cyan(`Loaded ${references.length} reference(s) from: ${opts.reference}`));
      for (const ref of references) {
        console.log(chalk.gray(`  - ${ref.name} (${ref.steps.length} steps, ${ref.screenshots.length} screenshots)`));
      }
      referenceContent = truncateForPrompt(
        formatReferencesForPrompt(references),
        PLAN_MAX_REF_CHARS,
        'reference context',
      );
    } else {
      console.log(chalk.yellow(`No references found at: ${opts.reference}`));
    }
  }

  // ── Resolve requirements ───────────────────────────────────────
  let requirements: string | undefined;
  if (opts.prompt) {
    requirements = opts.prompt;
    console.log(chalk.gray(`Using inline prompt: "${opts.prompt.slice(0, 80)}${opts.prompt.length > 80 ? '...' : ''}"`));
  } else if (opts.promptFile) {
    console.log(chalk.gray(`Reading requirements from: ${opts.promptFile}`));
    requirements = readFileSync(opts.promptFile, 'utf-8');
  }

  // ── Extra context: structured site map + codegen reference ─────
  const extraContextParts: string[] = [];
  const siteProfiles = listWebsiteProfiles(opts.config.outputDir);
  if (siteProfiles.length > 0) {
    let profile = siteProfiles[0];
    if (opts.url) profile = loadWebsiteProfileForHost(hostFromUrl(opts.url), opts.config.outputDir) ?? profile;
    const mapText = siteMapContextForPrompt(profile);
    if (mapText) {
      extraContextParts.push(`\nSTRUCTURED SITE MAP (from per-site profile):\n${mapText}`);
    }
  }
  if (opts.codegenFile) {
    const codegenPath = opts.codegenFile.startsWith('/') || /^[a-zA-Z]:[\\/]/.test(opts.codegenFile)
      ? opts.codegenFile
      : join(process.cwd(), opts.codegenFile);
    if (existsSync(codegenPath)) {
      console.log(chalk.cyan(`Using existing codegen/exploration file as reference: ${codegenPath}`));
      const content = readFileSync(codegenPath, 'utf-8');
      extraContextParts.push(`\nRECORDED BROWSER SCRIPT (reference) — ${basename(codegenPath)}:\n${content}`);
    } else {
      console.log(chalk.yellow(`Codegen reference file not found: ${opts.codegenFile}`));
    }
  }
  const extraContext = extraContextParts.join('\n\n');

  // ── Explore-plan mini-loop ─────────────────────────────────────
  const baseUrl = opts.url ?? opts.config.targetUrl;
  let plan = '';
  const allSnapshots: string[] = [snapshotContent, ...additionalSnapshots];
  const expandedExplored = new Set<string>();

  for (let depth = 0; depth <= MAX_EXPLORE_DEPTH; depth++) {
    if (depth > 0) {
      console.log(chalk.cyan(`\nExplore-plan iteration ${depth}/${MAX_EXPLORE_DEPTH}`));
    }

    plan = await generatePlan(allSnapshots, requirements, referenceContent, opts, extraContext);

    if (!plan || plan.length < 20) {
      console.error(chalk.red('Plan output too short or empty'));
      process.exit(1);
    }

    // Collect exploration requests. Plain [explore: URL] requests a normal
    // snapshot; [explore-expanded: URL] (or a plan that leans on components
    // hidden behind droplists/reveals/tabs) requests an interactive expanded
    // exploration of that page so hidden components are captured too.
    const expandedUrls = extractExpandedExploreUrls(plan);
    if (hasRevealKeyElements(plan) && baseUrl && !expandedExplored.has(baseUrl)) {
      expandedUrls.push(baseUrl);
    }
    const requests = new Map<string, boolean>(); // url -> expanded
    for (const raw of extractExploreUrls(plan)) requests.set(resolveUrl(raw, baseUrl), false);
    for (const raw of expandedUrls) requests.set(resolveUrl(raw, baseUrl), true);
    for (const url of [...requests.keys()]) {
      if (requests.get(url) && expandedExplored.has(url)) requests.delete(url);
    }

    if (requests.size === 0) {
      console.log(chalk.gray('  No further exploration requested by planner'));
      break;
    }

    if (depth >= MAX_EXPLORE_DEPTH) {
      console.log(chalk.yellow(`  Max explore depth (${MAX_EXPLORE_DEPTH}) reached, skipping ${requests.size} pending page(s)`));
      break;
    }

    const expandedCount = [...requests.values()].filter(Boolean).length;
    console.log(chalk.cyan(`\nPlanner requested ${requests.size} page(s) to explore (${expandedCount} expanded):\n`));
    let explored = false;
    for (const [resolved, expanded] of requests) {
      const existing = getLatestEntryForUrl(resolved, opts.config.outputDir);
      // An expanded re-exploration is only useful if run live against the page
      // (the cached snapshot predates the interaction), so never reuse it.
      if (existing && !expanded) {
        const content = getSnapshotContent(existing);
        if (!allSnapshots.includes(content)) {
          allSnapshots.push(content);
          console.log(chalk.gray(`  Already explored: ${resolved} — added to context`));
          explored = true;
        } else {
          console.log(chalk.gray(`  Already in context: ${resolved}`));
        }
        continue;
      }
      console.log(chalk.gray(`  ${expanded ? 'Expanded explore (droplists/tabs): ' : 'Exploring: '}${resolved}`));
      try {
        const result = await exploreCommand({ url: resolved, config: opts.config, expanded });
        const content = getSnapshotContent(result.entry);
        allSnapshots.push(content);
        explored = true;
        if (expanded) expandedExplored.add(resolved);
      } catch (err: any) {
        console.log(chalk.yellow(`  Failed: ${err.message}`));
      }
    }

    if (!explored) {
      console.log(chalk.gray('  No new pages to explore — plan is stable'));
      break;
    }
  }

  const filename = opts.output ?? `plan-${Date.now()}.md`;
  const savedPath = savePlan(plan, filename, opts.config.outputDir);

  console.log(chalk.green(`Test plan saved: ${savedPath}`));
  console.log(chalk.gray('\n--- Plan Preview ---\n'));
  console.log(plan.slice(0, 2000));
  if (plan.length > 2000) console.log(chalk.gray('\n... (truncated)'));
  console.log('');
}

async function generatePlan(
  allSnapshots: string[],
  requirements: string | undefined,
  referenceContent: string | undefined,
  opts: PlanOptions,
  extraContext?: string
): Promise<string> {
  const snapshots = [
    allSnapshots[0],
    ...allSnapshots.slice(1, Math.max(1, PLAN_MAX_SNAPSHOTS)),
  ].filter(Boolean);
  const omittedSnapshots = Math.max(0, allSnapshots.length - snapshots.length);

  // Build context: element summaries + full snapshots
  const contextParts: string[] = [];
  for (let i = 0; i < snapshots.length; i++) {
    const parsed = await import('../lib/snapshot-parser.js');
    const elements = parsed.parseSnapshotElements(snapshots[i]);
    const summary = parsed.getElementSummary(elements);
    const label = i === 0 ? 'PRIMARY PAGE' : `PAGE ${i + 1}`;
    if (summary) contextParts.push(`${label} ELEMENT MAP:\n${summary}`);
    if (i === 0) {
      contextParts.push(`${label} SNAPSHOT:\n${snapshots[i]}`);
    } else {
      contextParts.push(`${label} SNAPSHOT: omitted for token budget (summary retained)`); 
    }
  }
  if (omittedSnapshots > 0) {
    contextParts.push(`\nTOKEN BUDGET: omitted ${omittedSnapshots} additional snapshot(s).`);
  }

  const allEntries = getExploreEntries(opts.config.outputDir);
  if (allEntries.length > 1) {
    contextParts.push(`\nSITE STRUCTURE (${allEntries.length} pages explored):\n${buildRegistrySummary(opts.config.outputDir)}`);
  }

  if (extraContext) contextParts.push(extraContext);

  const context = truncateForPrompt(contextParts.join('\n\n'), PLAN_MAX_PROMPT_CHARS, 'planner context');
  const prompt = truncateForPrompt(
    plannerPrompt(snapshots[0], context, requirements, referenceContent),
    PLAN_MAX_PROMPT_CHARS,
    'planner prompt',
  );

  const MAX_RETRIES = 2;
  let plan = '';
  let lastValidation: ReturnType<typeof isValidPlan> = { valid: false, score: 0, reason: '' };

  const dumpDiagnostics = (result: Awaited<ReturnType<typeof agentRun>>, stage: string): void => {
    const debug = `# Agent Debug — ${stage}\n\n` +
      `provider: ${result.provider}\nexitCode: ${result.exitCode}\n\n` +
      `## Raw output (${result.output.length} chars)\n\n\`\`\`\n${result.output}\n\`\`\`\n`;
    try {
      const debugPath = savePlan(debug, `plan-debug-${Date.now()}.md`, opts.config.outputDir);
      console.log(chalk.gray(`  Debug output saved: ${debugPath}`));
    } catch {
      // best-effort
    }
  };

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    if (attempt > 0) {
      console.log(chalk.yellow(`\nRetrying plan generation (attempt ${attempt + 1}/${MAX_RETRIES + 1}) — previous response was not a structured plan: ${lastValidation.reason}`));
    }

    const provider = resolveProviderName(opts.config);
    const result = await agentRun(prompt, { timeout: 300000 }, opts.config);

    const rawPlan = extractMarkdown(result);

    if (!rawPlan || rawPlan.length < 20) {
      if (result.exitCode !== 0) {
        const hint = provider === 'opencode' &&
          (result.output.includes('401') || result.output.includes('No provider available'))
          ? '\n  Hint: OpenCode API auth failed. Check your API key or try again later.'
          : provider === 'api'
            ? '\n  Hint: API request failed. Check AGENT_API_KEY / AGENT_API_BASE_URL or try again later.'
            : '';
        console.error(chalk.red(`Agent backend (${provider}) failed (exit ${result.exitCode})${hint}`));
        if (result.output.trim()) {
          console.log(chalk.gray('  Raw output preview:'));
          console.log(chalk.gray(result.output.slice(0, 800)));
        }
        process.exit(1);
      }
      console.log(chalk.yellow('  Agent returned no usable text — dumping raw output for diagnosis.'));
      dumpDiagnostics(result, 'short-or-empty');
      console.log(chalk.gray(`  Output preview: ${result.output.slice(0, 300).replace(/\n/g, ' ')}`));
      lastValidation = { valid: false, score: 0, reason: 'output too short or empty' };
      continue;
    }

    const stripped = stripPreamble(rawPlan);
    const toValidate = stripped.length > rawPlan.length * 0.5 ? stripped : rawPlan;

    lastValidation = isValidPlan(toValidate);

    if (lastValidation.valid) {
      plan = toValidate;
      if (toValidate !== rawPlan) {
        console.log(chalk.gray('  (stripped conversational preamble from response)'));
      }
      break;
    }

    if (attempt === MAX_RETRIES) {
      plan = toValidate;
      console.log(chalk.yellow(`  Warning: plan structure is weak (score ${lastValidation.score}): ${lastValidation.reason}`));
      console.log(chalk.yellow('  Saving anyway — review the plan for completeness.'));
      dumpDiagnostics(result, `invalid-score-${lastValidation.score}`);
    } else {
      console.log(chalk.yellow(`  Response failed validation (${lastValidation.reason}) — dumping raw output for diagnosis.`));
      dumpDiagnostics(result, `invalid-${lastValidation.reason}`);
    }
  }

  return plan;
}
