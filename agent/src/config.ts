import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

export interface Config {
  /*! Url for  target website */
  targetUrl?: string;
  /*! Agent backend: 'opencode' (default) or 'api' (OpenAI-compatible chat-completions) */
  agentProvider?: string;
  /*! Model for the opencode backend */
  opencodeModel?: string;
  /*! Model for the api backend */
  apiModel?: string;
  /*! Base URL for the api backend (default: https://api.openai.com/v1) */
  apiBaseUrl?: string;
  /*! Request timeout (ms) for the api backend */
  apiTimeout?: number;
  outputDir: string;
  playwrightCliPath: string;
  opencodePath: string;
  headed: boolean;
  snapshotDepth: number;
  maxRetries: number;
  storageState?: string;
  /*! HTTP Basic Auth credentials for sites behind an nginx auth gate */
  basicAuthUser?: string;
  basicAuthPass?: string;
}

const DEFAULT_CONFIG: Config = {
  outputDir: './artifacts',
  playwrightCliPath: 'playwright-cli',
  opencodePath: 'opencode',
  headed: false,
  snapshotDepth: 4,
  maxRetries: 3,
};

function findConfigFile(): string | null {
  const candidates = [
    join(process.cwd(), 'pw-cli-agent.config.json'),
    join(homedir(), '.config', 'pw-cli-agent', 'config.json'),
  ];
  for (const p of candidates) {
    if (existsSync(p)) return p;
  }
  return null;
}

export function loadConfig(overridePath?: string): Config {
  let fileConfig: Partial<Config> = {};

  const configPath = overridePath ?? findConfigFile();
  if (overridePath && !existsSync(overridePath)) {
    console.error(`Error: config file not found: ${overridePath}`);
    process.exit(1);
  }
  if (configPath && existsSync(configPath)) {
    try {
      fileConfig = JSON.parse(readFileSync(configPath, 'utf-8'));
    } catch {
      console.warn(`Warning: failed to parse config at ${configPath}`);
    }
  }

  const envConfig: Partial<Config> = {};
  if (process.env.AGENT_PROVIDER) envConfig.agentProvider = process.env.AGENT_PROVIDER;
  if (process.env.OPENCODE_MODEL) envConfig.opencodeModel = process.env.OPENCODE_MODEL;
  if (process.env.AGENT_API_MODEL) envConfig.apiModel = process.env.AGENT_API_MODEL;
  if (process.env.AGENT_API_BASE_URL) envConfig.apiBaseUrl = process.env.AGENT_API_BASE_URL;
  if (process.env.AGENT_API_TIMEOUT) {
    const t = parseInt(process.env.AGENT_API_TIMEOUT, 10);
    if (!Number.isNaN(t)) envConfig.apiTimeout = t;
  }
  if (process.env.TARGET_URL) envConfig.targetUrl = process.env.TARGET_URL;
  if (process.env.PW_CLI_HEADED) envConfig.headed = process.env.PW_CLI_HEADED === 'true';
  if (process.env.PW_CLI_OUTPUT_DIR) envConfig.outputDir = process.env.PW_CLI_OUTPUT_DIR;
  if (process.env.STORAGE_STATE) envConfig.storageState = process.env.STORAGE_STATE;
  if (process.env.BASIC_AUTH_USER) envConfig.basicAuthUser = process.env.BASIC_AUTH_USER;
  if (process.env.BASIC_AUTH_PASS) envConfig.basicAuthPass = process.env.BASIC_AUTH_PASS;

  return { ...DEFAULT_CONFIG, ...fileConfig, ...envConfig };
}

/**
 * Returns Playwright `httpCredentials` for the configured Basic Auth gate,
 * or undefined when no credentials are set.
 */
export function httpCredentialsFor(config?: Config): { username: string; password: string } | undefined {
  if (config?.basicAuthUser && config?.basicAuthPass) {
    return { username: config.basicAuthUser, password: config.basicAuthPass };
  }
  return undefined;
}

export function resolveConfig(cliFlags: Partial<Config>, configPath?: string): Config {
  const base = loadConfig(configPath);
  const merged = { ...base };

  if (cliFlags.targetUrl !== undefined) merged.targetUrl = cliFlags.targetUrl;
  if (cliFlags.agentProvider !== undefined) merged.agentProvider = cliFlags.agentProvider;
  if (cliFlags.opencodeModel !== undefined) merged.opencodeModel = cliFlags.opencodeModel;
  if (cliFlags.apiModel !== undefined) merged.apiModel = cliFlags.apiModel;
  if (cliFlags.apiBaseUrl !== undefined) merged.apiBaseUrl = cliFlags.apiBaseUrl;
  if (cliFlags.apiTimeout !== undefined) merged.apiTimeout = cliFlags.apiTimeout;
  if (cliFlags.outputDir !== undefined) merged.outputDir = cliFlags.outputDir;
  if (cliFlags.headed !== undefined) merged.headed = cliFlags.headed;
  if (cliFlags.snapshotDepth !== undefined) merged.snapshotDepth = cliFlags.snapshotDepth;
  if (cliFlags.maxRetries !== undefined) merged.maxRetries = cliFlags.maxRetries;
  if (cliFlags.storageState !== undefined) merged.storageState = cliFlags.storageState;
  if (cliFlags.basicAuthUser !== undefined) merged.basicAuthUser = cliFlags.basicAuthUser;
  if (cliFlags.basicAuthPass !== undefined) merged.basicAuthPass = cliFlags.basicAuthPass;

  return merged;
}

export function resolveProfile(explicit?: string, config?: Config): string | undefined {
  if (explicit) return explicit;
  if (config?.storageState) return config.storageState;
  const defaultProfile = join(process.cwd(), 'auth-profile');
  if (existsSync(defaultProfile)) {
    console.log(`  Auto-detected browser profile: ${defaultProfile}`);
    return defaultProfile;
  }
  return undefined;
}
