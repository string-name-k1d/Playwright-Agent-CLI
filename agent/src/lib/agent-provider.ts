import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import type { Config } from '../config.js';
import {
  opencodeRun,
  opencodeVersion,
  extractStructuredOutput,
  extractMarkdown,
} from './opencode.js';

export type AgentProviderName = 'opencode' | 'api';

export interface AgentOptions {
  model?: string;
  session?: string;
  agent?: string;
  system?: string;
  quiet?: boolean;
  timeout?: number;
  cwd?: string;
  retries?: number;
}

export interface AgentResult {
  output: string;
  structured?: any;
  exitCode: number;
  provider: string;
}

export interface AgentVersion {
  available: boolean;
  version?: string;
  mode: string;
  provider: string;
}

const DEFAULT_API_BASE_URL = 'https://api.openai.com/v1';
const DEFAULT_API_TIMEOUT = 300000;

/**
 * Resolves the active agent backend. When AGENT_PROVIDER is unset (or anything
 * other than `api`), the legacy opencode backend is used.
 */
export function resolveProviderName(config?: Config): AgentProviderName {
  const raw = (config?.agentProvider ?? process.env.AGENT_PROVIDER ?? 'opencode').toLowerCase().trim();
  return raw === 'api' ? 'api' : 'opencode';
}

/** Resolves the effective model for the active agent backend (for display). */
export function resolveAgentModel(config?: Config): string | undefined {
  if (resolveProviderName(config) === 'api') {
    return config?.apiModel ?? process.env.AGENT_API_MODEL ?? process.env.OPENAI_MODEL;
  }
  return config?.opencodeModel ?? process.env.OPENCODE_MODEL;
}

interface ApiBackendConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
  timeout: number;
}

function apiConfig(config?: Config): ApiBackendConfig {
  const baseUrl = (config?.apiBaseUrl ?? process.env.AGENT_API_BASE_URL ?? DEFAULT_API_BASE_URL).replace(/\/+$/, '');
  const apiKey = process.env.AGENT_API_KEY ?? process.env.OPENAI_API_KEY ?? '';
  const model = config?.apiModel ?? process.env.AGENT_API_MODEL ?? process.env.OPENAI_MODEL ?? '';
  const timeout =
    config?.apiTimeout ??
    (parseInt(process.env.AGENT_API_TIMEOUT ?? String(DEFAULT_API_TIMEOUT), 10) ||
      DEFAULT_API_TIMEOUT);
  return { baseUrl, apiKey, model, timeout };
}

async function httpPostJson(
  url: string,
  body: unknown,
  apiKey: string,
  timeout: number
): Promise<{ data: string; status: number }> {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const mod = parsed.protocol === 'https:' ? httpsRequest : httpRequest;
    const payload = JSON.stringify(body);

    const req = mod(
      {
        hostname: parsed.hostname,
        port: parsed.port,
        path: parsed.pathname,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(payload),
          Authorization: `Bearer ${apiKey}`,
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

    req.write(payload);
    req.end();
  });
}

function isRetryableError(message: string): boolean {
  const m = message.toLowerCase();
  return (
    m.includes('timed out') ||
    m.includes('econnreset') ||
    m.includes('econnrefused') ||
    m.includes('socket hang up') ||
    m.includes('fetch failed')
  );
}

async function apiRun(
  prompt: string,
  opts: AgentOptions,
  config?: Config
): Promise<AgentResult> {
  const { baseUrl, apiKey, model, timeout } = apiConfig(config);
  const resolvedModel = opts.model ?? model;

  if (!apiKey) {
    return {
      output:
        'No API key configured for the api backend. Set AGENT_API_KEY (or OPENAI_API_KEY).',
      exitCode: 1,
      provider: 'api',
    };
  }
  if (!resolvedModel) {
    return {
      output:
        'No model configured for the api backend. Set AGENT_API_MODEL (or OPENAI_API_MODEL) or pass --model.',
      exitCode: 1,
      provider: 'api',
    };
  }

  const maxRetries = opts.retries ?? 3;
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const res = await httpPostJson(
        `${baseUrl}/chat/completions`,
        {
          model: resolvedModel,
          messages: [
            ...(opts.system ? [{ role: 'system', content: opts.system }] : []),
            { role: 'user', content: prompt },
          ],
        },
        apiKey,
        opts.timeout ?? timeout
      );

      if (res.status === 200) {
        let content = '';
        try {
          const parsed = JSON.parse(res.data);
          content = parsed?.choices?.[0]?.message?.content ?? '';
        } catch {
          content = res.data;
        }
        return { output: content, exitCode: 0, provider: 'api' };
      }

      // Retry rate limits and transient 5xx errors
      const retryable = res.status === 429 || res.status >= 500;
      const message = res.data ? res.data.slice(0, 500) : `HTTP ${res.status}`;
      if (!retryable || attempt === maxRetries) {
        return { output: `API error (HTTP ${res.status}): ${message}`, exitCode: 1, provider: 'api' };
      }
    } catch (err: any) {
      const message = err?.message ?? String(err);
      if (!isRetryableError(message) || attempt === maxRetries) {
        return { output: message, exitCode: 1, provider: 'api' };
      }
    }

    const delay = attempt * 2000;
    console.error(`  API attempt ${attempt}/${maxRetries} failed, retrying in ${delay / 1000}s...`);
    await new Promise((r) => setTimeout(r, delay));
  }

  return { output: 'Max retries exceeded', exitCode: 1, provider: 'api' };
}

/**
 * Runs a prompt against the configured agent backend and returns the result.
 * The active backend is resolved from AGENT_PROVIDER / config.agentProvider.
 */
export async function agentRun(
  prompt: string,
  opts: AgentOptions = {},
  config?: Config
): Promise<AgentResult> {
  const provider = resolveProviderName(config);
  if (provider === 'api') {
    return apiRun(prompt, opts, config);
  }

  const result = await opencodeRun(prompt, {
    model: opts.model ?? config?.opencodeModel,
    agent: opts.agent,
    quiet: opts.quiet,
    timeout: opts.timeout,
    cwd: opts.cwd,
    retries: opts.retries,
  });
  return { ...result, provider: 'opencode' };
}

/**
 * Detects whether the configured agent backend is available and reports its
 * version/mode. Used by `check` and the interactive header.
 */
export async function agentVersion(config?: Config): Promise<AgentVersion> {
  const provider = resolveProviderName(config);
  if (provider === 'api') {
    const { apiKey, model } = apiConfig(config);
    return { available: !!apiKey, version: model || 'api', mode: 'http', provider: 'api' };
  }

  const v = await opencodeVersion();
  return { available: v.available, version: v.version, mode: v.mode, provider: 'opencode' };
}

export { extractStructuredOutput, extractMarkdown };
