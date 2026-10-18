import type { CliOptionFact, EnvVarFact, RouteFact } from '../types';
import type { Scan } from '../scan/walk';

const CODE_FILE = /\.(m?[jt]sx?|cjs|cts|mts|vue|svelte|astro|py|rb|go|rs|java|kt|php|cs|ex|exs|sh)$/;
const NOT_SOURCE = /(^|\/)(tests?|__tests__|spec|fixtures?|mocks?|examples?|e2e|scripts\/test)(\/|$)|\.(test|spec)\.[a-z]+$|\.d\.ts$/;

const ENV_PATTERNS: RegExp[] = [
  /process\.env\.([A-Z_][A-Z0-9_]*)/g,
  /process\.env\[\s*['"`]([A-Z_][A-Z0-9_]*)['"`]\s*\]/g,
  /import\.meta\.env\.([A-Z_][A-Z0-9_]*)/g,
  /Deno\.env\.get\(\s*['"]([A-Z_][A-Z0-9_]*)['"]/g,
  /Bun\.env\.([A-Z_][A-Z0-9_]*)/g,
  /os\.(?:getenv|environ\.get)\(\s*['"]([A-Z_][A-Z0-9_]*)['"]/g,
  /os\.environ\[\s*['"]([A-Z_][A-Z0-9_]*)['"]\s*\]/g,
  /(?:env::var|std::env::var|dotenvy::var)\(\s*"([A-Z_][A-Z0-9_]*)"/g,
  /os\.(?:Getenv|LookupEnv)\(\s*"([A-Z_][A-Z0-9_]*)"/g,
  /ENV(?:\.fetch\(\s*|\[\s*)['"]([A-Z_][A-Z0-9_]*)['"]/g,
  /System\.getenv\(\s*"([A-Z_][A-Z0-9_]*)"/g,
  /(?:getenv|env)\(\s*['"]([A-Z_][A-Z0-9_]*)['"]/g,
  /Environment\.GetEnvironmentVariable\(\s*"([A-Z_][A-Z0-9_]*)"/g,
  // `const env = process.env; env.<NAME>` and Workers-style `c.env.<NAME>`
  /\benv\.([A-Z][A-Z0-9_]{2,})\b/g,
  /\benv\[\s*['"`]([A-Z][A-Z0-9_]{2,})['"`]\s*\]/g,
];

/** Variables set by the OS, the shell or the runtime: not project configuration. */
const BUILTIN_ENV = new Set([
  'NODE_ENV', 'HOME', 'PATH', 'PWD', 'USER', 'SHELL', 'TERM', 'CI', 'TZ', 'LANG', 'TMPDIR', 'TEMP', 'TMP',
  'HOSTNAME', 'USERPROFILE', 'APPDATA', 'LOCALAPPDATA', 'EDITOR', 'NO_COLOR', 'FORCE_COLOR', 'DEBUG',
  'VERCEL', 'VERCEL_ENV', 'VERCEL_URL', 'NETLIFY', 'GITHUB_ACTIONS', 'RENDER', 'PROD', 'DEV', 'MODE', 'SSR',
  'BASE_URL', 'NODE_OPTIONS', 'npm_package_version', 'XDG_CONFIG_HOME', 'XDG_DATA_HOME', 'XDG_CACHE_HOME',
]);

export function isSourceFile(p: string): boolean {
  return CODE_FILE.test(p) && !NOT_SOURCE.test(p);
}

async function forEachSource(scan: Scan, fn: (path: string, text: string) => void, limit = 2_500): Promise<void> {
  const files = scan.files.filter((f) => isSourceFile(f.path) && f.size < 300_000).slice(0, limit);
  const texts = await Promise.all(files.map((f) => scan.read(f.path)));
  files.forEach((f, i) => {
    const t = texts[i];
    if (t) fn(f.path, t);
  });
}

async function parseEnvExample(scan: Scan): Promise<Map<string, string | undefined>> {
  const out = new Map<string, string | undefined>();
  for (const file of ['.env.example', '.env.sample', '.env.template', '.env.defaults', '.env.dist']) {
    const text = await scan.read(file);
    if (!text) continue;
    let comment: string[] = [];
    for (const line of text.split('\n')) {
      const trimmed = line.trim();
      if (trimmed.startsWith('#')) {
        comment.push(trimmed.replace(/^#+\s*/, ''));
        continue;
      }
      const m = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=(.*)$/.exec(trimmed);
      if (m) {
        const inline = /\s#\s*(.+)$/.exec(m[2]!)?.[1];
        const description = (inline ?? comment.join(' ')).trim();
        out.set(m[1]!, description || undefined);
      }
      comment = [];
    }
  }
  return out;
}

export interface CodeFacts {
  envVars: EnvVarFact[];
  routes: RouteFact[];
  cliOptions: CliOptionFact[];
}

const ROUTE_PATTERNS: { re: RegExp; method?: string }[] = [
  { re: /\b(?:app|router|server|api|route|routes|r|v1|admin)\.(get|post|put|patch|delete|options|all)\(\s*['"`](\/[^'"`]*)['"`]/g },
  { re: /@(?:app|router|bp|blueprint|api|api_router)\.(get|post|put|patch|delete|route)\(\s*['"](\/[^'"]*)['"]/g },
  { re: /@(Get|Post|Put|Patch|Delete)\(\s*['"]([^'"]*)['"]/g },
  { re: /\.(GET|POST|PUT|PATCH|DELETE|Get|Post|Put|Patch|Delete)\(\s*"(\/[^"]*)"/g },
  { re: /(?:http\.)?HandleFunc\(\s*"(\/[^"]*)"/g, method: 'ANY' },
];

function nextRoute(p: string): RouteFact | undefined {
  const app = /^(?:src\/)?app\/(.*?)\/?route\.(?:t|j)sx?$/.exec(p);
  const pages = /^(?:src\/)?pages\/(api\/.*?)(?:\/index)?\.(?:t|j)sx?$/.exec(p);
  const route = app ? `/${app[1]}` : pages ? `/${pages[1]}` : undefined;
  if (!route) return undefined;
  return { method: 'ANY', path: route.replace(/\/\([^)]+\)/g, '').replace(/\[([^\]]+)\]/g, ':$1') || '/', file: p };
}

export async function extractCodeFacts(scan: Scan): Promise<CodeFacts> {
  const env = new Map<string, Set<string>>();
  const routes: RouteFact[] = [];
  const routeKeys = new Set<string>();
  const cli: CliOptionFact[] = [];
  const cliKeys = new Set<string>();

  await forEachSource(scan, (p, text) => {
    for (const re of ENV_PATTERNS) {
      for (const m of text.matchAll(re)) {
        const name = m[1]!;
        if (BUILTIN_ENV.has(name) || name.length < 2) continue;
        if (!env.has(name)) env.set(name, new Set());
        env.get(name)!.add(p);
      }
    }

    const nr = nextRoute(p);
    if (nr && !routeKeys.has(nr.path)) {
      routeKeys.add(nr.path);
      routes.push(nr);
    }
    for (const { re, method } of ROUTE_PATTERNS) {
      for (const m of text.matchAll(re)) {
        const verb = (method ?? m[1]!).toUpperCase().replace('ROUTE', 'ANY').replace('ALL', 'ANY');
        const routePath = method ? m[1]! : m[2]!;
        const key = `${verb} ${routePath}`;
        if (routes.length < 60 && !routeKeys.has(key)) {
          routeKeys.add(key);
          routes.push({ method: verb, path: routePath || '/', file: p });
        }
      }
    }

    if (/commander|yargs|argparse|click|typer|cac\b|meow\b|clap::|cobra/.test(text)) {
      const add = (flag: string, description?: string) => {
        if (cli.length >= 50 || cliKeys.has(flag)) return;
        cliKeys.add(flag);
        cli.push({ flag, description: description || undefined, file: p });
      };
      for (const m of text.matchAll(/\.(?:option|requiredOption)\(\s*['"`]([^'"`]*-[^'"`]*)['"`]\s*(?:,\s*['"`]([^'"`]*)['"`])?/g)) add(m[1]!, m[2]);
      for (const m of text.matchAll(/add_argument\(\s*['"](-{1,2}[\w-]+)['"](?:\s*,\s*['"](-{1,2}[\w-]+)['"])?([^)]*)\)/g)) {
        add([m[1], m[2]].filter(Boolean).join(', '), /help\s*=\s*['"]([^'"]*)['"]/.exec(m[3] ?? '')?.[1]);
      }
      for (const m of text.matchAll(/@click\.option\(\s*['"](-{1,2}[\w-]+)['"]([^)]*)\)/g)) {
        add(m[1]!, /help\s*=\s*['"]([^'"]*)['"]/.exec(m[2] ?? '')?.[1]);
      }
    }
  });

  const example = await parseEnvExample(scan);
  const envVars: EnvVarFact[] = [];
  for (const [name, files] of env) {
    envVars.push({ name, files: [...files].slice(0, 3), description: example.get(name), inExample: example.has(name) });
  }
  for (const [name, description] of example) {
    if (!env.has(name)) envVars.push({ name, files: [], description, inExample: true });
  }
  envVars.sort((a, b) => Number(b.inExample) - Number(a.inExample) || a.name.localeCompare(b.name));

  return { envVars: envVars.slice(0, 60), routes, cliOptions: cli };
}
