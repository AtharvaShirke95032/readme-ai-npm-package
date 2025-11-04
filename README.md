# readme-ai 🚀

AI-powered README generator that analyzes your project and creates comprehensive documentation automatically using Google's Gemini AI.

## Features

- **Automatic Project Analysis** - Scans your codebase to understand structure, dependencies, and languages
- **AI-Powered Generation** - Uses Google Gemini AI to create comprehensive, professional README files
- **Smart Detection** - Automatically identifies project type (Node.js, Python, React, etc.)
- **One Command** - Simple CLI tool that works with `npx`
- **No Installation Required** - Run directly with npx
- **Customizable** - Supports different project directories and API key configurations

## Installation

No installation needed! Use with `npx`:

```bash
npx @catmeow/readme-ai
```

Or install globally:

```bash
npm install -g @catmeow/readme-ai
```

## Usage

### Basic Usage

Generate a README for the current directory:

```bash
npx @catmeow/readme-ai
```

### Specify a Directory

Generate a README for a specific project:

```bash
npx @catmeow/readme-ai /path/to/your/project
```

### API Key Configuration

You need a Google Gemini API key. Get one free at: https://makersuite.google.com/app/apikey

**Option 1: Environment Variable (Recommended)**

```bash
export GEMINI_API_KEY="your-api-key-here"
npx @catmeow/readme-ai
```

**Option 2: CLI Flag**

```bash
npx @catmeow/readme-ai --api-key your-api-key-here
```

## What Gets Generated

The tool creates a comprehensive README.md with:

- Project title and description
- Key features list
- Technology stack overview
- Installation instructions
- Usage examples
- Project structure overview
- Configuration details
- Contributing guidelines
- License information

## How It Works

1. **Scans** your project files and structure
2. **Analyzes** dependencies, languages, and code patterns
3. **Generates** professional documentation using AI
4. **Creates** README.md in your project root

## Requirements

- Node.js 16 or higher
- Google Gemini API key

## Tech Stack

- TypeScript
- Google Gemini AI (gemini-2.0-flash)
- Commander.js (CLI framework)
- fast-glob (file scanning)
- Chalk (colored output)

## Example Output

When you run `readme-ai`, you'll see:

```
🚀 README-AI Generator

Target directory: /path/to/project

🔍 Analyzing project...
✓ Found 45 files
✓ Detected project type: React
✓ Languages: TypeScript, JavaScript

🤖 Generating README with AI...

📝 Writing README.md...

✅ README.md created successfully!
```

## Development

Build the project:

```bash
npm run build
```

Run locally:

```bash
npm run dev
```

## License

MIT

## Contributing

Contributions welcome! Feel free to open issues or submit pull requests.
