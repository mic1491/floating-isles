import { defineConfig } from 'vite';

// The fighting game shares the character models and motion files of the main game in ../public.
export default defineConfig({
  base: './',
  publicDir: '../public',
  build: { target: 'es2022', outDir: 'dist', chunkSizeWarningLimit: 4000 },
});
