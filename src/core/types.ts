export type ProviderId = 'hosted' | 'gemini' | 'claude' | 'openai' | 'grok' | 'ollama';
export type DirectProviderId = Exclude<ProviderId, 'hosted'>;
export type Quality = 'fast' | 'high';
export type Style = 'minimal' | 'standard' | 'detailed';

export interface ScriptFact {
  name: string;
  command: string;
  /** The exact command a user types, e.g. `pnpm dev` or `make test`. */
  run: string;
  source: string;
}

export interface EnvVarFact {
  name: string;
  files: string[];
  description?: string;
  /** True when the variable is listed in .env.example (or similar). */
  inExample: boolean;
}

export interface RouteFact {
  method: string;
  path: string;
  file: string;
}

export interface CliOptionFact {
  flag: string;
  description?: string;
  file: string;
}

export interface LanguageStat {
  name: string;
  files: number;
  bytes: number;
  percent: number;
}

export interface FrameworkFact {
  name: string;
  category: string;
}

export interface ProjectFacts {
  name: string;
  description?: string;
  version?: string;
  license?: string;
  licenseFile?: string;
  languages: LanguageStat[];
  ecosystems: string[];
  frameworks: FrameworkFact[];
  packageManager?: string;
  installCommand?: string;
  testCommand?: string;
  scripts: ScriptFact[];
  binCommands: string[];
  npmPackage?: { name: string; private: boolean };
  pythonPackage?: { name: string };
  envVars: EnvVarFact[];
  routes: RouteFact[];
  cliOptions: CliOptionFact[];
  repoUrl?: string;
  defaultBranch?: string;
  docker?: { dockerfile: boolean; compose: boolean; exposedPorts: string[]; services: string[] };
  ci?: { provider: string; workflows: string[] };
  runtime: { node?: string; python?: string; go?: string; rust?: string };
  workspaces: string[];
  present: string[];
}

export interface SourceFile {
  path: string;
  content: string;
  truncated: boolean;
}

/** Everything the AI gets to see about a project. */
export interface ProjectContext {
  facts: ProjectFacts;
  tree: string;
  files: SourceFile[];
  /** Existing README, with protected blocks swapped for placeholders. */
  existingReadme?: string;
}

export interface GenerateOptions {
  style: Style;
  quality: Quality;
  sections?: string[];
}

export interface GenerateJob {
  kind: 'generate';
  context: ProjectContext;
  options: GenerateOptions;
}

export interface RepairJob {
  kind: 'repair';
  facts: ProjectFacts;
  readme: string;
  problems: string[];
}

export type Job = GenerateJob | RepairJob;

/** Something that turns a job into streamed Markdown. */
export interface Generator {
  /** Human-readable label, e.g. "claude · claude-sonnet-5-5 (your key)". */
  label: string;
  stream(job: Job, signal?: AbortSignal): AsyncIterable<string>;
}
