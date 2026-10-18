import * as path from 'node:path';
import type { SourceFile } from '../types';
import type { Scan, ScannedFile } from './walk';
import { redactSecrets } from './secrets';

export const estimateTokens = (text: string): number => Math.ceil(text.length / 4);

const MANIFESTS = new Set([
  'package.json', 'pyproject.toml', 'setup.py', 'setup.cfg', 'requirements.txt', 'Pipfile',
  'Cargo.toml', 'go.mod', 'pom.xml', 'build.gradle', 'build.gradle.kts', 'settings.gradle',
  'Gemfile', 'composer.json', 'Makefile', 'Justfile', 'justfile', 'Dockerfile', 'docker-compose.yml',
  'docker-compose.yaml', 'compose.yml', 'compose.yaml', '.env.example', '.env.sample', 'deno.json',
  'mix.exs', 'pubspec.yaml', 'Procfile', 'vercel.json', 'netlify.toml', 'fly.toml', 'render.yaml',
  'wrangler.toml', 'pnpm-workspace.yaml', 'turbo.json', 'nx.json',
]);

const ENTRY_NAME = /^(index|main|app|server|cli|lib|mod|bot|worker|handler|program|__main__|manage|wsgi|asgi)\.[a-z]+$/;
const CONFIG_NAME = /^(vite|next|nuxt|astro|svelte|tailwind|webpack|rollup|tsup|remix|vue|angular|nest-cli|drizzle|prisma)[\w.-]*\.(js|mjs|cjs|ts|mts|json)$/;
const TEST_PATH = /(^|\/)(__tests__|tests?|spec|e2e|cypress)(\/|$)|\.(test|spec)\.[a-z]+$|_test\.(go|py)$|^test_.*\.py$/;
const LOW_VALUE = /(^|\/)(fixtures?|mocks?|__mocks__|__snapshots__|snapshots|migrations|generated|gen|assets|static|public|locales?|i18n)(\/|$)|\.d\.ts$|\.pb\.go$|_generated\./;

function score(file: ScannedFile, entryPoints: Set<string>): number {
  const p = file.path;
  const base = path.posix.basename(p);
  const depth = p.split('/').length - 1;

  if (/^readme(\.[a-z]+)?$/i.test(base) && depth === 0) return -1; // sent separately
  if (/^(license|licence|copying|notice)/i.test(base)) return 4;
  if (base.startsWith('.') && !MANIFESTS.has(base)) return 6;
  if (entryPoints.has(p)) return 95;
  if (MANIFESTS.has(base) || base.endsWith('.csproj')) return depth === 0 ? 100 : 55 - depth * 5;
  if (p.startsWith('.github/workflows/')) return 35;
  if (/^src\/(main|lib)\.rs$/.test(p) || /^cmd\/[^/]+\/main\.go$/.test(p)) return 90;
  if (TEST_PATH.test(p)) return 12 - depth;
  if (LOW_VALUE.test(p)) return 3;
  if (ENTRY_NAME.test(base)) return 82 - depth * 6;
  if (CONFIG_NAME.test(base)) return 40;
  if (/(^|\/)(routes?|api|controllers?|handlers?|commands?|endpoints|pages\/api|app\/api)(\/|$)/.test(p)) return 62 - depth * 2;
  if (/(^|\/)examples?\//.test(p)) return 45;
  if (/\.(md|mdx|rst|adoc|txt)$/i.test(base)) {
    if (/^(changelog|history|code_of_conduct)/i.test(base)) return 8;
    return /^docs?\//.test(p) ? 32 : 20;
  }
  if (/\.(json|ya?ml|toml|ini|xml|lock|css|scss|sass|less|html?)$/i.test(base)) return 10 - depth;
  const sizeBonus = file.size > 300 && file.size < 20_000 ? 6 : 0;
  return 34 - depth * 3 + sizeBonus;
}

export interface Selection {
  files: SourceFile[];
  tokens: number;
  redactions: number;
}

/**
 * Picks the most informative files that fit in the token budget.
 * Big files are cut down rather than dropped.
 */
export async function selectFiles(scan: Scan, budgetTokens: number, entryPoints: string[] = []): Promise<Selection> {
  const entries = new Set(entryPoints);
  const ranked = scan.files
    .map((f) => ({ f, s: score(f, entries) }))
    .filter((x) => x.s >= 0)
    .sort((a, b) => b.s - a.s || a.f.path.localeCompare(b.f.path));

  const budgetChars = Math.max(2_000, budgetTokens * 4);
  const perFileMax = Math.max(1_500, Math.min(24_000, Math.floor(budgetChars * 0.2)));
  let remaining = budgetChars;
  let redactions = 0;
  const files: SourceFile[] = [];

  for (const { f } of ranked) {
    if (remaining < 600) break;
    if (f.size === 0) continue;
    const raw = await scan.read(f.path);
    if (!raw?.trim()) continue;
    const { content: clean, count } = redactSecrets(raw);
    redactions += count;

    const overhead = f.path.length + 30;
    const limit = Math.min(perFileMax, remaining - overhead);
    if (limit < 400) continue;
    let content = clean;
    let truncated = false;
    if (content.length > limit) {
      content = content.slice(0, content.lastIndexOf('\n', limit) > limit * 0.5 ? content.lastIndexOf('\n', limit) : limit);
      truncated = true;
    }
    files.push({ path: f.path, content, truncated });
    remaining -= content.length + overhead;
  }

  return { files, tokens: Math.ceil((budgetChars - remaining) / 4), redactions };
}
