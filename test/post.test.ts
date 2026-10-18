import { describe, expect, it } from 'vitest';
import { verifyReadme } from '../src/core/post/verify';
import { cleanOutput } from '../src/core/post/clean';
import { insertBadges, insertToc, buildBadges } from '../src/core/post/polish';
import { slugify } from '../src/core/post/markdown';
import { extractKeepBlocks, restoreKeepBlocks } from '../src/core/prompt/keep';
import { baseFacts } from './helpers';

const pnpmFacts = baseFacts({
  packageManager: 'pnpm',
  installCommand: 'pnpm install',
  scripts: [
    { name: 'dev', command: 'next dev', run: 'pnpm dev', source: 'package.json' },
    { name: 'build', command: 'next build', run: 'pnpm build', source: 'package.json' },
  ],
  repoUrl: 'https://github.com/acme/invoices',
  license: 'MIT',
  licenseFile: 'LICENSE',
  envVars: [{ name: 'DATABASE_URL', files: ['src/db.ts'], inExample: true }],
});
const noFiles = () => false;

describe('verifyReadme', () => {
  it('auto-fixes the package manager and clone URL', () => {
    const md = '# App\n\n```bash\ngit clone https://github.com/your-username/app.git\ncd app\nnpm install\nnpm run dev\n```\n\nSet `DATABASE_URL`.\n';
    const r = verifyReadme(md, pnpmFacts, noFiles);
    expect(r.readme).toContain('git clone https://github.com/acme/invoices.git');
    expect(r.readme).toContain('cd invoices');
    expect(r.readme).toContain('\npnpm install\n');
    expect(r.readme).toContain('\npnpm dev\n');
    expect(r.problems).toEqual([]);
    expect(r.fixed.length).toBe(4);
  });

  it('flags scripts that do not exist', () => {
    const r = verifyReadme('# App\n\nRun `pnpm start:prod` or:\n\n```bash\npnpm test\n```\n\nUses `DATABASE_URL`.', pnpmFacts, noFiles);
    expect(r.problems).toHaveLength(2);
    expect(r.problems[0]).toContain('"start:prod"');
    expect(r.problems[1]).toContain('"test"');
  });

  it('ignores package manager built-ins and global installs', () => {
    const md = '# App\n\n```bash\npnpm add zod\nnpm install -g @acme/cli\nnpx @acme/cli\n```\nDATABASE_URL';
    const r = verifyReadme(md, pnpmFacts, noFiles);
    expect(r.problems).toEqual([]);
    expect(r.fixed).toEqual([]);
  });

  it('flags invented and missing env vars', () => {
    const md = '# App\n\n| Variable | Description |\n| --- | --- |\n| `REDIS_URL` | Cache |\n| `SECRET_SAUCE` | ? |\n';
    const r = verifyReadme(md, pnpmFacts, noFiles);
    expect(r.problems.some((p) => p.includes('`REDIS_URL`, `SECRET_SAUCE`'))).toBe(true);
    expect(r.problems.some((p) => p.includes('`DATABASE_URL`'))).toBe(true);
  });

  it('does not mistake API tables for configuration tables', () => {
    const md = '# App\n\nDATABASE_URL\n\n| Method | Path |\n| --- | --- |\n| `GET` | /todos |\n| `POST` | /todos |\n';
    expect(verifyReadme(md, pnpmFacts, noFiles).problems).toEqual([]);
  });

  it('flags a wrong license', () => {
    const r = verifyReadme('# App\n\nDATABASE_URL\n\n## License\n\nApache 2.0\n', pnpmFacts, noFiles);
    expect(r.problems.some((p) => p.includes('licensed under MIT'))).toBe(true);
    const none = verifyReadme('# App\n\n## License\n\nMIT\n', baseFacts(), noFiles);
    expect(none.problems.some((p) => p.includes('no license'))).toBe(true);
  });

  it('removes links and images that point at missing files', () => {
    const md = '# App\n\nSee [docs](docs/guide.md) and [license](LICENSE).\n\n![Screenshot](assets/shot.png)\n\n[site](https://acme.dev)\nDATABASE_URL';
    const r = verifyReadme(md, pnpmFacts, (p) => p === 'LICENSE');
    expect(r.readme).toContain('See docs and [license](LICENSE)');
    expect(r.readme).not.toContain('shot.png');
    expect(r.readme).toContain('[site](https://acme.dev)');
  });

  it('flags npm commands in non-Node projects and placeholder clone URLs', () => {
    const facts = baseFacts({ ecosystems: ['python'], packageManager: 'pip', repoUrl: undefined });
    const r = verifyReadme('# Bot\n\n```bash\ngit clone https://github.com/your-username/bot\nnpm run dev\n```', facts, noFiles);
    expect(r.problems).toHaveLength(2);
  });
});

