# readme-ai

[![npm version](https://img.shields.io/npm/v/@catmeow/readme-ai)](https://www.npmjs.com/package/@catmeow/readme-ai)
[![CI](https://github.com/AtharvaShirke95032/readme-ai-npm-package/actions/workflows/ci.yml/badge.svg)](https://github.com/AtharvaShirke95032/readme-ai-npm-package/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
![Node.js](https://img.shields.io/badge/node-%3E%3D20-339933?logo=node.js&logoColor=white)

One command reads your project and writes an accurate, polished `README.md`. It runs on a free hosted service with no setup, or on your own Gemini, Claude, OpenAI or Grok key, or fully offline with Ollama.

```bash
npx @catmeow/readme-ai
```

## Why it's different

Most README generators paste some code into a model and hope. readme-ai collects the facts first, then checks the result against them:

- **Facts come from your code, not from the model.** It reads your scripts (`package.json`, `Makefile`, `pyproject.toml`, `Cargo.toml`, `go.mod` and more), package manager, environment variables, HTTP routes, CLI flags, license, Docker and CI setup, and your git remote.
- **Every command is checked.** If the README says `npm run seed` and there is no `seed` script, the model is asked to fix it. Wrong package managers and clone URLs are fixed automatically.
- **Your README is updated, not replaced.** Accurate content and hand-written sections survive, and the old file is backed up.

## Quick start

```bash
# In your project folder
npx @catmeow/readme-ai

# Another folder, previewing the changes before saving
npx @catmeow/readme-ai ../api-server --diff
```

```
readme-ai v2.0.0

Scanning ~/my-app
  ✓ 214 files, 38 picked for context (~41k tokens)
  ✓ Type: Next.js · React · Prisma · TypeScript
  ✓ Facts: 6 scripts, 4 env vars, MIT license, github.com/me/my-app

Writing README (hosted · gemini-3.8-flash)
  # My App
  A Next.js dashboard for tracking team invoices…        ← streams live

Checking
  ✓ 12 commands checked against the project
  ↻ `npm run dev` → `pnpm dev`
  ✓ 9 of 9 links resolve

✔ README.md updated (old version saved to README.backup.md) in 6.2s
```

Requires Node.js 20 or newer. Works for JavaScript/TypeScript, Python, Go, Rust, Java/Kotlin, Ruby, PHP, C# and mixed projects.

## Choose your AI

| Option | Command | Key needed |
| --- | --- | --- |
| Free hosted service (default) | `npx @catmeow/readme-ai` | No |
| Hosted, stronger model | `--quality high` | No (lower limit) |
| Gemini | `--provider gemini` | `GEMINI_API_KEY` ([get one](https://aistudio.google.com/apikey)) |
| Claude | `--provider claude` | `ANTHROPIC_API_KEY` ([get one](https://console.anthropic.com/settings/keys)) |
| OpenAI | `--provider openai` | `OPENAI_API_KEY` ([get one](https://platform.openai.com/api-keys)) |
| Grok | `--provider grok` | `XAI_API_KEY` ([get one](https://console.x.ai)) |
| Ollama, local | `--provider ollama` | No |

```bash
export ANTHROPIC_API_KEY=sk-ant-...
npx @catmeow/readme-ai --provider claude --quality high
npx @catmeow/readme-ai --provider openai --model gpt-5.4
```

With your own key, requests go straight from your machine to the provider. They never touch the readme-ai server and have no rate limit. Default models live in [`src/core/providers/models.ts`](src/core/providers/models.ts), and any model can be picked with `--model`.

The free hosted service allows 10 READMEs per 15 minutes per IP address (3 per hour with `--quality high`).

## Updating an existing README

readme-ai improves the README you already have: it keeps what is accurate and your own details (motivation, credits, links), and fixes what is outdated. `README.backup.md` is written before anything changes.

To lock a section so it comes back word for word:

```markdown
<!-- readme-ai:keep -->
## Acknowledgements
Thanks to everyone who tested the beta.
<!-- /readme-ai:keep -->
```

| Want | Flag |
| --- | --- |
| See a colored diff and confirm before saving | `--diff` |
| Ignore the current README and start over | `--fresh` |
| Overwrite without a backup | `--force` |
| Never ask questions (CI) | `--yes` |

## Privacy

```bash
npx @catmeow/readme-ai --dry-run     # shows every file and fact that would be sent, sends nothing
npx @catmeow/readme-ai --provider ollama    # nothing leaves your machine
```

- `.env` files, private keys, certificates and credential files are never read.
- Token-shaped values (API keys, AWS keys, GitHub tokens, JWTs, `password = "..."`) in other files are replaced with `[REDACTED]` before sending.
- `.gitignore` is respected. Add a `.readmeaiignore` (same syntax) to leave out more.

## Output and polish

Every README gets badges backed by real facts (license, CI, Node or Python version, and npm or PyPI version once published), a table of contents when it has 5 or more sections, and a link check that removes links returning 404.

```bash
npx @catmeow/readme-ai --style minimal          # short and plain
npx @catmeow/readme-ai --style detailed         # adds architecture, API reference, troubleshooting
npx @catmeow/readme-ai --sections features,install,usage,api
npx @catmeow/readme-ai --output docs/README.md
npx @catmeow/readme-ai --no-badges --no-toc --no-link-check
```

Section names for `--sections`: `features`, `tech-stack`, `prerequisites`, `installation`, `getting-started`, `configuration`, `usage`, `scripts`, `project-structure`, `api`, `architecture`, `testing`, `deployment`, `docker`, `faq`, `troubleshooting`, `contributing`, `license`.

## Config file

Save your preferences in `.readmeairc.json` at the project root. Command-line flags still win.

```json
{
  "provider": "claude",
  "quality": "high",
  "style": "detailed",
  "sections": ["features", "installation", "usage", "configuration", "contributing", "license"],
  "badges": true,
  "toc": true,
  "linkCheck": true,
  "ignore": ["internal/", "*.sql"]
}
```

Other keys: `model`, `output`, `server`, `contextTokens`.

## All options

| Flag | Description | Default |
| --- | --- | --- |
| `[path]` | Project folder | `.` |
| `-p, --provider <name>` | `hosted`, `gemini`, `claude`, `openai`, `grok`, `ollama` | `hosted` |
| `-m, --model <id>` | Model for that provider | provider default |
| `-q, --quality <level>` | `fast` or `high` | `fast` |
| `-s, --style <style>` | `minimal`, `standard`, `detailed` | `standard` |
| `--sections <list>` | Only these sections, in this order | all relevant |
| `-o, --output <file>` | Where to write | `README.md` |
| `--diff` | Show changes and ask before saving | off |
| `--dry-run` | Show what would be sent, then stop | off |
| `--fresh` | Ignore the existing README | off |
| `--force` | Overwrite without a backup | off |
| `-y, --yes` | Don't ask questions | off |
| `--server <url>` | Self-hosted readme-ai server | hosted URL |
| `--no-badges`, `--no-toc`, `--no-link-check` | Turn off polish steps | on |
| `--verbose` | List every selected file and the extracted facts | off |
| `-v, --version`, `-h, --help` | Version, help | |

| Environment variable | Used for |
| --- | --- |
| `GEMINI_API_KEY`, `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `XAI_API_KEY` | Your own provider key |
| `OLLAMA_HOST` | Ollama on another port or machine (default `127.0.0.1:11434`) |
| `README_AI_SERVER_URL` | Self-hosted backend |

## Use it from code

```ts
import { generateReadme } from '@catmeow/readme-ai';

const { readme, warnings } = await generateReadme('./my-project', {
  provider: 'gemini',
  style: 'detailed',
  onText: (chunk) => process.stdout.write(chunk),
});
```

`generateReadme` returns the Markdown and never writes to disk. `prepare` and `generate` are exported for finer control.

## How it works

```
scan ─► facts ─► select context ─► model (streamed) ─► check ─► repair ─► links ─► badges + TOC ─► write
```

1. **Scan** (`src/core/scan`): walks the project, honoring `.gitignore`, skipping build output, lockfiles, binaries and secrets.
2. **Facts** (`src/core/facts`): parses manifests and task runners, finds env vars, routes and CLI flags in the code, and reads the license, git remote, Docker and CI config.
3. **Context** (`src/core/scan/select.ts`): ranks files (manifests and entry points first, tests and fixtures last) and packs them into a token budget, trimming long files.
4. **Generate** (`src/core/providers`): streams from the chosen provider using plain `fetch`, no SDKs.
5. **Check and repair** (`src/core/post/verify.ts`): fixes what can be fixed safely, then sends the remaining problems back to the model once.
6. **Polish** (`src/core/post`): restores protected sections, removes dead links, adds badges and a table of contents.

## Self-hosting the API

The hosted service is the `server/` folder: a small [Hono](https://hono.dev) app with streaming responses, per-IP and daily limits, and request validation.

```bash
cp .env.example .env      # add GEMINI_API_KEY (and optionally ANTHROPIC_API_KEY)
npm install
npm run dev:server        # http://localhost:3001
npx @catmeow/readme-ai --server http://localhost:3001
```

| Variable | Description | Default |
| --- | --- | --- |
| `GEMINI_API_KEY` | Key for the default fast tier (`GOOGLE_GENERATIVE_AI_API_KEY` also works) | required |
| `ANTHROPIC_API_KEY` | Enables Claude for `--quality high` | optional |
| `FAST_PROVIDER` / `FAST_MODEL` | Provider and model for normal requests | `gemini` / `gemini-3.8-flash` |
| `HIGH_PROVIDER` / `HIGH_MODEL` | Provider and model for `--quality high` | `claude` if its key is set |
| `RATE_LIMIT` / `RATE_WINDOW_MINUTES` | Requests per IP per window | `10` / `15` |
| `HIGH_RATE_LIMIT` | High-quality requests per IP per hour | `3` |
| `DAILY_LIMIT` | Total generations per day, to cap spending | `1000` |
| `PORT`, `TRUST_PROXY` | Port; read client IP from `X-Forwarded-For` | `3001`, `true` |

Deploy to Render with the included [`render.yaml`](render.yaml) blueprint, or anywhere that runs Node 20+: build with `npm run build:server`, start with `node build/server.js`. `GET /health` reports status and the active models.

## Development

```bash
npm install
npm run dev -- ../some-project --dry-run    # run the CLI from source
npm test                                    # vitest
npm run typecheck
npm run build                               # dist/ (CLI + library) and build/ (server)
```

| Path | Purpose |
| --- | --- |
| `src/cli/` | Command-line interface: flags, config file, terminal output, diff |
| `src/core/scan/` | File walking, secret filtering, context selection, file tree |
| `src/core/facts/` | Manifest parsers, env/route/flag extraction, license, git, Docker, CI |
| `src/core/prompt/` | Prompt construction and protected-section handling |
| `src/core/providers/` | Gemini, Claude, OpenAI, Grok, Ollama and hosted clients |
| `src/core/post/` | Cleanup, fact checking, link checking, badges, table of contents |
| `server/` | Hosted API (Hono) |
| `test/` | Unit and integration tests |

All runtime libraries are bundled at build time, so the published package has zero dependencies.

## Contributing

Issues and pull requests are welcome. Please run `npm run typecheck && npm test` before opening a PR, and add a test for any new fact extractor or check.

## License

[MIT](LICENSE)
