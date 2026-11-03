import { defineConfig } from 'vite';

// Relative base so the same build works on GitHub Pages and itch.io.
export default defineConfig({
  base: './',
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 4000,
    rolldownOptions: {
      output: {
        // Libraries change far less often than the game does. Giving each its own file means a
        // returning player re-downloads only the small game chunk after an update.
        codeSplitting: {
          groups: [
            { name: 'physics', test: /node_modules[\\/]@dimforge/ },
            { name: 'three', test: /node_modules[\\/]three[\\/]/ },
            { name: 'vrm', test: /node_modules[\\/]@pixiv/ },
          ],
        },
      },
    },
  },
});
