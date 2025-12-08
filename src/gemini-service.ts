import { GoogleGenerativeAI } from '@google/generative-ai';
import { ProjectInfo } from './types';

export class GeminiService {
  private genAI: GoogleGenerativeAI;
  private model: any;

  constructor(apiKey: string) {
    this.genAI = new GoogleGenerativeAI(apiKey);
    this.model = this.genAI.getGenerativeModel({ model: 'gemini-1.5-flash-lite' });
  }

  async generateReadme(projectInfo: ProjectInfo, sampleCode: string): Promise<string> {
    const prompt = this.buildPrompt(projectInfo, sampleCode);

    try {
      const result = await this.model.generateContent(prompt);
      const response = await result.response;
      return response.text();
    } catch (error) {
      throw new Error(`Failed to generate README: ${error}`);
    }
  }

  private buildPrompt(projectInfo: ProjectInfo, sampleCode: string): string {
    return `You are an expert technical writer. Analyze the following project information and generate a comprehensive, professional README.md file.

PROJECT INFORMATION:
- Project Name: ${projectInfo.name}
- Project Type: ${projectInfo.type}
- Languages: ${projectInfo.languages.join(', ')}
- Dependencies: ${projectInfo.dependencies.slice(0, 20).join(', ')}

PROJECT STRUCTURE:
${projectInfo.structure}

SAMPLE CODE:
${sampleCode.slice(0, 2000)}

REQUIREMENTS:
Create a comprehensive README.md that includes:

1. **Project Title and Description**: A clear, concise description of what the project does
2. **Features**: Key features and capabilities (use bullet points)
3. **Tech Stack**: Technologies and frameworks used
4. **Installation**: Step-by-step installation instructions
5. **Usage**: How to use the project with examples
6. **Project Structure**: Brief overview of the folder structure
7. **Configuration**: Any environment variables or configuration needed
8. **Contributing**: Guidelines for contributing (if applicable)
9. **License**: License information

STYLE GUIDELINES:
- Use proper Markdown formatting
- Include code blocks with syntax highlighting where appropriate
- Use emojis sparingly and professionally (e.g., 🚀, ⚡, 📦)
- Be clear and concise
- Use badges if appropriate (build status, version, etc.)
- Make it beginner-friendly but professional

Generate ONLY the README.md content without any additional commentary or explanations. Start directly with the README content.`;
  }
}
