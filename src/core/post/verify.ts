import type { ProjectFacts } from '../types';
import { normalizeRepoUrl } from '../facts/repo';
import { scanLines } from './markdown';

export interface VerifyResult {
  readme: string;
  /** Problems fixed in place, without the model. */
  fixed: string[];
  /** Problems that need a repair pass by the model. */
  problems: string[];
  /** Things worth telling the user that can't be fixed automatically. */
  warnings: string[];
  /** How many commands were checked against the facts. */
  checkedCommands: number;
}

const SHELL_LANGS = new Set(['', 'bash', 'sh', 'shell', 'zsh', 'console', 'terminal', 'powershell', 'ps1', 'pwsh', 'cmd', 'bat', 'fish']);
const PM_BUILTINS = new Set(['install', 'i', 'add', 'remove', 'rm', 'uninstall', 'dlx', 'exec', 'x', 'create', 'init', 'link', 'unlink', 'why', 'update', 'up', 'upgrade', 'outdated', 'publish', 'pack', 'audit', 'config', 'store', 'env', 'global', 'info', 'list', 'ls', 'cache', 'help', 'version', 'set', 'import', 'patch', 'rebuild', 'prune', 'fetch', 'deploy', 'setup', 'workspace', 'workspaces', 'licenses', 'plugin', 'dedupe', 'login', 'logout', 'whoami', 'ci', 'node', 'tsx', 'turbo']);
const LICENSE_WORDS: [RegExp, string][] = [
  [/\bMIT\b/, 'MIT'], [/\bApache\b/i, 'Apache'], [/\bAGPL/i, 'AGPL'], [/\bLGPL/i, 'LGPL'], [/\bGPL/i, 'GPL'],
  [/\bBSD\b/i, 'BSD'], [/\bISC\b/, 'ISC'], [/\bMPL\b|Mozilla Public/i, 'MPL'], [/\bUnlicense\b/i, 'Unlicense'],
];

interface Command {
  text: string;
}

