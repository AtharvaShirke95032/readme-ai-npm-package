import * as fs from 'node:fs';
import * as path from 'node:path';
import type { ProviderId, Quality, Style } from '../core/types';
import { PROVIDERS, SetupError } from '../core/providers';

export interface FileConfig {
  provider?: ProviderId;
  model?: string;
  quality?: Quality;
  style?: Style;
  sections?: string[];
  output?: string;
  badges?: boolean;
  toc?: boolean;
  linkCheck?: boolean;
  ignore?: string[];
  server?: string;
  contextTokens?: number;
}

type Check = (v: unknown) => string | undefined;
const enumOf = (values: readonly string[]): Check => (v) => (typeof v === 'string' && values.includes(v) ? undefined : `must be one of: ${values.join(', ')}`);
const text: Check = (v) => (typeof v === 'string' && v.trim() ? undefined : 'must be a non-empty string');
const bool: Check = (v) => (typeof v === 'boolean' ? undefined : 'must be true or false');
const strings: Check = (v) => (Array.isArray(v) && v.every((x) => typeof x === 'string') ? undefined : 'must be a list of strings');
const url: Check = (v) => (typeof v === 'string' && /^https?:\/\/\S+$/.test(v) ? undefined : 'must be an http(s) URL');
const tokens: Check = (v) => (Number.isInteger(v) && (v as number) >= 2_000 && (v as number) <= 1_000_000 ? undefined : 'must be a whole number between 2000 and 1000000');

const SCHEMA: Record<keyof FileConfig, Check> = {
  provider: enumOf(PROVIDERS),
  model: text,
  quality: enumOf(['fast', 'high']),
  style: enumOf(['minimal', 'standard', 'detailed']),
  sections: strings,
  output: text,
  badges: bool,
  toc: bool,
  linkCheck: bool,
  ignore: strings,
  server: url,
  contextTokens: tokens,
};

export function validateConfig(raw: unknown): { config?: FileConfig; issues: string[] } {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { issues: ['the file must contain a JSON object'] };
  const issues: string[] = [];
  for (const [key, value] of Object.entries(raw)) {
    const check = SCHEMA[key as keyof FileConfig];
    if (!check) issues.push(`${key}: unknown setting (allowed: ${Object.keys(SCHEMA).join(', ')})`);
    else {
      const problem = check(value);
      if (problem) issues.push(`${key}: ${problem}`);
    }
  }
  return issues.length ? { issues } : { config: raw as FileConfig, issues };
}

export interface ResolvedOptions {
  provider: ProviderId;
  model?: string;
  quality: Quality;
  style: Style;
  sections?: string[];
  output: string;
  badges: boolean;
  toc: boolean;
  linkCheck: boolean;
  ignore: string[];
  server?: string;
  contextTokens?: number;
  diff: boolean;
  dryRun: boolean;
  fresh: boolean;
  force: boolean;
  yes: boolean;
  verbose: boolean;
  configFile?: string;
}

const CONFIG_FILES = ['.readmeairc.json', '.readmeairc'];

export function loadConfigFile(root: string): { config: FileConfig; file?: string } {
  for (const name of CONFIG_FILES) {
    const file = path.join(root, name);
    if (!fs.existsSync(file)) continue;
    let raw: unknown;
    try {
      raw = JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch (err) {
      throw new SetupError(`${name} is not valid JSON: ${(err as Error).message}`);
    }
    const { config, issues } = validateConfig(raw);
    if (!config) throw new SetupError(`${name} has invalid settings:\n${issues.map((i) => `  - ${i}`).join('\n')}`);
    return { config, file: name };
  }
  return { config: {} };
}

export interface CliFlags {
  provider?: string;
  model?: string;
  quality?: string;
  style?: string;
  sections?: string;
  output?: string;
  badges?: boolean;
  toc?: boolean;
  linkCheck?: boolean;
  server?: string;
  diff?: boolean;
  dryRun?: boolean;
  fresh?: boolean;
  force?: boolean;
  yes?: boolean;
  verbose?: boolean;
}

function oneOf<T extends string>(value: string | undefined, allowed: readonly T[], flag: string): T | undefined {
  if (value === undefined) return undefined;
  const v = value.toLowerCase() as T;
  if (!allowed.includes(v)) throw new SetupError(`Invalid ${flag} "${value}". Use one of: ${allowed.join(', ')}.`);
  return v;
}

/** Defaults < .readmeairc.json < command-line flags. */
export function resolveOptions(flags: CliFlags, file: FileConfig, configFile?: string): ResolvedOptions {
  const provider = oneOf(flags.provider, PROVIDERS, '--provider') ?? file.provider ?? 'hosted';
  const sections = flags.sections ? flags.sections.split(',').map((s) => s.trim()).filter(Boolean) : file.sections;
  return {
    provider,
    model: flags.model ?? (flags.provider && flags.provider !== file.provider ? undefined : file.model),
    quality: oneOf(flags.quality, ['fast', 'high'] as const, '--quality') ?? file.quality ?? 'fast',
    style: oneOf(flags.style, ['minimal', 'standard', 'detailed'] as const, '--style') ?? file.style ?? 'standard',
    sections: sections?.length ? sections : undefined,
    output: flags.output ?? file.output ?? 'README.md',
    badges: flags.badges === false ? false : file.badges ?? true,
    toc: flags.toc === false ? false : file.toc ?? true,
    linkCheck: flags.linkCheck === false ? false : file.linkCheck ?? true,
    ignore: file.ignore ?? [],
    server: flags.server ?? file.server,
    contextTokens: file.contextTokens,
    diff: !!flags.diff,
    dryRun: !!flags.dryRun,
    fresh: !!flags.fresh,
    force: !!flags.force,
    yes: !!flags.yes,
    verbose: !!flags.verbose,
    configFile,
  };
}
