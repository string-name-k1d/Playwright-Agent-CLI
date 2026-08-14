import { spawn, type SpawnOptions } from 'node:child_process';
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';

export interface OpenCodeOptions {
  model?: string;
  session?: string;
  agent?: string;
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
  const baseArgs: string[] = ['run'];

  baseArgs.push('--format', 'json');
  if (opts.model) baseArgs.push('-m', opts.model);
  if (opts.agent) baseArgs.push('--agent', opts.agent);

  // Pass the prompt inline as the message. Inline prompts keep the model focused
  // on answering (no tool exploration), whereas --file attachment mode can make
  // the model go agentic (running bash/read tools) and sometimes emit no text.
  // For prompts too large for a single command-line argument (~128KB per-arg
  // limit on Linux), split the prompt into batches and continue the session
  // between batches so the model retains the full context.
  const BATCH_SIZE = 100_000;

  if (prompt.length <= BATCH_SIZE) {
    return runOpencodeCli([...baseArgs, prompt], opts);
  }

  const chunks = splitPrompt(prompt, BATCH_SIZE);
  let sessionId: string | undefined;
  let last: OpenCodeResult = { output: '', exitCode: 1, structured: undefined };

  for (let i = 0; i < chunks.length; i++) {
    const isLast = i === chunks.length - 1;
    const partLabel =
      `[Part ${i + 1}/${chunks.length} — ` +
      (isLast
        ? 'FINAL PART. You now have the complete context. Produce your full response now.]\n\n'
        : 'continuation of the context. Read carefully. Do NOT produce your final answer yet — more content follows.]\n\n');

    const args = [...baseArgs];
    if (sessionId) args.push('-s', sessionId);
    args.push(partLabel + chunks[i]);

    const result = await runOpencodeCli(args, opts);
    last = result;

    if (result.exitCode !== 0) {
      break;
    }
    if (!sessionId) {
      sessionId = extractSessionId(result.output);
      if (!sessionId) {
        console.error('  Could not determine session id for batched prompt continuation');
        break;
      }
    }
  }

  return last;
}

function extractSessionId(output: string): string | undefined {
  const m = output.match(/"sessionID":"(ses_[^"]+)"/);
  return m ? m[1] : undefined;
}

function splitPrompt(prompt: string, chunkSize: number): string[] {
  if (prompt.length <= chunkSize) return [prompt];
  const parts: string[] = [];
  let current = '';
  for (const line of prompt.split('\n')) {
    const next = current ? `${current}\n${line}` : line;
    if (current && next.length > chunkSize) {
      parts.push(current);
      current = line;
    } else {
      current = next;
    }
  }
  if (current) parts.push(current);
  return parts;
}

function runOpencodeCli(
  args: string[],
  opts: OpenCodeOptions
): Promise<OpenCodeResult> {
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
      resolve({
        output: '',
        exitCode: 1,
        structured: undefined,
      });
    });
  });
}

/**
 * @deprecated Legacy opencode backend. Callers should use the provider-agnostic
 * `agentRun` from `lib/agent-provider.ts`, which dispatches to the configured
 * backend (opencode by default, or any OpenAI-compatible API). This function is
 * only invoked directly by that dispatcher; new code must not call it directly.
 */
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

    // Check if error is retryable (401, network errors, timeouts, empty output)
    const combined = result.output.toLowerCase();
    const isRetryable =
      result.exitCode === 124 || // our SIGTERM timeout marker
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

/**
 * @deprecated Legacy opencode backend detection. Prefer `agentVersion` from
 * `lib/agent-provider.ts`, which also reports on non-opencode backends.
 */
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

/**
 * @deprecated Legacy opencode-specific output extractor. Prefer the
 * re-exported `extractStructuredOutput` from `lib/agent-provider.ts`, which
 * accepts results from any agent backend.
 */
export function extractStructuredOutput(result: OpenCodeResult): any {
  if (result.structured?.info?.structured_output) {
    return result.structured.info.structured_output;
  }
  if (result.structured?.output) {
    return result.structured.output;
  }
  // opencode --format json outputs one JSON event per line
  // Extract text content from type:"text" events (part.type "text" too)
  const lines = result.output.split('\n').filter(l => l.trim());
  const textParts: string[] = [];
  let sawJsonEvent = false;
  for (const line of lines) {
    try {
      const event = JSON.parse(line);
      sawJsonEvent = true;
      const part = event?.part;
      if ((event.type === 'text' || part?.type === 'text') && typeof part?.text === 'string') {
        textParts.push(part.text);
      }
    } catch {
      // Not JSON or unparseable — include as-is
    }
  }
  if (textParts.length > 0) {
    return textParts.join('\n');
  }
  if (sawJsonEvent) {
    // JSON events present but no text parts (e.g. tool-call-only run).
    // Return the raw lines so extractMarkdown keeps any non-JSON content and
    // callers can diagnose why the model produced no answer.
    return lines.join('\n');
  }
  return result.output;
}

/**
 * @deprecated Legacy opencode-specific markdown extractor. Prefer the
 * re-exported `extractMarkdown` from `lib/agent-provider.ts`.
 */
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
    clean.push(line);
  }

  const joined = clean.join('\n').trim();
  if (joined) return joined;

  // Everything was stripped (only JSON events, no text content).
  // Return the raw output so callers see the actual agent response instead of
  // silently collapsing to an empty string.
  return raw;
}
