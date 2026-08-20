import chalk from 'chalk';
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { saveReport, ensureArtifactsDir, listArtifacts } from '../lib/artifacts.js';
import { Config } from '../config.js';

export interface ReportOptions {
  format?: 'md' | 'html' | 'json';
  output?: string;
  config: Config;
}

/** GitHub-style heading anchor: lowercase, keep alphanumerics and hyphens, spaces to hyphens. */
function anchorFor(heading: string): string {
  return heading.toLowerCase().replace(/[^a-z0-9 -]/g, '').replace(/ /g, '-');
}

function generateMarkdownReport(baseDir: string): string {
  const lines: string[] = ['# pw-cli-agent Report\n'];
  lines.push(`Generated: ${new Date().toISOString()}\n`);

  const plans = listArtifacts('plans', baseDir);
  const tests = listArtifacts('tests', baseDir);
  const explore = listArtifacts('explore', baseDir);
  const hasAny = plans.length + tests.length + explore.length > 0;

  if (hasAny) {
    lines.push('## Contents\n');
    if (plans.length > 0) {
      lines.push('- [Test Plans](#test-plans)');
      for (const f of plans) lines.push(`  - [${f}](#${anchorFor(f)})`);
      lines.push('');
    }
    if (tests.length > 0) lines.push('- [Generated Tests](#generated-tests)\n');
    if (explore.length > 0) lines.push('- [Exploration Snapshots](#exploration-snapshots)\n');
  }

  if (plans.length > 0) {
    lines.push('## Test Plans\n');
    for (const f of plans) {
      const content = readFileSync(join(baseDir, 'plans', f), 'utf-8');
      lines.push(`### ${f}\n`);
      lines.push(content.slice(0, 5000));
      if (content.length > 5000) lines.push('\n... (truncated)');
      lines.push('');
    }
  }

  if (tests.length > 0) {
    lines.push('## Generated Tests\n');
    for (const f of tests) {
      lines.push(`- \`${f}\``);
    }
    lines.push('');
  }

  if (explore.length > 0) {
    lines.push('## Exploration Snapshots\n');
    for (const f of explore) {
      lines.push(`- \`${f}\``);
    }
    lines.push('');
  }

  if (!hasAny) {
    lines.push('_No artifacts found. Run `explore`, `plan`, or `test` commands first._\n');
  }

  return lines.join('\n');
}

function generateHtmlReport(baseDir: string): string {
  const md = generateMarkdownReport(baseDir);
  const body = md
    .replace(/^### (.+)$/gm, (_, t) => `<h3 id="${anchorFor(t)}">${t}</h3>`)
    .replace(/^## (.+)$/gm, (_, t) => `<h2 id="${anchorFor(t)}">${t}</h2>`)
    .replace(/^# (.+)$/gm, (_, t) => `<h1 id="${anchorFor(t)}">${t}</h1>`)
    .replace(/^\s*- (.+)$/gm, '<li>$1</li>')
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\[([^\]]+)\]\(([^ )]+)\)/g, '<a href="$2">$1</a>')
    .replace(/\n\n/g, '</p><p>')
    .replace(/^(.+)$/gm, (line) => {
      if (line.startsWith('<')) return line;
      return `<p>${line}</p>`;
    });

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>pw-cli-agent Report</title>
  <style>
    body { font-family: system-ui, sans-serif; max-width: 800px; margin: 2rem auto; padding: 0 1rem; line-height: 1.6; }
    h1 { border-bottom: 2px solid #333; padding-bottom: 0.5rem; }
    h2 { color: #2563eb; margin-top: 2rem; }
    h3 { color: #1e40af; }
    code { background: #f3f4f6; padding: 0.125rem 0.375rem; border-radius: 0.25rem; font-size: 0.875rem; }
    li { margin: 0.25rem 0; }
    p { margin: 0.5rem 0; }
  </style>
</head>
<body>
${body}
</body>
</html>`;
}

function generateJsonReport(baseDir: string): string {
  const plans = listArtifacts('plans', baseDir);
  const tests = listArtifacts('tests', baseDir);
  const explore = listArtifacts('explore', baseDir);
  const report = {
    schemaVersion: 'report-v1',
    generatedAt: new Date().toISOString(),
    artifacts: {
      plans: plans.map((f) => ({ file: f })),
      tests: tests.map((f) => ({ file: f })),
      explore: explore.map((f) => ({ file: f })),
    },
    summary: {
      planCount: plans.length,
      testCount: tests.length,
      exploreCount: explore.length,
    },
  };
  return JSON.stringify(report, null, 2);
}

export async function reportCommand(opts: ReportOptions): Promise<void> {
  ensureArtifactsDir(opts.config.outputDir);

  const format = opts.format ?? 'md';
  const ext = format === 'json' ? 'json' : format;
  const filename = opts.output ?? `report-${Date.now()}.${ext}`;

  const content = format === 'html'
    ? generateHtmlReport(opts.config.outputDir)
    : format === 'json'
      ? generateJsonReport(opts.config.outputDir)
      : generateMarkdownReport(opts.config.outputDir);

  const savedPath = saveReport(content, filename, opts.config.outputDir);
  console.log(chalk.green(`Report saved: ${savedPath}`));
}
