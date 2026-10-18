import { createInterface } from 'node:readline/promises';
import pc from 'picocolors';
import { diffLines } from 'diff';

export const isTTY = !!process.stdout.isTTY && !process.env.CI;
const out = (s = '') => process.stdout.write(`${s}\n`);

export const ui = {
  pc,
  title(text: string) {
    out();
    out(pc.bold(text));
  },
  section(text: string) {
    out();
    out(pc.bold(pc.cyan(text)));
  },
  ok(text: string) {
    out(`  ${pc.green('✓')} ${text}`);
  },
  fix(text: string) {
    out(`  ${pc.yellow('↻')} ${text}`);
  },
  bad(text: string) {
    out(`  ${pc.red('✗')} ${text}`);
  },
  info(text: string) {
    out(`  ${pc.dim(text)}`);
  },
  warn(text: string) {
    out(`  ${pc.yellow('!')} ${text}`);
  },
  line(text = '') {
    out(text);
  },
  error(text: string) {
    process.stderr.write(`\n${pc.red(pc.bold('Error:'))} ${text}\n\n`);
  },
};

const FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

/** A one-line spinner. No-op output when not attached to a terminal. */
export function spinner(text: string) {
  let i = 0;
  let label = text;
  const started = Date.now();
  const timer = isTTY
    ? setInterval(() => {
        const secs = Math.floor((Date.now() - started) / 1000);
        process.stdout.write(`\r  ${pc.cyan(FRAMES[i++ % FRAMES.length]!)} ${label}${secs >= 3 ? pc.dim(` ${secs}s`) : ''}\x1b[K`);
      }, 80)
    : undefined;
  return {
    update(next: string) {
      label = next;
    },
    stop() {
      if (timer) {
        clearInterval(timer);
        process.stdout.write('\r\x1b[K');
      }
    },
  };
}

/** Prints streamed text dimmed and indented, as it arrives. */
export function streamPrinter() {
  let atLineStart = true;
  return {
    write(chunk: string) {
      if (!isTTY) return;
      let text = '';
      for (const ch of chunk) {
        if (atLineStart) text += '  ';
        text += ch;
        atLineStart = ch === '\n';
      }
      process.stdout.write(pc.dim(text));
    },
    end() {
      if (isTTY && !atLineStart) process.stdout.write('\n');
      atLineStart = true;
    },
  };
}

export async function confirm(question: string, defaultYes = true): Promise<boolean> {
  if (!process.stdin.isTTY) return defaultYes;
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = (await rl.question(`${question} ${pc.dim(defaultYes ? '(Y/n)' : '(y/N)')} `)).trim().toLowerCase();
    return answer ? answer.startsWith('y') : defaultYes;
  } finally {
    rl.close();
  }
}

/** A colored line diff with a little context around each change. */
export function renderDiff(before: string, after: string, context = 2): { text: string; added: number; removed: number } {
  const parts = diffLines(before, after);
  const rows: { kind: ' ' | '+' | '-'; text: string }[] = [];
  let added = 0;
  let removed = 0;
  for (const part of parts) {
    const kind = part.added ? '+' : part.removed ? '-' : ' ';
    const lines = part.value.replace(/\n$/, '').split('\n');
    if (kind === '+') added += lines.length;
    if (kind === '-') removed += lines.length;
    for (const text of lines) rows.push({ kind, text });
  }
  const keep = rows.map((r, i) => r.kind !== ' ' || rows.slice(Math.max(0, i - context), i + context + 1).some((n) => n.kind !== ' '));
  const outLines: string[] = [];
  let skipped = false;
  rows.forEach((r, i) => {
    if (!keep[i]) {
      if (!skipped) outLines.push(pc.dim('  ⋯'));
      skipped = true;
      return;
    }
    skipped = false;
    if (r.kind === '+') outLines.push(pc.green(`+ ${r.text}`));
    else if (r.kind === '-') outLines.push(pc.red(`- ${r.text}`));
    else outLines.push(pc.dim(`  ${r.text}`));
  });
  return { text: outLines.join('\n'), added, removed };
}