describe('cleanOutput', () => {
  it('unwraps a fenced answer and drops chatter, badges and a model-made TOC', () => {
    const raw = 'Sure! Here is the README:\n\n```markdown\n# App\n[![x](https://img.shields.io/x)](y) ![b](https://b)\n\nIntro.\n\n## Table of Contents\n- [Usage](#usage)\n\n## Usage\n\n```bash\nnpm start\n```\n```';
    const out = cleanOutput(raw);
    expect(out.startsWith('# App\n\nIntro.')).toBe(true);
    expect(out).not.toContain('Table of Contents');
    expect(out).toContain('```bash\nnpm start\n```');
    expect(out.endsWith('\n')).toBe(true);
  });

  it('removes <think> blocks from local reasoning models', () => {
    expect(cleanOutput('<think>hmm</think>\n# A\n\nB')).toBe('# A\n\nB\n');
  });
});

describe('polish', () => {
  it('slugifies like GitHub', () => {
    expect(slugify('Getting Started')).toBe('getting-started');
    expect(slugify('API Reference (v2)')).toBe('api-reference-v2');
    expect(slugify('`config` & env')).toBe('config--env');
  });

  it('adds a TOC only with 5+ sections, skipping code blocks', () => {
    const few = '# A\n\n## One\n\n## Two\n';
    expect(insertToc(few)).toBe(few);
    const many = '# A\n\nIntro\n\n## Features\n\n## Install\n\n```md\n## Not a heading\n```\n\n## Usage\n\n## Usage\n\n## License\n';
    const out = insertToc(many);
    expect(out).toContain('## Table of Contents\n\n- [Features](#features)');
    expect(out).toContain('- [Usage](#usage-1)');
    expect(out).not.toContain('[Not a heading]');
    expect(out.indexOf('Table of Contents')).toBeLessThan(out.indexOf('## Features'));
  });

  it('keeps the TOC outside a protected block that comes first', () => {
    const md = '# A\n\nIntro\n\n<!-- readme-ai:keep -->\n## Thanks\nx\n<!-- /readme-ai:keep -->\n\n## B\n\n## C\n\n## D\n\n## E\n';
    const out = insertToc(md);
    expect(out.indexOf('## Table of Contents')).toBeLessThan(out.indexOf('<!-- readme-ai:keep -->'));
  });

  it('builds fact-based badges and puts them under the title', async () => {
    const badges = await buildBadges(
      baseFacts({ license: 'Apache-2.0', licenseFile: 'LICENSE', runtime: { node: '>=20' }, repoUrl: 'https://github.com/a/b', ci: { provider: 'GitHub Actions', workflows: ['ci.yml'] } }),
      { network: false },
    );
    expect(badges).toEqual([
      '[![CI](https://github.com/a/b/actions/workflows/ci.yml/badge.svg)](https://github.com/a/b/actions/workflows/ci.yml)',
      '[![License: Apache-2.0](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](LICENSE)',
      '![Node.js](https://img.shields.io/badge/node-%3E%3D20-339933?logo=node.js&logoColor=white)',
    ]);
    expect(insertBadges('# A\n\nText\n', ['B1', 'B2'])).toBe('# A\n\nB1 B2\n\nText\n');
  });
});

describe('protected blocks', () => {
  it('round-trips protected sections and appends lost ones', () => {
    const readme = '# A\n\n<!-- readme-ai:keep -->\n## Thanks\nTo you.\n<!-- /readme-ai:keep -->\n\n<!-- readme-ai:keep -->\nExtra\n<!-- /readme-ai:keep -->\n';
    const { text, blocks } = extractKeepBlocks(readme);
    expect(blocks).toHaveLength(2);
    expect(text).toContain('<!-- readme-ai:keep:1 -->');
    const restored = restoreKeepBlocks('# New\n\n<!-- readme-ai:keep:1 -->\n\n## End\n', blocks);
    expect(restored.text).toContain('## Thanks\nTo you.');
    expect(restored.text.trimEnd().endsWith('<!-- /readme-ai:keep -->')).toBe(true);
    expect(restored.missing).toBe(1);
  });

  it('ignores markers shown inside code blocks', () => {
    const readme = '# A\n\n```markdown\n<!-- readme-ai:keep -->\nexample\n<!-- /readme-ai:keep -->\n```\n';
    expect(extractKeepBlocks(readme)).toEqual({ text: readme, blocks: [] });
  });
});
