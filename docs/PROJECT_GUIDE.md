# README-AI: The Complete Project Guide

> A from-zero explanation of every file, command, and design decision in `@catmeow/readme-ai`, so you can explain it in an interview and keep building it.
>
> Everything below was checked against the code as of commit `a9151d0` (Oct 2026). Commands were run on this machine and the outputs shown are real.

---

## Table of Contents

1. [TL;DR and the 30-second pitch](#1-tldr-and-the-30-second-pitch)
2. [Architecture: the big picture](#2-architecture-the-big-picture)
3. [Concepts primer (read this if any word is new)](#3-concepts-primer)
4. [Repo tour: every file at a glance](#4-repo-tour-every-file-at-a-glance)
5. [`package.json` and `tsconfig.json` line by line](#5-packagejson-and-tsconfigjson-line-by-line)
6. [File-by-file deep dive](#6-file-by-file-deep-dive)
7. [End-to-end walkthrough of one run](#7-end-to-end-walkthrough-of-one-run)
8. [Running everything locally (every command)](#8-running-everything-locally-every-command)
9. [Testing: what exists and what's missing](#9-testing-what-exists-and-whats-missing)
10. [Deployment: npm and Render](#10-deployment-npm-and-render)
11. [Project history (git timeline)](#11-project-history-git-timeline)
12. [Known bugs and limitations (with fixes)](#12-known-bugs-and-limitations-with-fixes)
13. [How to extend the project (recipes)](#13-how-to-extend-the-project-recipes)
14. [Interview Q&A bank](#14-interview-qa-bank)
15. [Command cheat sheet and glossary](#15-command-cheat-sheet-and-glossary)

---

## 1. TL;DR and the 30-second pitch

**What it is:** A command-line tool, published on npm as `@catmeow/readme-ai`. You run it inside any project folder:

```bash
npx @catmeow/readme-ai
```

It **scans the project** (files, languages, dependencies, folder structure, some sample code), sends that summary to a **backend server**, and the server asks **Google Gemini** (an LLM) to write a professional `README.md`. The CLI then saves the file into your project.

**One codebase, two deployments:**

| Part | Where it runs | How it ships |
|---|---|---|
| CLI (`src/cli.ts` + `src/analyzer.ts`) | The user's computer | Published to **npm**, run with `npx` |
| API server (`src/server.ts` + `src/gemini-service.ts`) | **Render.com** at `https://readme-ai-backend.onrender.com` | Render builds the repo and runs `node dist/server.js` |

**30-second interview pitch (memorize this):**

> "I built readme-ai, an npm CLI that generates README files using Google's Gemini model. It's written in TypeScript. The CLI uses fast-glob to scan a project, detects the languages and framework from file extensions and `package.json` dependencies, and pulls a small sample of source code. It sends that as JSON to an Express backend I deployed on Render. The backend holds the Gemini API key, so users don't need their own. It builds a structured prompt, calls Gemini 2.5 Flash, and returns the Markdown. I added per-IP rate limiting with express-rate-limit to control cost and abuse. The whole thing runs with one command, `npx @catmeow/readme-ai`."

---

## 2. Architecture: the big picture

```
 USER'S MACHINE                              RENDER.COM (cloud)                   GOOGLE
┌──────────────────────────────┐          ┌──────────────────────────────────┐   ┌──────────────┐
│ $ npx @catmeow/readme-ai .   │          │ Express server (dist/server.js)  │   │ Gemini API   │
│                              │          │                                  │   │ gemini-2.5-  │
│ cli.ts                       │          │ 1. cors()                        │   │ flash        │
│  ├─ ProjectAnalyzer          │  HTTPS   │ 2. express.json (10mb)           │   │              │
│  │   analyze()    ──┐        │  POST    │ 3. log IP                        │   │              │
│  │   getSampleCode()│        │ ───────► │ 4. rate limiter (10 / 15min/IP)  │   │              │
│  │                  ▼        │  /api/   │ 5. validate body                 │   │              │
│  │   { projectInfo,         │ generate │ 6. GeminiService.generateReadme ─┼──►│  LLM writes  │
│  │     sampleCode }          │          │      buildPrompt()               │   │  Markdown    │
│  │                           │ ◄─────── │ 7. res.json({success, readme}) ◄─┼───│              │
│  └─ fs.writeFile(README.md)  │   JSON   │                                  │   │              │
└──────────────────────────────┘          │ GET /health → {status:"ok"}      │   └──────────────┘
                                          │ env: GOOGLE_GENERATIVE_AI_API_KEY│
                                          └──────────────────────────────────┘
```

### Why split into CLI and server?

This is the most likely interview question about the architecture.

1. **Secret key protection.** Anything shipped in an npm package is public: anyone can download it and read the code. If the Gemini key lived in the CLI, it would leak. On the server, the key stays in an environment variable no user can see. The original version asked users for their own key (`--api-key`). Commit `940998f`, a PR from contributor *ssk090*, moved the key to the server.
2. **Zero setup for users.** No API key and no sign-up. `npx` and done.
3. **Cost and abuse control.** Every Gemini call costs money or quota. A central server can rate-limit per IP.
4. **You can change the AI without republishing.** The model and prompt live on the server. Redeploy the server and every user gets the change, even on an old CLI version.

### Request/response contract

**Request** — `POST /api/generate`, `Content-Type: application/json`:

```json
{
  "projectInfo": {
    "name": "my-app",
    "path": "/Users/me/my-app",
    "type": "React",
    "languages": ["TypeScript", "JavaScript"],
    "dependencies": ["react", "vite"],
    "files": [{ "path": "src/App.tsx", "type": ".tsx", "size": 1200 }],
    "structure": "src\nsrc/App.tsx\npackage.json"
  },
  "sampleCode": "\n--- src/App.tsx ---\nimport React from 'react'..."
}
```

**Success response (200):**

```json
{
  "success": true,
  "readme": "# My App\n\nA React app that ...",
  "projectInfo": { "name": "my-app", "type": "React", "languages": ["TypeScript","JavaScript"], "fileCount": 1 }
}
```

**Error responses:**

| Status | When | Body |
|---|---|---|
| 400 | `projectInfo` or `sampleCode` missing or empty | `{"error":"sampleCode is required"}` |
| 429 | More than 10 requests from your IP in 15 minutes | `{"error":"Too many requests from this IP, please try again later.","retryAfter":"15 minutes"}` |
| 500 | Gemini failed (bad key, quota, network) or the code crashed | `{"error":"Failed to generate README","message":"..."}` |

---

## 3. Concepts primer

Read the ones you're unsure about. Each is explained in terms of how this project uses it.

### Node.js
A program that runs JavaScript outside the browser. Both the CLI and the server are Node programs. `package.json` says `"engines": { "node": ">=18.0.0" }` because the CLI uses the built-in global `fetch()`, which first shipped in Node 18.

### npm, npx, pnpm
- **npm** is Node's package manager and the public registry (npmjs.com). `npm install` downloads the dependencies listed in `package.json` into `node_modules/`.
- **npx** runs a package's command without installing it globally. `npx @catmeow/readme-ai` downloads the package into a cache, finds its `bin` entry, and runs it.
- **pnpm** is a faster alternative to npm. This repo has **both** `package-lock.json` (npm) and `pnpm-lock.yaml` (pnpm) because different contributors used different tools. You should pick one (see §12).

### Scoped packages
`@catmeow/readme-ai`: the `@catmeow/` part is a **scope**, like a namespace tied to the npm user or org `catmeow`. Scoped packages are private by default, so the first publish needs `npm publish --access public`.

### Semantic versioning (semver)
`1.0.4` means `MAJOR.MINOR.PATCH`. Bump PATCH for bug fixes, MINOR for new backwards-compatible features, MAJOR for breaking changes. In dependencies, `^4.1.2` means "any 4.x.x at least 4.1.2", so minor and patch updates are allowed but not 5.0.0.

### The `bin` field and the shebang
```json
"bin": { "readme-ai": "dist/cli.js" }
```
This tells npm: "when someone installs this package, create a terminal command called `readme-ai` that runs `dist/cli.js`." For that to work on macOS and Linux, the file's first line must be the **shebang**:
```ts
#!/usr/bin/env node
```
It tells the OS "run this file with `node`". TypeScript keeps it when compiling `src/cli.ts` to `dist/cli.js`.

### TypeScript and `tsc`
TypeScript is JavaScript with types. Node can't run `.ts` files directly in this setup, so `tsc` (the TypeScript compiler) turns `src/*.ts` into `dist/*.js`. **You always run the `dist/` files, never `src/`.** That's why every script starts with `tsc` or a build.

### CommonJS vs ES modules
`tsconfig.json` has `"module": "commonjs"`. You write `import x from "y"` in TypeScript, but the compiled output uses `require("y")`. This matters because:
- `chalk` is pinned to **v4**, since chalk v5+ is ES-module-only and can't be `require()`d.
- `require.main === module` (used in `server.ts`) only works in CommonJS.

### async / await and Promises
Things that take time (reading files, HTTP calls) return **Promises**. `await` pauses the function until the Promise finishes. A function using `await` must be marked `async`, and it then returns a Promise itself:
```ts
async analyze(): Promise<ProjectInfo> {
  const files = await this.scanFiles(); // waits for the disk scan
  ...
}
```

### fetch
The browser-style HTTP client, built into Node 18+. The CLI uses it to call the server. When the server can't be reached at all, Node's `fetch` throws `TypeError: fetch failed`. The CLI detects that by checking whether the message contains `"fetch"`.

### Express and middleware
Express is a minimal web server framework. **Middleware** are functions `(req, res, next)` that run in order for each request. Each one either responds with `res.json(...)` or passes the request on with `next()`. In this server the order is: CORS → JSON parser → logger → rate limiter → route handler.

### CORS
Browsers block web pages from calling APIs on other domains unless the API says it's allowed. `app.use(cors())` allows every origin. The CLI isn't a browser, so CORS doesn't affect it. It only matters if a web frontend ever calls this API.

### Rate limiting
Limits how many requests one client can make in a time window. Here it's 10 requests per 15 minutes per IP, counted in server memory by `express-rate-limit`.

### Environment variables and dotenv
Config values like the API key are kept out of the code in env vars, read through `process.env.NAME`. **dotenv** loads them from a local `.env` file during development. `.env` is in `.gitignore`, so it's never committed. On Render you set them in the dashboard instead.

### `trust proxy`
On Render, requests reach your app through a load balancer, so the connecting IP is always the load balancer's. The real client IP is in the `X-Forwarded-For` header. `app.set("trust proxy", 1)` tells Express "trust one proxy hop", so `req.ip` becomes the real user IP. **Without it, every user would share one IP and one rate-limit bucket.**

### LLM and prompt
A large language model (Gemini here) produces text from a text instruction called the **prompt**. Most of the "AI" work in this project is in *how the prompt is written* (`buildPrompt` in `gemini-service.ts`).

---

## 4. Repo tour: every file at a glance

```
readme-backend/
├── src/
│   ├── cli.ts             ← CLI entry point (the `readme-ai` command). Runs on the user's machine.
│   ├── analyzer.ts        ← Scans a project folder → ProjectInfo + sample code.
│   ├── server.ts          ← Express API server. Runs on Render.
│   ├── gemini-service.ts  ← Wraps the Gemini SDK + builds the prompt.
│   ├── generator.ts       ← LEGACY: old "local mode" (analyzer + Gemini directly). Unused by CLI now.
│   ├── index.ts           ← Library entry (`main`): re-exports everything.
│   └── types.ts           ← Shared TypeScript types (ProjectInfo, FileInfo, ProjectType enum).
├── dist/                  ← (generated by `tsc`, git-ignored) compiled JS that actually runs.
├── test-rate-limit.js     ← Manual verification script (not a test framework).
├── package.json           ← Package metadata, scripts, dependencies, bin.
├── package-lock.json      ← npm's exact dependency versions.
├── pnpm-lock.yaml         ← pnpm's exact dependency versions (duplicate; pick one).
├── tsconfig.json          ← TypeScript compiler settings.
├── .gitignore             ← node_modules, dist, .env, logs, Replit files.
└── README.md              ← Public README shown on npm/GitHub.
```

**Who uses what (dependency graph):**

```
cli.ts ──────────► analyzer.ts ──► types.ts
server.ts ───────► gemini-service.ts ──► types.ts
generator.ts ────► analyzer.ts + gemini-service.ts   (legacy)
index.ts ────────► generator, analyzer, gemini-service, server, types
```

Key point: **`cli.ts` never imports `gemini-service.ts` or `server.ts`.** The CLI knows nothing about the API key. It only knows the server URL.

The `.gitignore` also lists `.replit` and `replit.nix`. The project was first scaffolded on **Replit** (an online IDE), and the first commits came from there.

---

## 5. `package.json` and `tsconfig.json` line by line

### `package.json`

```json
{
  "name": "@catmeow/readme-ai",
```
The npm package name, scoped under `@catmeow`. This is what users type after `npx`.

```json
  "version": "1.0.4",
```
The current version. **It must be bumped before every publish**, because npm rejects re-publishing an existing version.

```json
  "description": "AI-powered README generator ...",
  "main": "dist/index.js",
```
`main` is what you get with `require("@catmeow/readme-ai")` in code, meaning library use. It points at the compiled `index.ts`. (There's a bug here, see §12 #1.)

```json
  "bin": { "readme-ai": "dist/cli.js" },
```
Creates the `readme-ai` terminal command. `npx @catmeow/readme-ai` runs this file.

```json
  "scripts": {
    "clean": "rm -rf dist",
    "build": "npm run clean && tsc",
    "start": "node dist/cli.js",
    "start:server": "node dist/server.js",
    "dev": "tsc && node dist/cli.js",
    "dev:server": "tsc && node dist/server.js"
  },
```
Run each script with `npm run <name>` or `pnpm <name>`:

| Script | What it does | When to use |
|---|---|---|
| `clean` | Deletes `dist/` | Before a fresh build, so no stale files remain from deleted sources |
| `build` | `clean`, then compile `src/` → `dist/` | Before publishing or deploying |
| `start` | Runs the compiled CLI on the current folder | After building |
| `start:server` | Runs the compiled server | **This is what Render runs in production** |
| `dev` | Compiles, then runs the CLI | Quick local test of the CLI |
| `dev:server` | Compiles, then runs the server | Local server development |

To pass arguments through a script, use `--`: `npm run dev -- ../other-project --server http://localhost:3001`.

```json
  "dependencies": {
    "@google/generative-ai": "^0.21.0",
    "chalk": "^4.1.2",
    "commander": "^12.0.0",
    "cors": "^2.8.5",
    "dotenv": "^17.2.3",
    "express": "^4.18.2",
    "express-rate-limit": "^7.1.5",
    "fast-glob": "^3.3.2",
    "fs-extra": "^11.2.0"
  },
```

| Dependency | Used in | Purpose |
|---|---|---|
| `@google/generative-ai` | gemini-service.ts | Google's official Gemini SDK. **Note:** Google has deprecated this package in favor of `@google/genai`. Migrating is a good next task. |
| `chalk` (v4) | cli, generator, test script | Colored terminal output. v4 because v5 is ESM-only. |
| `commander` | cli.ts | Parses CLI arguments and flags, and generates `--help` and `--version`. |
| `cors` | server.ts | Adds CORS headers. |
| `dotenv` | server.ts | Loads `.env` into `process.env`. |
| `express` | server.ts | HTTP server framework. |
| `express-rate-limit` | server.ts | Per-IP rate limiting middleware. |
| `fast-glob` | analyzer.ts | Fast file search with glob patterns like `**/*.ts`. |
| `fs-extra` | analyzer, cli, generator | Like Node's `fs`, plus helpers: `pathExists`, `readJson`. |

Server-only packages (express, cors, dotenv, Gemini) are listed as regular dependencies too, so **every CLI user downloads them even though the CLI never uses them.** That's harmless but wasteful. A cleaner design would split the CLI and server into separate packages.

```json
  "devDependencies": {
    "@types/cors": "...", "@types/express": "...", "@types/fs-extra": "...",
    "@types/node": "^20.11.0",
    "typescript": "^5.3.3"
  },
```
`devDependencies` are only needed to **build**, not to run. `@types/*` packages give TypeScript type information for libraries written in plain JS. When someone installs your package from npm, dev dependencies are **not** installed.

```json
  "engines": { "node": ">=18.0.0" }
```
Declares the minimum Node version, needed for global `fetch`. npm warns if a user's Node is older.

**Missing fields worth knowing about** (see §10):
- `"files": ["dist"]` controls exactly what gets published.
- `"prepublishOnly": "npm run build"` builds automatically before `npm publish`.
- `"repository"`, `"author"` (currently empty), and `"homepage"` make the npm page look complete.

### `tsconfig.json`

```jsonc
{
  "compilerOptions": {
    "target": "ES2020",            // Output JS syntax level (Node 18+ supports far more; fine)
    "module": "commonjs",          // Output require()/module.exports
    "lib": ["ES2020"],             // Which built-in APIs TS knows about (no DOM)
    "outDir": "./dist",            // Compiled files go here
    "rootDir": "./src",            // Source root → dist mirrors src structure
    "strict": true,                // Strictest type checking (null checks, no implicit any, ...)
    "esModuleInterop": true,       // Lets you write `import express from "express"` for CJS libs
    "skipLibCheck": true,          // Don't type-check node_modules .d.ts files (faster)
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,     // Allows importing .json files
    "moduleResolution": "node",    // Find modules the Node way (node_modules lookup)
    "declaration": true,           // Emit .d.ts type files (for library users)
    "declarationMap": true,        // Map .d.ts back to .ts source
    "sourceMap": true              // Emit .js.map so stack traces point to .ts lines
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist"]
}
```

Because of `declaration`, `declarationMap`, and `sourceMap`, each source file produces **four** files in `dist/`: `x.js`, `x.js.map`, `x.d.ts`, `x.d.ts.map`. Seven sources × 4 = 28 files.

**About `lib: ["ES2020"]` and `fetch`:** `fetch` isn't part of ES2020, but `cli.ts` still compiles because `@types/node` declares a global `fetch`. If you ever drop `@types/node`, the CLI stops compiling.

---

## 6. File-by-file deep dive

### 6.1 `src/types.ts`: the shared data shapes

```ts
export interface ProjectInfo {
  name: string;          // from package.json "name", else the folder name
  path: string;          // absolute path that was scanned
  type: ProjectType;     // detected framework/language
  languages: string[];   // e.g. ["TypeScript", "JavaScript"]
  dependencies: string[];// package names from package.json / requirements.txt
  files: FileInfo[];     // up to 100 scanned files
  structure: string;     // newline-separated list of up to 50 paths, depth ≤ 3
}

export interface FileInfo {
  path: string;  // relative path, e.g. "src/cli.ts"
  type: string;  // extension incl. dot, e.g. ".ts"
  size: number;  // bytes
}

export enum ProjectType {
  NODEJS = 'Node.js', PYTHON = 'Python', WEB = 'Web Application',
  REACT = 'React', NEXTJS = 'Next.js', VUE = 'Vue.js', ANGULAR = 'Angular',
  TYPESCRIPT = 'TypeScript', JAVASCRIPT = 'JavaScript', UNKNOWN = 'Unknown'
}

export interface ReadmeSection { title: string; content: string; } // unused
```

**Syntax notes:**
- `interface` describes the *shape* of an object. It exists only at compile time and produces no JS.
- `string[]` means an array of strings. `FileInfo[]` means an array of `FileInfo` objects.
- `enum` with string values (`NODEJS = 'Node.js'`) is a set of named constants. It *does* produce JS: a real object. `ProjectType.REACT` evaluates to `"React"`, which is what goes over the network.
- `ReadmeSection` is never used anywhere. It's leftover.

### 6.2 `src/analyzer.ts`: scanning a project

This is the "intelligence" on the client side. The class `ProjectAnalyzer` holds one field, `targetPath`, and has one public entry point, `analyze()`, plus `getSampleCode()`.

```ts
export class ProjectAnalyzer {
  private targetPath: string;
  constructor(targetPath: string = process.cwd()) {
    this.targetPath = path.resolve(targetPath);
  }
```
- `private` means only code inside this class can access the field. That's checked by TypeScript only.
- `= process.cwd()` is a **default parameter**: if no path is given, use the current directory.
- `path.resolve(".")` turns a relative path into an absolute one, e.g. `/Users/meow/my-app`.

#### `analyze()`: the orchestrator
```ts
async analyze(): Promise<ProjectInfo> {
  const files = await this.scanFiles();
  const packageInfo = await this.readPackageJson();
  const dependencies = await this.extractDependencies();
  const languages = this.detectLanguages(files);
  const projectType = this.detectProjectType(files, packageInfo);
  const structure = await this.generateStructure();
  return {
    name: packageInfo?.name || path.basename(this.targetPath),
    path: this.targetPath, type: projectType, languages, dependencies, files, structure
  };
}
```
- `packageInfo?.name` is **optional chaining**: if `packageInfo` is `null`, the result is `undefined` instead of a crash.
- `|| path.basename(...)` falls back to the folder name (`/a/b/my-app` → `my-app`).
- `{ languages, dependencies }` is **shorthand properties**, the same as `{ languages: languages }`.
- The steps run **one after another**. They could run in parallel with `Promise.all`, but the gain is small.

#### `scanFiles()`: find relevant files
```ts
const patterns = [
  '**/*.{js,ts,jsx,tsx,py,java,go,rs,rb,php,cs,cpp,c,h,hpp}',
  '**/package.json', '**/requirements.txt', '**/Cargo.toml',
  '**/go.mod', '**/pom.xml', '**/*.md'
];
const ignore = ['**/node_modules/**','**/dist/**','**/build/**','**/.git/**',
                '**/venv/**','**/__pycache__/**','**/target/**'];
const filePaths = await fg(patterns, { cwd: this.targetPath, ignore, dot: false, absolute: false });
for (const filePath of filePaths.slice(0, 100)) { ... fs.stat ... }
```
**Glob syntax:**
- `**` matches any number of folders, including zero.
- `*` matches any characters within one name.
- `{a,b}` means "either a or b". So `**/*.{js,ts}` matches every `.js` and `.ts` file at any depth.

Options:
- `cwd` is the folder to search in.
- `dot: false` skips hidden files like `.env` and `.github/`. That's good for privacy.
- `absolute: false` returns relative paths like `src/cli.ts`.

Then it keeps **only the first 100 files** (`slice(0, 100)`) and calls `fs.stat` on each to get its size. `try/catch ... continue` skips files that vanish or can't be read.

**Why ignore `node_modules` etc.?** Those folders hold thousands of third-party or generated files that say nothing about *your* project, and scanning them would be slow.

#### `readPackageJson()` and `extractDependencies()`
- `readPackageJson` returns the parsed `package.json`, or `null` if it's missing or invalid.
- `extractDependencies` reads `package.json` **again** (redundant) and collects the keys of `dependencies` and `devDependencies`. It also reads `requirements.txt` for Python:

```ts
const lines = content.split('\n').filter(line => line.trim() && !line.startsWith('#'));
deps.push(...lines.map(line => line.split('==')[0].split('>=')[0].trim()));
```
Example: `flask==2.0.1` → `flask`, `requests>=2.0` → `requests`, `# comment` → skipped. It does **not** handle `~=`, `<`, `[extras]`, or `-r other.txt` (see §12).

- `...array` is the **spread operator**. `deps.push(...['a','b'])` is the same as `deps.push('a','b')`.
- `Object.keys({react: "^18"})` returns `["react"]`.
- `catch (error) {}` swallows errors silently. A broken file just means "no dependencies".

#### `detectLanguages(files)`
Maps each file extension to a language name through a lookup table, then de-duplicates with a `Set`:
```ts
const languages = new Set<string>();
files.forEach(file => { const lang = languageMap[file.type]; if (lang) languages.add(lang); });
return Array.from(languages);
```
`{ [key: string]: string }` is an **index signature** type: "an object with any string keys whose values are strings". `.h` and `.hpp` files are scanned but have no entry in the map, so they don't count as a language.

#### `detectProjectType(files, packageInfo)`: priority rules
```
Has package.json?
 ├─ yes → merge dependencies + devDependencies, then check in order:
 │         next → NEXTJS   (checked before react, since every Next app also has react)
 │         react → REACT
 │         vue → VUE
 │         @angular/core → ANGULAR
 │         typescript → TYPESCRIPT
 │         otherwise → NODEJS
 └─ no  → requirements.txt in files? → PYTHON
          any .ts/.tsx? → TYPESCRIPT
          any .js/.jsx? → JAVASCRIPT
          any .html/.css? → WEB   (⚠ unreachable: those extensions are never scanned)
          → UNKNOWN
```
`{ ...a, ...b }` is **object spread**. It merges two objects into a new one, and spreading `undefined` is safe.

**Interview point:** "Order matters. Next.js projects also depend on React, so I check `next` first."

#### `generateStructure()`
```ts
const files = await fg('**/*', { cwd, ignore, dot: false, onlyFiles: false, deep: 3 });
return files.slice(0, 50).join('\n');
```
Lists files **and folders** (`onlyFiles: false`) up to 3 levels deep, keeps the first 50, and joins them with newlines. The AI uses this to understand the layout.

#### `getSampleCode()`
```ts
const codeFiles = await fg(['**/*.{js,ts,jsx,tsx,py}'], { cwd, ignore: ['**/node_modules/**','**/dist/**','**/.git/**'] });
for (const file of codeFiles.slice(0, 3)) {
  const lines = content.split('\n').slice(0, 30).join('\n');
  sampleCode += `\n--- ${file} ---\n${lines}\n`;
}
```
Takes the **first 3** JS/TS/Python files in whatever order the glob returns them, and the **first 30 lines** of each. The result looks like:
```
--- src/index.ts ---
import express from 'express';
...
```
The `` `...${x}...` `` syntax is a **template literal**, a string with embedded values.

**Real output when run on this repo:**
```json
{
  "name": "@catmeow/readme-ai",
  "type": "TypeScript",
  "languages": ["JavaScript", "TypeScript"],
  "dependencies": ["@google/generative-ai","chalk","commander","cors","dotenv","express",
                   "express-rate-limit","fast-glob","fs-extra","@types/cors", "...", "typescript"],
  "files": [{"path":"README.md","type":".md","size":2744}, {"path":"package.json","type":".json","size":1132}, "..."],
  "structure": "README.md\npackage-lock.json\npackage.json\npnpm-lock.yaml\nsrc\ntest-rate-limit.js\ntsconfig.json\nsrc/analyzer.ts ..."
}
```
The detected type is `TypeScript`, not `Node.js`, because `typescript` is a devDependency. And the first "sample code" file it picked was `test-rate-limit.js`, a test script, not the core logic. That shows the "first 3 files" limitation.

**Size limits, and why they exist:** 100 files, 50 structure entries, 3 sample files × 30 lines. The server adds two more limits: 20 dependencies, and sample code cut to 3000 characters. These keep the prompt small, which makes it **cheaper** (LLMs bill by token), **faster**, and keeps it within the model's context limit.

### 6.3 `src/gemini-service.ts`: talking to the AI

```ts
import { GoogleGenerativeAI } from '@google/generative-ai';

export class GeminiService {
  private genAI: GoogleGenerativeAI;
  private model: any;

  constructor(apiKey: string) {
    this.genAI = new GoogleGenerativeAI(apiKey);
    this.model = this.genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });
  }

  async generateReadme(projectInfo: ProjectInfo, sampleCode: string): Promise<string> {
    const prompt = this.buildPrompt(projectInfo, sampleCode);
    try {
      const result = await this.model.generateContent(prompt);
      const response = await result.response;
      return response.text();
    } catch (error: any) {
      console.error("Gemini Error:", error); /* + message, status, stack */
      throw error;
    }
  }
```
How the SDK works, step by step:
1. `new GoogleGenerativeAI(apiKey)` creates an authenticated client.
2. `getGenerativeModel({ model })` picks the model. `gemini-2.5-flash` is Google's fast, cheap model. It's the right fit for a free tool. The git history shows several "model change" commits while tuning this.
3. `generateContent(prompt)` sends one HTTPS request to `generativelanguage.googleapis.com` and waits for the full answer. There's no streaming.
4. `result.response.text()` returns the generated Markdown as a string. (`await result.response` is harmless but unnecessary, since `response` is already a plain object.)

`catch (error: any) { ...; throw error; }` logs every detail on the server, then **re-throws** so `server.ts` can turn it into a 500 response. `private model: any` turns off type checking for the model. A better type is `GenerativeModel`, imported from the SDK.

#### `buildPrompt()`: prompt engineering
The prompt is one big template literal with these parts:

| Section | Purpose |
|---|---|
| `# ROLE`: "senior technical writer and open-source maintainer" | **Role prompting.** It sets the tone and quality bar. |
| `# PROJECT INFORMATION`: name, type, languages, the first 20 dependencies | Grounding facts |
| `# PROJECT STRUCTURE`: the file tree | Lets the model explain folders |
| `# SAMPLE SOURCE CODE`: `sampleCode.slice(0, 3000)` | Grounding in real code. It's capped to control cost. |
| `# WRITING PRINCIPLES`: "Never invent features...", "omit instead of guessing" | **Reduces hallucination** |
| `# REQUIRED README STRUCTURE`: Title, Features, Tech Stack, Installation, Usage, Project Structure, Configuration (table), Contributing, License | Gives every README the same consistent structure |
| `# STYLE`: GFM, fenced code, "Do not mention that this README was generated by AI" | Formatting rules |
| `Return ONLY the README.md.` | Stops chatty preambles like "Sure! Here's your README" |

**Interview point:** "Most of the quality comes from the prompt: a role, grounded facts, explicit anti-hallucination rules, a required output structure, and a strict output instruction. I iterated on it. Commit `175934f` refactored it into this structured format."

**Known gap:** the model sometimes wraps its answer in ```` ```markdown ```` fences anyway. Nothing strips those (see §12).

### 6.4 `src/server.ts`: the API backend

Read it top to bottom. This is the order things happen when the server starts.

```ts
import express, { Express, Request, Response } from "express";
import cors from "cors";
import rateLimit from "express-rate-limit";
import { GeminiService } from "./gemini-service";
import dotenv from "dotenv";
import path from "path";
dotenv.config({ path: path.resolve(__dirname, "../.env") });
```
- `import express, { Express, Request, Response }` pulls in the default export (the `express` function) plus named type exports.
- `__dirname` is the folder of the *running* file. When running `dist/server.js` that's `dist/`, so `../.env` is the repo root `.env`. That's how `.env` is found no matter which directory you start the server from.

```ts
const app: Express = express();
const PORT = process.env.PORT || 3001;
app.set("trust proxy", 1);
app.use(cors());
app.use(express.json({ limit: "10mb" }));
```
- `PORT`: Render sets `PORT` itself. Locally it falls back to 3001.
- `trust proxy`: needed so `req.ip` is the real client behind Render's proxy (see §3).
- `express.json` parses the JSON request body into `req.body`. Bodies over 10 MB are rejected with 413.

```ts
const apiKey = process.env.GOOGLE_GENERATIVE_AI_API_KEY;
if (!apiKey) { console.error("❌ Error: ...required!"); process.exit(1); }
```
**Fail fast:** a server without a key is useless, so it refuses to start. `process.exit(1)` means "exit with an error code". This runs **at import time**, which causes bug #1 in §12.

```ts
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,   // 15 minutes in milliseconds
  max: 10,                    // 10 requests per window per IP
  message: {...},             // (unused because a custom handler is given)
  standardHeaders: true,      // send RateLimit-* headers
  legacyHeaders: false,       // don't send old X-RateLimit-* headers
  handler: (req, res) => { console.log(`🚫 Rate limit exceeded for IP: ${ip}`); res.status(429).json({...}); },
});
```
Real response headers seen on a request:
```
RateLimit-Policy: 10;w=900
RateLimit-Limit: 10
RateLimit-Remaining: 9
RateLimit-Reset: 900
```
The counter lives **in server memory**: one `Map` of IP → count. It resets when the server restarts, and it isn't shared if you run more than one server instance. Production systems use a shared store like Redis for this.

**Every request counts, including 400 errors.** Testing locally, 10 invalid requests used up the whole quota, and the 11th returned 429.

```ts
app.use("/api/generate", (req, res, next) => { console.log(`📥 Request from IP: ...`); next(); });
app.use("/api/generate", limiter);
app.post("/api/generate", async (req, res) => { ... });
```
**Middleware order matters:** log, then rate-limit, then handle. `app.use(path, fn)` runs for *any* HTTP method on that path. `app.post` only matches POST.

The handler:
```ts
const { projectInfo, sampleCode } = req.body;            // destructuring
if (!projectInfo) return res.status(400).json({ error: "projectInfo is required" });
if (!sampleCode)  return res.status(400).json({ error: "sampleCode is required" });
const geminiService = new GeminiService(apiKey);         // new instance per request
const readmeContent = await geminiService.generateReadme(projectInfo, sampleCode);
res.json({ success: true, readme: readmeContent, projectInfo: { name, type, languages,
          fileCount: projectInfo.files?.length || 0 } });
// catch → 500 { error: "Failed to generate README", message: error.message }
```
- `const { a, b } = obj` is **destructuring**: it pulls fields out into variables.
- `!sampleCode` is true for `undefined`, `null`, **and `""`**. So a project with no JS/TS/Python files gets a 400 (bug in §12).
- The handler times each request with `Date.now()` and logs the duration.
- **Validation is shallow.** It only checks that the fields exist, not their shape. Testing showed `{"projectInfo":{"name":"x"},"sampleCode":"x"}` crashes inside `buildPrompt` (`languages.join` on undefined) and returns a 500. That's a request that should have been a 400.
- In TypeScript, `apiKey` is known to be a `string` here (not `string | undefined`) because of the `process.exit` check above. TypeScript's **control-flow narrowing** understands that `process.exit` never returns.

```ts
app.get("/health", (req, res) => res.json({ status: "ok", service: "readme-ai" }));
```
A **health check** endpoint. Hosting platforms and uptime monitors call it to see if the service is alive. It isn't rate-limited.

```ts
if (require.main === module) { app.listen(PORT, () => { console.log(...) }); }
export default app;
```
- `require.main === module` is true only when this file is run **directly** (`node dist/server.js`), not when it's imported. So importing `app`, for example in tests, doesn't open a port. That's the standard way to make an Express app testable with supertest.
- `export default app` allows `import app from "./server"`.

### 6.5 `src/cli.ts`: the command users run

```ts
#!/usr/bin/env node
import { Command } from "commander";
...
interface ApiErrorResponse { error: string; message?: string; retryAfter?: string; }
interface ApiSuccessResponse { success: true; readme: string; projectInfo: {...} }
```
- `message?: string` means the field is optional.
- `success: true` is a **literal type**: the field must be exactly `true`.
- These interfaces describe the server's JSON, so `data.readme` is typed.

```ts
const DEFAULT_SERVER_URL = "https://readme-ai-backend.onrender.com";
// const DEFAULT_SERVER_URL = "http://localhost:3001";
```
The commented line is how the author switched to local testing. Prefer `--server` or the env var instead of editing code.

**Commander setup:**
```ts
program
  .name("readme-ai")
  .description("AI-powered README generator for your projects")
  .version("1.0.0")                                    // ⚠ hard-coded, package is 1.0.4
  .argument("[path]", "Path to the project directory", ".")
  .option("-s, --server <url>", "Server URL (...)", process.env.README_AI_SERVER_URL || DEFAULT_SERVER_URL)
  .action(async (targetPath: string, options: any) => { ... });
program.parse();
```
- `[path]` in square brackets is an **optional** argument, with default `"."`. Angle brackets `<url>` mean a **required value** for that flag.
- `-s, --server` gives a short and a long form. The third argument is the default.
- `.action(fn)`: commander calls `fn(positionalArgs..., options)`.
- `program.parse()` reads `process.argv`, the actual command-line words, and runs the action.

**Real `--help` output:**
```
Usage: readme-ai [options] [path]

AI-powered README generator for your projects

Arguments:
  path                Path to the project directory (default: ".")

Options:
  -V, --version       output the version number
  -s, --server <url>  Server URL (default: http://localhost:3001 or
                      README_AI_SERVER_URL env) (default:
                      "https://readme-ai-backend.onrender.com")
  -h, --help          display help for command
```
(The description text wrongly says localhost. `readme-ai --version` prints `1.0.0`.)

**Server URL priority:** `--server` flag → `README_AI_SERVER_URL` env var → Render URL.

**The action flow:**
1. `path.resolve(targetPath)` gets the absolute folder path.
2. Print a banner with chalk: `chalk.bold.blue(...)`. Chalk styles chain.
3. `new ProjectAnalyzer(resolvedPath).analyze()`, then print the file count, type, and languages.
4. `analyzer.getSampleCode()`.
5. `fetch(`${serverUrl}/api/generate`, { method: "POST", headers: {"Content-Type": "application/json"}, body: JSON.stringify({ projectInfo, sampleCode }) })`.
6. If `!response.ok` (status not 2xx):
   - Try to parse the error JSON: `.catch(() => ({ error: response.statusText }))` falls back if the body isn't JSON.
   - 429 → "Rate limit exceeded. Please try again later."
   - Otherwise throw `errorData.error`. (The more useful `errorData.message` is dropped.)
7. Parse the success JSON. If `!data.success || !data.readme`, throw.
8. `fs.writeFile(path.join(resolvedPath, "README.md"), data.readme, "utf-8")`. **This overwrites any existing README without asking.**
9. Print the first 15 lines as a preview, then "🎉 Done!".

**Error handling:**
```ts
} catch (error) {
  if (error instanceof Error && error.message.includes("fetch")) {
    // "Could not connect to server" + tips (pnpm start:server, README_AI_SERVER_URL)
  } else {
    console.error(chalk.red(`\n❌ Error: ${error instanceof Error ? error.message : error}`));
  }
  process.exit(1);
}
```
- In TypeScript, a caught `error` has type `unknown`, so `instanceof Error` is needed before reading `.message`.
- `process.exit(1)` gives a non-zero exit code, so scripts and CI can tell it failed.
- The "fetch" check catches Node's `TypeError: fetch failed`, which is thrown for DNS failures or a refused connection.

**`(await response.json()) as ApiSuccessResponse`**: `as` is a **type assertion**. It tells TypeScript "trust me, it's this shape". Nothing is checked at runtime. A library like `zod` would validate the shape for real.

### 6.6 `src/generator.ts`: the legacy local mode

```ts
export class ReadmeGenerator {
  constructor(apiKey: string, targetPath: string = process.cwd()) { ... new GeminiService(apiKey) ... }
  async generate(): Promise<void> { analyze → getSampleCode → geminiService.generateReadme → writeFile → preview }
}
```
This is the **original architecture**, before the server existed. The CLI took `--api-key` and called Gemini directly from the user's machine. It does the same steps as `cli.ts`, but with Gemini in-process instead of over HTTP. Nothing calls it now. It's only exported from `index.ts` for library users who have their own key. Keep it or delete it, but be able to explain why it exists.

### 6.7 `src/index.ts`: the library entry

```ts
export { ReadmeGenerator } from './generator';
export { ProjectAnalyzer } from './analyzer';
export { GeminiService } from './gemini-service';
export { default as server } from './server';
export * from './types';
```
**Re-exports** turn the package into a library: `const { ProjectAnalyzer } = require("@catmeow/readme-ai")`. `export * from` re-exports everything in `types.ts`. `export { default as server }` re-exports `server.ts`'s default export under the name `server`.

⚠ **Verified bug:** re-exporting `server` runs `server.ts`'s top-level code on import. Without the env var:
```
$ node -e 'require("./dist/index")'
❌ Error: GOOGLE_GENERATIVE_AI_API_KEY environment variable is required!
exit code: 1
```
So library use is broken unless the key is set. Fix: remove that line (see §12).

### 6.8 `test-rate-limit.js`: the verification script

Plain JavaScript (`require`, not TypeScript), run with `node test-rate-limit.js`. It runs three checks in order:

1. **`testNoApiKey()`** reads `dist/cli.js` and `src/cli.ts`, and regex-searches them for `GEMINI_API_KEY`, `apiKey`, `--api-key`, and so on. This proves the client no longer contains or asks for a key, which was the point of PR #1. **It needs `dist/` built first.**
2. **`testServerConnection()`** calls `GET /health`, then makes one `POST /api/generate`. A 500 whose message contains "API key" means the server's key is wrong.
3. **`testRateLimit()`** sends 12 POSTs, 100 ms apart. It expects 200 for requests 1–10 and 429 for 11–12.

Server URL: `README_AI_SERVER_URL` env var or `http://localhost:3001`.

**Real run** against a local server with a fake key:
```
✅ No API key references found in CLI code
   Has --api-key option: NO ✅ ... Uses server URL: YES ✅
✅ Server is reachable   Response: {"status":"ok","service":"readme-ai"}
❌ Server is missing API key
   Error: [GoogleGenerativeAI Error]: ... [400 ] API key not valid ...
⚠️  Request 1: 500 - 288ms
...
```

**Limitations:**
- It isn't a real test suite: no assertions, it always prints "Tests completed!", and it never exits non-zero.
- With a **real** key it makes up to 11 **real Gemini calls**, which use quota. The health-check POST counts toward the limit too, so expect only 9 successes before 429s.
- Never point it at the production URL casually. You'd rate-limit yourself.

---

## 7. End-to-end walkthrough of one run

You run, inside `~/my-app`:
```bash
npx @catmeow/readme-ai
```

| # | Where | What happens |
|---|---|---|
| 1 | npm | `npx` downloads `@catmeow/readme-ai` into its cache, reads `bin.readme-ai = dist/cli.js`, runs it with node (shebang). |
| 2 | cli.ts | Commander parses args → `targetPath="."`, `options.server="https://readme-ai-backend.onrender.com"`. |
| 3 | cli.ts | Prints banner, target dir, server. |
| 4 | analyzer | `scanFiles` (fast-glob, ≤100 files) → `readPackageJson` → `extractDependencies` → `detectLanguages` → `detectProjectType` → `generateStructure`. |
| 5 | cli.ts | Prints `✓ Found 52 files`, `✓ Detected project type: React`, `✓ Languages: ...`. |
| 6 | analyzer | `getSampleCode` → first 30 lines of first 3 code files. |
| 7 | network | `POST https://readme-ai-backend.onrender.com/api/generate` with JSON body. **If the Render free instance was asleep, this first request can take 20–60 s** (a cold start: the live `/health` took 22 s when tested). |
| 8 | Render proxy | Adds `X-Forwarded-For: <your IP>` and forwards to Express. |
| 9 | server | `cors` → `express.json` parses body → log `📥 Request from IP` → limiter increments your IP's count (if >10 → 429 and stop). |
| 10 | server | Validate `projectInfo`, `sampleCode` → `new GeminiService(apiKey)` → `buildPrompt` → `generateContent`. |
| 11 | Google | Gemini 2.5 Flash returns Markdown (typically several seconds). |
| 12 | server | Logs duration, responds `{ success: true, readme, projectInfo }`. |
| 13 | cli.ts | Checks `response.ok`, parses JSON, writes `~/my-app/README.md` (overwrites!). |
| 14 | cli.ts | Prints 15-line preview and `🎉 Done!`, exits with code 0. |

---

## 8. Running everything locally (every command)

### 8.1 One-time setup
```bash
git clone <your repo url> readme-backend
cd readme-backend
npm install            # or: pnpm install   (pick one tool and stick to it)
```
`npm install` reads `package.json` and the lock file, then downloads everything into `node_modules/`.

### 8.2 Get a Gemini API key and create `.env`
1. Create a key at Google AI Studio (aistudio.google.com → "Get API key").
2. Create a file named `.env` in the repo root. It's git-ignored, so it's never committed:
```bash
GOOGLE_GENERATIVE_AI_API_KEY=your_key_here
# PORT=3001   (optional)
```

### 8.3 Build
```bash
npm run build          # deletes dist/, compiles src/ → dist/
npx tsc --noEmit       # type-check only, writes nothing (great before committing)
```

### 8.4 Run the server (terminal 1)
```bash
npm run dev:server     # compile + start
# or, if already built:
npm run start:server
```
Expected output:
```
🚀 README-AI Server running on port 3001
📡 API endpoint: http://localhost:3001/api/generate
🔑 API Key configured: ✅ Yes
🛡️  Rate limit: 10 requests per 15 minutes per IP
📊 Request logging: Enabled
```
Stop it with `Ctrl+C`. If the port is taken: `PORT=4000 npm run start:server`.

### 8.5 Poke the server with curl (terminal 2)
```bash
# Health check
curl http://localhost:3001/health
# → {"status":"ok","service":"readme-ai"}

# Validation error (shows rate-limit headers with -i)
curl -i -X POST http://localhost:3001/api/generate \
  -H 'Content-Type: application/json' \
  -d '{"projectInfo":{"name":"x"},"sampleCode":""}'
# → HTTP/1.1 400 ... {"error":"sampleCode is required"}

# A real generation (uses 1 Gemini call)
curl -X POST http://localhost:3001/api/generate \
  -H 'Content-Type: application/json' \
  -d '{"projectInfo":{"name":"demo","type":"Node.js","languages":["JavaScript"],"dependencies":["express"],"files":[],"structure":"index.js"},"sampleCode":"const express=require(\"express\");"}'
```
Restart the server to reset your rate-limit count.

### 8.6 Run the CLI against your local server (terminal 2)
```bash
# Option A: flag
node dist/cli.js /path/to/some/project --server http://localhost:3001

# Option B: env var
README_AI_SERVER_URL=http://localhost:3001 node dist/cli.js /path/to/some/project

# Option C: via npm script (note the -- to pass args through)
npm run dev -- /path/to/some/project --server http://localhost:3001
```
⚠ **Careful:** running it with no path, inside this repo, **overwrites this repo's own README.md**. Point it at a throwaway folder, or commit first so `git checkout README.md` can undo it.

### 8.7 Run the CLI against production
```bash
node dist/cli.js /path/to/project    # default server is Render
npx @catmeow/readme-ai /path/to/project   # the published version
```

### 8.8 Test the CLI as if it were installed globally
```bash
npm run build
npm link               # symlinks the `readme-ai` command to this folder globally
readme-ai --help
readme-ai ~/some-project --server http://localhost:3001
npm unlink -g @catmeow/readme-ai   # undo
```

### 8.9 See exactly what would be published
```bash
npm pack --dry-run     # lists files that would go into the npm tarball
```

### 8.10 Run the verification script
```bash
npm run build                                  # it reads dist/cli.js
npm run dev:server                             # terminal 1
README_AI_SERVER_URL=http://localhost:3001 node test-rate-limit.js   # terminal 2
```

---

## 9. Testing: what exists and what's missing

**What exists:**
- `test-rate-limit.js`, a manual script (see §6.8).
- `npx tsc --noEmit`, a type check. It passes on the current code.

**What's missing:** a test framework, automated assertions, mocked Gemini calls, and CI. If an interviewer asks "how did you test it?", be honest:

> "I tested it manually. I had a verification script that checks the CLI contains no API key, hits the health endpoint, and fires 12 requests to confirm the 11th gets a 429. I also tested end to end with curl and by running the CLI on real projects. Next I'd add unit tests for the analyzer with Vitest, and API tests with supertest that mock the Gemini service, so tests don't call the real API."

**How you'd add real tests:**
```bash
npm i -D vitest supertest @types/supertest
```
Add `"test": "vitest run"` to `scripts`. Example tests:

```ts
// tests/analyzer.test.ts: unit test with a temp folder
import { describe, it, expect } from "vitest";
import * as fs from "fs-extra"; import * as os from "os"; import * as path from "path";
import { ProjectAnalyzer } from "../src/analyzer";

describe("ProjectAnalyzer", () => {
  it("detects a React project", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "ra-"));
    await fs.writeJson(path.join(dir, "package.json"), { name: "x", dependencies: { react: "18" } });
    await fs.writeFile(path.join(dir, "App.tsx"), "export default 1");
    const info = await new ProjectAnalyzer(dir).analyze();
    expect(info.type).toBe("React");
    expect(info.languages).toContain("TypeScript/React");
  });
});
```
```ts
// tests/server.test.ts: API test without opening a port or calling Gemini
import { vi, it, expect } from "vitest";
import request from "supertest";
process.env.GOOGLE_GENERATIVE_AI_API_KEY = "test";
vi.mock("../src/gemini-service", () => ({
  GeminiService: class { async generateReadme() { return "# Mock README"; } },
}));
const { default: app } = await import("../src/server");

it("returns 400 without sampleCode", async () => {
  const res = await request(app).post("/api/generate").send({ projectInfo: { name: "x" } });
  expect(res.status).toBe(400);
});
it("returns the readme", async () => {
  const res = await request(app).post("/api/generate").send({ projectInfo: { name: "x" }, sampleCode: "y" });
  expect(res.body.readme).toBe("# Mock README");
});
```
This works because `server.ts` exports `app` and only calls `listen()` when run directly (`require.main === module`).

---

## 10. Deployment: npm and Render

There are **two independent deployments**. Changing one doesn't update the other.

### 10.1 Publishing the CLI to npm

**Current state (checked with `npm view` on 2026-10-18):**
```
name = '@catmeow/readme-ai'
version = '1.0.4'          ← latest
time.modified = '2025-11-09'
dist.fileCount = 39
```
Every commit after 2025-11-09 is **not on npm**. That includes the model change to `gemini-2.5-flash`, the new prompt, and the `clean` script. Mostly that doesn't matter, because the model and prompt live on the **server**: Render picks them up on redeploy, and old CLIs still benefit.

**⚠ Publishing gotcha (verified):** `package.json` has no `"files"` field and the repo has no `.npmignore`, so npm falls back to `.gitignore`, which excludes `dist/`. Running `npm pack --dry-run` today gives:
```
npm warn gitignore-fallback No .npmignore file found, using .gitignore for file exclusion.
Tarball Contents: README.md, package.json, src/*.ts, test-rate-limit.js, tsconfig.json
total files: 11          ← no dist/ → the `readme-ai` bin would be missing!
```
The live 1.0.4 has 39 files, so it *did* include `dist/`. It was probably published from a different environment, such as Replit. **Before you publish again, add this to `package.json`:**
```json
"files": ["dist", "README.md"],
"scripts": { "prepublishOnly": "npm run build", ... }
```
When `files` is present, npm ships only those paths, plus `package.json`, which is always included. `prepublishOnly` guarantees a fresh build.

**Step-by-step publish:**
```bash
npm login                     # once; must be the npm user that owns the @catmeow scope
npx tsc --noEmit              # sanity check
npm version patch             # 1.0.4 → 1.0.5, updates package.json AND creates a git commit + tag
                              # (use `minor` for features, `major` for breaking changes)
npm run build                 # (automatic if prepublishOnly is added)
npm pack --dry-run            # VERIFY dist/cli.js is listed
npm publish --access public   # --access public is required for scoped packages' first publish
git push && git push --tags
```
Then test it like a user would: `npx @catmeow/readme-ai@latest --help`.

Also update `.version("1.0.0")` in `cli.ts`, or better, read it from `package.json` (see §13).

**If you publish something broken:** you can't overwrite a version. Publish a new patch, or run `npm deprecate @catmeow/readme-ai@1.0.5 "broken, use 1.0.6"`. `npm unpublish` only works within 72 hours and has restrictions.

### 10.2 Deploying the backend on Render

The repo has **no Render config file** (no `render.yaml`), so the service was set up by hand in Render's dashboard. The settings below are **inferred** from how the code works. Check them in your Render dashboard:

| Render setting | Value |
|---|---|
| Service type | Web Service |
| Repo / branch | this GitHub repo, `main` |
| Runtime | Node |
| Build command | `npm install && npm run build` (or the pnpm equivalent) |
| Start command | `npm run start:server` (= `node dist/server.js`) |
| Environment variable | `GOOGLE_GENERATIVE_AI_API_KEY` = your key |
| `PORT` | Set automatically by Render. The code reads `process.env.PORT`. |
| Health check path | `/health` (optional) |
| Auto-deploy | Typically on: every push to `main` redeploys |

**What happens on deploy:** Render clones the repo, runs the build command (which needs devDependencies for `tsc`), then runs the start command. In production `dotenv` finds no `.env` file (it's git-ignored). That's fine, because the key comes from Render's environment.

**Free tier behavior:** the instance **sleeps after about 15 minutes idle**. The next request wakes it, which takes 20–60 s. The live `/health` took **22 s** to answer when tested. A sleep also **resets the in-memory rate limiter**.

**Why `trust proxy` matters on Render:** without it, `req.ip` would be Render's proxy IP, and **all users worldwide would share one 10-request bucket**.

**Checking production:**
```bash
curl https://readme-ai-backend.onrender.com/health
```
The server's `console.log` lines (`📥`, `✅`, `🚫`, `Gemini Error`) appear in the Render dashboard → Logs.

---

## 11. Project history (git timeline)

| Date | Commits | What changed |
|---|---|---|
| 2025-11-04 | `80d6dd3` … `06473b9` "final 1.0" | Created on Replit: analyzer, Gemini service, generator, original CLI that took `--api-key`. Package renamed a few times and published as `@catmeow/readme-ai` 1.0.0. |
| 2025-11-07 | `940998f` (PR #1 by ssk090, merged `e3a9eb4`) | **Big architecture change:** removed the API key from the CLI, added `server.ts` (Express + rate limit), `test-rate-limit.js`, pnpm lock file. |
| 2025-11-09 | `1e486a7` "url update" … `3d5e0ed` | Pointed CLI at the Render URL, README polish, version bumps up to **1.0.4 (last npm publish)**. |
| 2025-12-08 → 12-14 | "model change", "MODEL TWICK" | Iterated on which Gemini model to use, ending on `gemini-2.5-flash`. |
| 2026-07-18 | `577c495` | Added the `clean` script, verbose Gemini error logging. |
| 2026-07-22 | `175934f`, `a9151d0` | Rewrote `buildPrompt` into the structured role/principles/structure prompt. |

---

## 12. Known bugs and limitations (with fixes)

These are great answers to "what would you improve?". Items marked ✔ were reproduced while writing this guide.

| # | Problem | Where | Fix |
|---|---|---|---|
| 1 ✔ | Importing the library (`require("@catmeow/readme-ai")`) **kills the process** without the env var, because `index.ts` re-exports `server`, whose top-level code calls `process.exit(1)` | `index.ts:4`, `server.ts:18-23` | Remove the `server` export, or move the key check inside `require.main === module` |
| 2 ✔ | `npm publish` from this repo would ship **no `dist/`**, so the command breaks | `package.json` | Add `"files": ["dist"]` and `prepublishOnly` |
| 3 | Projects with **no JS/TS/Python files** (Go, Rust, Java…) send `sampleCode: ""` → server returns 400 → the CLI fails | `analyzer.getSampleCode`, `server.ts:65` | Widen the sample patterns to match `scanFiles`, and/or check `typeof sampleCode !== "string"` instead of `!sampleCode` |
| 4 ✔ | Shallow validation: a `projectInfo` missing `languages`/`dependencies` crashes `buildPrompt` → 500 instead of 400 | `server.ts`, `gemini-service.ts` | Validate with `zod`, or default the arrays (`?? []`) |
| 5 ✔ | `--version` prints `1.0.0` while the package is `1.0.4`; the `--server` help text says the default is localhost | `cli.ts:34,38` | `require("../package.json").version`; fix the help string |
| 6 ✔ | Invalid requests (400s) count toward the 10/15-min limit | `server.ts:52` | Use `skipFailedRequests`, or validate before the limiter |
| 7 | The rate limit is in memory: it resets on restart or sleep and isn't shared across instances | `server.ts` | Use a Redis store (`rate-limit-redis`) |
| 8 | **Overwrites an existing README.md without asking** | `cli.ts:98-99` | Prompt, back up to `README.old.md`, or add `--output`/`--force` flags |
| 9 | The CLI shows only `errorData.error`, hiding the useful `message` | `cli.ts:85-87` | Print `errorData.message` when present |
| 10 | The server returns raw internal error messages (provider, model, Google error JSON) to clients | `server.ts:100-103` | Log the details server-side; send a generic message |
| 11 | `ProjectType.WEB` can never be detected (`.html`/`.css` aren't scanned) | `analyzer.ts:34,173` | Add `html,css` to the scan patterns |
| 12 | `package.json` read twice; steps run sequentially | `analyzer.ts` | Read once, pass the result in; use `Promise.all` |
| 13 | Sample code = the **first 3 files in glob order** (on this repo it picked a test script); `getSampleCode` doesn't ignore `venv/` or `build/` | `analyzer.ts:201-228` | Prioritize entry points (`index.*`, `main.*`, `app.*`, files named in `package.json` `main`/`bin`), reuse the same ignore list |
| 14 | `requirements.txt` parsing ignores `~=`, `<`, `!=`, extras, `-r` | `analyzer.ts:110-111` | Split on the regex `/[<>=!~\[;\s]/` |
| 15 | No timeout on `fetch` or the Gemini call. A hung request hangs the CLI | `cli.ts`, `gemini-service.ts` | `fetch(url, { signal: AbortSignal.timeout(120_000) })` |
| 16 | The model sometimes wraps its output in ```` ```markdown ```` fences | `gemini-service.ts` | Strip a leading/trailing fence before returning |
| 17 | `@google/generative-ai` is deprecated by Google | `package.json` | Migrate to `@google/genai` |
| 18 | Server-only dependencies get installed for every CLI user | `package.json` | Split into two packages, or move them to a separate server `package.json` |
| 19 | Two lock files (npm + pnpm) can drift apart | repo root | Delete one; set `"packageManager"` in package.json |
| 20 | `private model: any`, `options: any`, unused `ReadmeSection`, unused `message` in limiter config | various | Tighten types, delete dead code |
| 21 | Privacy: the first 30 lines of 3 files go to a third-party server and then to Google. Hard-coded secrets in that code would leak | design | Document it in the README; skip files matching secret patterns; add a `--dry-run` that shows what would be sent |
| 22 | No automated tests or CI | repo | §9 tests + a GitHub Actions workflow |

---

## 13. How to extend the project (recipes)

**Golden loop for any change:** edit `src/*.ts` → `npx tsc --noEmit` → `npm run dev:server` + `node dist/cli.js <folder> --server http://localhost:3001` → commit. Then, depending on what changed: redeploy the server (push to `main`), and/or publish to npm (§10.1).

### Recipe A: Read the version from package.json
```ts
// cli.ts
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { version } = require("../package.json");   // dist/cli.js → ../package.json
program.version(version);
```
`require` is used instead of `import` because `package.json` sits outside `rootDir: ./src`, and `import` would make `tsc` complain.

### Recipe B: Add `--output` and `--dry-run` flags
```ts
program
  .option("-o, --output <file>", "Output file name", "README.md")
  .option("--dry-run", "Print what would be sent to the server and exit");

// inside .action(async (targetPath, options) => {
if (options.dryRun) {                       // commander camelCases --dry-run → dryRun
  console.log(JSON.stringify({ projectInfo, sampleCode }, null, 2));
  return;
}
const readmePath = path.join(resolvedPath, options.output);
```
CLI-only change → **npm publish** needed; no server deploy.

### Recipe C: Don't overwrite an existing README
```ts
.option("-f, --force", "Overwrite existing README.md")
...
if ((await fs.pathExists(readmePath)) && !options.force) {
  await fs.copy(readmePath, readmePath.replace(/\.md$/, ".backup.md"));
  console.log(chalk.yellow("Existing README backed up to README.backup.md"));
}
```

### Recipe D: Support a new language (e.g. Kotlin)
1. `analyzer.ts` → add `kt` to the `scanFiles` pattern `{js,ts,...,kt}`.
2. Add `'.kt': 'Kotlin'` to `languageMap`.
3. Add `kt` to the `getSampleCode` pattern, so Kotlin-only projects don't get a 400.
4. Optionally add a `ProjectType.KOTLIN = 'Kotlin'` in `types.ts`, plus a rule in `detectProjectType` (e.g. `build.gradle.kts` exists).

### Recipe E: Add a new framework type (e.g. Svelte)
`types.ts`: `SVELTE = 'Svelte'`. `analyzer.ts`, in `detectProjectType` before the `react` check: `if (deps['svelte']) return ProjectType.SVELTE;`. Client-only → publish.

### Recipe F: Change the AI model or prompt
Edit `gemini-service.ts` (`model: '...'` or `buildPrompt`). **Server-only → push to main, Render redeploys, every user gets it instantly. No npm publish needed.** Even better, make the model configurable:
```ts
this.model = this.genAI.getGenerativeModel({ model: process.env.GEMINI_MODEL || 'gemini-2.5-flash' });
```

### Recipe G: Add a new endpoint (e.g. generate a description only)
```ts
// server.ts
app.use("/api/describe", limiter);
app.post("/api/describe", async (req, res) => {
  const { projectInfo } = req.body;
  if (!projectInfo) return res.status(400).json({ error: "projectInfo is required" });
  try {
    const text = await new GeminiService(apiKey).generateDescription(projectInfo); // add this method
    res.json({ success: true, description: text });
  } catch (e) { res.status(500).json({ error: "Failed" }); }
});
```
`express-rate-limit` keeps a **separate counter per limiter instance**, but because the same `limiter` object is mounted on both paths, they share a count. Create a second `rateLimit({...})` if you want separate limits.

### Recipe H: Fix the library-import crash (bug #1)
```ts
// index.ts: delete:  export { default as server } from './server';
```
Or, in `server.ts`, move the `apiKey` check and `process.exit` inside `if (require.main === module) { ... }`.

### Recipe I: Add CI (GitHub Actions)
`.github/workflows/ci.yml`:
```yaml
name: CI
on: [push, pull_request]
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 20 }
      - run: npm ci
      - run: npx tsc --noEmit
      - run: npm test --if-present
```
`npm ci` is a clean, exact install from `package-lock.json`. It's meant for CI.

### Recipe J: Stream the response (advanced)
Use `model.generateContentStream(prompt)` on the server and pipe chunks through `res.write()`. On the CLI, read `response.body` incrementally so the user sees text appear. This is a good stretch feature to talk about.

---

## 14. Interview Q&A bank

**Q1. Explain the project in a minute.**
See the §1 pitch. Hit four points: npm CLI, analyzer, Express backend holding the key, Gemini, rate limiting.

**Q2. Why have a backend at all? Why not call Gemini from the CLI?**
Anything in an npm package is public, so an embedded key would leak and be abused. The backend keeps the key secret, removes setup for users, centralizes rate limiting and cost control, and lets me change the model or prompt without users upgrading. The first version did call Gemini directly with a user-supplied `--api-key`. `generator.ts` is that legacy path.

**Q3. How does the analyzer detect the project type?**
If there's a `package.json`, it merges dependencies and devDependencies and checks in priority order: `next` → `react` → `vue` → `@angular/core` → `typescript` → otherwise Node.js. Next comes before React because Next apps also depend on React. Without a `package.json`, it falls back to `requirements.txt` for Python, then file extensions.

**Q4. How do you keep the prompt small and cheap?**
Hard limits at every stage: 100 files, a 50-entry tree to depth 3, 3 sample files × 30 lines, 20 dependencies, and sample code capped at 3000 characters. Heavy folders like `node_modules`, `dist`, `.git`, and `venv` are ignored. Tokens cost money and latency, so a sample is enough for the model to infer purpose.

**Q5. How did you design the prompt?**
A role ("senior technical writer"), grounded project facts, explicit anti-hallucination rules ("never invent features; omit instead of guessing"), a required section order, style rules, and "Return ONLY the README.md" to avoid chatty preambles.

**Q6. How does rate limiting work? Its weaknesses?**
`express-rate-limit` middleware on `/api/generate`: 10 requests per 15-minute window per IP, returning 429 with a `retryAfter`, plus standard `RateLimit-*` headers. Weaknesses: the count lives in memory, so it resets on restart and isn't shared across instances (Redis fixes that). IP-based limits are unfair behind shared NATs and easy to dodge with many IPs. And failed requests count too.

**Q7. What does `app.set("trust proxy", 1)` do?**
On Render, traffic comes through a reverse proxy, so the socket IP is the proxy's. Trusting one hop makes Express use the client IP from `X-Forwarded-For`. Without it, everyone would share one rate-limit bucket. Trusting *too many* hops would let clients spoof their IP.

**Q8. What's the middleware order and why?**
CORS → JSON body parser (10 MB limit) → request logger → rate limiter → handler. Logging comes before limiting so blocked requests are still logged. Limiting comes before the handler so blocked requests never reach Gemini.

**Q9. What does `require.main === module` do?**
It's true only when the file is executed directly. The server calls `listen()` only then, so tests can import `app` and use supertest without opening a port.

**Q10. How does a user's `npx` command end up running your code?**
`npx` fetches the package, reads `"bin": {"readme-ai": "dist/cli.js"}`, and runs that file. The `#!/usr/bin/env node` shebang tells the OS to use Node.

**Q11. Why TypeScript? How is it built?**
Type safety across the shared shapes (`ProjectInfo`), plus better editor support. `tsc` compiles `src` to `dist` as CommonJS ES2020, with `.d.ts` types and source maps. `strict` mode is on.

**Q12. Why chalk v4 and not v5?**
Chalk 5 is pure ESM. This project compiles to CommonJS, which can't `require()` an ESM-only package. Version 4 supports CommonJS.

**Q13. How do you handle errors in the CLI?**
Non-2xx responses: parse the JSON error (falling back to `statusText`), with a special message for 429. Network failures: Node's fetch throws "fetch failed", which I detect to print "Could not connect to server" and troubleshooting tips. Everything exits with code 1 so scripts can tell it failed.

**Q14. How do you handle errors on the server?**
400 for missing fields, 429 from the limiter, and try/catch around the Gemini call that logs details and returns 500. The key is checked at startup (fail fast). Improvements: schema validation with zod, and not leaking internal error text to clients.

**Q15. How did you deploy it?**
The CLI goes to npm: bump with `npm version`, build, `npm publish --access public` (scoped package). The backend is a Render web service: build `npm install && npm run build`, start `node dist/server.js`, with the API key as an env var and `PORT` provided by Render. Pushing to main triggers a redeploy.

**Q16. What happens if you change the prompt? Do users need to update?**
No. The prompt and model live on the server, so a Render redeploy updates everyone instantly. Only CLI-side changes (analyzer, flags) need an npm publish.

**Q17. How did you test it?**
Be honest. See §9. Manual verification script, curl, and real runs. Next steps would be Vitest unit tests for the analyzer, supertest API tests with a mocked Gemini service, and CI.

**Q18. Security concerns?**
- The API key stays server-side and `.env` is git-ignored.
- Rate limiting is in place.
- The body size is capped at 10 MB.
- Open CORS is fine for a CLI-only API.
- Privacy: snippets of user code go to my server and Google, so hard-coded secrets could leak. A `--dry-run` flag and secret filtering would help.
- Raw error messages are currently returned to clients.

**Q19. How would you scale it?**
- Move to paid instances to avoid cold starts.
- Run multiple instances with a Redis-backed rate limiter.
- Add request timeouts and retries with backoff for Gemini (429/503).
- Cache results by a hash of the input.
- Use per-user API tokens instead of IP limits.
- Add monitoring.

**Q20. Why fast-glob instead of a recursive `fs.readdir`?**
Glob patterns express "all these extensions, minus these folders" in one line. fast-glob is fast, handles ignore patterns and depth limits, and returns relative paths.

**Q21. Why `fs-extra` over `fs`?**
Promise-based helpers like `pathExists`, `readJson`, and `copy`, with the same API as `fs` otherwise.

**Q22. What's the cold start you'd see?**
Render's free tier sleeps idle services. The first request after a sleep takes 20–60 s (measured 22 s on `/health`), and it also resets the in-memory rate limits.

**Q23. What's one bug you know about?**
Pick #1 (library import exits the process), #3 (non-JS projects get a 400), or #2 (publish would miss `dist/`). Explain the cause and the fix from §12. Interviewers like this.

**Q24. What's the difference between `dependencies` and `devDependencies`?**
`dependencies` are installed for anyone using the package at runtime. `devDependencies` are only for building or testing (TypeScript, `@types/*`) and aren't installed for consumers.

**Q25. Why does the API return `projectInfo` back?**
It's a summary echo (name, type, languages, file count) the client could display or log. The CLI currently ignores it.

**Q26. What does `"declaration": true` give you?**
`.d.ts` files, so TypeScript users of the library get types for `ProjectAnalyzer` and the rest.

**Q27. Why `process.exit(1)` and not `0`?**
Non-zero exit codes tell shells and CI that the command failed.

**Q28. Why is the default server URL hard-coded?**
For the zero-config experience. It can be overridden with `--server` or `README_AI_SERVER_URL` for local development or self-hosting.

**Q29. What would v2 look like?**
- Split the CLI and server into separate packages.
- Migrate to `@google/genai`.
- Stream output.
- Add `--output`, `--force`, and `--dry-run` flags.
- Pick sample files smarter (entry points first).
- Validate with zod, add tests and CI, use a Redis rate limit.
- Support a custom section template.

**Q30. Walk me through what happens when I run it.**
Use the §7 table: npx → commander → analyzer → POST → proxy → middleware chain → Gemini → JSON → write file.

---

## 15. Command cheat sheet and glossary

### Commands
| Command | What it does |
|---|---|
| `npm install` / `pnpm install` | Install dependencies |
| `npm ci` | Clean install exactly from package-lock.json (CI) |
| `npm run build` | Delete `dist/` and compile TypeScript |
| `npx tsc --noEmit` | Type-check without output |
| `npm run dev` | Compile and run the CLI on the current folder (**overwrites ./README.md**) |
| `npm run dev:server` | Compile and start the API on :3001 |
| `npm run start:server` | Start the compiled API (what Render runs) |
| `PORT=4000 npm run start:server` | Start on a different port |
| `node dist/cli.js <dir> --server http://localhost:3001` | CLI → local server |
| `README_AI_SERVER_URL=http://localhost:3001 node dist/cli.js <dir>` | Same, via env var |
| `node dist/cli.js --help` / `--version` | Help / version |
| `curl localhost:3001/health` | Health check |
| `node test-rate-limit.js` | Run the verification script (needs build + server) |
| `npm link` / `npm unlink -g @catmeow/readme-ai` | Install / remove the local build as a global command |
| `npm pack --dry-run` | Preview published files |
| `npm version patch\|minor\|major` | Bump version + git tag |
| `npm publish --access public` | Publish to npm |
| `npm view @catmeow/readme-ai` | See what's live on npm |
| `npx @catmeow/readme-ai [dir]` | Run the published CLI |

### Environment variables
| Variable | Used by | Purpose |
|---|---|---|
| `GOOGLE_GENERATIVE_AI_API_KEY` | server | **Required.** Gemini API key |
| `PORT` | server | Listen port (default 3001; Render sets it) |
| `README_AI_SERVER_URL` | CLI, test script | Override the backend URL |

### Glossary
- **CLI**: command-line interface, a program you run in the terminal.
- **Endpoint**: a URL path + method the server handles (`POST /api/generate`).
- **Middleware**: an Express function that runs before the handler (`(req, res, next)`).
- **Glob**: a file pattern like `**/*.ts`.
- **LLM**: large language model (Gemini).
- **Prompt**: the instruction text sent to an LLM.
- **Token**: a chunk of text that LLMs bill and limit by.
- **Hallucination**: an LLM confidently inventing false details.
- **Cold start**: delay while a sleeping cloud instance boots.
- **Reverse proxy**: a server in front of your app that forwards requests (Render's load balancer).
- **429**: HTTP "Too Many Requests". **400**: "Bad Request". **500**: "Internal Server Error".
- **Shebang**: the `#!/usr/bin/env node` first line that makes a script executable.
- **Transpile/compile**: convert TypeScript to JavaScript (`tsc`).
- **Semver**: `MAJOR.MINOR.PATCH` versioning.
- **Scope**: the `@catmeow/` namespace on npm.