function commandsIn(md: string): Command[] {
  const out: Command[] = [];
  const push = (raw: string) => {
    const line = raw.trim().replace(/^(\$|>|PS>|#\s*\$)\s+/, '');
    if (!line || line.startsWith('#')) return;
    for (const seg of line.split(/\s*(?:&&|\|\||;)\s*/)) if (seg.trim()) out.push({ text: seg.trim() });
  };
  for (const l of scanLines(md)) {
    if (l.inCode && SHELL_LANGS.has(l.lang ?? '')) push(l.text);
    if (!l.inCode && !l.fence) for (const m of l.text.matchAll(/`([^`\n]+)`/g)) push(m[1]!);
  }
  return out;
}

function licenseFamily(text: string): string | undefined {
  return LICENSE_WORDS.find(([re]) => re.test(text))?.[1];
}

export function verifyReadme(input: string, facts: ProjectFacts, exists: (relPath: string) => boolean): VerifyResult {
  let readme = input;
  const fixed: string[] = [];
  const problems: string[] = [];
  const warnings: string[] = [];

  const nodeScripts = new Map(facts.scripts.filter((s) => s.source === 'package.json').map((s) => [s.name, s]));
  const makeTargets = new Set(facts.scripts.filter((s) => /makefile/i.test(s.source)).map((s) => s.name));
  const justTargets = new Set(facts.scripts.filter((s) => /justfile/i.test(s.source)).map((s) => s.name));
  const isNode = facts.ecosystems.includes('node');
  const pm = facts.packageManager;
  const available = [...nodeScripts.values()].map((s) => `\`${s.run}\``).join(', ') || 'none';
  const replacements = new Map<string, string>();

  const commands = commandsIn(readme);
  for (const { text } of commands) {
    let m: RegExpExecArray | null;
    let usedPm: string | undefined;
    let script: string | undefined;
    if ((m = /^npm\s+(?:run(?:-script)?)\s+([^\s]+)/.exec(text))) [usedPm, script] = ['npm', m[1]];
    else if ((m = /^npm\s+(test|start|t)\b/.exec(text))) [usedPm, script] = ['npm', m[1] === 't' ? 'test' : m[1]];
    else if ((m = /^(pnpm|yarn)\s+(run\s+)?([^\s-][^\s]*)/.exec(text)) && (m[2] || !PM_BUILTINS.has(m[3]!))) [usedPm, script] = [m[1], m[3]];
    else if ((m = /^bun\s+run\s+([^\s]+)/.exec(text))) [usedPm, script] = ['bun', m[1]];

    if (usedPm && script) {
      const fact = nodeScripts.get(script);
      if (!isNode) {
        problems.push(`\`${text}\` is an npm-style command, but this is not a Node.js project. Remove it or use the real commands from the facts.`);
      } else if (!fact) {
        if (!(script === 'start' && exists('server.js'))) {
          problems.push(`\`${text}\` runs a script named "${script}" that does not exist in package.json. Available scripts: ${available}.`);
        }
      } else if (pm && usedPm !== pm) {
        replacements.set(text, fact.run);
      }
      continue;
    }

    if (isNode && pm && pm !== 'npm' && /^npm\s+(install|i|ci)\s*$/.test(text) && facts.installCommand) {
      replacements.set(text, facts.installCommand);
      continue;
    }
    if ((m = /^make\s+([A-Za-z0-9][\w.-]*)/.exec(text))) {
      if (!makeTargets.size) problems.push(`\`${text}\` uses make, but the project has no Makefile.`);
      else if (!makeTargets.has(m[1]!)) problems.push(`\`${text}\`: there is no "${m[1]}" target in the Makefile. Targets: ${[...makeTargets].join(', ')}.`);
      continue;
    }
    if ((m = /^just\s+([\w-]+)/.exec(text)) && justTargets.size && !justTargets.has(m[1]!)) {
      problems.push(`\`${text}\`: there is no "${m[1]}" recipe in the Justfile.`);
      continue;
    }
    if ((m = /^git\s+clone\s+(?:--?[\w-]+(?:\s+\S+)?\s+)*(\S+)/.exec(text))) {
      const url = m[1]!;
      if (facts.repoUrl && normalizeRepoUrl(url)?.toLowerCase() !== facts.repoUrl.toLowerCase()) {
        replacements.set(url, `${facts.repoUrl}.git`);
        const oldName = url.replace(/\.git$/, '').split(/[/:]/).pop();
        const newName = facts.repoUrl.split('/').pop();
        if (oldName && newName && oldName !== newName) replacements.set(`cd ${oldName}`, `cd ${newName}`);
      } else if (!facts.repoUrl && /your|user(name)?\/|<|example|placeholder/i.test(url)) {
        problems.push(`The clone command uses a placeholder URL (${url}). The repository URL is unknown, so drop the git clone line and simply say to clone the repository.`);
      }
    }
  }

  for (const [from, to] of replacements) {
    if (from === to) continue;
    const re = new RegExp(`${from.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?=$|[\\s\`'"&;)|])`, 'gm');
    if (re.test(readme)) {
      readme = readme.replace(re, to);
      fixed.push(`\`${from}\` → \`${to}\``);
    }
  }

  // Environment variables: nothing invented, nothing important missing.
  const known = new Set(facts.envVars.map((e) => e.name));
  const documented = new Set<string>();
  // Only tables whose first header cell looks like a config column (not API tables with GET/POST rows).
  let tableIsConfig: boolean | undefined;
  for (const l of scanLines(readme)) {
    const isRow = !l.inCode && l.text.trimStart().startsWith('|');
    if (!isRow) {
      tableIsConfig = undefined;
      continue;
    }
    if (tableIsConfig === undefined) {
      const header = /^\s*\|\s*([^|]*)\|/.exec(l.text)?.[1] ?? '';
      tableIsConfig = /variable|env|name|key|setting|option|config/i.test(header);
      continue;
    }
    if (!tableIsConfig) continue;
    const cell = /^\s*\|\s*`?([A-Z][A-Z0-9_]{2,})`?\s*\|/.exec(l.text)?.[1];
    if (cell) documented.add(cell);
  }
  const invented = [...documented].filter((n) => !known.has(n));
  if (invented.length && (known.size || documented.size > 1)) {
    problems.push(`The configuration table lists ${invented.map((n) => `\`${n}\``).join(', ')}, which the code never reads. Remove ${invented.length > 1 ? 'them' : 'it'}.`);
  }
  const used = facts.envVars.filter((e) => e.files.length || e.inExample);
  if (used.length && used.length <= 25) {
    const missing = used.filter((e) => !readme.includes(e.name));
    if (missing.length) {
      problems.push(`These environment variables are read by the code but not documented: ${missing.map((e) => `\`${e.name}\`${e.files[0] ? ` (${e.files[0]})` : ''}`).join(', ')}. Add them to the configuration table.`);
    }
  }

  // License section must match the facts.
  const lines = scanLines(readme);
  const licIdx = lines.findIndex((l) => !l.inCode && /^##\s+licen[sc]e/i.test(l.text));
  if (licIdx !== -1) {
    const end = lines.findIndex((l, i) => i > licIdx && !l.inCode && /^#{1,2} /.test(l.text));
    const section = lines.slice(licIdx + 1, end === -1 ? undefined : end).map((l) => l.text).join('\n');
    const claimed = licenseFamily(section);
    const actual = facts.license ? licenseFamily(facts.license.replace(/-/g, ' ')) : undefined;
    if (claimed && !facts.license && !facts.licenseFile) {
      problems.push(`The License section claims ${claimed}, but the project has no license. Say "This project does not currently specify a license."`);
    } else if (claimed && actual && claimed !== actual) {
      problems.push(`The License section says ${claimed}, but the project is licensed under ${facts.license}.`);
    }
  }

  // Relative links and images must point at real files.
  readme = readme.replace(/(!?)\[([^\]\n]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g, (whole, bang: string, label: string, target: string) => {
    if (/^(https?:|mailto:|tel:|#|data:|\/\/)/i.test(target)) return whole;
    const rel = decodeURIComponent(target.split(/[?#]/)[0]!).replace(/^\.\//, '').replace(/^\//, '').replace(/\/$/, '');
    if (!rel || exists(rel)) return whole;
    fixed.push(`removed link to missing file ${target}`);
    return bang ? '' : label;
  });

  if (!facts.repoUrl && /github\.com\/(your|user|username|<)/i.test(readme)) {
    warnings.push('The README still contains a placeholder GitHub URL. Add a git remote (`git remote add origin …`) and run again.');
  }

  return { readme, fixed, problems: [...new Set(problems)], warnings, checkedCommands: commands.length };
}
