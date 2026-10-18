import { execFile } from 'node:child_process';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type { LanguageStat } from '../types';
import type { Scan } from '../scan/walk';

function git(cwd: string, args: string[]): Promise<string | undefined> {
  return new Promise((resolve) => {
    execFile('git', args, { cwd, timeout: 3_000, windowsHide: true }, (err, stdout) => {
      resolve(err ? undefined : stdout.trim() || undefined);
    });
  });
}

/** git@github.com:me/app.git → https://github.com/me/app */
export function normalizeRepoUrl(url: string | undefined): string | undefined {
  if (!url) return undefined;
  let u = url.trim();
  const scp = /^[\w.-]+@([\w.-]+):(.+)$/.exec(u);
  if (scp) u = `https://${scp[1]}/${scp[2]}`;
  u = u.replace(/^ssh:\/\/[\w.-]+@/, 'https://').replace(/^git\+/, '').replace(/^git:\/\//, 'https://');
  u = u.replace(/^(https?:\/\/)[^/@]+@/, '$1'); // strip credentials
  u = u.replace(/\.git$/, '').replace(/\/$/, '');
  return /^https?:\/\/[^/]+\/.+/.test(u) ? u : undefined;
}

export async function gitInfo(root: string): Promise<{ repoUrl?: string; defaultBranch?: string }> {
  let remote = await git(root, ['remote', 'get-url', 'origin']);
  if (!remote) {
    const config = await fs.readFile(path.join(root, '.git', 'config'), 'utf8').catch(() => '');
    remote = /\[remote "origin"\][^[]*?url\s*=\s*(\S+)/.exec(config)?.[1];
  }
  const head = await git(root, ['symbolic-ref', '--short', 'refs/remotes/origin/HEAD']);
  const branch = head?.replace(/^origin\//, '') ?? (await git(root, ['rev-parse', '--abbrev-ref', 'HEAD']));
  return { repoUrl: normalizeRepoUrl(remote), defaultBranch: branch && branch !== 'HEAD' ? branch : undefined };
}

const LICENSE_FILE = /^(licen[sc]e|copying|unlicense)(\.(md|txt|rst))?$/i;

export function detectLicense(text: string): string | undefined {
  const t = text.slice(0, 3_000);
  if (/MIT License|Permission is hereby granted, free of charge/i.test(t)) return 'MIT';
  if (/Apache License/i.test(t) && /Version 2\.0/.test(t)) return 'Apache-2.0';
  if (/GNU AFFERO GENERAL PUBLIC LICENSE/i.test(t)) return 'AGPL-3.0';
  if (/GNU LESSER GENERAL PUBLIC LICENSE/i.test(t)) return /Version 2\.1/.test(t) ? 'LGPL-2.1' : 'LGPL-3.0';
  if (/GNU GENERAL PUBLIC LICENSE/i.test(t)) return /Version 2/.test(t) ? 'GPL-2.0' : 'GPL-3.0';
  if (/Mozilla Public License/i.test(t)) return 'MPL-2.0';
  if (/ISC License|Permission to use, copy, modify, and\/or distribute/i.test(t)) return 'ISC';
  if (/Redistribution and use in source and binary forms/i.test(t)) return /Neither the name/i.test(t) ? 'BSD-3-Clause' : 'BSD-2-Clause';
  if (/free and unencumbered software released into the public domain/i.test(t)) return 'Unlicense';
  if (/Creative Commons/i.test(t)) return 'CC';
  return undefined;
}

export async function licenseInfo(scan: Scan): Promise<{ license?: string; licenseFile?: string }> {
  const file = scan.files.find((f) => !f.path.includes('/') && LICENSE_FILE.test(f.path));
  if (!file) return {};
  const text = await scan.read(file.path);
  return { license: text ? detectLicense(text) : undefined, licenseFile: file.path };
}

export async function dockerInfo(scan: Scan) {
  const dockerfile = scan.files.find((f) => /^(Dockerfile|Containerfile)(\.[\w-]+)?$/.test(f.path));
  const composeFile = ['docker-compose.yml', 'docker-compose.yaml', 'compose.yml', 'compose.yaml'].find((f) => scan.has(f));
  if (!dockerfile && !composeFile) return undefined;
  const exposedPorts = dockerfile
    ? [...((await scan.read(dockerfile.path)) ?? '').matchAll(/^\s*EXPOSE\s+(.+)$/gim)].flatMap((m) => m[1]!.trim().split(/\s+/))
    : [];
  const services: string[] = [];
  if (composeFile) {
    const text = (await scan.read(composeFile)) ?? '';
    const block = /^services:\s*\n((?:[ \t]+.*\n?|\s*\n)*)/m.exec(text)?.[1] ?? '';
    const indent = /^([ \t]+)\S/m.exec(block)?.[1] ?? '  ';
    for (const m of block.matchAll(new RegExp(`^${indent}([\\w.-]+):\\s*$`, 'gm'))) services.push(m[1]!);
  }
  return { dockerfile: !!dockerfile, compose: !!composeFile, exposedPorts, services };
}

export function ciInfo(scan: Scan) {
  const workflows = scan.files.filter((f) => /^\.github\/workflows\/[^/]+\.ya?ml$/.test(f.path)).map((f) => path.posix.basename(f.path));
  if (workflows.length) return { provider: 'GitHub Actions', workflows };
  if (scan.has('.gitlab-ci.yml')) return { provider: 'GitLab CI', workflows: ['.gitlab-ci.yml'] };
  if (scan.has('.circleci/config.yml')) return { provider: 'CircleCI', workflows: ['config.yml'] };
  if (scan.has('azure-pipelines.yml')) return { provider: 'Azure Pipelines', workflows: ['azure-pipelines.yml'] };
  return undefined;
}

export function presentFiles(scan: Scan): string[] {
  const out: string[] = [];
  const top = (re: RegExp) => scan.files.find((f) => re.test(f.path))?.path;
  for (const re of [/^CONTRIBUTING(\.md)?$/i, /^(\.github\/)?CODE_OF_CONDUCT\.md$/i, /^(\.github\/)?SECURITY\.md$/i, /^CHANGELOG(\.md)?$/i, /^\.github\/CONTRIBUTING\.md$/i]) {
    const hit = top(re);
    if (hit) out.push(hit);
  }
  for (const dir of ['docs', 'examples', 'example']) {
    if (scan.files.some((f) => f.path.startsWith(`${dir}/`))) out.push(`${dir}/`);
  }
  return out;
}

const LANG: Record<string, string> = {
  ts: 'TypeScript', tsx: 'TypeScript', mts: 'TypeScript', cts: 'TypeScript', js: 'JavaScript', jsx: 'JavaScript',
  mjs: 'JavaScript', cjs: 'JavaScript', vue: 'Vue', svelte: 'Svelte', astro: 'Astro', py: 'Python', rb: 'Ruby',
  go: 'Go', rs: 'Rust', java: 'Java', kt: 'Kotlin', kts: 'Kotlin', scala: 'Scala', swift: 'Swift', c: 'C', h: 'C',
  cpp: 'C++', cc: 'C++', cxx: 'C++', hpp: 'C++', cs: 'C#', fs: 'F#', php: 'PHP', lua: 'Lua', dart: 'Dart',
  ex: 'Elixir', exs: 'Elixir', erl: 'Erlang', hs: 'Haskell', clj: 'Clojure', zig: 'Zig', nim: 'Nim',
  sol: 'Solidity', r: 'R', jl: 'Julia', sh: 'Shell', bash: 'Shell', zsh: 'Shell', ps1: 'PowerShell',
  html: 'HTML', css: 'CSS', scss: 'SCSS', sass: 'Sass', less: 'Less', sql: 'SQL', ipynb: 'Jupyter Notebook',
};

export function languageStats(scan: Scan): LanguageStat[] {
  const stats = new Map<string, { files: number; bytes: number }>();
  for (const f of scan.files) {
    if (/\.d\.ts$|\.min\./.test(f.path)) continue;
    const ext = f.path.slice(f.path.lastIndexOf('.') + 1).toLowerCase();
    const lang = LANG[ext];
    if (!lang) continue;
    const s = stats.get(lang) ?? { files: 0, bytes: 0 };
    s.files++;
    s.bytes += f.size;
    stats.set(lang, s);
  }
  const total = [...stats.values()].reduce((n, s) => n + s.bytes, 0) || 1;
  return [...stats.entries()]
    .map(([name, s]) => ({ name, ...s, percent: Math.round((s.bytes / total) * 1000) / 10 }))
    .filter((s) => s.percent >= 1)
    .sort((a, b) => b.bytes - a.bytes)
    .slice(0, 8);
}
