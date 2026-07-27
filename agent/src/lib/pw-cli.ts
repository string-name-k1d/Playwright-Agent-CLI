import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export interface PwCliResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export interface PwCliOptions {
  session?: string;
  raw?: boolean;
  timeout?: number;
  cliPath?: string;
}

const DEFAULT_TIMEOUT = 60000;

function buildArgs(command: string, args: string[], opts: PwCliOptions): string[] {
  const result: string[] = [];
  if (opts.session) result.push(`-s=${opts.session}`);
  if (opts.raw) result.push('--raw');
  result.push(command, ...args);
  return result;
}

export async function pwExec(
  command: string,
  args: string[],
  opts: PwCliOptions = {}
): Promise<PwCliResult> {
  const cliPath = opts.cliPath ?? 'playwright-cli';
  const fullArgs = buildArgs(command, args, opts);

  try {
    const { stdout, stderr } = await execFileAsync(cliPath, fullArgs, {
      timeout: opts.timeout ?? DEFAULT_TIMEOUT,
      maxBuffer: 10 * 1024 * 1024,
    });
    return { stdout: stdout.trim(), stderr: stderr.trim(), exitCode: 0 };
  } catch (err: any) {
    return {
      stdout: err.stdout?.trim() ?? '',
      stderr: err.stderr?.trim() ?? err.message,
      exitCode: err.code ?? 1,
    };
  }
}

export async function pwOpen(
  url: string,
  opts: { headed?: boolean; browser?: string; session?: string; cliPath?: string; profile?: string; persistent?: boolean } = {}
): Promise<PwCliResult> {
  const args: string[] = [];
  if (opts.headed) args.push('--headed');
  // Default to chromium — the Playwright Docker image ships Chromium, not Chrome
  args.push(`--browser=${opts.browser ?? 'chromium'}`);
  if (opts.profile) args.push('--profile', opts.profile);
  if (opts.persistent) args.push('--persistent');
  if (url) args.push(url);
  return pwExec('open', args, { session: opts.session, cliPath: opts.cliPath });
}

export async function pwGoto(
  url: string,
  opts?: PwCliOptions
): Promise<PwCliResult> {
  return pwExec('goto', [url], opts);
}

export async function pwSnapshot(
  filename?: string,
  opts?: PwCliOptions & { depth?: number; selector?: string }
): Promise<PwCliResult> {
  const args: string[] = [];
  if (filename) args.push(`--filename=${filename}`);
  if (opts?.depth !== undefined) args.push(`--depth=${opts.depth}`);
  if (opts?.selector) args.push(opts.selector);
  return pwExec('snapshot', args, opts);
}

export async function pwClick(
  ref: string,
  opts?: PwCliOptions & { button?: string }
): Promise<PwCliResult> {
  const args = [ref];
  if (opts?.button) args.push(opts.button);
  return pwExec('click', args, opts);
}

export async function pwFill(
  ref: string,
  text: string,
  opts?: PwCliOptions & { submit?: boolean }
): Promise<PwCliResult> {
  const args = [ref, text];
  if (opts?.submit) args.push('--submit');
  return pwExec('fill', args, opts);
}

export async function pwType(
  text: string,
  opts?: PwCliOptions
): Promise<PwCliResult> {
  return pwExec('type', [text], opts);
}

export async function pwScreenshot(
  filename?: string,
  opts?: PwCliOptions & { ref?: string; hires?: boolean }
): Promise<PwCliResult> {
  const args: string[] = [];
  if (opts?.ref) args.push(opts.ref);
  if (filename) args.push(`--filename=${filename}`);
  if (opts?.hires) args.push('--hires');
  return pwExec('screenshot', args, opts);
}

export async function pwClose(opts?: PwCliOptions): Promise<PwCliResult> {
  return pwExec('close', [], opts);
}

export async function pwVersion(opts?: { cliPath?: string }): Promise<string> {
  const result = await pwExec('--version', [], { raw: true, ...opts });
  return result.stdout || result.stderr;
}

export function parseSnapshotPageInfo(stdout: string): {
  url?: string;
  title?: string;
  snapshotPath?: string;
} {
  const urlMatch = stdout.match(/Page URL:\s*(.+)/);
  const titleMatch = stdout.match(/Page Title:\s*(.+)/);
  const snapMatch = stdout.match(/\[Snapshot\]\((.+\.yml)\)/);
  return {
    url: urlMatch?.[1]?.trim(),
    title: titleMatch?.[1]?.trim(),
    snapshotPath: snapMatch?.[1]?.trim(),
  };
}
