import { defineConfig } from 'tsup';

// The hosted API server (deployed to Render, never published to npm).
export default defineConfig({
  entry: { server: 'server/index.ts' },
  format: ['cjs'],
  platform: 'node',
  target: 'node20',
  outDir: 'build',
  clean: true,
  noExternal: [/.*/],
});
