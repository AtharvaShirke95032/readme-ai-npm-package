import { serve } from '@hono/node-server';
import pkg from '../package.json';
import { createApp } from './app';
import { loadServerConfig } from './config';

// Local development: read .env if present (production sets real env vars).
try {
  process.loadEnvFile();
} catch {
  /* no .env file */
}

let config;
try {
  config = loadServerConfig(process.env);
} catch (err) {
  console.error(`readme-ai server: ${(err as Error).message}`);
  process.exit(1);
}

const app = createApp(config, undefined, pkg.version);
const server = serve({ fetch: app.fetch, port: config.port }, (info) => {
  const high = config.high ? `${config.high.provider}/${config.high.model}` : 'same as fast';
  console.log(`readme-ai server v${pkg.version} listening on :${info.port}`);
  console.log(`  fast: ${config.fast.provider}/${config.fast.model} · high: ${high}`);
  console.log(`  limits: ${config.limits.perWindow} per ${config.limits.windowMinutes} min per IP · ${config.limits.dailyLimit} per day`);
});

const shutdown = () => server.close(() => process.exit(0));
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
