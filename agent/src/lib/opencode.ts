import { spawn, type SpawnOptions } from 'node:child_process';
import { writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';

export interface OpenCodeOptions {
  model?: string;
  session?: string;
  quiet?: boolean;
  timeout?: number;
  cwd?: string;
  retries?: number;
}

export interface OpenCodeResult {
  output: string;
  structured?: any;
  exitCode: number;
}

const DEFAULT_TIMEOUT = 300000;

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
    const mod = parsed.protocol === 'https:' ? httpsRequest : httpRequest;

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

  args.push('--format', 'json');
  if (opts.model) args.push('-m', opts.model);
  if (opts.session) args.push('-s', opts.session);

  const LARGE_PROMPT_THRESHOLD = 8000;
  let tmpFile: string | null = null;

  if (prompt.length > LARGE_PROMPT_THRESHOLD) {
    tmpFile = join(tmpdir(), `pw-prompt-${Date.now()}.txt`);
    writeFileSync(tmpFile, prompt, 'utf-8');
    args.push('Analyze the attached file and respond accordingly.');
    args.push('--file', tmpFile);
  } else {
    args.push(prompt);
  }

  return new Promise((resolve) => {
    const child = spawn('opencode', args, {
      cwd: opts.cwd ?? process.cwd(),
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env },
    } as SpawnOptions);

    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill('SIGTERM');
      if (tmpFile) try { unlinkSync(tmpFile); } catch {}
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
      if (tmpFile) try { unlinkSync(tmpFile); } catch {}
      const output = stdout.trim();
      const errOutput = stderr.trim();
      let structured: any;
      try {
        structured = JSON.parse(output);
      } catch {
        structured = undefined;
      }
      resolve({
        output: code !== 0 && !output && errOutput ? errOutput : output,
        structured,
        exitCode: code ?? 1,
      });
    });

    child.on('error', () => {
      clearTimeout(timer);
      if (tmpFile) try { unlinkSync(tmpFile); } catch {}
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
  const maxRetries = opts.retries ?? 3;
  const serverUrl = getServerUrl();

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    let result: OpenCodeResult;
    if (serverUrl) {
      result = await opencodeViaServer(prompt, opts);
      // If server returned HTML (web UI) instead of JSON, fall back to CLI
      if (result.exitCode !== 0 && result.output?.startsWith('<!doctype')) {
        result = await opencodeViaCli(prompt, opts);
      }
    } else {
      result = await opencodeViaCli(prompt, opts);
    }

    // Success or non-retryable error
    if (result.exitCode === 0 || attempt === maxRetries) return result;

    // Check if error is retryable (401, network errors, empty output)
    const combined = result.output.toLowerCase();
    const isRetryable =
      combined.includes('401') ||
      combined.includes('no provider available') ||
      combined.includes('timed out') ||
      combined.includes('econnrefused') ||
      combined.includes('fetch failed') ||
      combined.includes('econnreset') ||
      combined.includes('socket hang up') ||
      result.output.trim() === '';

    if (!isRetryable) return result;

    const delay = attempt * 2000;
    console.error(`  OpenCode attempt ${attempt}/${maxRetries} failed, retrying in ${delay / 1000}s...`);
    await new Promise(r => setTimeout(r, delay));
  }

  // Should not reach here, but just in case
  return { output: 'Max retries exceeded', exitCode: 1 };
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
  // opencode --format json outputs one JSON event per line
  // Extract text content from type:"text" events
  const lines = result.output.split('\n').filter(l => l.trim());
  const textParts: string[] = [];
  for (const line of lines) {
    try {
      const event = JSON.parse(line);
      if (event.type === 'text' && event.part?.text) {
        textParts.push(event.part.text);
      }
    } catch {
      // Not JSON or unparseable — include as-is
    }
  }
  if (textParts.length > 0) {
    return textParts.join('\n');
  }
  return result.output;
}

export function extractMarkdown(result: OpenCodeResult): string {
  const raw = extractStructuredOutput(result);
  if (typeof raw !== 'string') return JSON.stringify(raw, null, 2);

  // Strip JSON log lines that leaked into the output
  const lines = raw.split('\n');
  const clean: string[] = [];
  for (const line of lines) {
    const trimmed = line.trim();
    // Skip JSON event lines (opencode format: {"type":"...","part":{...}})
    if (trimmed.startsWith('{') && trimmed.includes('"type"') && trimmed.includes('"part"')) continue;
    // Skip empty lines only if we haven't started content yet
    clean.push(line);
  }

  return clean.join('\n').trim();
}
