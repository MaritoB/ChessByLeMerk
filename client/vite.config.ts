import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@shared': path.resolve(rootDir, '../shared'),
    },
  },
  server: {
    host: true,
    port: 5173,
    fs: {
      allow: [path.resolve(rootDir, '..')],
    },
  },
});
