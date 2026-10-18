import { describe, expect, it } from 'vitest';
import { scanProject } from '../src/core/scan/walk';
import { collectFacts } from '../src/core/facts';
import { detectLicense, normalizeRepoUrl } from '../src/core/facts/repo';
import { makeProject } from './helpers';

const MIT = 'MIT License\n\nCopyright (c) 2026\n\nPermission is hereby granted, free of charge, to any person...';

async function factsFor(files: Record<string, string>) {
  const scan = await scanProject(makeProject(files));
  return collectFacts(scan);
}

describe('Node projects', () => {
  it('reads scripts, package manager, env vars, routes and license', async () => {
    const { facts, entryPoints } = await factsFor({
      'package.json': JSON.stringify({
        name: '@acme/invoices', description: 'Invoice tracker', version: '1.2.0', bin: { invoices: 'dist/cli.js' },
        scripts: { dev: 'next dev', build: 'next build', test: 'vitest run', lint: 'eslint .' },
        dependencies: { next: '15', react: '19', '@prisma/client': '6' }, devDependencies: { vitest: '3', typescript: '5' },
        engines: { node: '>=20' },
      }),
      'pnpm-lock.yaml': 'lockfileVersion: 9',
      'src/cli.ts': 'console.log(process.env.INVOICE_API_URL)',
      'src/db.ts': 'const url = process.env.DATABASE_URL; const env = process.env; env.STRIPE_KEY; process.env.NODE_ENV',
      'src/server.ts': "app.get('/api/invoices', h); router.post('/api/invoices/:id/pay', h)",
      'app/api/health/route.ts': 'export function GET() {}',
      '.env.example': '# Postgres connection string\nDATABASE_URL=postgres://localhost/db\nSTRIPE_KEY= # Stripe secret key\n',
      LICENSE: MIT,
    });
    expect(facts.name).toBe('@acme/invoices');
    expect(facts.packageManager).toBe('pnpm');
    expect(facts.installCommand).toBe('pnpm install');
    expect(facts.testCommand).toBe('pnpm test');
    expect(facts.scripts.map((s) => s.run)).toEqual(['pnpm dev', 'pnpm build', 'pnpm test', 'pnpm lint']);
    expect(facts.binCommands).toEqual(['invoices']);
    expect(entryPoints).toContain('src/cli.ts');
    expect(facts.license).toBe('MIT');
    expect(facts.licenseFile).toBe('LICENSE');
    expect(facts.runtime.node).toBe('>=20');
    expect(facts.frameworks.map((f) => f.name)).toEqual(expect.arrayContaining(['Next.js', 'React', 'Prisma', 'Vitest', 'TypeScript']));

    const env = Object.fromEntries(facts.envVars.map((e) => [e.name, e]));
    expect(Object.keys(env).sort()).toEqual(['DATABASE_URL', 'INVOICE_API_URL', 'STRIPE_KEY']);
    expect(env.DATABASE_URL!.description).toBe('Postgres connection string');
    expect(env.STRIPE_KEY!.description).toBe('Stripe secret key');
    expect(env.INVOICE_API_URL!.inExample).toBe(false);

    const routes = facts.routes.map((r) => `${r.method} ${r.path}`);
    expect(routes).toEqual(expect.arrayContaining(['GET /api/invoices', 'POST /api/invoices/:id/pay', 'ANY /api/health']));
  });

  it('uses npm commands when there is no other lockfile, and skips the placeholder test script', async () => {
    const { facts } = await factsFor({
      'package.json': JSON.stringify({ name: 'x', scripts: { start: 'node .', build: 'tsc', test: 'echo "Error: no test specified" && exit 1' } }),
    });
    expect(facts.scripts.map((s) => s.run)).toEqual(['npm start', 'npm run build']);
    expect(facts.testCommand).toBeUndefined();
  });
});

