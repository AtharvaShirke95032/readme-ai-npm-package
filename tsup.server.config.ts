import { defineConfig } from 'tsup';

// The hosted API server (deployed to Render). It lands in dist/server.js next to the
// CLI, but package.json "files" keeps it out of the published npm package.
export default defineConfig({
  entry: { server: 'server/index.ts' },
  format: ['cjs'],
  platform: 'node',
  target: 'node20',
  outDir: 'dist',
  clean: false,
  noExternal: [/.*/],
});
