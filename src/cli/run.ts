import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type { Generator, ProjectFacts } from '../core/types';
import { prepare, generate, type Prepared, type GenerateResult } from '../core/pipeline';
import { createGenerator, SetupError } from '../core/providers';
import { loadConfigFile, resolveOptions, type CliFlags, type ResolvedOptions } from './config';
import { confirm, isTTY, renderDiff, spinner, streamPrinter, ui } from './ui';

const { pc } = ui;
const tildify = (p: string) => (p.startsWith(os.homedir()) ? `~${p.slice(os.homedir().length)}` : p);
const k = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(n >= 10_000 ? 0 : 1)}k` : String(n));
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

const CATEGORY_ORDER = ['Framework', 'Frontend', 'Backend', 'Mobile', 'Desktop', 'CLI', 'Bots', 'AI', 'AI/ML', 'Database', 'Data', 'Styling'];

function describeType(f: ProjectFacts): string {
  const fw = [...f.frameworks]
    .filter((x) => CATEGORY_ORDER.includes(x.category))
    .sort((a, b) => CATEGORY_ORDER.indexOf(a.category) - CATEGORY_ORDER.indexOf(b.category))
    .map((x) => x.name);
  const parts = [...new Set([...fw.slice(0, 3), ...f.languages.slice(0, 2).map((l) => l.name)])];
  return parts.join(' · ') || 'unknown';
}

function describeFacts(f: ProjectFacts): string {
  const bits = [
    f.scripts.length && plural(f.scripts.length, 'script'),
    f.envVars.length && plural(f.envVars.length, 'env var'),
    f.routes.length && plural(f.routes.length, 'route'),
    f.license ? `${f.license} license` : f.licenseFile ? 'license file' : 'no license',
    f.repoUrl?.replace(/^https?:\/\//, ''),
  ].filter(Boolean);
  return bits.join(', ');
}

function printScanSummary(p: Prepared, o: ResolvedOptions) {
  const s = p.stats;
  ui.section(`Scanning ${tildify(p.root)}`);
  ui.ok(`${plural(s.totalFiles, 'file')}, ${s.selectedFiles} picked for context (~${k(s.tokens)} tokens)`);
  ui.ok(`Type: ${describeType(p.facts)}`);
  ui.ok(`Facts: ${describeFacts(p.facts)}`);
  if (p.existingReadme && !o.fresh) ui.ok(`Updating existing ${path.basename(p.readmePath)}${p.keepBlocks.length ? ` (${plural(p.keepBlocks.length, 'protected section')})` : ''}`);
  if (s.sensitiveSkipped.length) ui.info(`Never sent: ${s.sensitiveSkipped.slice(0, 5).join(', ')}${s.sensitiveSkipped.length > 5 ? ` +${s.sensitiveSkipped.length - 5} more` : ''}`);
  if (s.redactions) ui.info(`Redacted ${plural(s.redactions, 'secret-looking value')} from the context`);
  if (o.configFile) ui.info(`Settings from ${o.configFile}`);
}

function printDryRun(p: Prepared, o: ResolvedOptions) {
  let target: string;
  try {
    target = createGenerator({ provider: o.provider, quality: o.quality, model: o.model, serverUrl: o.server }).label;
  } catch (err) {
    target = `${o.provider} ${pc.yellow(`(${(err as Error).message.split('\n')[0]})`)}`;
  }
  ui.section('Dry run: nothing was sent');
  ui.line(`  Would send to: ${target}`);
  ui.line(`  Context: ${plural(p.context.files.length, 'file')}, ~${k(p.stats.tokens)} tokens (budget ${k(p.stats.budget)})`);
  const files = o.verbose ? p.context.files : p.context.files.slice(0, 25);
  for (const f of files) ui.info(`${f.path}${f.truncated ? ' (truncated)' : ''} · ~${k(Math.ceil(f.content.length / 4))}`);
  if (files.length < p.context.files.length) ui.info(`… ${p.context.files.length - files.length} more (use --verbose to list all)`);
  if (p.stats.sensitiveSkipped.length) ui.line(`  Never sent: ${p.stats.sensitiveSkipped.join(', ')}`);
  if (p.facts.envVars.length) ui.line(`  Env vars found: ${p.facts.envVars.map((e) => e.name).join(', ')}`);
  if (p.facts.scripts.length) ui.line(`  Scripts found: ${p.facts.scripts.map((s) => s.run).join(', ')}`);
  if (o.verbose) {
    ui.section('Facts');
    ui.line(JSON.stringify(p.facts, null, 2));
  }
  ui.line();
}

function printChecks(r: GenerateResult, header: boolean) {
  if (header) ui.section('Checking');
  if (r.checkedCommands) ui.ok(`${plural(r.checkedCommands, 'command')} checked against the project`);
  for (const f of r.fixed) ui.fix(f);
  for (const f of r.repaired) ui.fix(`fixed: ${f.length > 140 ? `${f.slice(0, 137)}…` : f}`);
  if (r.links?.checked) {
    const good = r.links.checked - r.links.removed.length - r.links.unreachable.length;
    ui.ok(`${good} of ${plural(r.links.checked, 'link')} resolve`);
    for (const l of r.links.removed) ui.fix(`removed dead link ${l}`);
    for (const l of r.links.unreachable) ui.warn(`could not reach ${l}`);
  }
  if (r.keepRestored) ui.ok(`${plural(r.keepRestored, 'protected section')} kept word for word`);
  if (r.keepMissing) ui.warn(`${plural(r.keepMissing, 'protected section')} had no obvious place, so ${r.keepMissing === 1 ? 'it was' : 'they were'} added at the end`);
  for (const w of r.warnings) ui.warn(w);
  if (!r.fixed.length && !r.repaired.length && !r.warnings.length) ui.ok('No problems found');
}

function backupPath(file: string): string {
  const ext = path.extname(file);
  return path.join(path.dirname(file), `${path.basename(file, ext)}.backup${ext}`);
}

export async function run(target: string, flags: CliFlags, version: string): Promise<number> {
  const started = Date.now();
  const root = path.resolve(target);
  if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) throw new SetupError(`Folder not found: ${root}`);
  const { config, file } = loadConfigFile(root);
  const o = resolveOptions(flags, config, file);

  ui.title(`readme-ai ${pc.dim(`v${version}`)}`);

  // Create the generator first so a missing API key fails before any work.
  let generator: Generator | undefined;
  if (!o.dryRun) generator = createGenerator({ provider: o.provider, quality: o.quality, model: o.model, serverUrl: o.server, clientVersion: version });

  const scanSpin = spinner('Scanning project');
  let p: Prepared;
  try {
    p = await prepare(root, { provider: o.provider, quality: o.quality, output: o.output, fresh: o.fresh, ignore: o.ignore, contextTokens: o.contextTokens });
  } finally {
    scanSpin.stop();
  }
  printScanSummary(p, o);

  if (o.dryRun || !generator) {
    printDryRun(p, o);
    return 0;
  }

  const controller = new AbortController();
  const onSigint = () => {
    if (controller.signal.aborted) process.exit(130);
    controller.abort();
  };
  process.on('SIGINT', onSigint);

  const initialLabel = generator.label;
  ui.section(`Writing README ${pc.dim(`(${generator.label})`)}`);
  if (!isTTY) ui.info('Generating…');
  const printer = streamPrinter();
  let waiting: ReturnType<typeof spinner> | undefined = spinner(o.provider === 'hosted' ? 'Connecting (the free server may need ~30s to wake up)' : 'Thinking');
  let result: GenerateResult;
  let checkingShown = false;
  try {
    result = await generate(
      p,
      generator,
      { style: o.style, quality: o.quality, sections: o.sections, badges: o.badges, toc: o.toc, linkCheck: o.linkCheck },
      {
        onText(chunk) {
          if (waiting) {
            waiting.stop();
            waiting = undefined;
          }
          printer.write(chunk);
        },
        onStage(stage, detail) {
          waiting?.stop();
          printer.end();
          if (stage === 'repair') {
            ui.section('Checking');
            checkingShown = true;
            ui.info(`Found ${plural(detail?.length ?? 0, 'problem')}, asking the model to fix ${detail?.length === 1 ? 'it' : 'them'}…`);
            waiting = spinner('Repairing');
          } else if (stage === 'links') {
            waiting = spinner('Checking links');
          } else {
            waiting = undefined;
          }
        },
      },
      controller.signal,
    );
  } catch (err) {
    if (controller.signal.aborted) {
      printer.end();
      ui.line(pc.dim('\n  Cancelled. Nothing was written.'));
      return 130;
    }
    throw err;
  } finally {
    (waiting as ReturnType<typeof spinner> | undefined)?.stop();
    printer.end();
    process.off('SIGINT', onSigint);
  }
  if (result.generator !== initialLabel) ui.info(`Model: ${result.generator}`);

  printChecks(result, !checkingShown);

  const outPath = p.existingReadme !== undefined ? p.readmePath : path.resolve(root, o.output);
  const relative = path.relative(process.cwd(), outPath);
  const rel = relative && !relative.startsWith('..') ? relative : tildify(outPath);
  const before = p.existingReadme;
  ui.line();

  if (before !== undefined && before.trim() === result.readme.trim()) {
    ui.ok(`${rel} is already up to date`);
    return 0;
  }

  if (o.diff && before !== undefined) {
    const d = renderDiff(before, result.readme);
    ui.section(`Changes to ${rel} ${pc.green(`+${d.added}`)} ${pc.red(`-${d.removed}`)}`);
    ui.line(d.text);
    ui.line();
    if (!o.yes && !(await confirm('Apply these changes?'))) {
      ui.info('No changes written.');
      return 0;
    }
  }

  let backup: string | undefined;
  if (before !== undefined && !o.force) {
    backup = backupPath(outPath);
    fs.writeFileSync(backup, before);
  }
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, result.readme);

  const secs = ((Date.now() - started) / 1000).toFixed(1);
  const verb = before !== undefined ? 'updated' : 'created';
  ui.line(`${pc.green(pc.bold('✔'))} ${pc.bold(rel)} ${verb}${backup ? pc.dim(` (old version saved to ${path.basename(backup)})`) : ''} ${pc.dim(`in ${secs}s`)}`);
  ui.line();
  return 0;
}