describe('other ecosystems', () => {
  it('reads a uv Python project with console scripts and pytest', async () => {
    const { facts, entryPoints } = await factsFor({
      'pyproject.toml': '[project]\nname = "weatherbot"\ndescription = "Weather in Slack"\nrequires-python = ">=3.11"\ndependencies = ["fastapi>=0.110", "httpx"]\n[project.scripts]\nweatherbot = "weatherbot.cli:main"\n[dependency-groups]\ndev = ["pytest>=8"]\n',
      'uv.lock': 'version = 1',
      'weatherbot/cli.py': 'import os\nKEY = os.getenv("OPENWEATHER_KEY")\n',
      'weatherbot/api.py': '@app.get("/forecast")\ndef f(): ...',
    });
    expect(facts.ecosystems).toContain('python');
    expect(facts.packageManager).toBe('uv');
    expect(facts.installCommand).toBe('uv sync');
    expect(facts.testCommand).toBe('uv run pytest');
    expect(facts.binCommands).toEqual(['weatherbot']);
    expect(entryPoints).toContain('weatherbot/cli.py');
    expect(facts.envVars.map((e) => e.name)).toEqual(['OPENWEATHER_KEY']);
    expect(facts.frameworks.map((f) => f.name)).toEqual(expect.arrayContaining(['FastAPI', 'pytest']));
    expect(facts.routes[0]).toMatchObject({ method: 'GET', path: '/forecast' });
    expect(facts.runtime.python).toBe('>=3.11');
  });

  it('reads Go modules, cmd binaries and Makefile targets', async () => {
    const { facts } = await factsFor({
      'go.mod': 'module github.com/acme/shipit\n\ngo 1.23\n\nrequire (\n\tgithub.com/spf13/cobra v1.8.0\n)\n',
      'cmd/shipit/main.go': 'package main\nfunc main() { os.Getenv("SHIPIT_TOKEN") }',
      Makefile: '.PHONY: build\nbuild:\n\tgo build ./...\n\ntest: build\n\tgo test ./...\nVERSION := 1\n',
    });
    expect(facts.name).toBe('shipit');
    expect(facts.binCommands).toEqual(['shipit']);
    expect(facts.frameworks.map((f) => f.name)).toContain('Cobra');
    expect(facts.scripts.map((s) => s.run)).toEqual(['make build', 'make test']);
    expect(facts.envVars.map((e) => e.name)).toEqual(['SHIPIT_TOKEN']);
    expect(facts.runtime.go).toBe('1.23');
  });

  it('falls back to the folder name when there is no manifest', async () => {
    const { facts } = await factsFor({ 'index.html': '<h1>hi</h1>', 'app.js': 'alert(1)' });
    expect(facts.name).toMatch(/^readme-ai-test-/);
    expect(facts.scripts).toEqual([]);
    expect(facts.languages.map((l) => l.name)).toEqual(expect.arrayContaining(['JavaScript', 'HTML']));
  });
});

describe('repo helpers', () => {
  it('normalizes git remotes', () => {
    expect(normalizeRepoUrl('git@github.com:me/app.git')).toBe('https://github.com/me/app');
    expect(normalizeRepoUrl('https://token@github.com/me/app.git')).toBe('https://github.com/me/app');
    expect(normalizeRepoUrl('ssh://git@gitlab.com/group/app.git')).toBe('https://gitlab.com/group/app');
    expect(normalizeRepoUrl('not a url')).toBeUndefined();
  });

  it('detects common licenses', () => {
    expect(detectLicense(MIT)).toBe('MIT');
    expect(detectLicense('Apache License\nVersion 2.0, January 2004')).toBe('Apache-2.0');
    expect(detectLicense('GNU GENERAL PUBLIC LICENSE\nVersion 3, 29 June 2007')).toBe('GPL-3.0');
    expect(detectLicense('Redistribution and use in source and binary forms... Neither the name')).toBe('BSD-3-Clause');
    expect(detectLicense('something else')).toBeUndefined();
  });
});
