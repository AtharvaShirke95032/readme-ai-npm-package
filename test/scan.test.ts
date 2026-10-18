import { describe, expect, it } from 'vitest';
import { scanProject } from '../src/core/scan/walk';
import { selectFiles } from '../src/core/scan/select';
import { isSensitiveFile, redactSecrets } from '../src/core/scan/secrets';
import { buildTree } from '../src/core/scan/tree';
import { makeProject } from './helpers';

describe('scanning', () => {
  it('skips ignored folders, gitignored files, lockfiles, binaries and secrets', async () => {
    const dir = makeProject({
      'src/index.ts': 'export {}',
      'node_modules/x/index.js': 'x',
      'dist/out.js': 'x',
      'package-lock.json': '{}',
      'logo.png': 'binary',
      '.env': 'SECRET=1',
      '.env.example': 'SECRET=',
      'keys/server.pem': 'x',
      'generated/big.ts': 'x',
      'private/notes.md': 'x',
      '.gitignore': 'generated/\n',
      '.readmeaiignore': 'private/\n',
    });
    const scan = await scanProject(dir);
    expect(scan.files.map((f) => f.path).sort()).toEqual(['.env.example', '.gitignore', 'src/index.ts']);
    expect(scan.sensitive.sort()).toEqual(['.env', 'keys/server.pem']);
  });

  it('applies extra ignore patterns from the config', async () => {
    const scan = await scanProject(makeProject({ 'a.ts': '1', 'internal/b.ts': '2' }), ['internal/']);
    expect(scan.files.map((f) => f.path)).toEqual(['a.ts']);
  });
});

describe('secrets', () => {
  it('recognizes sensitive file names', () => {
    for (const f of ['.env', '.env.local', 'id_rsa', 'cert/key.pem', 'credentials.json', 'gcp-service-account.json', '.npmrc']) {
      expect(isSensitiveFile(f), f).toBe(true);
    }
    for (const f of ['.env.example', 'src/secrets.ts', 'keyboard.ts', 'credentials-form.tsx']) {
      expect(isSensitiveFile(f), f).toBe(false);
    }
  });

  it('redacts token-shaped values but keeps env lookups and placeholders', () => {
    const src = [
      'const a = "sk-ant-api03-abcdefghijklmnopqrstuvwxyz0123456789";',
      'const b = "AKIAABCDEFGHIJKLMNOP";',
      'const c = { apiKey: "9f8e7d6c5b4a39281706" };',
      'const d = process.env.API_KEY;',
      'const e = { password: "your-password-here" };',
      'const f = "ghp_' + 'a'.repeat(36) + '";',
    ].join('\n');
    const { content, count } = redactSecrets(src);
    expect(count).toBe(4);
    expect(content).not.toMatch(/sk-ant-api03|AKIAABCD|9f8e7d6c|ghp_a/);
    expect(content).toContain('process.env.API_KEY');
    expect(content).toContain('your-password-here');
  });
});

describe('file selection', () => {
  it('puts manifests and entry points first and respects the budget', async () => {
    const files: Record<string, string> = {
      'package.json': '{"name":"x","bin":"dist/cli.js"}',
      'src/cli.ts': 'cli '.repeat(200),
      'src/utils/deep/helper.ts': 'helper '.repeat(200),
      'src/index.test.ts': 'test '.repeat(200),
      'README.md': '# old',
    };
    for (let i = 0; i < 30; i++) files[`src/feature${i}.ts`] = 'x'.repeat(4_000);
    const scan = await scanProject(makeProject(files));
    const sel = await selectFiles(scan, 6_000, ['src/cli.ts']);
    const paths = sel.files.map((f) => f.path);
    expect(paths[0]).toBe('package.json');
    expect(paths[1]).toBe('src/cli.ts');
    expect(paths).not.toContain('README.md');
    expect(paths.indexOf('src/index.test.ts')).toBe(-1);
    expect(sel.tokens).toBeLessThanOrEqual(6_000);
  });

  it('truncates big files instead of dropping them', async () => {
    const scan = await scanProject(makeProject({ 'main.py': 'print(1)\n'.repeat(5_000) }));
    const sel = await selectFiles(scan, 2_000);
    expect(sel.files[0]!.truncated).toBe(true);
    expect(sel.files[0]!.content.length).toBeLessThan(8_100);
  });
});

describe('tree', () => {
  it('collapses deep folders and long lists', () => {
    const paths = ['a/b/c/d/e.ts', ...Array.from({ length: 20 }, (_, i) => `src/f${String(i).padStart(2, '0')}.ts`), 'README.md'];
    const tree = buildTree(paths, { maxDepth: 3, perDir: 5 });
    expect(tree).toContain('a/');
    expect(tree).toContain('c/ (1 files)');
    expect(tree).toContain('… 15 more');
  });
});
