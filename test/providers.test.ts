import { afterEach, describe, expect, it, vi } from 'vitest';
import { createGenerator, normalizeOllamaHost, ProviderError, SetupError } from '../src/core/providers';
import type { GenerateJob } from '../src/core/types';
import { baseFacts, streamResponse } from './helpers';

const job: GenerateJob = {
  kind: 'generate',
  context: { facts: baseFacts(), tree: 'index.js', files: [{ path: 'index.js', content: 'x', truncated: false }] },
  options: { style: 'standard', quality: 'fast' },
};

async function run(gen: ReturnType<typeof createGenerator>) {
  let out = '';
  for await (const chunk of gen.stream(job)) out += chunk;
  return out;
}

const sse = (events: object[], extra = '') => events.map((e) => `data: ${JSON.stringify(e)}\n\n`).join('') + extra;

afterEach(() => vi.unstubAllGlobals());

function stubFetch(handler: (url: string, init: RequestInit) => Response | Promise<Response>) {
  const calls: { url: string; init: RequestInit; body: any }[] = [];
  vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
    calls.push({ url, init, body: init.body ? JSON.parse(init.body as string) : undefined });
    return handler(url, init);
  });
  return calls;
}

describe('direct providers', () => {
  it('streams Claude (Anthropic SSE)', async () => {
    const calls = stubFetch(() =>
      streamResponse(
        'event: message_start\ndata: {"type":"message_start"}\n\n' +
          'event: content_block_delta\ndata: {"type":"content_block_delta","delta":{"type":"text_delta","text":"# Hel"}}\n\n' +
          ': keep-alive\n\n' +
          'event: content_block_delta\ndata: {"type":"content_block_delta","delta":{"type":"text_delta","text":"lo"}}\n\n' +
          'event: message_stop\ndata: {"type":"message_stop"}\n\n',
      ),
    );
    const gen = createGenerator({ provider: 'claude', quality: 'high', env: { ANTHROPIC_API_KEY: 'k1' } });
    expect(gen.label).toBe('claude · claude-sonnet-5-5 (your key)');
    expect(await run(gen)).toBe('# Hello');
    expect(calls[0]!.url).toBe('https://api.anthropic.com/v1/messages');
    expect((calls[0]!.init.headers as Record<string, string>)['x-api-key']).toBe('k1');
    expect(calls[0]!.body.system).toContain('expert technical writer');
    expect(calls[0]!.body.stream).toBe(true);
  });

  it('streams Gemini and skips thought parts', async () => {
    const calls = stubFetch(() =>
      streamResponse(sse([
        { candidates: [{ content: { parts: [{ text: 'thinking…', thought: true }] } }] },
        { candidates: [{ content: { parts: [{ text: '# A' }] } }] },
        { candidates: [{ content: { parts: [{ text: 'pp' }] }, finishReason: 'STOP' }] },
      ])),
    );
    const gen = createGenerator({ provider: 'gemini', quality: 'fast', model: 'gemini-x', env: { GOOGLE_GENERATIVE_AI_API_KEY: 'g' } });
    expect(await run(gen)).toBe('# App');
    expect(calls[0]!.url).toContain('/models/gemini-x:streamGenerateContent?alt=sse');
    expect((calls[0]!.init.headers as Record<string, string>)['x-goog-api-key']).toBe('g');
  });

  it('streams OpenAI and Grok (OpenAI-compatible SSE)', async () => {
    const calls = stubFetch(() => streamResponse(sse([{ choices: [{ delta: { role: 'assistant' } }] }, { choices: [{ delta: { content: '# O' } }] }, { choices: [{ delta: { content: 'K' } }] }], 'data: [DONE]\n\n')));
    expect(await run(createGenerator({ provider: 'openai', quality: 'fast', env: { OPENAI_API_KEY: 'o' } }))).toBe('# OK');
    expect(await run(createGenerator({ provider: 'grok', quality: 'fast', env: { XAI_API_KEY: 'x' } }))).toBe('# OK');
    expect(calls[0]!.url).toBe('https://api.openai.com/v1/chat/completions');
    expect(calls[1]!.url).toBe('https://api.x.ai/v1/chat/completions');
    expect((calls[1]!.init.headers as Record<string, string>).authorization).toBe('Bearer x');
  });

  it('streams Ollama NDJSON from OLLAMA_HOST', async () => {
    const calls = stubFetch(() => streamResponse('{"message":{"content":"# L"}}\n{"message":{"content":"ocal"}}\n{"done":true}\n'));
    const gen = createGenerator({ provider: 'ollama', quality: 'fast', env: { OLLAMA_HOST: '0.0.0.0' } });
    expect(gen.label).toBe('ollama · qwen3:8b (local)');
    expect(await run(gen)).toBe('# Local');
    expect(calls[0]!.url).toBe('http://127.0.0.1:11434/api/chat');
    expect(calls[0]!.body.think).toBe(false);
  });
});

