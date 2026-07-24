import { spawn, type SpawnOptions } from 'node:child_process';
import { get } from 'node:http';
import { get as gets } from 'node:https';

export interface OpenCodeOptions {
  model?: string;
  session?: string;
  quiet?: boolean;
  timeout?: number;
  cwd?: string;
}

export interface OpenCodeResult {
  output: string;
  structured?: any;
  exitCode: number;
}

const DEFAULT_TIMEOUT = 120000;

function getServerUrl(): string | null {
  return process.env.OPENCODE_SERVER_URL ?? null;
}

async function httpPost(
  url: string,
  body: string,
  timeout: number
): Promise<{ data: string; status: number }> {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const mod = parsed.protocol === 'https:' ? gets : get;

    const req = mod(
      {
        hostname: parsed.hostname,
        port: parsed.port,
        path: parsed.pathname,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body),
        },
        timeout,
      },
      (res) => {
        let data = '';
        res.on('data', (chunk: Buffer) => (data += chunk.toString()));
        res.on('end', () => resolve({ data, status: res.statusCode ?? 0 }));
      }
    );

    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Request timed out'));
    });

    req.write(body);
    req.end();
  });
}

async function opencodeViaServer(
  prompt: string,
  opts: OpenCodeOptions
): Promise<OpenCodeResult> {
  const serverUrl = getServerUrl()!;
  const baseUrl = serverUrl.replace(/\/$/, '');

  try {
    const createRes = await httpPost(
      `${baseUrl}/session/create`,
      JSON.stringify({ title: 'pw-cli-agent' }),
      10000
    );
    const session = JSON.parse(createRes.data);
    const sessionId = session?.data?.id ?? session?.id;

    if (!sessionId) {
      return { output: 'Failed to create session', exitCode: 1 };
    }

    const promptBody = JSON.stringify({
      parts: [{ type: 'text', text: prompt }],
      ...(opts.model ? { model: opts.model } : {}),
    });

    const promptRes = await httpPost(
      `${baseUrl}/session/${sessionId}/prompt`,
      promptBody,
      opts.timeout ?? DEFAULT_TIMEOUT
    );

    const result = JSON.parse(promptRes.data);
    const output = result?.data?.info?.message?.content
      ?? result?.info?.message?.content
      ?? promptRes.data;

    let structured: any;
    try {
      structured = JSON.parse(output);
    } catch {
      structured = undefined;
    }

    return { output, structured, exitCode: 0 };
  } catch (err: any) {
    return { output: err.message, exitCode: 1 };
  }
}

async function opencodeViaCli(
  prompt: string,
  opts: OpenCodeOptions
): Promise<OpenCodeResult> {
  const args: string[] = ['run'];

  if (opts.quiet !== false) args.push('-q');
  args.push('-f', 'json');
  if (opts.model) args.push('-m', opts.model);
  if (opts.session) args.push('-s', opts.session);
  args.push(prompt);

  return new Promise((resolve) => {
    const child = spawn('opencode', args, {
      cwd: opts.cwd ?? process.cwd(),
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env },
    } as SpawnOptions);

    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill('SIGTERM');
      resolve({
        output: stdout.trim(),
        exitCode: 124,
        structured: undefined,
      });
    }, opts.timeout ?? DEFAULT_TIMEOUT);

    child.stdout?.on('data', (data: Buffer) => {
      stdout += data.toString();
    });

    child.stderr?.on('data', (data: Buffer) => {
      stderr += data.toString();
    });

    child.on('close', (code) => {
      clearTimeout(timer);
      const output = stdout.trim();
      let structured: any;
      try {
        structured = JSON.parse(output);
      } catch {
        structured = undefined;
      }
      resolve({
        output,
        structured,
        exitCode: code ?? 1,
      });
    });

    child.on('error', () => {
      clearTimeout(timer);
      resolve({
        output: '',
        exitCode: 1,
        structured: undefined,
      });
    });
  });
}

export async function opencodeRun(
  prompt: string,
  opts: OpenCodeOptions = {}
): Promise<OpenCodeResult> {
  if (getServerUrl()) {
    return opencodeViaServer(prompt, opts);
  }
  return opencodeViaCli(prompt, opts);
}

export async function opencodeVersion(): Promise<{ available: boolean; version?: string; mode: string }> {
  const serverUrl = getServerUrl();
  if (serverUrl) {
    try {
      const res = await httpPost(
        `${serverUrl.replace(/\/$/, '')}/global/health`,
        '{}',
        5000
      );
      if (res.status === 200) {
        return { available: true, version: 'server', mode: 'http' };
      }
    } catch {
      return { available: false, mode: 'http' };
    }
    return { available: false, mode: 'http' };
  }

  const result = await opencodeViaCli('--version', { timeout: 5000, quiet: true });
  if (result.exitCode === 0 && result.output) {
    return { available: true, version: result.output, mode: 'cli' };
  }
  return { available: false, mode: 'cli' };
}

export function extractStructuredOutput(result: OpenCodeResult): any {
  if (result.structured?.info?.structured_output) {
    return result.structured.info.structured_output;
  }
  if (result.structured?.output) {
    return result.structured.output;
  }
  return result.output;
}
