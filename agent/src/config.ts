import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

export interface Config {
  /*! Url for  target website */
  targetUrl?: string;
  opencodeModel?: string;
  outputDir: string;
  playwrightCliPath: string;
  opencodePath: string;
  headed: boolean;
  snapshotDepth: number;
  maxRetries: number;
  storageState?: string;
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
  if (configPath && existsSync(configPath)) {
    try {
      fileConfig = JSON.parse(readFileSync(configPath, 'utf-8'));
    } catch {
      console.warn(`Warning: failed to parse config at ${configPath}`);
    }
  }

  const envConfig: Partial<Config> = {};
  if (process.env.OPENCODE_MODEL) envConfig.opencodeModel = process.env.OPENCODE_MODEL;
  if (process.env.TARGET_URL) envConfig.targetUrl = process.env.TARGET_URL;
  if (process.env.PW_CLI_HEADED) envConfig.headed = process.env.PW_CLI_HEADED === 'true';
  if (process.env.PW_CLI_OUTPUT_DIR) envConfig.outputDir = process.env.PW_CLI_OUTPUT_DIR;
  if (process.env.STORAGE_STATE) envConfig.storageState = process.env.STORAGE_STATE;

  return { ...DEFAULT_CONFIG, ...fileConfig, ...envConfig };
}

export function resolveConfig(cliFlags: Partial<Config>, configPath?: string): Config {
  const base = loadConfig(configPath);
  const merged = { ...base };

  if (cliFlags.targetUrl !== undefined) merged.targetUrl = cliFlags.targetUrl;
  if (cliFlags.opencodeModel !== undefined) merged.opencodeModel = cliFlags.opencodeModel;
  if (cliFlags.outputDir !== undefined) merged.outputDir = cliFlags.outputDir;
  if (cliFlags.headed !== undefined) merged.headed = cliFlags.headed;
  if (cliFlags.snapshotDepth !== undefined) merged.snapshotDepth = cliFlags.snapshotDepth;
  if (cliFlags.maxRetries !== undefined) merged.maxRetries = cliFlags.maxRetries;
  if (cliFlags.storageState !== undefined) merged.storageState = cliFlags.storageState;

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
