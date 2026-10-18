#!/usr/bin/env node
import { Command, Option } from 'commander';
import pkg from '../../package.json';
import { run } from './run';
import { ui } from './ui';
import { ProviderError, SetupError } from '../core/providers';

const program = new Command()
  .name('readme-ai')
  .description('Generate an accurate, polished README.md for your project with one command.')
  .version(pkg.version, '-v, --version')
  .argument('[path]', 'project folder', '.')
  .addOption(new Option('-p, --provider <name>', 'AI provider (default: free hosted service)').choices(['hosted', 'gemini', 'claude', 'openai', 'grok', 'ollama']))
  .option('-m, --model <id>', "model to use (default: the provider's recommended model)")
  .addOption(new Option('-q, --quality <level>', 'fast or high (stronger model)').choices(['fast', 'high']))
  .addOption(new Option('-s, --style <style>', 'length and depth of the README').choices(['minimal', 'standard', 'detailed']))
  .option('--sections <list>', 'only these sections, in this order (e.g. features,install,usage,api)')
  .option('-o, --output <file>', 'where to write the README (default: README.md)')
  .option('--diff', 'show the changes and ask before saving')
  .option('--dry-run', 'show what would be sent to the AI, then stop')
  .option('--fresh', 'ignore the existing README and start from scratch')
  .option('--force', 'overwrite without keeping a backup')
  .option('-y, --yes', "don't ask any questions (for CI)")
  .option('--server <url>', 'use a self-hosted readme-ai server')
  .option('--no-badges', "don't add badges")
  .option('--no-toc', "don't add a table of contents")
  .option('--no-link-check', "don't check links (works offline)")
  .option('--verbose', 'show every selected file and the extracted facts')
  .addHelpText(
    'after',
    `
Examples:
  $ npx @catmeow/readme-ai                      free hosted service, no key needed
  $ npx @catmeow/readme-ai ../api --diff        review changes before saving
  $ npx @catmeow/readme-ai -p claude -q high    your ANTHROPIC_API_KEY, best quality
  $ npx @catmeow/readme-ai -p ollama            fully local, nothing leaves your machine
  $ npx @catmeow/readme-ai --dry-run            see exactly what would be sent

API keys (only for --provider):
  gemini GEMINI_API_KEY · claude ANTHROPIC_API_KEY · openai OPENAI_API_KEY · grok XAI_API_KEY
  ollama needs no key (set OLLAMA_HOST if it isn't on localhost:11434)
`,
  )
  .action(async (target: string, flags) => {
    process.exitCode = await run(target, flags, pkg.version);
  });

program.parseAsync().catch((err: unknown) => {
  if (err instanceof SetupError || err instanceof ProviderError) {
    ui.error(err.message);
  } else {
    ui.error(err instanceof Error ? (process.env.DEBUG ? err.stack ?? err.message : err.message) : String(err));
    if (!process.env.DEBUG) process.stderr.write('  Run with DEBUG=1 for details.\n\n');
  }
  process.exitCode = 1;
});
