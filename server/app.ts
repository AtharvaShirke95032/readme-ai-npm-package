import { Hono, type Context } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { getConnInfo } from '@hono/node-server/conninfo';
import type { Generator, Job, ProjectFacts } from '../src/core/types';
import { directGenerator, ProviderError } from '../src/core/providers';
import { detectFrameworks } from '../src/core/facts/frameworks';
import { cleanOutput } from '../src/core/post/clean';
import type { ServerConfig, Tier } from './config';
import { DailyBudget, RateLimiter } from './limits';
import { RequestSchema } from './schema';

export type GeneratorFactory = (tier: Tier) => Generator;

const defaultFactory: GeneratorFactory = (t) =>
  directGenerator({ provider: t.provider, model: t.model, apiKey: t.apiKey, keyEnv: t.keyEnv, baseUrl: t.baseUrl }, `${t.provider} · ${t.model}`);

const log = (msg: string, extra?: Record<string, unknown>) =>
  console.log(JSON.stringify({ t: new Date().toISOString(), msg, ...extra }));

/** What the user sees. Provider details stay in the server logs. */
function publicMessage(err: unknown): string {
  if (err instanceof ProviderError && err.status === 429) return 'The AI provider is busy right now. Please try again in a minute.';
  if (err instanceof ProviderError && (err.status ?? 0) >= 500) return 'The AI provider is having problems. Please try again shortly.';
  return 'Generation failed on the server. Please try again, or use your own key with --provider.';
}

