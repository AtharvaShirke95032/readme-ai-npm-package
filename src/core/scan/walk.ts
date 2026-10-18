import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import fg from 'fast-glob';
import ignore from 'ignore';
import { isSensitiveFile } from './secrets';

export interface ScannedFile {
  /** POSIX path relative to the project root. */
  path: string;
  size: number;
}

export interface Scan {
  root: string;
  files: ScannedFile[];
  /** Sensitive files that were skipped entirely (never read). */
  sensitive: string[];
  has(relPath: string): boolean;
  /** Reads a text file (cached). Returns undefined for missing, binary or huge files. */
  read(relPath: string): Promise<string | undefined>;
}

const IGNORED_DIRS = [
  'node_modules', '.git', '.hg', '.svn', 'dist', 'build', 'out', '.next', '.nuxt', '.svelte-kit',
  '.turbo', '.vercel', '.netlify', '.output', '.cache', '.parcel-cache', 'coverage', '.nyc_output',
  'vendor', 'target', 'venv', '.venv', '__pycache__', '.pytest_cache', '.mypy_cache', '.ruff_cache',
  '.tox', '.idea', '.vscode', '.gradle', 'obj', '.terraform', 'Pods', 'DerivedData', '.dart_tool',
  '.expo', '.angular', 'storybook-static', '.docusaurus', 'site-packages', 'bower_components',
];

const IGNORED_FILES = [
  'package-lock.json', 'pnpm-lock.yaml', 'yarn.lock', 'bun.lockb', 'bun.lock', 'Cargo.lock',
  'poetry.lock', 'uv.lock', 'Pipfile.lock', 'go.sum', 'composer.lock', 'Gemfile.lock',
  'npm-shrinkwrap.json', 'flake.lock', '.DS_Store', 'Thumbs.db', 'README.backup.md',
];

const TEXT_EXT = new Set([
  'js', 'mjs', 'cjs', 'jsx', 'ts', 'mts', 'cts', 'tsx', 'vue', 'svelte', 'astro', 'py', 'pyi', 'rb',
  'go', 'rs', 'java', 'kt', 'kts', 'scala', 'groovy', 'swift', 'm', 'mm', 'c', 'h', 'cc', 'cpp', 'cxx',
  'hpp', 'hh', 'cs', 'fs', 'vb', 'php', 'pl', 'pm', 'lua', 'r', 'jl', 'dart', 'ex', 'exs', 'erl',
  'hrl', 'clj', 'cljs', 'hs', 'elm', 'ml', 'mli', 'nim', 'zig', 'sol', 'sh', 'bash', 'zsh', 'fish',
  'ps1', 'bat', 'cmd', 'sql', 'prisma', 'graphql', 'gql', 'proto', 'html', 'htm', 'css', 'scss',
  'sass', 'less', 'styl', 'md', 'mdx', 'rst', 'txt', 'adoc', 'json', 'jsonc', 'json5', 'yaml', 'yml',
  'toml', 'ini', 'cfg', 'conf', 'env', 'xml', 'gradle', 'properties', 'csproj', 'fsproj', 'sln',
  'tf', 'hcl', 'nix', 'cmake', 'mk', 'example', 'sample', 'template', 'lock', 'gemspec', 'cabal',
  'ipynb', 'mod', 'work',
]);

const TEXT_NAMES = new Set([
  'Makefile', 'GNUmakefile', 'makefile', 'Dockerfile', 'Containerfile', 'Procfile', 'Gemfile',
  'Rakefile', 'Brewfile', 'Justfile', 'justfile', 'Vagrantfile', 'Jenkinsfile', 'LICENSE',
  'LICENCE', 'COPYING', 'NOTICE', 'AUTHORS', 'CODEOWNERS', '.gitignore', '.dockerignore',
  '.nvmrc', '.node-version', '.python-version', '.tool-versions', '.editorconfig', 'Pipfile',
]);

const MAX_FILES = 20_000;
const MAX_READ_BYTES = 512 * 1024;

export function isTextFile(relPath: string): boolean {
  const base = path.posix.basename(relPath);
  if (TEXT_NAMES.has(base) || base.startsWith('Dockerfile') || base.startsWith('LICENSE')) return true;
  if (/\.min\.(js|css)$/.test(base) || base.endsWith('.map')) return false;
  const ext = base.includes('.') ? base.slice(base.lastIndexOf('.') + 1).toLowerCase() : '';
  return TEXT_EXT.has(ext);
}

async function loadIgnoreFile(root: string, name: string): Promise<string> {
  try {
    return await fs.readFile(path.join(root, name), 'utf8');
  } catch {
    return '';
  }
}

export async function scanProject(root: string, extraIgnore: string[] = []): Promise<Scan> {
  const absRoot = path.resolve(root);
  const stat = await fs.stat(absRoot).catch(() => undefined);
  if (!stat?.isDirectory()) throw new Error(`Not a folder: ${absRoot}`);

  const ig = ignore().add(await loadIgnoreFile(absRoot, '.gitignore'));
  ig.add(await loadIgnoreFile(absRoot, '.readmeaiignore'));
  ig.add(extraIgnore);

  const entries = await fg('**/*', {
    cwd: absRoot,
    dot: true,
    onlyFiles: true,
    followSymbolicLinks: false,
    suppressErrors: true,
    stats: true,
    deep: 12,
    ignore: [...IGNORED_DIRS.map((d) => `**/${d}/**`), ...IGNORED_FILES.map((f) => `**/${f}`)],
  });

  const files: ScannedFile[] = [];
  const sensitive: string[] = [];
  for (const entry of entries) {
    if (files.length >= MAX_FILES) break;
    const rel = entry.path;
    if (ig.ignores(rel)) continue;
    if (isSensitiveFile(rel)) {
      sensitive.push(rel);
      continue;
    }
    if (!isTextFile(rel)) continue;
    files.push({ path: rel, size: entry.stats?.size ?? 0 });
  }
  files.sort((a, b) => a.path.localeCompare(b.path));

  const known = new Set(files.map((f) => f.path));
  const sizes = new Map(files.map((f) => [f.path, f.size]));
  const cache = new Map<string, Promise<string | undefined>>();

  const read = (rel: string): Promise<string | undefined> => {
    let hit = cache.get(rel);
    if (!hit) {
      hit = (async () => {
        if (!known.has(rel) || (sizes.get(rel) ?? 0) > MAX_READ_BYTES) return undefined;
        try {
          const text = await fs.readFile(path.join(absRoot, rel), 'utf8');
          return text.includes('\u0000') ? undefined : text;
        } catch {
          return undefined;
        }
      })();
      cache.set(rel, hit);
    }
    return hit;
  };

  return { root: absRoot, files, sensitive, has: (rel) => known.has(rel), read };
}
