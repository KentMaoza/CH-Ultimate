import { resolve } from 'node:path';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  root: resolve(process.cwd(), 'mobile'),
  publicDir: resolve(process.cwd(), 'public'),
  plugins: [react()],
  build: {
    emptyOutDir: true,
    outDir: resolve(process.cwd(), 'dist-mobile'),
  },
});
