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
      // Target configurable (VITE_PROXY_TARGET) para que el dev server pueda apuntar a la
      // API de e2e en :3003; por defecto la API local en :3002.
      '/api': { target: process.env.VITE_PROXY_TARGET || 'http://localhost:3002', changeOrigin: true },
      '/socket.io': { target: process.env.VITE_PROXY_TARGET || 'http://localhost:3002', ws: true },
    },
  },
  // Serving de PRODUCCIÓN del build estático (`vite preview`). Reusa el mismo proxy que
  // el dev server para que el frontend siga hablando por rutas relativas (/api, /socket.io)
  // con la API en :3002 — sin cambios en el frontend y conservando la URL :5180 de la clínica.
  preview: {
    port: Number(process.env.PORT) || 5180,
    strictPort: true,
    proxy: {
      '/api': { target: 'http://localhost:3002', changeOrigin: true },
      '/socket.io': { target: 'http://localhost:3002', ws: true },
    },
  },
});
