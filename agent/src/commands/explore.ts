import chalk from 'chalk';
import { existsSync, readdirSync, copyFileSync, statSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { pwOpen, pwSnapshot, pwScreenshot, pwClose, parseSnapshotPageInfo } from '../lib/pw-cli.js';
import { saveSnapshot, ensureArtifactsDir } from '../lib/artifacts.js';
import { registerExploreEntry, type ExploreEntry } from '../lib/explore-registry.js';
import { saveSiteProfile } from '../lib/site-profile.js';
import { Config, resolveProfile } from '../config.js';

export interface ExploreOptions {
  url: string;
  depth?: number;
  screenshot?: boolean;
  headed?: boolean;
  profile?: string;
  config: Config;
}

export interface ExploreResult {
  entry: ExploreEntry;
  snapshotPath: string;
}

export async function exploreCommand(opts: ExploreOptions): Promise<ExploreResult> {
  ensureArtifactsDir(opts.config.outputDir);

  const profile = resolveProfile(opts.profile, opts.config);
  console.log(chalk.cyan(`\nOpening: ${opts.url}\n`));

  const openResult = await pwOpen(opts.url, {
    headed: opts.headed ?? opts.config.headed,
    cliPath: opts.config.playwrightCliPath,
    profile,
  });

  if (openResult.exitCode !== 0) {
    console.error(chalk.red(`Failed to open site: ${openResult.stderr}`));
    process.exit(1);
  }

  console.log(chalk.green('Browser opened'));

  const snapFilename = `explore-${Date.now()}.yaml`;
  const snapResult = await pwSnapshot(snapFilename, {
    depth: opts.depth ?? opts.config.snapshotDepth,
    cliPath: opts.config.playwrightCliPath,
  });

  if (snapResult.exitCode !== 0) {
    console.error(chalk.red(`Snapshot failed: ${snapResult.stderr}`));
    await pwClose({ cliPath: opts.config.playwrightCliPath });
    process.exit(1);
  }

  const pageInfo = parseSnapshotPageInfo(snapResult.stdout);
  console.log(chalk.green(`Snapshot captured: ${pageInfo.snapshotPath ?? snapFilename}`));
  if (pageInfo.url) console.log(chalk.gray(`  URL: ${pageInfo.url}`));
  if (pageInfo.title) console.log(chalk.gray(`  Title: ${pageInfo.title}`));

  // Copy the actual YAML snapshot from .playwright-cli/ to artifacts
  const pwCliDir = join(process.cwd(), '.playwright-cli');
  let destPath = join(opts.config.outputDir, 'explore', snapFilename);
  try {
    const ymlFiles = readdirSync(pwCliDir)
      .filter(f => f.endsWith('.yml') && f.startsWith('page-'))
      .map(f => ({
        name: f,
        time: statSync(join(pwCliDir, f)).mtimeMs,
      }))
      .sort((a, b) => b.time - a.time);

    if (ymlFiles.length > 0) {
      const latestYml = join(pwCliDir, ymlFiles[0].name);
      copyFileSync(latestYml, destPath);
    }
  } catch {
    saveSnapshot(snapResult.stdout, snapFilename, opts.config.outputDir);
  }

  // Register in explore registry
  const entry = registerExploreEntry(
    pageInfo.url ?? opts.url,
    pageInfo.title ?? 'Untitled',
    destPath,
    snapFilename,
    opts.config.outputDir
  );
  console.log(chalk.gray(`  Elements: ${entry.elementCount}, Links: ${entry.linkCount}`));

  // Clean up stale YAML files left in CWD by playwright-cli
  const staleYamlPattern = /^explore-\d+\.yaml$/;
  for (const f of readdirSync(process.cwd())) {
    if (staleYamlPattern.test(f)) {
      try { unlinkSync(join(process.cwd(), f)); } catch {}
    }
  }

  if (opts.screenshot) {
    const imgFilename = `explore-${Date.now()}.png`;
    const imgResult = await pwScreenshot(imgFilename, {
      cliPath: opts.config.playwrightCliPath,
    });
    if (imgResult.exitCode === 0) {
      console.log(chalk.green(`Screenshot saved: ${imgFilename}`));
    } else {
      console.log(chalk.yellow(`Screenshot failed: ${imgResult.stderr}`));
    }
  }

  await pwClose({ cliPath: opts.config.playwrightCliPath });

  // Regenerate site profile
  const profilePath = saveSiteProfile(opts.config.outputDir);
  if (profilePath) {
    console.log(chalk.gray(`  Site profile: ${profilePath}`));
  }

  console.log(chalk.green('\nExploration complete\n'));

  return { entry, snapshotPath: destPath };
}
