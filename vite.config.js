// vite.config.js
import { defineConfig } from 'vite';

export default defineConfig({
  root:    '.',
  publicDir: 'public',
  build: {
    outDir:        'dist',
    emptyOutDir:   true,
    sourcemap:     true,
    rollupOptions: {
      input: 'public/index.html',
    },
  },
  server: {
    port: 3000,
    proxy: {
      // Proxy API calls to backend during development
      '/api': {
        target:       'http://localhost:3001',
        changeOrigin: true,
      },
    },
  },
  define: {
    // Inject env vars at build time
    'import.meta.env.VITE_GOOGLE_MAPS_API_KEY': JSON.stringify(process.env.VITE_GOOGLE_MAPS_API_KEY ?? ''),
    'import.meta.env.VITE_API_URL':             JSON.stringify(process.env.VITE_API_URL ?? 'http://localhost:3001'),
  },
});
