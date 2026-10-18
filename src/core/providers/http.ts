export class ProviderError extends Error {
  constructor(
    message: string,
    readonly provider: string,
    readonly status?: number,
    readonly retryAfterSeconds?: number,
  ) {
    super(message);
    this.name = 'ProviderError';
  }
}

/** Pulls a readable message out of the many error shapes providers return. */
function extractMessage(body: string): string | undefined {
  try {
    const j = JSON.parse(body);
    const m = j?.error?.message ?? j?.error ?? j?.message ?? j?.detail ?? j?.[0]?.error?.message;
    return typeof m === 'string' ? m : m ? JSON.stringify(m) : undefined;
  } catch {
    return body.trim().slice(0, 300) || undefined;
  }
}

export async function errorFromResponse(res: Response, provider: string, hint: { keyEnv?: string; model?: string } = {}): Promise<ProviderError> {
  const body = await res.text().catch(() => '');
  const detail = extractMessage(body);
  const retry = Number(res.headers.get('retry-after')) || undefined;
  let message: string;
  switch (true) {
    case res.status === 401 || res.status === 403 || /api[_ ]?key/i.test(detail ?? ''):
      message = `${provider} rejected the API key${hint.keyEnv ? ` (${hint.keyEnv})` : ''}. Check that it is correct and active.`;
      break;
    case res.status === 404:
      message = `${provider} doesn't know the model "${hint.model}". Pick another with --model.`;
      break;
    case res.status === 429:
      message = `${provider} rate limit or quota reached. Try again in a bit${retry ? ` (${retry}s)` : ''}.`;
      break;
    case res.status >= 500:
      message = `${provider} is having problems right now (HTTP ${res.status}). Try again shortly.`;
      break;
    default:
      message = `${provider} returned HTTP ${res.status}.`;
  }
  if (detail && res.status !== 429) message += `\n  ${provider} said: ${detail.slice(0, 400)}`;
  return new ProviderError(message, provider, res.status, retry);
}

const RETRYABLE = new Set([500, 502, 503, 504, 529]);
export const retryDelays = { ms: [1_500, 4_000] };

const wait = (ms: number, signal?: AbortSignal | null) =>
  new Promise<void>((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => {
      clearTimeout(t);
      reject(signal.reason);
    }, { once: true });
  });

/**
 * fetch() with a friendly error when the network fails, and a couple of retries when
 * the provider is briefly overloaded (5xx). Retries happen before any text is streamed.
 */
export async function request(url: string, init: RequestInit, provider: string): Promise<Response> {
  for (let attempt = 0; ; attempt++) {
    let res: Response;
    try {
      res = await fetch(url, init);
    } catch (err) {
      if ((err as Error).name === 'AbortError' || init.signal?.aborted) throw err;
      const cause = (err as { cause?: { code?: string } }).cause?.code;
      throw new ProviderError(`Could not reach ${provider} (${cause ?? (err as Error).message}). Check your internet connection.`, provider);
    }
    const delay = retryDelays.ms[attempt];
    if (!RETRYABLE.has(res.status) || delay === undefined) return res;
    await res.body?.cancel().catch(() => undefined);
    await wait(delay, init.signal);
  }
}

async function* lines(body: ReadableStream<Uint8Array>): AsyncGenerator<string> {
  const decoder = new TextDecoder();
  let buffer = '';
  for await (const chunk of body as unknown as AsyncIterable<Uint8Array>) {
    buffer += decoder.decode(chunk, { stream: true });
    let nl: number;
    while ((nl = buffer.indexOf('\n')) !== -1) {
      yield buffer.slice(0, nl).replace(/\r$/, '');
      buffer = buffer.slice(nl + 1);
    }
  }
  buffer += decoder.decode();
  if (buffer) yield buffer.replace(/\r$/, '');
}

export interface SseEvent {
  event?: string;
  data: string;
}

/** Server-sent events (Anthropic, OpenAI, Gemini, xAI). */
export async function* readSse(body: ReadableStream<Uint8Array>): AsyncGenerator<SseEvent> {
  let event: string | undefined;
  let data: string[] = [];
  for await (const line of lines(body)) {
    if (line === '') {
      if (data.length) yield { event, data: data.join('\n') };
      event = undefined;
      data = [];
    } else if (line.startsWith(':')) {
      continue;
    } else if (line.startsWith('event:')) {
      event = line.slice(6).trim();
    } else if (line.startsWith('data:')) {
      data.push(line.slice(5).replace(/^ /, ''));
    }
  }
  if (data.length) yield { event, data: data.join('\n') };
}

/** Newline-delimited JSON (Ollama, the hosted server). */
export async function* readNdjson<T = any>(body: ReadableStream<Uint8Array>): AsyncGenerator<T> {
  for await (const line of lines(body)) {
    if (!line.trim()) continue;
    yield JSON.parse(line) as T;
  }
}

/** Aborts when either signal fires, or when the timeout passes. */
export function withTimeout(signal: AbortSignal | undefined, ms: number): AbortSignal {
  const timeout = AbortSignal.timeout(ms);
  return signal ? AbortSignal.any([signal, timeout]) : timeout;
}
