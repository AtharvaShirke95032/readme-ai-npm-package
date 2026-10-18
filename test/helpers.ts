import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type { Generator, Job, ProjectFacts } from '../src/core/types';

/** Creates a throwaway project folder from a map of path → contents. */
export function makeProject(files: Record<string, string>): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'readme-ai-test-'));
  for (const [rel, content] of Object.entries(files)) {
    const full = path.join(dir, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content);
  }
  return dir;
}

export function baseFacts(overrides: Partial<ProjectFacts> = {}): ProjectFacts {
  return {
    name: 'demo', languages: [], ecosystems: ['node'], frameworks: [], scripts: [], binCommands: [], envVars: [],
    routes: [], cliOptions: [], runtime: {}, workspaces: [], present: [], packageManager: 'npm', installCommand: 'npm install',
    ...overrides,
  };
}

/** A generator that replays canned answers and records the jobs it received. */
export function fakeGenerator(answers: string[] | ((job: Job) => string)): Generator & { jobs: Job[] } {
  const jobs: Job[] = [];
  let i = 0;
  return {
    label: 'fake · test-model',
    jobs,
    async *stream(job: Job) {
      jobs.push(job);
      const text = typeof answers === 'function' ? answers(job) : answers[Math.min(i++, answers.length - 1)]!;
      for (let at = 0; at < text.length; at += 40) yield text.slice(at, at + 40);
    },
  };
}

/** A Response whose body streams the given string in small chunks. */
export function streamResponse(body: string, init: ResponseInit = {}): Response {
  const bytes = new TextEncoder().encode(body);
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (let i = 0; i < bytes.length; i += 17) controller.enqueue(bytes.slice(i, i + 17));
      controller.close();
    },
  });
  return new Response(stream, { status: 200, ...init });
}
