import { mkdirSync, readdirSync, readFileSync, writeFileSync, existsSync, statSync, copyFileSync } from 'node:fs';
import { join, basename, isAbsolute } from 'node:path';

const SUBDIRS = ['explore', 'plans', 'tests', 'reports', 'results'] as const;

/**
 * Ensures all artifact subdirectories exist under the base directory.
 * Creates explore/, plans/, tests/, reports/, results/ if missing.
 */
export function ensureArtifactsDir(baseDir: string = './artifacts'): void {
  for (const sub of SUBDIRS) {
    const dir = join(baseDir, sub);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
  }
}

function timestamp(): string {
  return new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
}

export function getLatestFile(subdir: string, baseDir: string = './artifacts'): string | null {
  const dir = join(baseDir, subdir);
  if (!existsSync(dir)) return null;

  const files = readdirSync(dir)
    .filter((f) => !f.startsWith('.'))
    .map((f) => ({
      name: f,
      time: statSync(join(dir, f)).mtimeMs,
    }))
    .sort((a, b) => b.time - a.time);

  return files.length > 0 ? join(dir, files[0].name) : null;
}

export function saveArtifact(
  subdir: string,
  content: string,
  name?: string,
  baseDir: string = './artifacts'
): string {
  ensureArtifactsDir(baseDir);
  const filename = name ?? `${subdir}-${timestamp()}.md`;
  const filePath = join(baseDir, subdir, filename);
  writeFileSync(filePath, content, 'utf-8');
  return filePath;
}

export function saveSnapshot(
  content: string,
  name?: string,
  baseDir: string = './artifacts'
): string {
  return saveArtifact('explore', content, name, baseDir);
}

export function savePlan(
  content: string,
  name?: string,
  baseDir: string = './artifacts'
): string {
  return saveArtifact('plans', content, name, baseDir);
}

export function saveTest(
  content: string,
  name?: string,
  baseDir: string = './artifacts'
): string {
  return saveArtifact('tests', content, name, baseDir);
}

export function saveReport(
  content: string,
  name?: string,
  baseDir: string = './artifacts'
): string {
  return saveArtifact('reports', content, name, baseDir);
}

export function readArtifact(subdir: string, filename: string, baseDir: string = './artifacts'): string {
  const name = basename(filename);
  const filePath = filename.includes('/') || filename.includes('\\')
    ? filename
    : join(baseDir, subdir, name);
  return readFileSync(filePath, 'utf-8');
}

export function listArtifacts(subdir: string, baseDir: string = './artifacts'): string[] {
  const dir = join(baseDir, subdir);
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((f) => !f.startsWith('.'));
}

export interface ExtractedCode {
  filename: string;
  code: string;
  testId?: string;
}

const SCREENSHOT_HOOK = `
test.afterEach(async ({ page }, testInfo) => {
  const { mkdirSync } = await import('node:fs');
  const dir = testInfo.outputDir + '/screenshots';
  try { mkdirSync(dir, { recursive: true }); } catch {}
  const name = testInfo.title.replace(/[^a-z0-9]/gi, '_').toLowerCase();
  const suffix = testInfo.status === 'passed' ? 'pass' : 'fail';
  try {
    await page.screenshot({ path: dir + '/' + name + '_' + suffix + '.png', fullPage: true });
  } catch {
    // page may be closed — try without fullPage
    try { await page.screenshot({ path: dir + '/' + name + '_' + suffix + '.png' }); } catch {}
  }
});
`;

