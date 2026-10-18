import { describe, expect, it } from 'vitest';
import { createApp } from '../server/app';
import { loadServerConfig, type ServerConfig } from '../server/config';
import { ProviderError } from '../src/core/providers';
import type { Generator, Job } from '../src/core/types';
import { baseFacts } from './helpers';

const config = (over: Partial<ServerConfig['limits']> = {}, high = true): ServerConfig => ({
  port: 0,
  trustProxy: true,
  fast: { provider: 'gemini', model: 'fast-model', apiKey: 'k' },
  high: high ? { provider: 'claude', model: 'high-model', apiKey: 'k2' } : undefined,
  limits: { perWindow: 3, windowMinutes: 15, highPerWindow: 1, repairPerWindow: 5, dailyLimit: 100, ...over },
});

function factory(seen: string[] = [], fail?: Error) {
  return (t: { model: string }): Generator => ({
    label: t.model,
    async *stream(job: Job) {
      seen.push(`${t.model}:${job.kind}`);
      if (fail) throw fail;
      yield '# Generated';
      yield '\n\nBody';
    },
  });
}

const generateBody = (quality: 'fast' | 'high' = 'fast') => ({
  job: { kind: 'generate', context: { facts: baseFacts(), tree: 'a.ts', files: [{ path: 'a.ts', content: '1', truncated: false }] }, options: { style: 'standard', quality } },
  client: { version: '2.0.0' },
});

const post = (app: ReturnType<typeof createApp>, path: string, body: unknown, ip = '1.1.1.1') =>
  app.request(path, { method: 'POST', headers: { 'content-type': 'application/json', 'x-forwarded-for': ip }, body: JSON.stringify(body) });

const json = async (res: Response): Promise<any> => res.json();

async function events(res: Response) {
  return (await res.text()).trim().split('\n').map((l) => JSON.parse(l));
}

