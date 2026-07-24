import { mkdirSync, readdirSync, readFileSync, writeFileSync, existsSync, statSync } from 'node:fs';
import { join } from 'node:path';

const SUBDIRS = ['explore', 'plans', 'tests', 'reports'] as const;

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
  return readFileSync(join(baseDir, subdir, filename), 'utf-8');
}

export function listArtifacts(subdir: string, baseDir: string = './artifacts'): string[] {
  const dir = join(baseDir, subdir);
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((f) => !f.startsWith('.'));
}