function looksLikeCode(code: string): boolean {
  const codePatterns = [
    /^import\s/m,
    /^test\(|^test\.describe\(|^test\.beforeEach\(|^test\.afterEach\(/m,
    /\bawait\b/,
    /\bexpect\s*\(/,
    /\bpage\.(goto|click|fill|locator|getBy)/,
    /^\s*(?:const|let|var)\s+\w+\s*=/m,
    /^\s*(?:if|for|while)\s*\(/m,
  ];
  return codePatterns.some(p => p.test(code));
}

function injectBaseUrl(code: string): string {
  if (/\bBASE_URL\b/.test(code) && !/const\s+BASE_URL\s*=/.test(code)) {
    return `const BASE_URL = '';\n` + code;
  }
  return code;
}

function injectNavigation(code: string, url?: string): string {
  if (/page\.goto\s*\(/.test(code)) return code;
  const gotoCall = url
    ? `await page.goto('${url}');`
    : `await page.goto('/');`;
  // Insert after first await or at the start of the test body
  const lines = code.split('\n');
  let insertIdx = 0;
  for (let i = 0; i < lines.length; i++) {
    const t = lines[i].trim();
    if (t.startsWith('await ') || t.startsWith('const ') || t.startsWith('let ')) {
      insertIdx = i;
      break;
    }
  }
  lines.splice(insertIdx, 0, gotoCall);
  return lines.join('\n');
}

export function wrapInTest(code: string, testName: string, url?: string): string {
  const hasImport = /import.*@playwright\/test/.test(code);
  const hasTest = /\b(?:test|it)\s*\(/.test(code);
  const hasAfterEach = /test\.afterEach/.test(code);

  if (!hasImport && !hasTest && !looksLikeCode(code)) {
    throw new Error('Generated content is prose, not code — cannot wrap');
  }

  const hook = hasAfterEach ? '' : SCREENSHOT_HOOK;

  if (hasImport && hasTest) {
    let result = injectBaseUrl(code);
    result = injectNavigation(result, url);
    return result + hook;
  }

  const importLine = hasImport ? '' : "import { test, expect } from '@playwright/test';\n\n";
  let testBlock = hasTest ? code : `test('${testName.replace(/'/g, "\\'")}', async ({ page }) => {\n${code}\n});`;
  testBlock = injectNavigation(testBlock, url);

  return importLine + injectBaseUrl(testBlock) + hook;
}

// ── Plan validation ───────────────────────────────────────────────

const PREAMBLE_PATTERNS = [
  /(?:I'?ll|I will|Let me|Let's|I can|I'd|I would)\s+(?:analyze|explore|review|examine|look|create|generate|build|start|begin|check|investigate|read|understand|write|provide|help|assist|discuss|explain|describe|summarize|outline|plan|design|think|consider|evaluate|assess|inspect|investigate|process|handle|address|tackle|deal|work|go|try|attempt|begin|commence|initiate|commence)/i,
  /(?:first|firstly|initially|to start|before we|before I|prior to)\s/i,
  /(?:based on|given the|considering|taking into account|in order to|to (?:better|effectively|properly|successfully))/i,
  /(?:I'?m going to|I'?ll be|I will be|I'?m here to|allow me to|permit me to)/i,
  /(?:Sure|Of course|Certainly|Absolutely|Alright|Okay|Ok),?\s+(?:I|let|we|here|I'?ll)/i,
  /(?:let me (?:first|start|begin|take|go))/i,
];

const STRUCTURE_INDICATORS = [
  /#{2,4}\s+TC[\s\-:]/i,
  /#{2,4}\s+(?:Objective|Goal|Summary|Overview|Context|Background|Scope)/i,
  /#{2,4}\s+(?:Test\s+Cases?|Test\s+Plan|Test\s+Strategy|Healing\s+Plan|Pages?)/i,
  /#{2,4}\s+(?:Steps?|Actions?|Expected\s+Results?|Priority|Requirements?)/i,
];

const STRUCTURE_CONTENT_PATTERNS = [
  /#{2,4}\s+Objective/i,
  /#{2,4}\s+Pages/i,
  /#{2,4}\s+Test\s+Cases?/i,
  /###\s+TC-\d+:\s+\S+/,
  /\*\*Priority:\*\*\s*(?:high|medium|low)/i,
  /\*\*Dependencies:\*\*\s*/i,
  /\*\*Description:\*\*\s*/i,
  /\*\*Steps:\*\*\s*/i,
  /\*\*Expected:\*\*\s*/i,
];

/**
 * Validates whether the plan text is a structured test plan
 * (not just conversational preamble).
 *
 * Returns `{ valid, score, reason }`.
 */
export function isValidPlan(text: string): { valid: boolean; score: number; reason: string } {
  let score = 0;

  // ── Deductions for preamble patterns ──
  const preambleMatches = PREAMBLE_PATTERNS.filter(p => p.test(text)).length;
  score -= preambleMatches * 2;

  // ── Headings ──
  const headings = text.match(/^#{1,4}\s+.+/gm) ?? [];
  const h2Plus = headings.filter(h => /^#{2,3}\s/.test(h));
  score += Math.min(h2Plus.length * 2, 8);

  // ── Structure indicators (heading-level) ──
  const structHeadings = STRUCTURE_INDICATORS.filter(p => p.test(text)).length;
  score += Math.min(structHeadings * 2, 8);

  // ── Inline structure content (test name, steps, expected, etc.) ──
  const structContent = STRUCTURE_CONTENT_PATTERNS.filter(p => p.test(text)).length;
  score += Math.min(structContent, 6);

  // ── Fenced code blocks with test content ──
  const codeBlocks = text.match(/```[\s\S]*?```/g) ?? [];
  const testCodeBlocks = codeBlocks.filter(b => /test\s*\(|expect\s*\(|page\.(goto|click|fill|getBy)/.test(b));
  score += Math.min(testCodeBlocks.length * 3, 9);

  // ── Numbered or bulleted test-case-like lists ──
  const testListItems = (text.match(/(?:^|\n)\s*(?:\d+\.|\-|\*)\s+.*(?:test|verify|check|assert|should|expect)/gi) ?? []).length;
  score += Math.min(testListItems, 4);

  const valid = score >= 2;
  let reason = '';
  if (!valid) {
    const issues: string[] = [];
    if (preambleMatches > 0) issues.push(`contains ${preambleMatches} preamble pattern(s)`);
    if (h2Plus.length === 0) issues.push('no markdown headings (## or ###)');
    if (structHeadings === 0) issues.push('no recognized section headings');
    if (structContent === 0) issues.push('no structured content (test name, steps, expected results, etc.)');
    if (testCodeBlocks.length === 0) issues.push('no code blocks with test code');
    reason = issues.join('; ') || 'score too low';
  }

  return { valid, score, reason };
}

/**
 * Strips conversational preamble from the beginning of a plan,
 * returning only the structured content starting from the first heading.
 * If no heading is found, returns the original text.
 */
export function stripPreamble(text: string): string {
  // Find the first markdown heading (## or ###)
  const headingMatch = text.match(/\n(#{1,4}\s+.+)/);
  if (headingMatch && headingMatch.index !== undefined) {
    const idx = headingMatch.index + 1; // skip the leading newline
    const stripped = text.slice(idx).trim();
    if (stripped.length > 50) return stripped;
  }

  // Fallback: find first occurrence of "## " pattern directly
  const h2Idx = text.indexOf('\n## ');
  if (h2Idx !== -1) {
    const stripped = text.slice(h2Idx + 1).trim();
    if (stripped.length > 50) return stripped;
  }

  return text;
}

export function extractCodeBlocks(markdown: string, url?: string): ExtractedCode[] {
  const blocks: ExtractedCode[] = [];
  const lines = markdown.split('\n');
  const regex = /```(?:ts|typescript|javascript|js|playwright-test)?\s*\n([\s\S]*?)```/g;
  let match;
  let blockIndex = 0;

  while ((match = regex.exec(markdown)) !== null) {
    const code = match[1].trim();
    if (!code) continue;

    const hasTest = /\b(?:test|it)\s*\(/.test(code);
    const hasImport = /import.*@playwright\/test/.test(code);
    const hasExpect = /\bexpect\s*\(/.test(code);

    if (hasTest || hasImport || hasExpect) {
      // Find the nearest heading before this code block for the test name
      const beforeMatch = markdown.substring(0, match.index);
      const beforeLines = beforeMatch.split('\n');
      let testName = `test-${blockIndex}`;
      let testId: string | undefined;
      for (let i = beforeLines.length - 1; i >= 0; i--) {
        const line = beforeLines[i];
        if (/^#{1,4}\s+/.test(line)) {
          const heading = line.replace(/^#{1,4}\s+/, '').trim();
          testName = heading;
          const tcMatch = heading.match(/^TC-(\d+)/i);
          if (tcMatch) testId = `TC-${tcMatch[1]}`;
          break;
        }
      }

      const wrappedCode = wrapInTest(code, testName, url);
      const filename = `test-${blockIndex}.spec.ts`;
      blocks.push({ filename, code: wrappedCode, testId });
      blockIndex++;
    }
  }

  return blocks;
}

export function saveExtractedTests(
  blocks: ExtractedCode[],
  baseDir: string = './artifacts'
): string[] {
  ensureArtifactsDir(baseDir);
  const saved: string[] = [];

  for (const block of blocks) {
    const filePath = join(baseDir, 'tests', block.filename);
    writeFileSync(filePath, block.code, 'utf-8');
    saved.push(filePath);
  }

  return saved;
}

// ── Plan test-case dependencies ───────────────────────────────────

export interface PlanTestCase {
  id: string;
  name: string;
  dependencies: string[];
}

/**
 * Parses a plan markdown document for its test cases and their
 * dependency references. Dependencies may be expressed as TC ids
 * ("depends: TC-1") or as kebab-case test names ("depends: create-page").
 * Name references are resolved to TC ids when a matching heading exists.
 */
export function parsePlanTestCases(markdown: string): PlanTestCase[] {
  const cases: PlanTestCase[] = [];
  const idByName = new Map<string, string>();

  let current: PlanTestCase | null = null;
  let currentName = '';

  const finalize = (): void => {
    if (!current) return;
    current.dependencies = current.dependencies.map(d => idByName.get(d.toLowerCase()) ?? d);
    cases.push(current);
    current = null;
  };

  for (const line of markdown.split('\n')) {
    const heading = line.match(/^#{1,6}\s*TC-(\d+)\s*[:：]?\s*(.*)$/i);
    if (heading) {
      finalize();
      const id = `TC-${heading[1]}`;
      currentName = heading[2].trim().toLowerCase();
      current = { id, name: currentName, dependencies: [] };
      idByName.set(id.toLowerCase(), id);
      if (currentName) idByName.set(currentName, id);
      continue;
    }
    if (!current) continue;
    if (/^#{1,6}\s+/.test(line)) {
      finalize();
      continue;
    }
    const depMatch = line.match(/^\s*[-*]?\s*\*\*Dependencies:\*\*\s*(.*)$/i);
    if (!depMatch) continue;

    const value = depMatch[1].toLowerCase();
    if (value.includes('standalone')) {
      current.dependencies = [];
      continue;
    }
    const tcRefs = [...value.matchAll(/TC-\d+/gi)].map(m => m[0].toUpperCase());
    const dependsPart = value.split('depends:')[1];
    let nameRefs: string[] = [];
    if (dependsPart) {
      nameRefs = dependsPart
        .split(/[,&]|\band\b/g)
        .map(s => s.trim().replace(/[^a-z0-9-]/g, ''))
        .filter(s => s.length > 0 && !/^TC-\d+$/i.test(s));
    }
    current.dependencies = [...new Set([...tcRefs, ...nameRefs])];
  }
  finalize();

  return cases;
}

/**
 * Computes a topological "wave" level for each test case using its
 * dependencies. Level 0 = no dependencies; level N runs only after all
 * its transitive dependencies at levels < N have completed.
 */
export function computeDependencyLevels(cases: PlanTestCase[]): Map<string, number> {
  const levels = new Map<string, number>();
  const byId = new Map(cases.map(c => [c.id, c]));
  const visited = new Set<string>();

  const compute = (id: string): number => {
    if (visited.has(id)) return levels.get(id) ?? 0;
    visited.add(id);
    const tc = byId.get(id);
    if (!tc) return 0;
    let level = 0;
    for (const dep of tc.dependencies) {
      if (/^TC-\d+$/i.test(dep)) {
        level = Math.max(level, compute(dep) + 1);
      }
    }
    levels.set(id, level);
    return level;
  };

  for (const c of cases) compute(c.id);
  return levels;
}
