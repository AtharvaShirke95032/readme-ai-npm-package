import type { DirectProviderId, Generator, Job, ProviderId, Quality } from '../types';
import { buildGeneratePrompt, buildRepairPrompt } from '../prompt/build';
import { ProviderError, readNdjson, request, withTimeout } from './http';
import { streamChat, type ChatConfig } from './llm';
import { DEFAULT_MODELS, KEY_URLS, PROVIDER_NAMES, findKey } from './models';

export { ProviderError } from './http';
export { DEFAULT_MODELS, KEY_ENV, contextBudget, findKey } from './models';

export const DEFAULT_SERVER_URL = 'https://readme-ai-backend.onrender.com';
export const PROVIDERS: ProviderId[] = ['hosted', 'gemini', 'claude', 'openai', 'grok', 'ollama'];

/** A problem the user can fix (missing key, bad flag). Shown without a stack trace. */
export class SetupError extends Error {
  override name = 'SetupError';
}

export interface GeneratorSettings {
  provider: ProviderId;
  quality: Quality;
  model?: string;
  serverUrl?: string;
  clientVersion?: string;
  env?: NodeJS.ProcessEnv;
}

export function normalizeOllamaHost(raw: string | undefined): string {
  if (!raw?.trim()) return 'http://127.0.0.1:11434';
  let host = raw.trim();
  if (!/^https?:\/\//.test(host)) host = `http://${host}`;
  host = host.replace('://0.0.0.0', '://127.0.0.1');
  if (!/:\d+(\/|$)/.test(host.replace(/^https?:\/\//, ''))) host = `${host.replace(/\/$/, '')}:11434`;
  return host.replace(/\/$/, '');
}

/** Runs prompts on a model directly from this machine. Also used by the hosted server. */
export function directGenerator(cfg: ChatConfig, label: string): Generator {
  return {
    label,
    async *stream(job: Job, signal?: AbortSignal) {
      const prompt = job.kind === 'generate' ? buildGeneratePrompt(job) : buildRepairPrompt(job);
      yield* streamChat(cfg, prompt, signal);
    },
  };
}

export function hostedGenerator(serverUrl: string, clientVersion = '0.0.0'): Generator {
  const base = serverUrl.replace(/\/$/, '');
  const name = PROVIDER_NAMES.hosted;
  const gen: Generator = {
    label: 'hosted',
    async *stream(job: Job, signal?: AbortSignal) {
      const res = await request(`${base}/v1/generate`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'user-agent': `readme-ai/${clientVersion}` },
        body: JSON.stringify({ job, client: { version: clientVersion } }),
        signal: withTimeout(signal, 6 * 60_000),
      }, name);
      if (!res.ok || !res.body) {
        const body = await res.json().catch(() => ({})) as { error?: string; retryAfterSeconds?: number };
        if (res.status === 429) {
          const wait = body.retryAfterSeconds ? ` Try again in about ${Math.ceil(body.retryAfterSeconds / 60)} min,` : ' Try again later,';
          throw new ProviderError(`${body.error ?? 'The free hosted service is at its limit.'}${wait} or use your own key, e.g. --provider gemini (free key: ${KEY_URLS.gemini}).`, name, 429, body.retryAfterSeconds);
        }
        throw new ProviderError(`Hosted service error (HTTP ${res.status}): ${body.error ?? res.statusText}`, name, res.status);
      }
      for await (const ev of readNdjson<{ type: string; text?: string; message?: string; provider?: string; model?: string }>(res.body)) {
        if (ev.type === 'meta' && ev.model) gen.label = `hosted · ${ev.model}`;
        else if (ev.type === 'text' && ev.text) yield ev.text;
        else if (ev.type === 'error') throw new ProviderError(ev.message ?? 'Hosted generation failed.', name);
        else if (ev.type === 'done') break;
      }
    },
  };
  return gen;
}

export function createGenerator(s: GeneratorSettings): Generator {
  const env = s.env ?? process.env;
  if (s.provider === 'hosted') {
    return hostedGenerator(s.serverUrl ?? env.README_AI_SERVER_URL ?? DEFAULT_SERVER_URL, s.clientVersion);
  }
  if (!PROVIDERS.includes(s.provider)) {
    throw new SetupError(`Unknown provider "${s.provider}". Use one of: ${PROVIDERS.join(', ')}.`);
  }
  const provider = s.provider as DirectProviderId;
  const model = s.model ?? DEFAULT_MODELS[provider][s.quality];

  if (provider === 'ollama') {
    const baseUrl = normalizeOllamaHost(env.OLLAMA_HOST);
    return directGenerator({ provider, model, baseUrl }, `ollama · ${model} (local)`);
  }

  const { key, envName } = findKey(provider, env);
  if (!key) {
    throw new SetupError(
      `No ${envName} found.\n` +
        `  → Set it:     export ${envName}=your-key\n` +
        `  → Get a key:  ${KEY_URLS[provider]}\n` +
        '  → Or run without --provider to use the free hosted service.',
    );
  }
  return directGenerator({ provider, model, apiKey: key, keyEnv: envName }, `${provider} · ${model} (your key)`);
}
