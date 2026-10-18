import { defineConfig } from 'tsup';

// The published package: a CLI plus a small programmatic API.
// Every dependency is bundled in, so `npx` installs a single package
// with zero runtime dependencies.
export default defineConfig({
  entry: { cli: 'src/cli/index.ts', index: 'src/index.ts' },
  format: ['cjs'],
  platform: 'node',
  target: 'node20',
  outDir: 'dist',
  clean: true,
  noExternal: [/.*/],
  minify: false,
  sourcemap: false,
  shims: false,
});