describe('server', () => {
  it('streams NDJSON: meta, text, done', async () => {
    const res = await post(createApp(config(), factory()), '/v1/generate', generateBody());
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('application/x-ndjson');
    expect(await events(res)).toEqual([
      { type: 'meta', provider: 'gemini', model: 'fast-model' },
      { type: 'text', text: '# Generated' },
      { type: 'text', text: '\n\nBody' },
      { type: 'done' },
    ]);
  });

  it('uses the high tier for --quality high, with its own stricter limit', async () => {
    const seen: string[] = [];
    const app = createApp(config(), factory(seen));
    expect((await post(app, '/v1/generate', generateBody('high'))).status).toBe(200);
    const second = await post(app, '/v1/generate', generateBody('high'));
    expect(second.status).toBe(429);
    expect((await json(second)).error).toMatch(/High-quality limit/);
    expect(seen).toEqual(['high-model:generate']);
  });

  it('falls back to the fast tier when no high tier is configured', async () => {
    const seen: string[] = [];
    await (await post(createApp(config({}, false), factory(seen)), '/v1/generate', generateBody('high'))).text();
    expect(seen).toEqual(['fast-model:generate']);
  });

  it('rate-limits per IP and reports when to retry', async () => {
    const app = createApp(config(), factory());
    for (let i = 0; i < 3; i++) await (await post(app, '/v1/generate', generateBody())).text();
    const blocked = await post(app, '/v1/generate', generateBody());
    expect(blocked.status).toBe(429);
    expect(blocked.headers.get('retry-after')).toBeTruthy();
    expect((await json(blocked)).retryAfterSeconds).toBeGreaterThan(0);
    expect((await post(app, '/v1/generate', generateBody(), '2.2.2.2')).status).toBe(200);
  });

  it('enforces the daily budget', async () => {
    const app = createApp(config({ dailyLimit: 1, perWindow: 10 }), factory());
    await (await post(app, '/v1/generate', generateBody(), '1.1.1.1')).text();
    const res = await post(app, '/v1/generate', generateBody(), '3.3.3.3');
    expect(res.status).toBe(429);
    expect((await json(res)).error).toMatch(/daily limit/);
  });

  it('rejects malformed and oversized jobs', async () => {
    const app = createApp(config(), factory());
    expect((await post(app, '/v1/generate', { job: { kind: 'generate' } })).status).toBe(400);
    const huge = generateBody();
    huge.job.context.files = Array.from({ length: 12 }, (_, i) => ({ path: `f${i}`, content: 'x'.repeat(55_000), truncated: false }));
    const res = await post(app, '/v1/generate', huge);
    expect(res.status).toBe(400);
    expect((await json(res)).error).toMatch(/larger than/);
  });

  it('hides provider details and refunds the request when the provider is down', async () => {
    const app = createApp(config({ perWindow: 1 }), factory([], new ProviderError('secret upstream detail', 'Gemini', 503)));
    const res = await post(app, '/v1/generate', generateBody());
    const evs = await events(res);
    expect(evs.at(-1)).toEqual({ type: 'error', message: 'The AI provider is having problems. Please try again shortly.' });
    expect(JSON.stringify(evs)).not.toContain('secret upstream detail');
    // The failed request was refunded, so this one is still allowed.
    expect((await post(app, '/v1/generate', generateBody())).status).toBe(200);
  });

  it('accepts repair jobs', async () => {
    const seen: string[] = [];
    const res = await post(createApp(config(), factory(seen)), '/v1/generate', { job: { kind: 'repair', facts: baseFacts(), readme: '# A', problems: ['fix it'] } });
    expect(res.status).toBe(200);
    await res.text();
    expect(seen).toEqual(['fast-model:repair']);
  });

  it('keeps 1.x clients working on /api/generate', async () => {
    const res = await post(createApp(config(), factory()), '/api/generate', {
      projectInfo: { name: 'old', type: 'Node.js', languages: ['JavaScript'], dependencies: ['express'], files: [{}, {}], structure: 'index.js' },
      sampleCode: 'console.log(1)',
    });
    expect(res.status).toBe(200);
    expect(await json(res)).toEqual({ success: true, readme: '# Generated\n\nBody\n', projectInfo: { name: 'old', type: 'Node.js', languages: ['JavaScript'], fileCount: 2 } });
  });

  it('has a health check', async () => {
    const res = await createApp(config(), factory(), '2.0.0').request('/health');
    expect(await json(res)).toMatchObject({ status: 'ok', version: '2.0.0', fast: 'fast-model', high: 'high-model' });
  });
});

describe('server config', () => {
  it('needs a key for the fast provider', () => {
    expect(() => loadServerConfig({})).toThrow(/GEMINI_API_KEY is required/);
  });

  it('accepts the legacy Gemini variable and picks Claude for high quality when its key exists', () => {
    const cfg = loadServerConfig({ GOOGLE_GENERATIVE_AI_API_KEY: 'g', ANTHROPIC_API_KEY: 'a', RATE_LIMIT: '20' });
    expect(cfg.fast).toMatchObject({ provider: 'gemini', model: 'gemini-3.8-flash', apiKey: 'g' });
    expect(cfg.high).toMatchObject({ provider: 'claude', model: 'claude-sonnet-5-5' });
    expect(cfg.limits.perWindow).toBe(20);
  });

  it('uses the fast provider for high quality when no other key exists', () => {
    const cfg = loadServerConfig({ GEMINI_API_KEY: 'g' });
    expect(cfg.high).toMatchObject({ provider: 'gemini', model: 'gemini-4-argon' });
  });

  it('rejects bad numbers and unknown providers', () => {
    expect(() => loadServerConfig({ GEMINI_API_KEY: 'g', RATE_LIMIT: 'lots' })).toThrow(/RATE_LIMIT/);
    expect(() => loadServerConfig({ FAST_PROVIDER: 'skynet' })).toThrow(/Unknown provider/);
  });
});
