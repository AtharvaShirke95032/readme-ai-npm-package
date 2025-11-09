```markdown
# @catmeow/readme-ai 🚀

A CLI tool and library to automatically generate README.md files for your projects using AI.

## Features ⚡

-   **Automated README Generation:** Automatically creates a comprehensive README file based on your project's structure and code.
-   **AI-Powered:** Leverages the power of Google Gemini AI to understand your project and generate relevant content.
-   **Customizable:** Easily configure the tool to fit your specific needs.
-   **CLI and Library:** Use it as a command-line tool or integrate it directly into your JavaScript/TypeScript projects.
-   **Language Detection:** Automatically detects the programming languages used in your project.
-   **Dependency Extraction:** Identifies and lists project dependencies.
-   **Project Structure Analysis:** Analyzes the project's file structure to provide a clear overview.
-   **Supports TypeScript Projects:** Specifically designed and optimized for TypeScript projects.

## Tech Stack 📦

-   **TypeScript:** Primary language for development.
-   **@google/generative-ai:** Google's Generative AI SDK for generating README content.
-   **chalk:** For colorful console output.
-   **commander:** For building the command-line interface.
-   **cors:** For enabling Cross-Origin Resource Sharing (CORS) in the server.
-   **express:** For creating a simple web server (optional).
-   **express-rate-limit:** For rate-limiting API requests to prevent abuse.
-   **fast-glob:** For efficient file system scanning.
-   **fs-extra:** For enhanced file system operations.

## Installation

1.  **Install via npm or yarn:**

    ```bash
    npm install -g @catmeow/readme-ai
    # or
    yarn global add @catmeow/readme-ai
    # or
    pnpm add -g @catmeow/readme-ai
    ```

2.  **Install as a dev dependency:**

    ```bash
    npm install -D @catmeow/readme-ai
    # or
    yarn add -D @catmeow/readme-ai
    # or
    pnpm add -D @catmeow/readme-ai
    ```

## Usage

### CLI

1.  **Run the CLI tool:**

    ```bash
    readme-ai generate
    ```

    This command will analyze your project in the current directory and generate a `README.md` file.

2.  **Specify a target directory:**

    ```bash
    readme-ai generate --path /path/to/your/project
    ```

3.  **Configure with API Key:**

   You must set the `GEMINI_API_KEY` environment variable.

   ```bash
   export GEMINI_API_KEY="YOUR_API_KEY"
   ```

   Or you can pass it as a command-line argument:

   ```bash
   readme-ai generate --api-key YOUR_API_KEY
   ```

4.  **Run a local server (optional):**

    You can run a local server to generate README files via API calls.

    ```bash
    readme-ai server
    ```

    The server will run on `http://localhost:3001` by default.

### Library

1.  **Import the `ProjectAnalyzer` class:**

    ```typescript
    import { ProjectAnalyzer } from '@catmeow/readme-ai';

    async function generateReadme() {
      const analyzer = new ProjectAnalyzer('/path/to/your/project');
      const projectInfo = await analyzer.analyze();
      // Use projectInfo to generate your README content
      console.log(projectInfo);
    }

    generateReadme();
    ```

## Project Structure

```
@catmeow/readme-ai/
├── README.md            # This file
├── package-lock.json    # npm lockfile
├── package.json         # Project metadata and dependencies
├── pnpm-lock.yaml       # pnpm lockfile
├── src/                 # Source code directory
│   ├── analyzer.ts      # Analyzes the project structure and extracts information
│   ├── cli.ts           # Command-line interface logic
│   ├── gemini-service.ts # Interacts with the Google Gemini AI API
│   ├── generator.ts     # Generates the README content (currently a placeholder)
│   ├── index.ts         # Main entry point for the library
│   ├── server.ts        # Simple Express server for API access (optional)
│   └── types.ts         # Defines TypeScript interfaces and types
├── tsconfig.json        # TypeScript configuration file
```

## Configuration

-   **`GEMINI_API_KEY`**:  Your Google Gemini API key.  Required for using the AI-powered features.  You can obtain an API key from the Google AI Studio.

## Contributing

Contributions are welcome!  Please follow these guidelines:

1.  Fork the repository.
2.  Create a new branch for your feature or bug fix.
3.  Write tests for your code.
4.  Submit a pull request.

## License

MIT License

Copyright (c) 2024 catmeow

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```