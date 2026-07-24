import chalk from 'chalk';
import { pwOpen, pwSnapshot, pwScreenshot, pwClose, parseSnapshotPageInfo } from '../lib/pw-cli.js';
import { saveSnapshot, ensureArtifactsDir } from '../lib/artifacts.js';
import { Config } from '../config.js';

export interface ExploreOptions {
  url: string;
  depth?: number;
  screenshot?: boolean;
  headed?: boolean;
  config: Config;
}

export async function exploreCommand(opts: ExploreOptions): Promise<void> {
  ensureArtifactsDir(opts.config.outputDir);

  console.log(chalk.cyan(`\nOpening: ${opts.url}\n`));

  const openResult = await pwOpen(opts.url, {
    headed: opts.headed ?? opts.config.headed,
    cliPath: opts.config.playwrightCliPath,
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

  saveSnapshot(snapResult.stdout, snapFilename, opts.config.outputDir);

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
  console.log(chalk.green('\nExploration complete\n'));
}
