import { mkdirSync, readdirSync, readFileSync, writeFileSync, existsSync, statSync, copyFileSync } from 'node:fs';
import { join, basename, isAbsolute } from 'node:path';

const SUBDIRS = ['explore', 'plans', 'tests', 'reports', 'results'] as const;

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

export function wrapInTest(code: string, testName: string): string {
  const hasImport = /import.*@playwright\/test/.test(code);
  const hasTest = /\b(?:test|it)\s*\(/.test(code);
  const hasAfterEach = /test\.afterEach/.test(code);

  if (!hasImport && !hasTest && !looksLikeCode(code)) {
    throw new Error('Generated content is prose, not code — cannot wrap');
  }

  const hook = hasAfterEach ? '' : SCREENSHOT_HOOK;

  if (hasImport && hasTest) return injectBaseUrl(code) + hook;

  const importLine = hasImport ? '' : "import { test, expect } from '@playwright/test';\n\n";
  const testBlock = hasTest ? code : `test('${testName.replace(/'/g, "\\'")}', async ({ page }) => {\n${code}\n});`;

  return importLine + injectBaseUrl(testBlock) + hook;
}

export function extractCodeBlocks(markdown: string): ExtractedCode[] {
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
      for (let i = beforeLines.length - 1; i >= 0; i--) {
        const line = beforeLines[i];
        if (/^#{1,4}\s+/.test(line)) {
          testName = line.replace(/^#{1,4}\s+/, '').trim();
          break;
        }
      }

      const wrappedCode = wrapInTest(code, testName);
      const filename = `test-${blockIndex}.spec.ts`;
      blocks.push({ filename, code: wrappedCode });
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
