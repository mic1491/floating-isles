import { defineConfig } from 'vite';

// Relative base so the same build works on GitHub Pages and itch.io.
export default defineConfig({
  base: './',
  build: { target: 'es2022', chunkSizeWarningLimit: 4000 },
});
