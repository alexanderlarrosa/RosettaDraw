import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    proxy: {
      '/api/handwriting': {
        target: 'https://inputtools.google.com',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/handwriting/, '/request'),
      }
    }
  }
});
