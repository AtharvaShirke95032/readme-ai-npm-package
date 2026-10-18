import { scanLines } from './markdown';

const BADGE_LINE = /^\s*(\[?!\[[^\]]*\]\([^)]+\)\]?(\([^)]+\))?\s*)+$/;

/** Removes a `## Heading` section (up to the next `## `). */
export function removeSection(md: string, heading: RegExp): string {
  const lines = scanLines(md);
  const start = lines.findIndex((l) => !l.inCode && heading.test(l.text));
  if (start === -1) return md;
  let end = lines.findIndex((l, i) => i > start && !l.inCode && !l.fence && /^#{1,2} /.test(l.text));
  if (end === -1) end = lines.length;
  return [...lines.slice(0, start), ...lines.slice(end)].map((l) => l.text).join('\n');
}

/** Turns raw model output into clean Markdown. */
export function cleanOutput(raw: string): string {
  let t = raw.replace(/\r\n?/g, '\n').replace(/<think>[\s\S]*?<\/think>/g, '').trim();

  // The whole answer wrapped in ```markdown … ```
  const fenced = /^(`{3,}|~{3,})(?:markdown|md|gfm)?[ \t]*\n([\s\S]*?)\n\1[ \t]*$/i.exec(t);
  if (fenced) t = fenced[2]!.trim();

  // "Here is your README:" before the title
  const h1 = t.search(/^# /m);
  if (h1 > 0 && h1 < 500 && !/^#{1,6} /m.test(t.slice(0, h1))) t = t.slice(h1);

  // Badges and table of contents are added by readme-ai itself.
  t = removeSection(t, /^#{2,3}\s+(table of contents|contents|toc)\s*$/i);
  const lines = t.split('\n');
  const title = lines.findIndex((l) => l.startsWith('# '));
  if (title !== -1) {
    let i = title + 1;
    while (i < lines.length && (lines[i]!.trim() === '' || BADGE_LINE.test(lines[i]!))) i++;
    const removed = lines.slice(title + 1, i).some((l) => BADGE_LINE.test(l));
    if (removed) lines.splice(title + 1, i - title - 1, '');
  }
  t = lines.join('\n');

  return `${t.replace(/[ \t]+$/gm, '').replace(/\n{3,}/g, '\n\n').trim()}\n`;
}
