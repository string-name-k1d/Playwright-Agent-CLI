import chalk from 'chalk';
import { readFileSync } from 'node:fs';
import { opencodeRun, extractMarkdown } from '../lib/opencode.js';
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
  type ExploreEntry,
} from '../lib/explore-registry.js';
import { getElementSummary } from '../lib/snapshot-parser.js';
import { loadReferences, formatReferencesForPrompt, type TestReference } from '../lib/reference-loader.js';
import { Config } from '../config.js';

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

  // ── Build context from all explore records ─────────────────────
  const contextParts: string[] = [];

  // Add primary snapshot element summary
  if (primaryEntry) {
    const primaryElements = getSnapshotElements(primaryEntry);
    const summary = getElementSummary(primaryElements);
    if (summary) {
      contextParts.push(`PRIMARY PAGE ELEMENT MAP:\n${summary}`);
    }
  }

  // Add additional snapshots
  if (additionalSnapshots.length > 0) {
    contextParts.push('\nADDITIONAL PAGE SNAPSHOTS:');
    for (const snap of additionalSnapshots) {
      contextParts.push(snap);
    }
  }

  // Add registry summary if there are multiple records
  const allEntries = getExploreEntries(opts.config.outputDir);
  if (allEntries.length > 1) {
    contextParts.push(`\nSITE STRUCTURE (${allEntries.length} pages explored):\n${buildRegistrySummary(opts.config.outputDir)}`);
  }

  const context = contextParts.length > 0 ? contextParts.join('\n\n') : undefined;

  // ── Load user references ───────────────────────────────────────
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

  // ── Resolve requirements ───────────────────────────────────────
  let requirements: string | undefined;
  if (opts.prompt) {
    requirements = opts.prompt;
    console.log(chalk.gray(`Using inline prompt: "${opts.prompt.slice(0, 80)}${opts.prompt.length > 80 ? '...' : ''}"`));
  } else if (opts.promptFile) {
    console.log(chalk.gray(`Reading requirements from: ${opts.promptFile}`));
    requirements = readFileSync(opts.promptFile, 'utf-8');
  }

  // ── Generate plan ──────────────────────────────────────────────
  console.log(chalk.cyan('\nGenerating test plan via opencode...\n'));

  const prompt = plannerPrompt(snapshotContent, context, requirements, referenceContent);
  const MAX_RETRIES = 2;
  let plan = '';
  let lastValidation: ReturnType<typeof isValidPlan> = { valid: false, score: 0, reason: '' };

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    if (attempt > 0) {
      console.log(chalk.yellow(`\nRetrying plan generation (attempt ${attempt + 1}/${MAX_RETRIES + 1}) — previous response was not a structured plan: ${lastValidation.reason}`));
    }

    const result = await opencodeRun(prompt, {
      model: opts.model ?? opts.config.opencodeModel,
      timeout: 300000,
    });

    const rawPlan = extractMarkdown(result);

    if (!rawPlan || rawPlan.length < 20) {
      if (result.exitCode !== 0) {
        const hint = result.output.includes('401') || result.output.includes('No provider available')
          ? '\n  Hint: OpenCode API auth failed. Check your API key or try again later.'
          : '';
        console.error(chalk.red(`OpenCode failed (exit ${result.exitCode})${hint}`));
        process.exit(1);
      }
      lastValidation = { valid: false, score: 0, reason: 'output too short or empty' };
      continue;
    }

    // First: try stripping preamble
    const stripped = stripPreamble(rawPlan);
    const toValidate = stripped.length > rawPlan.length * 0.5 ? stripped : rawPlan;

    // Validate structure
    lastValidation = isValidPlan(toValidate);

    if (lastValidation.valid) {
      plan = toValidate;
      if (toValidate !== rawPlan) {
        console.log(chalk.gray('  (stripped conversational preamble from response)'));
      }
      break;
    }

    // On last attempt, use the best we have (stripped version)
    if (attempt === MAX_RETRIES) {
      plan = toValidate;
      console.log(chalk.yellow(`  Warning: plan structure is weak (score ${lastValidation.score}): ${lastValidation.reason}`));
      console.log(chalk.yellow('  Saving anyway — review the plan for completeness.'));
    }
  }

  if (!plan || plan.length < 20) {
    console.error(chalk.red('Plan output too short or empty'));
    process.exit(1);
  }

  const filename = opts.output ?? `plan-${Date.now()}.md`;
  const savedPath = savePlan(plan, filename, opts.config.outputDir);

  console.log(chalk.green(`Test plan saved: ${savedPath}`));
  console.log(chalk.gray('\n--- Plan Preview ---\n'));
  console.log(plan.slice(0, 2000));
  if (plan.length > 2000) console.log(chalk.gray('\n... (truncated)'));
  console.log('');
}
