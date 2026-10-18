import * as fs from 'node:fs';
import * as path from 'node:path';
import type { Generator, ProjectContext, ProjectFacts, ProviderId, Quality, Style } from './types';
import { scanProject, type Scan } from './scan/walk';
import { estimateTokens, selectFiles } from './scan/select';
import { buildTree } from './scan/tree';
import { collectFacts } from './facts';
import { extractKeepBlocks, restoreKeepBlocks } from './prompt/keep';
import { formatFacts } from './prompt/build';
import { contextBudget } from './providers/models';
import { cleanOutput } from './post/clean';
import { verifyReadme } from './post/verify';
import { checkExternalLinks, type LinkReport } from './post/links';
import { buildBadges, finalize, insertBadges, insertToc } from './post/polish';

export interface PrepareOptions {
  provider: ProviderId;
  quality: Quality;
  /** README path relative to the project root. */
  output?: string;
  /** Ignore the existing README and write from scratch. */
  fresh?: boolean;
  /** Extra gitignore-style patterns to leave out. */
  ignore?: string[];
  /** Override the token budget for project context. */
  contextTokens?: number;
}

export interface Prepared {
  root: string;
  scan: Scan;
  facts: ProjectFacts;
  context: ProjectContext;
  readmePath: string;
  existingReadme?: string;
  keepBlocks: string[];
  stats: { totalFiles: number; selectedFiles: number; tokens: number; redactions: number; sensitiveSkipped: string[]; budget: number };
}

async function findExistingReadme(root: string, output: string): Promise<{ path: string; text?: string }> {
  const target = path.resolve(root, output);
  if (fs.existsSync(target)) return { path: target, text: fs.readFileSync(target, 'utf8') };
  if (output.toLowerCase() === 'readme.md') {
    const alt = fs.readdirSync(root).find((f) => f.toLowerCase() === 'readme.md');
    if (alt) return { path: path.join(root, alt), text: fs.readFileSync(path.join(root, alt), 'utf8') };
  }
  return { path: target };
}

/** Scans the project and builds everything the model will see. Never calls a model. */
export async function prepare(dir: string, opts: PrepareOptions): Promise<Prepared> {
  const scan = await scanProject(dir, opts.ignore);
  const { facts, entryPoints } = await collectFacts(scan);
  const existing = await findExistingReadme(scan.root, opts.output ?? 'README.md');
  const keep = existing.text && !opts.fresh ? extractKeepBlocks(existing.text) : undefined;

  const budget = contextBudget(opts.provider, opts.quality, opts.contextTokens);
  const small = budget < 12_000;
  const tree = buildTree(scan.files.map((f) => f.path), small ? { maxDepth: 3, maxLines: 50, perDir: 8 } : {});
  const existingText = keep?.text.slice(0, small ? 6_000 : 40_000);
  const overhead = estimateTokens(formatFacts(facts)) + estimateTokens(tree) + estimateTokens(existingText ?? '') + 1_500;
  const selection = await selectFiles(scan, Math.max(1_000, budget - overhead), entryPoints);

  return {
    root: scan.root,
    scan,
    facts,
    context: { facts, tree, files: selection.files, existingReadme: existingText },
    readmePath: existing.path,
    existingReadme: existing.text,
    keepBlocks: keep?.blocks ?? [],
    stats: {
      totalFiles: scan.files.length,
      selectedFiles: selection.files.length,
      tokens: selection.tokens + overhead,
      redactions: selection.redactions,
      sensitiveSkipped: scan.sensitive,
      budget,
    },
  };
}

export interface GenerateSettings {
  style: Style;
  quality: Quality;
  sections?: string[];
  badges?: boolean;
  toc?: boolean;
  linkCheck?: boolean;
}

export interface GenerateHooks {
  onText?(chunk: string): void;
  onStage?(stage: 'repair' | 'links' | 'polish', detail?: string[]): void;
}

export interface GenerateResult {
  readme: string;
  generator: string;
  checkedCommands: number;
  fixed: string[];
  repaired: string[];
  warnings: string[];
  links?: LinkReport;
  keepRestored: number;
  keepMissing: number;
}

async function collect(stream: AsyncIterable<string>, onText?: (s: string) => void): Promise<string> {
  let text = '';
  for await (const chunk of stream) {
    text += chunk;
    onText?.(chunk);
  }
  return text;
}

/** Runs the model, then checks, repairs and polishes the result. */
export async function generate(p: Prepared, generator: Generator, s: GenerateSettings, hooks: GenerateHooks = {}, signal?: AbortSignal): Promise<GenerateResult> {
  const exists = (rel: string) => fs.existsSync(path.join(p.root, rel));
  const raw = await collect(generator.stream({ kind: 'generate', context: p.context, options: { style: s.style, quality: s.quality, sections: s.sections } }, signal), hooks.onText);
  if (!raw.trim()) throw new Error(`${generator.label} returned an empty answer. Try again or pick another model.`);

  let check = verifyReadme(cleanOutput(raw), p.facts, exists);
  const fixed = [...check.fixed];
  const repaired: string[] = [];
  const warnings = [...check.warnings];

  if (check.problems.length) {
    hooks.onStage?.('repair', check.problems);
    try {
      const fixedText = await collect(generator.stream({ kind: 'repair', facts: p.facts, readme: check.readme, problems: check.problems }, signal));
      if (fixedText.trim().length > check.readme.length * 0.5) {
        const before = check.problems;
        check = verifyReadme(cleanOutput(fixedText), p.facts, exists);
        fixed.push(...check.fixed);
        repaired.push(...before.filter((b) => !check.problems.includes(b)));
        warnings.push(...check.problems);
      } else {
        warnings.push(...check.problems);
      }
    } catch (err) {
      if (signal?.aborted) throw err;
      warnings.push(`Repair pass failed (${(err as Error).message.split('\n')[0]}), so these remain:`, ...check.problems);
    }
  }

  let readme = check.readme;
  let links: LinkReport | undefined;
  if (s.linkCheck !== false) {
    hooks.onStage?.('links');
    links = await checkExternalLinks(readme);
    readme = links.readme;
  }

  hooks.onStage?.('polish');
  const restored = restoreKeepBlocks(readme, p.keepBlocks);
  readme = restored.text;
  if (s.badges !== false) readme = insertBadges(readme, await buildBadges(p.facts, { network: s.linkCheck !== false }));
  if (s.toc !== false) readme = insertToc(readme);

  return {
    readme: finalize(readme),
    generator: generator.label,
    checkedCommands: check.checkedCommands,
    fixed: [...new Set(fixed)],
    repaired,
    warnings: [...new Set(warnings)],
    links,
    keepRestored: p.keepBlocks.length - restored.missing,
    keepMissing: restored.missing,
  };
}
