import { scanLines } from '../post/markdown';

const KEEP_BLOCK = /<!--\s*readme-ai:keep\s*-->[\s\S]*?<!--\s*\/readme-ai:keep\s*-->/g;
const placeholder = (i: number) => `<!-- readme-ai:keep:${i} -->`;

/** Character ranges covered by fenced code blocks, so examples of the markers are ignored. */
function codeRanges(md: string): [number, number][] {
  const ranges: [number, number][] = [];
  let offset = 0;
  let start = -1;
  for (const line of scanLines(md)) {
    if (line.fence) {
      if (start === -1) start = offset;
      else {
        ranges.push([start, offset + line.text.length]);
        start = -1;
      }
    }
    offset += line.text.length + 1;
  }
  if (start !== -1) ranges.push([start, md.length]);
  return ranges;
}

/** Swaps protected blocks for short placeholders the model must copy through. */
export function extractKeepBlocks(readme: string): { text: string; blocks: string[] } {
  const ranges = codeRanges(readme);
  const blocks: string[] = [];
  const text = readme.replace(KEEP_BLOCK, (block, at: number) => {
    if (ranges.some(([s, e]) => at >= s && at < e)) return block;
    blocks.push(block);
    return placeholder(blocks.length);
  });
  return { text, blocks };
}

/** Puts protected blocks back. Any placeholder the model dropped is appended at the end. */
export function restoreKeepBlocks(output: string, blocks: string[]): { text: string; missing: number } {
  let text = output;
  let missing = 0;
  blocks.forEach((block, idx) => {
    const ph = placeholder(idx + 1);
    const at = text.indexOf(ph);
    if (at === -1) {
      missing++;
      text = `${text.trimEnd()}\n\n${block}\n`;
      return;
    }
    text = text.slice(0, at) + block + text.slice(at + ph.length).split(ph).join('');
  });
  return { text, missing };
}
