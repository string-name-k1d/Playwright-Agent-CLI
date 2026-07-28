import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, extname, basename } from 'node:path';

/**
 * Represents a user-provided test procedure or reference.
 * Each reference can contain markdown instructions, screenshots, or both.
 */
export interface TestReference {
  /** Display name derived from filename */
  name: string;
  /** Raw markdown content of the procedure */
  content: string;
  /** Path to the file */
  filePath: string;
  /** Screenshot files referenced in the content or in the same directory */
  screenshots: string[];
  /** Step-by-step instructions extracted from the content */
  steps: string[];
}

/**
 * Loads test references from a file or directory path.
 *
 * Accepts:
 * - A single markdown file (.md) containing test procedures
 * - A directory containing markdown files and/or screenshot images
 *
 * Reference format:
 * - Markdown files contain step-by-step test procedures
 * - Screenshots (PNG/JPG) in the same directory are automatically associated
 * - Steps are extracted from markdown headings (##, ###) or numbered lists (1., 2.)
 *
 * @param referencePath - Path to a .md file or directory containing references
 * @returns Array of TestReference objects with content, steps, and screenshots
 */
export function loadReferences(referencePath: string): TestReference[] {
  if (!existsSync(referencePath)) {
    console.warn(`Warning: reference path not found: ${referencePath}`);
    return [];
  }

  const stat = statSync(referencePath);
  if (stat.isFile()) {
    return [loadSingleReference(referencePath)];
  }

  return loadReferenceDir(referencePath);
}

/**
 * Loads a single markdown file as a test reference.
 * Extracts steps from headings and numbered lists.
 * Finds associated screenshots in the same directory.
 */
function loadSingleReference(filePath: string): TestReference {
  const content = readFileSync(filePath, 'utf-8');
  const dir = join(filePath, '..');
  const screenshots = findScreenshots(dir);
  const steps = extractSteps(content);

  return {
    name: basename(filePath, extname(filePath)),
    content,
    filePath,
    screenshots,
    steps,
  };
}

/**
 * Loads all markdown files from a directory as test references.
 * Each .md file becomes a separate TestReference.
 * Screenshots from the directory are shared across all references.
 */
function loadReferenceDir(dirPath: string): TestReference[] {
  const references: TestReference[] = [];
  const screenshots = findScreenshots(dirPath);

  const files = readdirSync(dirPath).filter(f => extname(f) === '.md');

  for (const file of files) {
    const filePath = join(dirPath, file);
    const content = readFileSync(filePath, 'utf-8');
    const steps = extractSteps(content);

    references.push({
      name: basename(file, '.md'),
      content,
      filePath,
      screenshots,
      steps,
    });
  }

  return references;
}

/**
 * Finds all image files (PNG, JPG, JPEG, GIF) in a directory.
 * Returns full paths to each image.
 */
function findScreenshots(dirPath: string): string[] {
  if (!existsSync(dirPath)) return [];

  const imageExts = ['.png', '.jpg', '.jpeg', '.gif', '.webp'];
  return readdirSync(dirPath)
    .filter(f => imageExts.includes(extname(f).toLowerCase()))
    .map(f => join(dirPath, f));
}

/**
 * Extracts test steps from markdown content.
 * Recognizes:
 * - Markdown headings (##, ###) as step titles
 * - Numbered lists (1., 2., etc.) as individual steps
 * - Bullet points (-, *) as sub-steps
 */
function extractSteps(content: string): string[] {
  const steps: string[] = [];
  const lines = content.split('\n');

  for (const line of lines) {
    const trimmed = line.trim();

    // Match markdown headings (## Step Title)
    const headingMatch = trimmed.match(/^#{1,4}\s+(.+)/);
    if (headingMatch) {
      steps.push(headingMatch[1]);
      continue;
    }

    // Match numbered lists (1. Step description)
    const numberedMatch = trimmed.match(/^\d+\.\s+(.+)/);
    if (numberedMatch) {
      steps.push(numberedMatch[1]);
      continue;
    }

    // Match bullet points (- Step description)
    const bulletMatch = trimmed.match(/^[-*]\s+(.+)/);
    if (bulletMatch) {
      steps.push(bulletMatch[1]);
    }
  }

  return steps;
}

/**
 * Formats references into a context string for AI prompts.
 * Includes procedure content, screenshots list, and extracted steps.
 *
 * @param references - Array of TestReference objects
 * @returns Formatted string suitable for inclusion in AI prompts
 */
export function formatReferencesForPrompt(references: TestReference[]): string {
  if (references.length === 0) return '';

  const sections: string[] = [
    'USER-PROVIDED TEST PROCEDURES:',
    'The following test procedures and reference materials were provided by the user.',
    'Use them as the primary source for test steps, expected behavior, and assertions.',
    '',
  ];

  for (const ref of references) {
    sections.push(`--- Reference: ${ref.name} ---`);
    sections.push(ref.content);
    sections.push('');

    if (ref.steps.length > 0) {
      sections.push('Extracted Steps:');
      for (let i = 0; i < ref.steps.length; i++) {
        sections.push(`  ${i + 1}. ${ref.steps[i]}`);
      }
      sections.push('');
    }

    if (ref.screenshots.length > 0) {
      sections.push('Available Screenshots:');
      for (const screenshot of ref.screenshots) {
        sections.push(`  - ${basename(screenshot)}`);
      }
      sections.push('');
    }
  }

  return sections.join('\n');
}
