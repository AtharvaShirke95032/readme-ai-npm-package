import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type { ProjectFacts } from '../types';
import type { Scan } from '../scan/walk';
import { detectFrameworks } from './frameworks';
import { readManifests, taskRunnerScripts } from './manifests';
import { extractCodeFacts } from './code';
import { ciInfo, dockerInfo, gitInfo, languageStats, licenseInfo, presentFiles } from './repo';

const LOCKFILES = ['package-lock.json', 'pnpm-lock.yaml', 'yarn.lock', 'bun.lockb', 'bun.lock', 'uv.lock', 'poetry.lock', 'Pipfile.lock'];

async function existingLockfiles(root: string): Promise<Set<string>> {
  const hits = await Promise.all(LOCKFILES.map((f) => fs.access(path.join(root, f)).then(() => f, () => undefined)));
  return new Set(hits.filter((h): h is string => !!h));
}

export interface FactsResult {
  facts: ProjectFacts;
  /** Files that manifests point to (main, bin, console scripts). Used to rank files. */
  entryPoints: string[];
}

export async function collectFacts(scan: Scan): Promise<FactsResult> {
  const lockfiles = await existingLockfiles(scan.root);
  const [manifests, tasks, code, git, license, docker] = await Promise.all([
    readManifests(scan, lockfiles),
    taskRunnerScripts(scan),
    extractCodeFacts(scan),
    gitInfo(scan.root),
    licenseInfo(scan),
    dockerInfo(scan),
  ]);

  const languages = languageStats(scan);
  // The main ecosystem is the one whose language dominates; ties go to manifest order.
  const langToEco: Record<string, string> = { TypeScript: 'node', JavaScript: 'node', Python: 'python', Rust: 'rust', Go: 'go', Java: 'java', Kotlin: 'java', Ruby: 'ruby', PHP: 'php', 'C#': 'dotnet' };
  const topEco = languages.map((l) => langToEco[l.name]).find((e) => e && manifests.some((m) => m.ecosystem === e));
  const primary = manifests.find((m) => m.ecosystem === topEco) ?? manifests[0];

  const deps = manifests.flatMap((m) => m.deps);
  const scripts = [...manifests.flatMap((m) => m.scripts), ...tasks];
  const runtime = Object.assign({}, ...manifests.map((m) => m.runtime ?? {}));
  const npm = manifests.find((m) => m.npmPackage)?.npmPackage;

  const facts: ProjectFacts = {
    name: primary?.name ?? path.basename(scan.root),
    description: primary?.description ?? manifests.find((m) => m.description)?.description,
    version: primary?.version,
    license: license.license ?? primary?.license ?? manifests.find((m) => m.license)?.license,
    licenseFile: license.licenseFile,
    languages,
    ecosystems: [...new Set(manifests.map((m) => m.ecosystem))],
    frameworks: detectFrameworks(deps),
    packageManager: primary?.packageManager,
    installCommand: primary?.installCommand,
    testCommand: primary?.testCommand ?? manifests.find((m) => m.testCommand)?.testCommand,
    scripts: scripts.slice(0, 40),
    binCommands: [...new Set(manifests.flatMap((m) => m.bin))],
    npmPackage: npm,
    pythonPackage: manifests.find((m) => m.pythonPackage)?.pythonPackage,
    envVars: code.envVars,
    routes: code.routes,
    cliOptions: code.cliOptions,
    repoUrl: git.repoUrl,
    defaultBranch: git.defaultBranch,
    docker,
    ci: ciInfo(scan),
    runtime,
    workspaces: [...new Set(manifests.flatMap((m) => m.workspaces ?? []))],
    present: presentFiles(scan),
  };

  return { facts, entryPoints: [...new Set(manifests.flatMap((m) => m.entryPoints))] };
}
