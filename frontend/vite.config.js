import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { localApiConfig } from '../scripts/dev-config.mjs';

export default defineConfig({
  plugins: [react()],
  build: { rollupOptions: { output: { manualChunks: { charts: ['recharts'] } } } },
  server: { proxy: { '/api': localApiConfig().origin } },
  test: { environment: 'jsdom', setupFiles: './src/test-setup.js', include: ['src/**/*.test.jsx'] },
});