export function createApp(cfg: ServerConfig, makeGenerator: GeneratorFactory = defaultFactory, version = '0.0.0') {
  const windowMs = cfg.limits.windowMinutes * 60_000;
  const limiter = new RateLimiter(cfg.limits.perWindow, windowMs);
  const highLimiter = new RateLimiter(cfg.limits.highPerWindow, 60 * 60_000);
  const repairLimiter = new RateLimiter(cfg.limits.repairPerWindow, windowMs);
  const daily = new DailyBudget(cfg.limits.dailyLimit);

  const clientIp = (c: Context): string => {
    if (cfg.trustProxy) {
      const fwd = c.req.header('x-forwarded-for')?.split(',')[0]?.trim();
      if (fwd) return fwd;
    }
    try {
      return getConnInfo(c).remote.address ?? 'unknown';
    } catch {
      return 'unknown';
    }
  };

  /** Applies the limits for a job. Returns an error response, or undefined when allowed. */
  const admit = (c: Context, job: Job, ip: string): Response | undefined => {
    const deny = (error: string, retryAfterSeconds?: number) => {
      log('rate_limited', { ip, error });
      return c.json({ error, retryAfterSeconds }, 429, retryAfterSeconds ? { 'retry-after': String(retryAfterSeconds) } : {});
    };
    if (job.kind === 'repair') {
      const r = repairLimiter.take(ip);
      return r.ok ? undefined : deny('Too many requests.', r.retryAfterSeconds);
    }
    const r = limiter.take(ip);
    if (!r.ok) return deny(`Free limit reached: ${cfg.limits.perWindow} READMEs per ${cfg.limits.windowMinutes} minutes.`, r.retryAfterSeconds);
    if (job.options.quality === 'high' && cfg.high) {
      const h = highLimiter.take(ip);
      if (!h.ok) {
        limiter.refund(ip);
        return deny(`High-quality limit reached: ${cfg.limits.highPerWindow} per hour. Use --quality fast, or your own key.`, h.retryAfterSeconds);
      }
    }
    if (!daily.take()) return deny('The free service has reached its daily limit.');
    return undefined;
  };

  const tierFor = (job: Job): Tier => (job.kind === 'generate' && job.options.quality === 'high' && cfg.high ? cfg.high : cfg.fast);

  const app = new Hono();
  app.use('*', bodyLimit({ maxSize: 4 * 1024 * 1024, onError: (c) => c.json({ error: 'Request too large.' }, 413) }));

  app.get('/', (c) => c.json({ service: 'readme-ai', version, usage: 'npx @catmeow/readme-ai' }));
  app.get('/health', (c) =>
    c.json({ status: 'ok', service: 'readme-ai', version, fast: cfg.fast.model, high: (cfg.high ?? cfg.fast).model, usedToday: daily.usedToday }),
  );

  app.post('/v1/generate', async (c) => {
    const ip = clientIp(c);
    const body = await c.req.json().catch(() => undefined);
    const parsed = RequestSchema.safeParse(body);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      return c.json({ error: `Invalid request: ${issue ? `${issue.path.join('.')} ${issue.message}` : 'bad body'}` }, 400);
    }
    const job = parsed.data.job as Job;
    const denied = admit(c, job, ip);
    if (denied) return denied;

    const t = tierFor(job);
    const generator = makeGenerator(t);
    const started = Date.now();
    log('start', { ip, kind: job.kind, model: t.model, client: parsed.data.client?.version, files: job.kind === 'generate' ? job.context.files.length : undefined });

    const encoder = new TextEncoder();
    const signal = c.req.raw.signal;
    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        const send = (ev: object) => controller.enqueue(encoder.encode(`${JSON.stringify(ev)}\n`));
        send({ type: 'meta', provider: t.provider, model: t.model });
        let chars = 0;
        try {
          for await (const text of generator.stream(job, signal)) {
            chars += text.length;
            send({ type: 'text', text });
          }
          send({ type: 'done' });
          log('done', { ip, kind: job.kind, ms: Date.now() - started, chars });
        } catch (err) {
          if (err instanceof ProviderError && (err.status === 429 || (err.status ?? 0) >= 500)) limiter.refund(ip);
          log('error', { ip, kind: job.kind, ms: Date.now() - started, error: (err as Error).message });
          if (!signal.aborted) send({ type: 'error', message: publicMessage(err) });
        } finally {
          controller.close();
        }
      },
    });
    return new Response(stream, {
      headers: { 'content-type': 'application/x-ndjson; charset=utf-8', 'cache-control': 'no-cache, no-transform', 'x-accel-buffering': 'no' },
    });
  });

  // Compatibility with readme-ai 1.x clients ({ projectInfo, sampleCode } → { success, readme }).
  app.post('/api/generate', async (c) => {
    const ip = clientIp(c);
    const body = (await c.req.json().catch(() => ({}))) as { projectInfo?: any; sampleCode?: unknown };
    const info = body.projectInfo;
    if (!info || typeof info !== 'object' || typeof info.name !== 'string') return c.json({ error: 'projectInfo is required' }, 400);
    const strings = (v: unknown, max: number) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string').slice(0, max) : []);
    const languages = strings(info.languages, 15);
    const facts: ProjectFacts = {
      name: info.name.slice(0, 200), languages: languages.map((name) => ({ name, files: 0, bytes: 0, percent: Math.round(100 / languages.length) })),
      ecosystems: [], frameworks: detectFrameworks(strings(info.dependencies, 200)), scripts: [], binCommands: [], envVars: [],
      routes: [], cliOptions: [], runtime: {}, workspaces: [], present: [],
    };
    const job: Job = {
      kind: 'generate',
      options: { style: 'standard', quality: 'fast' },
      context: {
        facts,
        tree: typeof info.structure === 'string' ? info.structure.slice(0, 20_000) : '',
        files: typeof body.sampleCode === 'string' && body.sampleCode ? [{ path: 'sample-code.txt', content: body.sampleCode.slice(0, 20_000), truncated: false }] : [],
      },
    };
    const denied = admit(c, job, ip);
    if (denied) return denied;
    try {
      let text = '';
      for await (const chunk of makeGenerator(cfg.fast).stream(job, c.req.raw.signal)) text += chunk;
      log('legacy_done', { ip });
      return c.json({ success: true, readme: cleanOutput(text), projectInfo: { name: info.name, type: info.type, languages, fileCount: Array.isArray(info.files) ? info.files.length : 0 } });
    } catch (err) {
      log('legacy_error', { ip, error: (err as Error).message });
      return c.json({ error: 'Failed to generate README', message: publicMessage(err) }, 500);
    }
  });

  app.notFound((c) => c.json({ error: 'Not found' }, 404));
  app.onError((err, c) => {
    log('unhandled', { error: err.message });
    return c.json({ error: 'Internal server error' }, 500);
  });
  return app;
}
