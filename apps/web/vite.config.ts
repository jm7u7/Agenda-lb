import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@limablue/shared': path.resolve(__dirname, '../../packages/shared/src/index.ts'),
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    port: Number(process.env.PORT) || 5180,
    strictPort: false,
    proxy: {
      '/api': { target: 'http://localhost:3002', changeOrigin: true },
      '/socket.io': { target: 'http://localhost:3002', ws: true },
    },
  },
});
