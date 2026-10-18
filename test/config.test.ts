import { describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { loadConfigFile, resolveOptions, validateConfig } from '../src/cli/config';
import { makeProject } from './helpers';

describe('config', () => {
  it('validates settings with clear messages', () => {
    expect(validateConfig({ provider: 'claude', quality: 'high', sections: ['a'] }).issues).toEqual([]);
    const { issues } = validateConfig({ provider: 'gpt', badges: 'yes', colour: 'red' });
    expect(issues).toEqual([
      'provider: must be one of: hosted, gemini, claude, openai, grok, ollama',
      'badges: must be true or false',
      expect.stringContaining('colour: unknown setting'),
    ]);
  });

  it('loads .readmeairc.json and reports invalid JSON', () => {
    const dir = makeProject({ '.readmeairc.json': '{"style":"detailed"}' });
    expect(loadConfigFile(dir)).toEqual({ config: { style: 'detailed' }, file: '.readmeairc.json' });
    fs.writeFileSync(path.join(dir, '.readmeairc.json'), '{oops');
    expect(() => loadConfigFile(dir)).toThrow(/not valid JSON/);
  });

  it('merges defaults < file < flags', () => {
    const file = { provider: 'claude' as const, model: 'claude-x', quality: 'high' as const, badges: false, sections: ['usage'] };
    const o = resolveOptions({ style: 'minimal' }, file);
    expect(o).toMatchObject({ provider: 'claude', model: 'claude-x', quality: 'high', style: 'minimal', badges: false, sections: ['usage'], output: 'README.md', toc: true });

    // Switching provider on the command line drops the file's model (it belongs to another provider).
    expect(resolveOptions({ provider: 'gemini' }, file).model).toBeUndefined();
    expect(resolveOptions({ sections: 'features, install' }, file).sections).toEqual(['features', 'install']);
    expect(resolveOptions({}, {}).provider).toBe('hosted');
    expect(() => resolveOptions({ quality: 'ultra' }, {})).toThrow(/Invalid --quality/);
  });
});
