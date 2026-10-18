export interface Line {
  text: string;
  inCode: boolean;
  /** Language tag of the surrounding fenced block ('' when untagged). */
  lang?: string;
  fence: boolean;
}

/** Splits Markdown into lines, marking which ones sit inside fenced code blocks. */
export function scanLines(md: string): Line[] {
  const out: Line[] = [];
  let open: { marker: string; lang: string } | undefined;
  for (const text of md.split('\n')) {
    const m = /^\s{0,3}(`{3,}|~{3,})\s*([\w+-]*)/.exec(text);
    if (m) {
      if (!open) {
        open = { marker: m[1]!, lang: m[2]!.toLowerCase() };
        out.push({ text, inCode: false, fence: true });
        continue;
      }
      if (m[1]!.startsWith(open.marker[0]!) && m[1]!.length >= open.marker.length && !m[2]) {
        open = undefined;
        out.push({ text, inCode: false, fence: true });
        continue;
      }
    }
    out.push({ text, inCode: !!open, lang: open?.lang, fence: false });
  }
  return out;
}

/** GitHub-style heading anchor. */
export function slugify(heading: string): string {
  return heading
    .replace(/<[^>]+>/g, '')
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[`*_~]/g, '')
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, '')
    .replace(/\s/g, '-');
}

export function headings(md: string, level: number): { text: string; index: number }[] {
  const prefix = `${'#'.repeat(level)} `;
  return scanLines(md)
    .map((l, index) => ({ l, index }))
    .filter(({ l }) => !l.inCode && !l.fence && l.text.startsWith(prefix))
    .map(({ l, index }) => ({ text: l.text.slice(prefix.length).replace(/\s+#+\s*$/, '').trim(), index }));
}
