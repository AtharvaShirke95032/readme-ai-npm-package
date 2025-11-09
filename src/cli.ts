#!/usr/bin/env node

import { Command } from "commander";
import chalk from "chalk";
import * as path from "path";
import * as fs from "fs-extra";
import { ProjectAnalyzer } from "./analyzer";

interface ApiErrorResponse {
  error: string;
  message?: string;
  retryAfter?: string;
}

interface ApiSuccessResponse {
  success: true;
  readme: string;
  projectInfo: {
    name: string;
    type: string;
    languages: string[];
    fileCount: number;
  };
}

const program = new Command();

const DEFAULT_SERVER_URL = "http://localhost:3001";

program
  .name("readme-ai")
  .description("AI-powered README generator for your projects")
  .version("1.0.0")
  .argument("[path]", "Path to the project directory", ".")
  .option(
    "-s, --server <url>",
    "Server URL (default: http://localhost:3001 or README_AI_SERVER_URL env)",
    process.env.README_AI_SERVER_URL || DEFAULT_SERVER_URL
  )
  .action(async (targetPath: string, options: any) => {
    try {
      const serverUrl =
        options.server ||
        process.env.README_AI_SERVER_URL ||
        DEFAULT_SERVER_URL;
      const resolvedPath = path.resolve(targetPath);

      console.log(chalk.bold.blue("\n🚀 README-AI Generator\n"));
      console.log(chalk.gray(`Target directory: ${resolvedPath}`));
      console.log(chalk.gray(`Server: ${serverUrl}\n`));

      console.log(chalk.blue("🔍 Analyzing project..."));

      const analyzer = new ProjectAnalyzer(resolvedPath);
      const projectInfo = await analyzer.analyze();
      console.log(chalk.green(`✓ Found ${projectInfo.files.length} files`));
      console.log(chalk.green(`✓ Detected project type: ${projectInfo.type}`));
      console.log(
        chalk.green(`✓ Languages: ${projectInfo.languages.join(", ")}`)
      );

      console.log(chalk.blue("\n🤖 Generating README with AI..."));

      const sampleCode = await analyzer.getSampleCode();

      const response = await fetch(`${serverUrl}/api/generate`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          projectInfo,
          sampleCode,
        }),
      });

      if (!response.ok) {
        const errorData = (await response
          .json()
          .catch(() => ({ error: response.statusText }))) as ApiErrorResponse;
        if (response.status === 429) {
          throw new Error("Rate limit exceeded. Please try again later.");
        }
        throw new Error(
          errorData.error || `Server error: ${response.statusText}`
        );
      }

      const data = (await response.json()) as ApiSuccessResponse;

      if (!data.success || !data.readme) {
        throw new Error("Failed to generate README from server");
      }

      console.log(chalk.blue("\n📝 Writing README.md..."));

      const readmePath = path.join(resolvedPath, "README.md");
      await fs.writeFile(readmePath, data.readme, "utf-8");

      console.log(
        chalk.green(`\n✅ README.md created successfully at: ${readmePath}`)
      );
      console.log(chalk.cyan("\n📄 Preview:"));
      console.log(chalk.gray("─".repeat(50)));
      console.log(data.readme.split("\n").slice(0, 15).join("\n"));
      console.log(chalk.gray("─".repeat(50)));

      console.log(chalk.green.bold("\n🎉 Done!\n"));
    } catch (error) {
      if (error instanceof Error && error.message.includes("fetch")) {
        console.error(chalk.red("\n❌ Error: Could not connect to server."));
        console.log(chalk.yellow("\nMake sure the server is running:"));
        console.log(chalk.cyan("  pnpm start:server"));
        console.log(chalk.cyan("  or"));
        console.log(chalk.cyan("  pnpm dev:server"));
        console.log(
          chalk.gray(
            "\nOr set README_AI_SERVER_URL environment variable to point to a hosted server."
          )
        );
      } else {
        console.error(
          chalk.red(
            `\n❌ Error: ${error instanceof Error ? error.message : error}`
          )
        );
      }
      process.exit(1);
    }
  });

program.parse();
