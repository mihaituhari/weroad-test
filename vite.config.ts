import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

// The SPA (search page + /admin) is built to dist/web and served by the API in production.
// In dev, Vite proxies /api to the API server.
export default defineConfig({
  root: 'src/web',
  plugins: [react()],
  build: { outDir: '../../dist/web', emptyOutDir: true },
  server: { port: 5173, proxy: { '^/api/': 'http://localhost:3000' } },
  test: { root: '.', include: ['src/**/*.test.ts'] },
});
