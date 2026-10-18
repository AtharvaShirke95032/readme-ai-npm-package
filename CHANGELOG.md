# Changelog

## 2.0.0

A ground-up rewrite.

- **Pick your AI:** `--provider gemini | claude | openai | grok | ollama` with your own key, or the free hosted service by default. `--model` and `--quality high` choose the model.
- **Accurate by default:** commands, scripts, environment variables, routes, CLI flags, license and clone URL are read from the code and given to the model as facts. A check pass fixes or repairs anything that doesn't match.
- **Updates instead of overwriting:** the existing README is improved, `<!-- readme-ai:keep -->` sections are kept word for word, a backup is saved, and `--diff` previews the changes.
- **Privacy:** `--dry-run` shows exactly what would be sent; `.env` files and keys are never read; token-shaped values are redacted; `.readmeaiignore` excludes more.
- **Polish:** fact-based badges, a table of contents, dead-link removal, `--style`, `--sections`, `--output`, and a `.readmeairc.json` config file.
- **Live output:** the README streams into the terminal as it is written.
- **Smaller install:** zero runtime dependencies (everything is bundled).
- **Server:** streaming API, per-IP and daily limits, request validation, and a compatibility endpoint for 1.x clients.
- Requires Node.js 20 or newer.
