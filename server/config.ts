import type { DirectProviderId } from '../src/core/types';
import { DEFAULT_MODELS, findKey, normalizeOllamaHost } from '../src/core/providers';

export interface Tier {
  provider: DirectProviderId;
  model: string;
  apiKey?: string;
  keyEnv?: string;
  baseUrl?: string;
}

export interface ServerConfig {
  port: number;
  trustProxy: boolean;
  fast: Tier;
  /** Used for --quality high. Falls back to the fast tier when not configured. */
  high?: Tier;
  limits: {
    perWindow: number;
    windowMinutes: number;
    highPerWindow: number;
    repairPerWindow: number;
    dailyLimit: number;
  };
}

const PROVIDERS: DirectProviderId[] = ['gemini', 'claude', 'openai', 'grok', 'ollama'];

function int(env: NodeJS.ProcessEnv, name: string, fallback: number): number {
  const raw = env[name];
  if (raw === undefined || raw === '') return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 0) throw new Error(`${name} must be a whole number, got "${raw}"`);
  return n;
}

function tier(env: NodeJS.ProcessEnv, provider: string, model: string | undefined, quality: 'fast' | 'high'): Tier | { missing: string } {
  if (!PROVIDERS.includes(provider as DirectProviderId)) throw new Error(`Unknown provider "${provider}". Use one of: ${PROVIDERS.join(', ')}`);
  const p = provider as DirectProviderId;
  const m = model || DEFAULT_MODELS[p][quality];
  if (p === 'ollama') return { provider: p, model: m, baseUrl: normalizeOllamaHost(env.OLLAMA_HOST) };
  const { key, envName } = findKey(p, env);
  if (!key) return { missing: envName };
  return { provider: p, model: m, apiKey: key, keyEnv: envName };
}

export function loadServerConfig(env: NodeJS.ProcessEnv): ServerConfig {
  const fastProvider = env.FAST_PROVIDER || 'gemini';
  const fast = tier(env, fastProvider, env.FAST_MODEL, 'fast');
  if ('missing' in fast) throw new Error(`${fast.missing} is required (FAST_PROVIDER=${fastProvider}).`);

  const highProvider = env.HIGH_PROVIDER || (findKey('claude', env).key ? 'claude' : fastProvider);
  const high = tier(env, highProvider, env.HIGH_MODEL, 'high');
  if ('missing' in high && env.HIGH_PROVIDER) throw new Error(`${high.missing} is required (HIGH_PROVIDER=${highProvider}).`);

  return {
    port: int(env, 'PORT', 3001),
    trustProxy: env.TRUST_PROXY !== 'false',
    fast,
    high: 'missing' in high ? undefined : high,
    limits: {
      perWindow: int(env, 'RATE_LIMIT', 10),
      windowMinutes: int(env, 'RATE_WINDOW_MINUTES', 15),
      highPerWindow: int(env, 'HIGH_RATE_LIMIT', 3),
      repairPerWindow: int(env, 'REPAIR_RATE_LIMIT', 20),
      dailyLimit: int(env, 'DAILY_LIMIT', 1_000),
    },
  };
}
