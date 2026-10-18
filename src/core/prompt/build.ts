import type { GenerateJob, ProjectFacts, RepairJob, Style } from '../types';

export interface Prompt {
  system: string;
  user: string;
}

export const SECTION_IDS: Record<string, string> = {
  features: 'Features',
  'tech-stack': 'Tech Stack',
  tech: 'Tech Stack',
  prerequisites: 'Prerequisites',
  installation: 'Installation',
  install: 'Installation',
  'getting-started': 'Getting Started',
  configuration: 'Configuration',
  config: 'Configuration',
  usage: 'Usage',
  scripts: 'Available Scripts',
  'project-structure': 'Project Structure',
  structure: 'Project Structure',
  api: 'API Reference',
  architecture: 'Architecture',
  testing: 'Testing',
  tests: 'Testing',
  deployment: 'Deployment',
  deploy: 'Deployment',
  docker: 'Docker',
  faq: 'FAQ',
  troubleshooting: 'Troubleshooting',
  contributing: 'Contributing',
  license: 'License',
};

const STYLE_GUIDE: Record<Style, string> = {
  minimal: `MINIMAL. Short and plain, roughly 40-90 lines.
Sections: title + one-paragraph summary, Features (3-6 bullets), Installation, Usage, License.
Skip everything else unless it is essential to run the project.`,
  standard: `STANDARD. A complete README for a real repository, roughly 90-220 lines.
Suggested order (skip any section the facts and code give you nothing real to say about):
title + summary paragraph, Features, Tech Stack, Getting Started (Prerequisites, Installation, Configuration), Usage, Available Scripts, Project Structure, Testing, Deployment, Contributing, License.`,
  detailed: `DETAILED. Thorough documentation for a serious open-source project, roughly 180-400 lines.
Everything in the standard layout, plus where the code supports it: Architecture (how the main parts fit and how data flows),
API Reference (routes or CLI options as tables), Troubleshooting (only issues the code clearly anticipates, such as required env vars).`,
};

export const SYSTEM_PROMPT = `You are an expert technical writer and open-source maintainer. You write README.md files that developers trust: accurate, specific, skimmable and free of filler.

Hard rules:
1. Output raw GitHub-flavored Markdown only. No surrounding code fence, no preamble, no closing remarks.
2. Start with "# <Project Name>" followed by a short paragraph: what the project is, who it is for, and the problem it solves.
3. "Verified facts" are ground truth. Commands, script names, package manager, environment variables, routes, CLI flags, repository URL and license MUST match them exactly. Copy commands character for character from the facts.
4. Never invent anything: no made-up commands, flags, env vars, URLs, endpoints, screenshots, demo links, version numbers, benchmarks, roadmap items, authors or contact details. If something is unknown, leave it out. Describe only features you can see in the code.
5. Use the detected package manager in every command. If there is no repository URL, do not write a git clone command with a placeholder; just say to clone the repository.
6. Do NOT add badges or a table of contents. Both are added automatically afterwards.
7. Every code block has a language tag (bash, ts, python, json, ...). Shell commands go in bash blocks, one command per line, no "$" prompts.
8. Environment variables go in a table: | Variable | Description | Required |. Only mark Required "Yes" when the code clearly fails without it; otherwise use "No" or "Optional". Do not show real or example secret values.
9. In "Project Structure", show a short annotated tree of the important paths only and say what each is for. Do not paste the full tree.
10. License: name the license from the facts and link the license file if one exists. If there is no license, write "This project does not currently specify a license."
11. Plain, confident, developer-focused tone. No marketing language, no exclamation marks, no emojis in headings, no "This README...", never mention that it was generated.`;

function list<T>(items: T[], fmt: (t: T) => string, max = 40): string {
  const shown = items.slice(0, max).map((i) => `  - ${fmt(i)}`);
  if (items.length > max) shown.push(`  - … and ${items.length - max} more`);
  return shown.join('\n');
}

