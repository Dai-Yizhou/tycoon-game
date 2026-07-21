import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/main.ts'],
  outDir: 'dist',
  format: ['esm'],
  target: 'es2022',
  sourcemap: true,
  clean: true,
  bundle: true,
  minify: false,
  shims: true,
  dts: true
});
