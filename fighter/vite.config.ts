import { defineConfig } from 'vite';

// The fighting game shares the character models and motion files of the main game. While developing they are
// served from ../public; the built game is placed in dist/fighter beside the main game and reads them from
// one folder up, so the 28 MB of models are published once rather than twice.
export default defineConfig(({ command }) => ({
  base: './',
  publicDir: command === 'serve' ? '../public' : false,
  build: { target: 'es2022', outDir: '../dist/fighter', emptyOutDir: true, chunkSizeWarningLimit: 4000 },
}));