describe('errors', () => {
  it('explains a missing key with the env var and where to get one', () => {
    expect(() => createGenerator({ provider: 'claude', quality: 'fast', env: {} })).toThrow(SetupError);
    expect(() => createGenerator({ provider: 'claude', quality: 'fast', env: {} })).toThrow(/ANTHROPIC_API_KEY[\s\S]*console\.anthropic\.com/);
  });

  it('maps HTTP failures to friendly messages', async () => {
    stubFetch(() => new Response(JSON.stringify({ error: { message: 'invalid x-api-key' } }), { status: 401 }));
    await expect(run(createGenerator({ provider: 'claude', quality: 'fast', env: { ANTHROPIC_API_KEY: 'bad' } }))).rejects.toThrow(/rejected the API key \(ANTHROPIC_API_KEY\)/);

    stubFetch(() => new Response('{"error":{"message":"model not found"}}', { status: 404 }));
    await expect(run(createGenerator({ provider: 'openai', quality: 'fast', model: 'nope', env: { OPENAI_API_KEY: 'k' } }))).rejects.toThrow(/doesn't know the model "nope"/);

    stubFetch(() => new Response('{}', { status: 429, headers: { 'retry-after': '20' } }));
    const err = await run(createGenerator({ provider: 'grok', quality: 'fast', env: { XAI_API_KEY: 'k' } })).catch((e) => e);
    expect(err).toBeInstanceOf(ProviderError);
    expect(err.retryAfterSeconds).toBe(20);
  });

  it('tells you to start Ollama or pull the model', async () => {
    stubFetch(() => {
      throw Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNREFUSED' } });
    });
    await expect(run(createGenerator({ provider: 'ollama', quality: 'fast', env: {} }))).rejects.toThrow(/ollama serve/);
    stubFetch(() => new Response('{"error":"model not found"}', { status: 404 }));
    await expect(run(createGenerator({ provider: 'ollama', quality: 'fast', env: {} }))).rejects.toThrow(/ollama pull qwen3:8b/);
  });

  it('normalizes OLLAMA_HOST values', () => {
    expect(normalizeOllamaHost(undefined)).toBe('http://127.0.0.1:11434');
    expect(normalizeOllamaHost('192.168.1.20')).toBe('http://192.168.1.20:11434');
    expect(normalizeOllamaHost('https://gpu.box:8080/')).toBe('https://gpu.box:8080');
  });
});

describe('hosted', () => {
  it('reads NDJSON events and updates the label with the model', async () => {
    const calls = stubFetch(() => streamResponse('{"type":"meta","provider":"gemini","model":"gemini-3.8-flash"}\n{"type":"text","text":"# H"}\n{"type":"text","text":"i"}\n{"type":"done"}\n'));
    const gen = createGenerator({ provider: 'hosted', quality: 'fast', serverUrl: 'http://srv/', clientVersion: '2.0.0', env: {} });
    expect(await run(gen)).toBe('# Hi');
    expect(gen.label).toBe('hosted · gemini-3.8-flash');
    expect(calls[0]!.url).toBe('http://srv/v1/generate');
    expect(calls[0]!.body.job.kind).toBe('generate');
  });

  it('turns a 429 into advice to use your own key', async () => {
    stubFetch(() => new Response(JSON.stringify({ error: 'Free limit reached: 10 READMEs per 15 minutes.', retryAfterSeconds: 300 }), { status: 429 }));
    const gen = createGenerator({ provider: 'hosted', quality: 'fast', serverUrl: 'http://srv', env: {} });
    await expect(run(gen)).rejects.toThrow(/Free limit reached[\s\S]*about 5 min[\s\S]*--provider gemini/);
  });

  it('surfaces errors sent mid-stream', async () => {
    stubFetch(() => streamResponse('{"type":"text","text":"# H"}\n{"type":"error","message":"The AI provider is busy"}\n'));
    await expect(run(createGenerator({ provider: 'hosted', quality: 'fast', serverUrl: 'http://srv', env: {} }))).rejects.toThrow(/busy/);
  });
});
