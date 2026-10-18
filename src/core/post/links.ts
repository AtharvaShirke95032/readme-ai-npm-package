import { scanLines } from './markdown';

const SKIP_HOST = /^(localhost|127\.|0\.0\.0\.0|\[::1\]|example\.(com|org|net)|img\.shields\.io|.*\.local$)/i;

async function probe(url: string): Promise<number | 'error'> {
  const attempt = async (method: 'HEAD' | 'GET') => {
    const res = await fetch(url, {
      method,
      redirect: 'follow',
      signal: AbortSignal.timeout(6_000),
      headers: { 'user-agent': 'readme-ai-link-check (+https://www.npmjs.com/package/@catmeow/readme-ai)' },
    });
    if (method === 'GET') await res.body?.cancel().catch(() => undefined);
    return res.status;
  };
  try {
    const status = await attempt('HEAD');
    // Many servers dislike HEAD; confirm failures with GET.
    return status >= 400 ? await attempt('GET') : status;
  } catch {
    try {
      return await attempt('GET');
    } catch {
      return 'error';
    }
  }
}

export interface LinkReport {
  readme: string;
  checked: number;
  /** Links that returned 404/410 and were unlinked. */
  removed: string[];
  /** Links that could not be reached (kept, but reported). */
  unreachable: string[];
}

/** Checks http(s) links outside code blocks. Dead links (404/410) are unlinked, keeping their text. */
export async function checkExternalLinks(readme: string, concurrency = 6): Promise<LinkReport> {
  const urls = new Set<string>();
  for (const l of scanLines(readme)) {
    if (l.inCode || l.fence) continue;
    for (const m of l.text.matchAll(/\]\((https?:\/\/[^)\s]+)\)/g)) {
      try {
        if (!SKIP_HOST.test(new URL(m[1]!).hostname)) urls.add(m[1]!);
      } catch {
        /* not a URL */
      }
    }
  }
  const list = [...urls].slice(0, 40);
  const results = new Map<string, number | 'error'>();
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(concurrency, list.length) }, async () => {
      while (next < list.length) {
        const url = list[next++]!;
        results.set(url, await probe(url));
      }
    }),
  );

  const removed: string[] = [];
  const unreachable: string[] = [];
  let out = readme;
  for (const [url, status] of results) {
    if (status === 404 || status === 410) {
      removed.push(url);
      const esc = url.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      out = out.replace(new RegExp(`!\\[[^\\]]*\\]\\(${esc}\\)`, 'g'), '').replace(new RegExp(`\\[([^\\]]*)\\]\\(${esc}\\)`, 'g'), '$1');
    } else if (status === 'error') {
      unreachable.push(url);
    }
  }
  return { readme: out, checked: list.length, removed, unreachable };
}
