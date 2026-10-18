import * as path from 'node:path';
import { parse as parseToml } from 'smol-toml';
import type { ScriptFact } from '../types';
import type { Scan } from '../scan/walk';

export interface ManifestInfo {
  ecosystem: string;
  name?: string;
  description?: string;
  version?: string;
  license?: string;
  deps: string[];
  scripts: ScriptFact[];
  bin: string[];
  entryPoints: string[];
  packageManager?: string;
  installCommand?: string;
  testCommand?: string;
  runtime?: { node?: string; python?: string; go?: string; rust?: string };
  workspaces?: string[];
  npmPackage?: { name: string; private: boolean };
  pythonPackage?: { name: string };
}

type Json = Record<string, any>;

const str = (v: unknown): string | undefined => (typeof v === 'string' && v.trim() ? v.trim() : undefined);
const clean = (p: string) => p.replace(/^\.\//, '');

function tryJson(text: string | undefined): Json | undefined {
  if (!text) return undefined;
  try {
    const v = JSON.parse(text);
    return v && typeof v === 'object' ? v : undefined;
  } catch {
    return undefined;
  }
}

function tryToml(text: string | undefined): Json | undefined {
  if (!text) return undefined;
  try {
    return parseToml(text) as Json;
  } catch {
    return undefined;
  }
}

/** dist/cli.js → src/cli.ts (and friends), when those files exist. */
function sourceGuesses(scan: Scan, target: string): string[] {
  const t = clean(target);
  const out = scan.has(t) ? [t] : [];
  const m = /^(dist|build|lib|out)\/(.+?)\.(c|m)?js$/.exec(t);
  if (m) {
    for (const ext of ['ts', 'tsx', 'mts', 'js', 'mjs']) {
      const guess = `src/${m[2]}.${ext}`;
      if (scan.has(guess)) out.push(guess);
    }
  }
  return out;
}

// ---------------------------------------------------------------- Node

const PNPM_BUILTINS = new Set(['install', 'add', 'remove', 'update', 'link', 'publish', 'pack', 'exec', 'dlx', 'init', 'create', 'audit', 'outdated', 'list', 'why', 'store', 'rebuild', 'prune', 'import', 'patch', 'deploy', 'env', 'setup', 'config', 'licenses', 'help']);

export function nodeRunCommand(pm: string, script: string): string {
  switch (pm) {
    case 'pnpm':
    case 'yarn':
      return PNPM_BUILTINS.has(script) ? `${pm} run ${script}` : `${pm} ${script}`;
    case 'bun':
      return `bun run ${script}`;
    default:
      return script === 'test' || script === 'start' ? `npm ${script}` : `npm run ${script}`;
  }
}

function detectNodePm(scan: Scan, field: unknown): string {
  const declared = str(field)?.split('@')[0];
  if (declared && ['npm', 'pnpm', 'yarn', 'bun'].includes(declared)) return declared;
  if (scan.has('pnpm-lock.yaml') || scan.has('pnpm-workspace.yaml')) return 'pnpm';
  if (scan.has('bun.lockb') || scan.has('bun.lock')) return 'bun';
  if (scan.has('yarn.lock')) return 'yarn';
  return 'npm';
}

async function nodeManifest(scan: Scan, lockfiles: Set<string>): Promise<ManifestInfo | undefined> {
  const pkg = tryJson(await scan.read('package.json'));
  if (!pkg) return undefined;
  const has = (p: string) => scan.has(p) || lockfiles.has(p);
  const pm = detectNodePm({ ...scan, has }, pkg.packageManager);

  const scripts: ScriptFact[] = [];
  for (const [name, command] of Object.entries<unknown>(pkg.scripts ?? {})) {
    if (typeof command !== 'string') continue;
    if (name === 'test' && /no test specified/.test(command)) continue;
    scripts.push({ name, command, run: nodeRunCommand(pm, name), source: 'package.json' });
  }

  const name = str(pkg.name);
  let bin: string[] = [];
  const entryPoints: string[] = [];
  if (typeof pkg.bin === 'string') {
    if (name) bin = [name.replace(/^@[^/]+\//, '')];
    entryPoints.push(...sourceGuesses(scan, pkg.bin));
  } else if (pkg.bin && typeof pkg.bin === 'object') {
    bin = Object.keys(pkg.bin);
    for (const t of Object.values<unknown>(pkg.bin)) if (typeof t === 'string') entryPoints.push(...sourceGuesses(scan, t));
  }
  for (const key of ['main', 'module', 'browser']) {
    if (typeof pkg[key] === 'string') entryPoints.push(...sourceGuesses(scan, pkg[key]));
  }
  const dot = pkg.exports?.['.'] ?? pkg.exports;
  for (const v of [dot, dot?.import, dot?.require, dot?.default]) {
    if (typeof v === 'string') entryPoints.push(...sourceGuesses(scan, v));
  }

  let workspaces: string[] = Array.isArray(pkg.workspaces) ? pkg.workspaces : Array.isArray(pkg.workspaces?.packages) ? pkg.workspaces.packages : [];
  const pnpmWs = await scan.read('pnpm-workspace.yaml');
  if (pnpmWs) workspaces = [...workspaces, ...[...pnpmWs.matchAll(/^\s*-\s*['"]?([^'"\n#]+?)['"]?\s*$/gm)].map((m) => m[1]!)];

  const nvmrc = (await scan.read('.nvmrc')) ?? (await scan.read('.node-version'));
  const testScript = scripts.find((s) => s.name === 'test');

  return {
    ecosystem: 'node',
    name,
    description: str(pkg.description),
    version: str(pkg.version),
    license: str(pkg.license) ?? str(pkg.license?.type),
    deps: [...Object.keys(pkg.dependencies ?? {}), ...Object.keys(pkg.devDependencies ?? {}), ...Object.keys(pkg.peerDependencies ?? {})],
    scripts,
    bin,
    entryPoints,
    packageManager: pm,
    installCommand: pm === 'yarn' ? 'yarn' : `${pm} install`,
    testCommand: testScript?.run,
    runtime: { node: str(pkg.engines?.node) ?? str(nvmrc) },
    workspaces,
    npmPackage: name ? { name, private: pkg.private === true } : undefined,
  };
}

// ---------------------------------------------------------------- Python

const pyName = (spec: string) => /^\s*([A-Za-z0-9][A-Za-z0-9._-]*)/.exec(spec)?.[1]?.toLowerCase();

async function pythonManifest(scan: Scan, lockfiles: Set<string>): Promise<ManifestInfo | undefined> {
  const pyproject = tryToml(await scan.read('pyproject.toml'));
  const requirements = await scan.read('requirements.txt');
  const setupPy = await scan.read('setup.py');
  const pipfile = scan.has('Pipfile');
  if (!pyproject && !requirements && !setupPy && !pipfile) return undefined;

  const project: Json = pyproject?.project ?? {};
  const poetry: Json = pyproject?.tool?.poetry ?? {};
  const deps = new Set<string>();
  for (const d of Array.isArray(project.dependencies) ? project.dependencies : []) {
    const n = typeof d === 'string' ? pyName(d) : undefined;
    if (n) deps.add(n);
  }
  for (const d of Object.keys(poetry.dependencies ?? {})) if (d !== 'python') deps.add(d.toLowerCase());
  for (const group of Object.values<any>(pyproject?.['dependency-groups'] ?? {})) {
    for (const d of Array.isArray(group) ? group : []) {
      const n = typeof d === 'string' ? pyName(d) : undefined;
      if (n) deps.add(n);
    }
  }
  for (const line of requirements?.split('\n') ?? []) {
    if (/^\s*(#|-)/.test(line)) continue;
    const n = pyName(line);
    if (n) deps.add(n);
  }

  const has = (p: string) => scan.has(p) || lockfiles.has(p);
  const pm = has('uv.lock') ? 'uv' : has('poetry.lock') || Object.keys(poetry).length ? 'poetry' : pipfile ? 'pipenv' : 'pip';
  const run = (cmd: string) => (pm === 'pip' ? cmd : `${pm} run ${cmd}`);
  const install =
    pm === 'uv' ? 'uv sync' : pm === 'poetry' ? 'poetry install' : pm === 'pipenv' ? 'pipenv install'
      : requirements ? 'pip install -r requirements.txt' : 'pip install -e .';

  const consoleScripts: Record<string, string> = { ...(project.scripts ?? {}), ...(poetry.scripts ?? {}) };
  const entryPoints: string[] = [];
  for (const target of Object.values(consoleScripts)) {
    if (typeof target !== 'string') continue;
    const mod = target.split(':')[0]!.replace(/\./g, '/');
    for (const guess of [`${mod}.py`, `src/${mod}.py`, `${mod}/__init__.py`, `src/${mod}/__init__.py`]) {
      if (scan.has(guess)) entryPoints.push(guess);
    }
  }

  const name = str(project.name) ?? str(poetry.name) ?? (setupPy ? /name\s*=\s*['"]([^'"]+)['"]/.exec(setupPy)?.[1] : undefined);
  const hasTests = deps.has('pytest') || scan.files.some((f) => /(^|\/)test_[^/]+\.py$/.test(f.path));
  const license = str(project.license) ?? str(project.license?.text) ?? str(poetry.license);

  return {
    ecosystem: 'python',
    name,
    description: str(project.description) ?? str(poetry.description),
    version: str(project.version) ?? str(poetry.version),
    license: license && license.length < 40 ? license : undefined,
    deps: [...deps],
    scripts: [],
    bin: Object.keys(consoleScripts),
    entryPoints,
    packageManager: pm,
    installCommand: install,
    testCommand: hasTests ? run('pytest') : undefined,
    runtime: { python: str(project['requires-python']) ?? str(poetry.dependencies?.python) ?? str(await scan.read('.python-version')) },
    pythonPackage: name && (pyproject || setupPy) ? { name } : undefined,
  };
}

// ---------------------------------------------------------------- Rust, Go, others

async function rustManifest(scan: Scan): Promise<ManifestInfo | undefined> {
  const cargo = tryToml(await scan.read('Cargo.toml'));
  if (!cargo) return undefined;
  const p: Json = cargo.package ?? {};
  const name = str(p.name);
  const bins: string[] = Array.isArray(cargo.bin) ? cargo.bin.map((b: Json) => b.name).filter(Boolean) : [];
  if (!bins.length && name && scan.has('src/main.rs')) bins.push(name);
  return {
    ecosystem: 'rust', name, description: str(p.description), version: str(p.version), license: str(p.license),
    deps: [...Object.keys(cargo.dependencies ?? {}), ...Object.keys(cargo['dev-dependencies'] ?? {})],
    scripts: [], bin: bins, entryPoints: [], packageManager: 'cargo',
    installCommand: 'cargo build --release', testCommand: 'cargo test',
    runtime: { rust: str(p['rust-version']) },
    workspaces: Array.isArray(cargo.workspace?.members) ? cargo.workspace.members : [],
  };
}

async function goManifest(scan: Scan): Promise<ManifestInfo | undefined> {
  const mod = await scan.read('go.mod');
  if (!mod) return undefined;
  const module = /^module\s+(\S+)/m.exec(mod)?.[1];
  const deps = [...mod.matchAll(/^\s*(?:require\s+)?([a-z0-9.-]+\.[a-z]{2,}\/\S+)\s+v[\d.]+/gm)].map((m) => m[1]!);
  const cmds = [...new Set(scan.files.map((f) => /^cmd\/([^/]+)\/main\.go$/.exec(f.path)?.[1]).filter(Boolean))] as string[];
  const bin = cmds.length ? cmds : scan.has('main.go') && module ? [module.split('/').pop()!] : [];
  return {
    ecosystem: 'go', name: module?.split('/').pop(), deps, scripts: [], bin, entryPoints: [],
    packageManager: 'go', installCommand: 'go mod download', testCommand: 'go test ./...',
    runtime: { go: /^go\s+([\d.]+)/m.exec(mod)?.[1] },
  };
}

async function otherManifests(scan: Scan): Promise<ManifestInfo[]> {
  const out: ManifestInfo[] = [];
  const pom = await scan.read('pom.xml');
  const gradle = (await scan.read('build.gradle.kts')) ?? (await scan.read('build.gradle'));
  if (pom || gradle) {
    const text = pom ?? gradle ?? '';
    const wrapper = scan.has('gradlew') ? './gradlew' : 'gradle';
    out.push({
      ecosystem: 'java',
      name: pom ? /<artifactId>([^<]+)<\/artifactId>/.exec(pom.replace(/<parent>[\s\S]*?<\/parent>/, ''))?.[1] : undefined,
      description: pom ? /<description>([^<]+)<\/description>/.exec(pom)?.[1]?.trim() : undefined,
      deps: text.includes('spring-boot') ? ['spring-boot'] : [],
      scripts: [], bin: [], entryPoints: [],
      packageManager: pom ? 'maven' : 'gradle',
      installCommand: pom ? 'mvn install' : `${wrapper} build`,
      testCommand: pom ? 'mvn test' : `${wrapper} test`,
    });
  }
  const gemfile = await scan.read('Gemfile');
  if (gemfile) {
    const gems = [...gemfile.matchAll(/^\s*gem\s+['"]([^'"]+)['"]/gm)].map((m) => m[1]!);
    out.push({
      ecosystem: 'ruby', deps: gems, scripts: [], bin: [], entryPoints: [], packageManager: 'bundler',
      installCommand: 'bundle install', testCommand: gems.includes('rspec') || gems.includes('rspec-rails') ? 'bundle exec rspec' : undefined,
    });
  }
  const composer = tryJson(await scan.read('composer.json'));
  if (composer) {
    out.push({
      ecosystem: 'php', name: str(composer.name)?.split('/').pop(), description: str(composer.description),
      license: str(composer.license), deps: [...Object.keys(composer.require ?? {}), ...Object.keys(composer['require-dev'] ?? {})],
      scripts: [], bin: [], entryPoints: [], packageManager: 'composer', installCommand: 'composer install',
    });
  }
  const csproj = scan.files.find((f) => f.path.endsWith('.csproj') && f.path.split('/').length <= 2);
  if (csproj) {
    out.push({
      ecosystem: 'dotnet', name: path.posix.basename(csproj.path, '.csproj'), deps: [], scripts: [], bin: [],
      entryPoints: [], packageManager: 'dotnet', installCommand: 'dotnet restore', testCommand: 'dotnet test',
    });
  }
  const deno = tryJson((await scan.read('deno.json')) ?? (await scan.read('deno.jsonc')));
  if (deno) {
    out.push({
      ecosystem: 'deno', name: str(deno.name), version: str(deno.version), deps: [], bin: [], entryPoints: [],
      scripts: Object.entries<unknown>(deno.tasks ?? {}).filter(([, c]) => typeof c === 'string')
        .map(([n, c]) => ({ name: n, command: c as string, run: `deno task ${n}`, source: 'deno.json' })),
      packageManager: 'deno',
    });
  }
  return out;
}

/** Makefile / Justfile targets are commands people really run. */
export async function taskRunnerScripts(scan: Scan): Promise<ScriptFact[]> {
  const out: ScriptFact[] = [];
  for (const file of ['Makefile', 'GNUmakefile', 'makefile']) {
    const text = await scan.read(file);
    if (!text) continue;
    const lines = text.split('\n');
    lines.forEach((line, i) => {
      const m = /^([A-Za-z0-9][\w.-]*)\s*:(?![=:])/.exec(line);
      if (!m || m[1]!.startsWith('.') || m[1]!.includes('%')) return;
      const recipe = lines[i + 1]?.startsWith('\t') ? lines[i + 1]!.trim() : '';
      out.push({ name: m[1]!, command: recipe, run: `make ${m[1]}`, source: file });
    });
    break;
  }
  for (const file of ['Justfile', 'justfile']) {
    const text = await scan.read(file);
    if (!text) continue;
    for (const m of text.matchAll(/^([A-Za-z0-9][\w-]*)(?:\s+[^:\n=]*)?:(?!=)/gm)) {
      out.push({ name: m[1]!, command: '', run: `just ${m[1]}`, source: file });
    }
    break;
  }
  return out;
}

export async function readManifests(scan: Scan, lockfiles: Set<string>): Promise<ManifestInfo[]> {
  const found = await Promise.all([nodeManifest(scan, lockfiles), pythonManifest(scan, lockfiles), rustManifest(scan), goManifest(scan)]);
  return [...found.filter((m): m is ManifestInfo => !!m), ...(await otherManifests(scan))];
}
