import type { DirectProviderId, Quality } from '../types';

/**
 * Default model per provider and quality level. Model names change often:
 * update them here, or override at runtime with --model.
 */
export const DEFAULT_MODELS: Record<DirectProviderId, Record<Quality, string>> = {
  gemini: { fast: 'gemini-3.8-flash', high: 'gemini-4-argon' },
  claude: { fast: 'claude-haiku-5-5', high: 'claude-sonnet-5-5' },
  openai: { fast: 'gpt-5.4-mini', high: 'gpt-5.4' },
  grok: { fast: 'grok-4.3', high: 'grok-4.6' },
  ollama: { fast: 'qwen3:8b', high: 'qwen3:8b' },
};

/** Environment variables checked for each provider's key, in order. */
export const KEY_ENV: Record<Exclude<DirectProviderId, 'ollama'>, string[]> = {
  gemini: ['GEMINI_API_KEY', 'GOOGLE_API_KEY', 'GOOGLE_GENERATIVE_AI_API_KEY'],
  claude: ['ANTHROPIC_API_KEY'],
  openai: ['OPENAI_API_KEY'],
  grok: ['XAI_API_KEY'],
};

export const PROVIDER_NAMES: Record<DirectProviderId | 'hosted', string> = {
  hosted: 'readme-ai hosted',
  gemini: 'Gemini',
  claude: 'Claude',
  openai: 'OpenAI',
  grok: 'Grok',
  ollama: 'Ollama',
};

export const KEY_URLS: Record<Exclude<DirectProviderId, 'ollama'>, string> = {
  gemini: 'https://aistudio.google.com/apikey',
  claude: 'https://console.anthropic.com/settings/keys',
  openai: 'https://platform.openai.com/api-keys',
  grok: 'https://console.x.ai',
};

export function findKey(provider: Exclude<DirectProviderId, 'ollama'>, env: NodeJS.ProcessEnv = process.env): { key?: string; envName: string } {
  for (const name of KEY_ENV[provider]) {
    const v = env[name]?.trim();
    if (v) return { key: v, envName: name };
  }
  return { envName: KEY_ENV[provider][0]! };
}

/** How many prompt tokens to aim for. Local models get a small window. */
export function contextBudget(provider: DirectProviderId | 'hosted', quality: Quality, override?: number): number {
  if (override) return override;
  if (provider === 'ollama') return 6_000;
  return quality === 'high' ? 110_000 : 60_000;
}