export function formatFacts(f: ProjectFacts): string {
  const lines: string[] = [];
  const add = (label: string, value: string | undefined) => {
    if (value) lines.push(`- ${label}: ${value}`);
  };
  add('Name', f.name);
  add('Description from the manifest', f.description);
  add('Version', f.version);
  add('License', f.license ? `${f.license}${f.licenseFile ? ` (file: ${f.licenseFile})` : ''}` : f.licenseFile ? `see ${f.licenseFile}` : 'none found');
  add('Repository URL', f.repoUrl);
  add('Languages', f.languages.map((l) => `${l.name} ${l.percent}%`).join(', '));
  add('Ecosystems', f.ecosystems.join(', '));
  if (f.frameworks.length) {
    const byCat = new Map<string, string[]>();
    for (const fw of f.frameworks) byCat.set(fw.category, [...(byCat.get(fw.category) ?? []), fw.name]);
    lines.push(`- Detected technologies:\n${list([...byCat], ([c, n]) => `${c}: ${n.join(', ')}`)}`);
  }
  const rt = Object.entries(f.runtime).filter(([, v]) => v);
  add('Runtime requirements', rt.map(([k, v]) => `${k} ${v}`).join(', '));
  add('Package manager', f.packageManager);
  add('Install dependencies with', f.installCommand && `\`${f.installCommand}\``);
  add('Run tests with', f.testCommand && `\`${f.testCommand}\``);
  if (f.scripts.length) {
    lines.push(`- Scripts (these are the ONLY scripts that exist; use the exact command in backticks):\n${list(f.scripts, (s) => `\`${s.run}\`${s.command ? ` → ${s.command.slice(0, 140)}` : ''}`)}`);
  } else {
    lines.push('- Scripts: none defined. Do not reference any npm/pnpm/yarn script or make target.');
  }
  if (f.binCommands.length) {
    const pkg = f.npmPackage && !f.npmPackage.private ? ` (npm package "${f.npmPackage.name}": run with npx ${f.npmPackage.name} or install globally)` : '';
    add('Command-line executables', f.binCommands.map((b) => `\`${b}\``).join(', ') + pkg);
  }
  if (f.pythonPackage) add('Python package name', f.pythonPackage.name);
  if (f.envVars.length) {
    lines.push(`- Environment variables read by the code:\n${list(f.envVars, (e) => `${e.name}${e.description ? ` — "${e.description}"` : ''}${e.files.length ? ` (used in ${e.files.join(', ')})` : ' (only in the example env file)'}`)}`);
    if (f.envVars.some((e) => e.inExample)) lines.push('  - An example env file exists, so setup can say to copy it, e.g. `cp .env.example .env`.');
  } else {
    lines.push('- Environment variables: none found in the code. Do not invent a configuration table.');
  }
  if (f.routes.length) lines.push(`- HTTP routes:\n${list(f.routes, (r) => `${r.method} ${r.path} (${r.file})`)}`);
  if (f.cliOptions.length) lines.push(`- CLI options:\n${list(f.cliOptions, (o) => `\`${o.flag}\`${o.description ? ` — ${o.description}` : ''}`)}`);
  if (f.docker) {
    const d = f.docker;
    add('Docker', [d.dockerfile && 'Dockerfile', d.exposedPorts.length && `EXPOSE ${d.exposedPorts.join(' ')}`, d.compose && `compose services: ${d.services.join(', ') || 'yes'}`].filter(Boolean).join('; '));
  }
  if (f.ci) add('CI', `${f.ci.provider} (${f.ci.workflows.join(', ')})`);
  if (f.workspaces.length) add('Monorepo workspaces', f.workspaces.join(', '));
  if (f.present.length) add('Existing docs to link instead of repeating', f.present.join(', '));
  return lines.join('\n');
}

function sectionsInstruction(sections: string[] | undefined): string {
  if (!sections?.length) return '';
  const names = sections.map((s) => SECTION_IDS[s.toLowerCase()] ?? s);
  return `\nUse exactly these sections, in this order, after the title and summary: ${names.join(', ')}.`;
}

export function buildGeneratePrompt(job: GenerateJob): Prompt {
  const { context, options } = job;
  const parts: string[] = [];
  parts.push(`# Task
${context.existingReadme ? 'Rewrite and improve the existing README below. Keep everything that is still accurate, keep the author\'s voice and any project-specific details only a human would know (motivation, credits, links), fix anything outdated or wrong, and fill the gaps.' : 'Write the README.md for this project.'}
Style: ${STYLE_GUIDE[options.style]}${sectionsInstruction(options.sections)}`);
  parts.push(`# Verified facts\n${formatFacts(context.facts)}`);
  parts.push(`# File tree\n\`\`\`\n${context.tree}\n\`\`\``);
  if (context.files.length) {
    parts.push(`# Source files\nThe most informative files, chosen automatically. Some are cut short (marked truncated).\n\n${context.files
      .map((f) => `<file path="${f.path}"${f.truncated ? ' truncated="true"' : ''}>\n${f.content}\n</file>`)
      .join('\n\n')}`);
  }
  if (context.existingReadme) {
    parts.push(`# Existing README\n<existing_readme>\n${context.existingReadme}\n</existing_readme>`);
    if (/<!-- readme-ai:keep:\d+ -->/.test(context.existingReadme)) {
      parts.push('Protected blocks: each line like `<!-- readme-ai:keep:1 -->` stands for a section the author locked. Output every such line exactly once, unchanged, on its own line, where that content belongs.');
    }
  }
  parts.push('Now write the complete README.md.');
  return { system: SYSTEM_PROMPT, user: parts.join('\n\n') };
}

export function buildRepairPrompt(job: RepairJob): Prompt {
  return {
    system: SYSTEM_PROMPT,
    user: `A README was checked against the project's verified facts and these problems were found:

${job.problems.map((p) => `- ${p}`).join('\n')}

# Verified facts
${formatFacts(job.facts)}

# README to fix
<readme>
${job.readme}
</readme>

Return the complete corrected README.md. Fix only the problems listed; keep everything else exactly as it is, including any lines like \`<!-- readme-ai:keep:1 -->\`.`,
  };
}
