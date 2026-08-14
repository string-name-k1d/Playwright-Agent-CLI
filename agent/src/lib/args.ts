import chalk from 'chalk';
import { existsSync, statSync } from 'node:fs';
import { join } from 'node:path';

/** Prints a red error and exits with code 1. */
export function fail(message: string): never {
  console.error(chalk.red(`Error: ${message}`));
  process.exit(1);
}

function isValidHttpUrl(value: string): boolean {
  try {
    const u = new URL(value);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

/**
 * Validates an optional http(s) URL argument. Returns the value unchanged
 * when present and valid; undefined/empty passes through untouched.
 */
export function validateUrl(value: string | undefined, label: string): string | undefined {
  if (value === undefined || value === '') return value;
  if (!isValidHttpUrl(value)) fail(`${label} is not a valid http(s) URL: ${value}`);
  return value;
}

/** Requires a valid http(s) URL, failing with `missingMessage` when absent. */
export function requireUrl(value: string | undefined, label: string, missingMessage?: string): string {
  const v = validateUrl(value, label);
  if (!v) fail(missingMessage ?? `${label} is required`);
  return v;
}

const GLOB_CHARS = /[*?[\]{}]/;

export interface PathValidationOptions {
  /** Artifact subdir used to resolve bare filenames (e.g. 'plans'). */
  subdir?: string;
  /** Base artifacts dir used to resolve bare filenames (default: ./artifacts). */
  baseDir?: string;
  /** When false, directories are accepted too. Defaults to true (file required). */
  fileOnly?: boolean;
  /** When true, glob patterns (e.g. `tests/*.spec.ts`) skip the existence check. */
  allowGlob?: boolean;
}

function resolveArgPath(value: string, opts: PathValidationOptions): string {
  if (opts.subdir && !value.includes('/') && !value.includes('\\')) {
    return join(opts.baseDir ?? './artifacts', opts.subdir, value);
  }
  return value;
}

/**
 * Validates an optional path argument exists. Bare filenames are resolved
 * against the artifact `subdir` when one is given. Returns the resolved path.
 */
export function validatePath(value: string | undefined, label: string, opts: PathValidationOptions = {}): string | undefined {
  if (value === undefined || value === '') return value;
  if (opts.allowGlob && GLOB_CHARS.test(value)) return value;
  const resolved = resolveArgPath(value, opts);
  if (!existsSync(resolved)) fail(`${label} not found: ${resolved}`);
  const fileOnly = opts.fileOnly ?? true;
  if (fileOnly && statSync(resolved).isDirectory()) fail(`${label} is a directory, expected a file: ${resolved}`);
  return resolved;
}

/** Requires a path argument to exist, failing with `missingMessage` when absent. */
export function requirePath(value: string | undefined, label: string, opts?: PathValidationOptions, missingMessage?: string): string {
  const v = validatePath(value, label, opts);
  if (!v) fail(missingMessage ?? `${label} is required`);
  return v;
}

/** Validates a numeric argument is a non-negative integer. */
export function validateCount(value: number | undefined, label: string): number | undefined {
  if (value === undefined) return value;
  if (!Number.isInteger(value) || value < 0) fail(`${label} must be a non-negative integer, got: ${value}`);
  return value;
}

/** Validates an argument is one of the allowed choices. */
export function validateChoice<T extends string>(value: T | undefined, label: string, choices: readonly T[]): T | undefined {
  if (value === undefined) return value;
  if (!choices.includes(value)) fail(`${label} must be one of: ${choices.join(', ')} (got: ${value})`);
  return value;
}
