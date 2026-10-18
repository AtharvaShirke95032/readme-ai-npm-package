import { describe, expect, it } from 'vitest';
import { prepare, generate } from '../src/core/pipeline';
import { buildGeneratePrompt } from '../src/core/prompt/build';
import type { GenerateJob } from '../src/core/types';
import { fakeGenerator, makeProject } from './helpers';

const project = () =>
  makeProject({
    'package.json': JSON.stringify({ name: 'invoices', scripts: { dev: 'vite', build: 'vite build' }, dependencies: { react: '19' } }),
    'yarn.lock': '',
    'src/main.tsx': 'fetch(import.meta.env.VITE_API_URL)',
    LICENSE: 'MIT License\nPermission is hereby granted, free of charge',
    'README.md': '# Invoices\n\nOld intro.\n\n<!-- readme-ai:keep -->\n## Credits\nIcons by Jane.\n<!-- /readme-ai:keep -->\n',
  });

describe('pipeline', () => {
  it('builds a grounded prompt from the project', async () => {
    const p = await prepare(project(), { provider: 'claude', quality: 'fast' });
    expect(p.keepBlocks).toHaveLength(1);
    expect(p.context.existingReadme).toContain('<!-- readme-ai:keep:1 -->');
    expect(p.context.existingReadme).not.toContain('Icons by Jane');

    const { system, user } = buildGeneratePrompt({ kind: 'generate', context: p.context, options: { style: 'standard', quality: 'fast' } } as GenerateJob);
    expect(system).toContain('Never invent anything');
    expect(user).toContain('`yarn dev` → vite');
    expect(user).toContain('Install dependencies with: `yarn`');
    expect(user).toContain('VITE_API_URL');
    expect(user).toContain('License: MIT (file: LICENSE)');
    expect(user).toContain('<file path="src/main.tsx">');
    expect(user).toContain('Rewrite and improve the existing README');
    expect(user).toContain('Protected blocks');
  });

  it('respects --sections and --style in the prompt', async () => {
    const p = await prepare(project(), { provider: 'claude', quality: 'fast', fresh: true });
    expect(p.context.existingReadme).toBeUndefined();
    const { user } = buildGeneratePrompt({ kind: 'generate', context: p.context, options: { style: 'minimal', quality: 'fast', sections: ['features', 'install', 'api'] } });
    expect(user).toContain('MINIMAL');
    expect(user).toContain('Use exactly these sections, in this order, after the title and summary: Features, Installation, API Reference.');
  });

  it('checks, repairs and polishes the answer', async () => {
    const first = [
      'Here you go!',
      '```markdown',
      '# Invoices',
      '',
      'A React app for invoices.',
      '',
      '## Features',
      '- Track invoices',
      '## Installation',
      '```bash',
      'npm install',
      'npm run dev',
      'npm run deploy',
      '```',
      '## Configuration',
      '| Variable | Description |',
      '| --- | --- |',
      '| `VITE_API_URL` | API base URL |',
      '## Usage',
      'Open the app. ![shot](docs/shot.png)',
      '<!-- readme-ai:keep:1 -->',
      '## License',
      'MIT',
      '```',
    ].join('\n');
    const repaired = first.replace('npm run deploy\n', '');
    const gen = fakeGenerator([first, repaired]);
    const p = await prepare(project(), { provider: 'claude', quality: 'fast' });
    const result = await generate(p, gen, { style: 'standard', quality: 'fast', linkCheck: false });

    expect(gen.jobs.map((j) => j.kind)).toEqual(['generate', 'repair']);
    const repairJob = gen.jobs[1]!;
    expect(repairJob.kind === 'repair' && repairJob.problems[0]).toContain('"deploy"');

    const md = result.readme;
    expect(md.startsWith('# Invoices\n\n[![License: MIT]')).toBe(true);
    expect(md).toContain('## Table of Contents');
    expect(md).toContain('\nyarn\nyarn dev\n');
    expect(md).not.toContain('npm run');
    expect(md).not.toContain('shot.png');
    expect(md).toContain('## Credits\nIcons by Jane.');
    expect(md).not.toContain('readme-ai:keep:1');
    expect(result.keepRestored).toBe(1);
    expect(result.repaired).toHaveLength(1);
    expect(result.warnings).toEqual([]);
    expect(result.fixed).toEqual(expect.arrayContaining(['`npm install` → `yarn`', '`npm run dev` → `yarn dev`']));
  });

  it('reports problems the repair pass could not fix', async () => {
    const bad = '# Invoices\n\n```bash\nyarn start\n```\n\nVITE_API_URL\n';
    const p = await prepare(project(), { provider: 'claude', quality: 'fast', fresh: true });
    const result = await generate(p, fakeGenerator([bad, bad]), { style: 'standard', quality: 'fast', linkCheck: false, badges: false });
    expect(result.warnings[0]).toContain('"start"');
  });

  it('fails clearly on an empty answer', async () => {
    const p = await prepare(project(), { provider: 'claude', quality: 'fast' });
    await expect(generate(p, fakeGenerator(['  ']), { style: 'standard', quality: 'fast', linkCheck: false })).rejects.toThrow(/empty answer/);
  });
});
