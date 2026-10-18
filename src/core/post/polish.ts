import type { ProjectFacts } from '../types';
import { normalizeRepoUrl } from '../facts/repo';
import { headings, scanLines, slugify } from './markdown';

/** shields.io static badge escaping: "-" → "--", "_" → "__", then URL-encode. */
const shield = (s: string) => encodeURIComponent(s.replace(/-/g, '--').replace(/_/g, '__'));

async function getJson(url: string): Promise<any> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(4_000), headers: { accept: 'application/json' } });
    return res.ok ? await res.json() : undefined;
  } catch {
    return undefined;
  }
}

/** True only when the published package points back at this repository (names alone can belong to someone else). */
function sameRepo(published: unknown[], repoUrl: string | undefined): boolean {
  if (!repoUrl) return false;
  return published.some((u) => typeof u === 'string' && normalizeRepoUrl(u.replace(/#.*$/, ''))?.toLowerCase() === repoUrl.toLowerCase());
}

/** Badges backed by real facts. Registry badges only appear if the package is actually published. */
export async function buildBadges(facts: ProjectFacts, opts: { network: boolean }): Promise<string[]> {
  const badges: string[] = [];
  const npm = facts.npmPackage;
  const py = facts.pythonPackage;
  const [npmInfo, pypiInfo] = await Promise.all([
    opts.network && npm && !npm.private && facts.repoUrl ? getJson(`https://registry.npmjs.org/${npm.name.replace('/', '%2F')}/latest`) : undefined,
    opts.network && py && facts.repoUrl ? getJson(`https://pypi.org/pypi/${encodeURIComponent(py.name)}/json`) : undefined,
  ]);
  const npmRepo = npmInfo?.repository;
  const onNpm = !!npmInfo && sameRepo([typeof npmRepo === 'string' ? npmRepo : npmRepo?.url, npmInfo.homepage], facts.repoUrl);
  const onPypi = !!pypiInfo && sameRepo([pypiInfo.info?.home_page, ...Object.values(pypiInfo.info?.project_urls ?? {})], facts.repoUrl);
  if (onNpm && npm) badges.push(`[![npm version](https://img.shields.io/npm/v/${npm.name})](https://www.npmjs.com/package/${npm.name})`);
  if (onPypi && py) badges.push(`[![PyPI version](https://img.shields.io/pypi/v/${py.name})](https://pypi.org/project/${py.name}/)`);

  const gh = facts.repoUrl && /^https:\/\/github\.com\/[^/]+\/[^/]+$/.test(facts.repoUrl) ? facts.repoUrl : undefined;
  if (gh && facts.ci?.provider === 'GitHub Actions' && facts.ci.workflows[0]) {
    const wf = facts.ci.workflows[0];
    badges.push(`[![CI](${gh}/actions/workflows/${wf}/badge.svg)](${gh}/actions/workflows/${wf})`);
  }
  if (facts.license && facts.license !== 'CC') {
    const target = facts.licenseFile ?? (gh ? `${gh}/blob/HEAD/LICENSE` : undefined);
    const img = `https://img.shields.io/badge/license-${shield(facts.license)}-blue.svg`;
    badges.push(target ? `[![License: ${facts.license}](${img})](${target})` : `![License: ${facts.license}](${img})`);
  }
  if (facts.runtime.node && facts.ecosystems.includes('node')) {
    badges.push(`![Node.js](https://img.shields.io/badge/node-${shield(facts.runtime.node)}-339933?logo=node.js&logoColor=white)`);
  }
  if (facts.runtime.python && facts.ecosystems.includes('python')) {
    badges.push(`![Python](https://img.shields.io/badge/python-${shield(facts.runtime.python)}-3776AB?logo=python&logoColor=white)`);
  }
  return badges;
}

/** Puts the badge row directly under the title. */
export function insertBadges(md: string, badges: string[]): string {
  if (!badges.length) return md;
  const lines = md.split('\n');
  const title = lines.findIndex((l) => l.startsWith('# '));
  if (title === -1) return `${badges.join(' ')}\n\n${md}`;
  lines.splice(title + 1, 0, '', badges.join(' '));
  return lines.join('\n').replace(/\n{3,}/g, '\n\n');
}

/** Adds a table of contents before the first `##` section once there are enough sections. */
export function insertToc(md: string, minSections = 5): string {
  const h2 = headings(md, 2);
  if (h2.length < minSections) return md;
  const seen = new Map<string, number>();
  const items = h2.map(({ text }) => {
    const base = slugify(text);
    const n = seen.get(base) ?? 0;
    seen.set(base, n + 1);
    return `- [${text.replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')}](#${n ? `${base}-${n}` : base})`;
  });
  const lines = scanLines(md).map((l) => l.text);
  let at = h2[0]!.index;
  // Never put the TOC inside a protected block that happens to come first.
  for (let i = at - 1; i >= 0 && (lines[i]!.trim() === '' || /^<!--\s*readme-ai:keep\s*-->$/.test(lines[i]!.trim())); i--) {
    if (lines[i]!.trim() !== '') at = i;
  }
  lines.splice(at, 0, '## Table of Contents', '', ...items, '');
  return lines.join('\n');
}

export function finalize(md: string): string {
  return `${md.replace(/\n{3,}/g, '\n\n').trim()}\n`;
}
