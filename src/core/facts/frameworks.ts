import type { FrameworkFact } from '../types';

type Entry = [name: string, category: string];

/** Dependency name → display name + category. Keys are per ecosystem but never collide. */
const KNOWN: Record<string, Entry> = {
  // JavaScript / TypeScript
  next: ['Next.js', 'Framework'], react: ['React', 'Frontend'], 'react-dom': ['React', 'Frontend'],
  vue: ['Vue', 'Frontend'], nuxt: ['Nuxt', 'Framework'], svelte: ['Svelte', 'Frontend'],
  '@sveltejs/kit': ['SvelteKit', 'Framework'], '@angular/core': ['Angular', 'Frontend'],
  'solid-js': ['Solid', 'Frontend'], preact: ['Preact', 'Frontend'], astro: ['Astro', 'Framework'],
  '@remix-run/react': ['Remix', 'Framework'], 'react-router': ['React Router', 'Frontend'],
  'react-native': ['React Native', 'Mobile'], expo: ['Expo', 'Mobile'], electron: ['Electron', 'Desktop'],
  '@tauri-apps/api': ['Tauri', 'Desktop'], express: ['Express', 'Backend'], fastify: ['Fastify', 'Backend'],
  hono: ['Hono', 'Backend'], koa: ['Koa', 'Backend'], '@nestjs/core': ['NestJS', 'Backend'],
  '@trpc/server': ['tRPC', 'Backend'], 'socket.io': ['Socket.IO', 'Backend'], graphql: ['GraphQL', 'Backend'],
  '@apollo/server': ['Apollo Server', 'Backend'], prisma: ['Prisma', 'Database'],
  '@prisma/client': ['Prisma', 'Database'], 'drizzle-orm': ['Drizzle ORM', 'Database'],
  mongoose: ['Mongoose', 'Database'], typeorm: ['TypeORM', 'Database'], sequelize: ['Sequelize', 'Database'],
  pg: ['PostgreSQL', 'Database'], mysql2: ['MySQL', 'Database'], redis: ['Redis', 'Database'],
  ioredis: ['Redis', 'Database'], '@supabase/supabase-js': ['Supabase', 'Database'], firebase: ['Firebase', 'Backend'],
  tailwindcss: ['Tailwind CSS', 'Styling'], 'styled-components': ['styled-components', 'Styling'],
  '@mui/material': ['Material UI', 'Styling'], '@chakra-ui/react': ['Chakra UI', 'Styling'], sass: ['Sass', 'Styling'],
  vite: ['Vite', 'Tooling'], webpack: ['webpack', 'Tooling'], typescript: ['TypeScript', 'Language'],
  tsup: ['tsup', 'Tooling'], turbo: ['Turborepo', 'Tooling'], eslint: ['ESLint', 'Tooling'],
  '@biomejs/biome': ['Biome', 'Tooling'], prettier: ['Prettier', 'Tooling'], jest: ['Jest', 'Testing'],
  vitest: ['Vitest', 'Testing'], mocha: ['Mocha', 'Testing'], '@playwright/test': ['Playwright', 'Testing'],
  cypress: ['Cypress', 'Testing'], commander: ['Commander', 'CLI'], yargs: ['yargs', 'CLI'],
  '@oclif/core': ['oclif', 'CLI'], ink: ['Ink', 'CLI'], openai: ['OpenAI SDK', 'AI'],
  '@anthropic-ai/sdk': ['Anthropic SDK', 'AI'], '@google/genai': ['Google Gen AI SDK', 'AI'],
  '@google/generative-ai': ['Google Generative AI SDK', 'AI'], ai: ['Vercel AI SDK', 'AI'],
  langchain: ['LangChain', 'AI'], zod: ['Zod', 'Validation'], 'discord.js': ['discord.js', 'Bots'],
  telegraf: ['Telegraf', 'Bots'], three: ['three.js', 'Graphics'], 'd3': ['D3', 'Visualization'],
  // Python
  django: ['Django', 'Backend'], flask: ['Flask', 'Backend'], fastapi: ['FastAPI', 'Backend'],
  starlette: ['Starlette', 'Backend'], uvicorn: ['Uvicorn', 'Backend'], celery: ['Celery', 'Backend'],
  sqlalchemy: ['SQLAlchemy', 'Database'], pydantic: ['Pydantic', 'Validation'], streamlit: ['Streamlit', 'Frontend'],
  gradio: ['Gradio', 'Frontend'], pytest: ['pytest', 'Testing'], click: ['Click', 'CLI'], typer: ['Typer', 'CLI'],
  torch: ['PyTorch', 'AI/ML'], tensorflow: ['TensorFlow', 'AI/ML'], transformers: ['Transformers', 'AI/ML'],
  'scikit-learn': ['scikit-learn', 'AI/ML'], pandas: ['pandas', 'Data'], numpy: ['NumPy', 'Data'],
  langgraph: ['LangGraph', 'AI'], 'discord.py': ['discord.py', 'Bots'], scrapy: ['Scrapy', 'Data'],
  // Rust
  tokio: ['Tokio', 'Runtime'], axum: ['Axum', 'Backend'], 'actix-web': ['Actix Web', 'Backend'],
  rocket: ['Rocket', 'Backend'], clap: ['clap', 'CLI'], serde: ['Serde', 'Serialization'],
  sqlx: ['SQLx', 'Database'], diesel: ['Diesel', 'Database'], bevy: ['Bevy', 'Graphics'],
  // Go
  'github.com/gin-gonic/gin': ['Gin', 'Backend'], 'github.com/labstack/echo/v4': ['Echo', 'Backend'],
  'github.com/gofiber/fiber/v2': ['Fiber', 'Backend'], 'github.com/go-chi/chi/v5': ['chi', 'Backend'],
  'github.com/spf13/cobra': ['Cobra', 'CLI'], 'gorm.io/gorm': ['GORM', 'Database'],
  'github.com/charmbracelet/bubbletea': ['Bubble Tea', 'CLI'],
  // Ruby / PHP / Java
  rails: ['Ruby on Rails', 'Framework'], sinatra: ['Sinatra', 'Backend'], rspec: ['RSpec', 'Testing'],
  'laravel/framework': ['Laravel', 'Framework'], 'symfony/framework-bundle': ['Symfony', 'Framework'],
  'phpunit/phpunit': ['PHPUnit', 'Testing'], 'spring-boot': ['Spring Boot', 'Framework'],
};

export function detectFrameworks(deps: Iterable<string>): FrameworkFact[] {
  const seen = new Set<string>();
  const out: FrameworkFact[] = [];
  for (const dep of deps) {
    const hit = KNOWN[dep.toLowerCase()] ?? KNOWN[dep];
    if (hit && !seen.has(hit[0])) {
      seen.add(hit[0]);
      out.push({ name: hit[0], category: hit[1] });
    }
  }
  return out;
}
