import { z } from 'zod';

const s = (max: number) => z.string().max(max);
const arr = <T extends z.ZodTypeAny>(item: T, max: number) => z.array(item).max(max).default([]);

export const FactsSchema = z.object({
  name: s(200),
  description: s(2_000).optional(),
  version: s(100).optional(),
  license: s(100).optional(),
  licenseFile: s(300).optional(),
  languages: arr(z.object({ name: s(60), files: z.number(), bytes: z.number(), percent: z.number() }), 20),
  ecosystems: arr(s(30), 15),
  frameworks: arr(z.object({ name: s(80), category: s(40) }), 80),
  packageManager: s(30).optional(),
  installCommand: s(300).optional(),
  testCommand: s(300).optional(),
  scripts: arr(z.object({ name: s(200), command: s(2_000), run: s(300), source: s(100) }), 80),
  binCommands: arr(s(100), 30),
  npmPackage: z.object({ name: s(214), private: z.boolean() }).optional(),
  pythonPackage: z.object({ name: s(200) }).optional(),
  envVars: arr(z.object({ name: s(200), files: arr(s(400), 5), description: s(1_000).optional(), inExample: z.boolean() }), 100),
  routes: arr(z.object({ method: s(20), path: s(500), file: s(400) }), 100),
  cliOptions: arr(z.object({ flag: s(200), description: s(500).optional(), file: s(400) }), 80),
  repoUrl: s(500).optional(),
  defaultBranch: s(200).optional(),
  docker: z.object({ dockerfile: z.boolean(), compose: z.boolean(), exposedPorts: arr(s(30), 20), services: arr(s(100), 40) }).optional(),
  ci: z.object({ provider: s(60), workflows: arr(s(200), 30) }).optional(),
  runtime: z.object({ node: s(100).optional(), python: s(100).optional(), go: s(100).optional(), rust: s(100).optional() }).default({}),
  workspaces: arr(s(300), 50),
  present: arr(s(300), 30),
});

const MAX_FILE_CHARS = 60_000;
const MAX_TOTAL_CHARS = 600_000;

export const GenerateJobSchema = z.object({
  kind: z.literal('generate'),
  context: z.object({
    facts: FactsSchema,
    tree: s(40_000),
    files: z.array(z.object({ path: s(500), content: s(MAX_FILE_CHARS), truncated: z.boolean() })).max(400),
    existingReadme: s(60_000).optional(),
  }).refine((c) => c.files.reduce((n, f) => n + f.content.length, 0) <= MAX_TOTAL_CHARS, {
    message: `project context is larger than ${MAX_TOTAL_CHARS} characters`,
  }),
  options: z.object({
    style: z.enum(['minimal', 'standard', 'detailed']),
    quality: z.enum(['fast', 'high']),
    sections: z.array(s(60)).max(30).optional(),
  }),
});

export const RepairJobSchema = z.object({
  kind: z.literal('repair'),
  facts: FactsSchema,
  readme: s(120_000),
  problems: z.array(s(2_000)).min(1).max(40),
});

export const RequestSchema = z.object({
  job: z.discriminatedUnion('kind', [GenerateJobSchema, RepairJobSchema]),
  client: z.object({ version: s(40) }).partial().optional(),
});
