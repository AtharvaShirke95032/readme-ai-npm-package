import type { DirectProviderId } from '../types';
import type { Prompt } from '../prompt/build';
import { ProviderError, errorFromResponse, readNdjson, readSse, request, withTimeout } from './http';
import { PROVIDER_NAMES } from './models';

export interface ChatConfig {
  provider: DirectProviderId;
  model: string;
  apiKey?: string;
  keyEnv?: string;
  /** Ollama host, e.g. http://127.0.0.1:11434 */
  baseUrl?: string;
  maxOutputTokens?: number;
}

const TIMEOUT_MS = 5 * 60_000;
const OLLAMA_TIMEOUT_MS = 15 * 60_000;

/** Streams plain text from a model. One function per wire format. */
export async function* streamChat(cfg: ChatConfig, prompt: Prompt, signal?: AbortSignal): AsyncGenerator<string> {
  switch (cfg.provider) {
    case 'claude':
      yield* streamAnthropic(cfg, prompt, signal);
      return;
    case 'gemini':
      yield* streamGemini(cfg, prompt, signal);
      return;
    case 'openai':
      yield* streamOpenAiCompatible(cfg, prompt, signal, 'https://api.openai.com/v1');
      return;
    case 'grok':
      yield* streamOpenAiCompatible(cfg, prompt, signal, 'https://api.x.ai/v1');
      return;
    case 'ollama':
      yield* streamOllama(cfg, prompt, signal);
      return;
  }
}

async function* streamAnthropic(cfg: ChatConfig, prompt: Prompt, signal?: AbortSignal) {
  const name = PROVIDER_NAMES.claude;
  const res = await request('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': cfg.apiKey ?? '', 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({
      model: cfg.model,
      max_tokens: cfg.maxOutputTokens ?? 16_000,
      system: prompt.system,
      messages: [{ role: 'user', content: prompt.user }],
      stream: true,
    }),
    signal: withTimeout(signal, TIMEOUT_MS),
  }, name);
  if (!res.ok || !res.body) throw await errorFromResponse(res, name, { keyEnv: cfg.keyEnv, model: cfg.model });
  for await (const ev of readSse(res.body)) {
    if (ev.data === '[DONE]') break;
    const d = JSON.parse(ev.data);
    if (d.type === 'content_block_delta' && d.delta?.type === 'text_delta') yield d.delta.text as string;
    else if (d.type === 'error') throw new ProviderError(`${name}: ${d.error?.message ?? 'stream error'}`, name);
  }
}

async function* streamGemini(cfg: ChatConfig, prompt: Prompt, signal?: AbortSignal) {
  const name = PROVIDER_NAMES.gemini;
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(cfg.model)}:streamGenerateContent?alt=sse`;
  const res = await request(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-goog-api-key': cfg.apiKey ?? '' },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: prompt.system }] },
      contents: [{ role: 'user', parts: [{ text: prompt.user }] }],
      generationConfig: { maxOutputTokens: cfg.maxOutputTokens ?? 32_000 },
    }),
    signal: withTimeout(signal, TIMEOUT_MS),
  }, name);
  if (!res.ok || !res.body) throw await errorFromResponse(res, name, { keyEnv: cfg.keyEnv, model: cfg.model });
  for await (const ev of readSse(res.body)) {
    const d = JSON.parse(ev.data);
    if (d.error) throw new ProviderError(`${name}: ${d.error.message ?? 'stream error'}`, name, d.error.code);
    if (d.promptFeedback?.blockReason) throw new ProviderError(`${name} refused the request (${d.promptFeedback.blockReason}).`, name);
    const cand = d.candidates?.[0];
    for (const part of cand?.content?.parts ?? []) {
      if (typeof part.text === 'string' && !part.thought) yield part.text;
    }
    if (cand?.finishReason === 'SAFETY' || cand?.finishReason === 'PROHIBITED_CONTENT') {
      throw new ProviderError(`${name} stopped the answer for safety reasons.`, name);
    }
  }
}

async function* streamOpenAiCompatible(cfg: ChatConfig, prompt: Prompt, signal: AbortSignal | undefined, baseUrl: string) {
  const name = PROVIDER_NAMES[cfg.provider];
  const res = await request(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${cfg.apiKey ?? ''}` },
    body: JSON.stringify({
      model: cfg.model,
      stream: true,
      messages: [
        { role: 'system', content: prompt.system },
        { role: 'user', content: prompt.user },
      ],
    }),
    signal: withTimeout(signal, TIMEOUT_MS),
  }, name);
  if (!res.ok || !res.body) throw await errorFromResponse(res, name, { keyEnv: cfg.keyEnv, model: cfg.model });
  for await (const ev of readSse(res.body)) {
    if (ev.data === '[DONE]') break;
    const d = JSON.parse(ev.data);
    if (d.error) throw new ProviderError(`${name}: ${d.error.message ?? 'stream error'}`, name);
    const text = d.choices?.[0]?.delta?.content;
    if (typeof text === 'string') yield text;
  }
}

async function* streamOllama(cfg: ChatConfig, prompt: Prompt, signal?: AbortSignal) {
  const name = PROVIDER_NAMES.ollama;
  const host = (cfg.baseUrl ?? 'http://127.0.0.1:11434').replace(/\/$/, '');
  let res: Response;
  try {
    res = await fetch(`${host}/api/chat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        model: cfg.model,
        stream: true,
        think: false,
        messages: [
          { role: 'system', content: prompt.system },
          { role: 'user', content: prompt.user },
        ],
        options: { num_ctx: 12_288, temperature: 0.2 },
      }),
      signal: withTimeout(signal, OLLAMA_TIMEOUT_MS),
    });
  } catch (err) {
    if ((err as Error).name === 'AbortError' || signal?.aborted) throw err;
    throw new ProviderError(`Ollama isn't running at ${host}. Start it with \`ollama serve\` (install from https://ollama.com), or set OLLAMA_HOST.`, name);
  }
  if (res.status === 404) {
    throw new ProviderError(`Ollama doesn't have the model "${cfg.model}". Download it with: ollama pull ${cfg.model}`, name, 404);
  }
  if (!res.ok || !res.body) throw await errorFromResponse(res, name, { model: cfg.model });
  for await (const d of readNdjson(res.body)) {
    if (d.error) throw new ProviderError(`Ollama: ${d.error}`, name);
    const text = d.message?.content;
    if (typeof text === 'string' && text) yield text;
    if (d.done) break;
  }
}
