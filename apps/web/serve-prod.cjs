// Servidor de PRODUCCIÓN del frontend (build estático). CommonJS para que pm2 lo
// arranque sin fricción (a diferencia de `vite preview`, que es ESM y pm2 no puede
// require()-ear en fork mode). Sirve apps/web/dist y proxya /api y /socket.io (WS)
// a la API en :3002 — igual que el proxy del dev server — para que el frontend siga
// hablando por rutas relativas y la clínica conserve la URL http://localhost:5180.
const path = require('path');
const express = require('express');
const { createProxyMiddleware } = require('http-proxy-middleware');

const PORT = Number(process.env.PORT) || 5180;
const API_TARGET = process.env.API_TARGET || 'http://localhost:3002';
const DIST = path.join(__dirname, 'dist');

const app = express();

// Proxy hacia la API (:3002). Se usa `pathFilter` (no un mount de Express) para que el
// path completo se preserve: /api/v1/… llega como /api/v1/… (Express, al montar en '/api',
// lo recortaría y la API respondería 404).
const apiProxy = createProxyMiddleware({ target: API_TARGET, changeOrigin: true, pathFilter: (p) => p.startsWith('/api') });
const wsProxy = createProxyMiddleware({ target: API_TARGET, changeOrigin: true, ws: true, pathFilter: (p) => p.startsWith('/socket.io') });
// Comprobantes de pago (imágenes subidas): las sirve la API en :3002/uploads. Se proxyan
// por same-origin para que el frontend use rutas RELATIVAS (/uploads/…) y funcione igual en
// localhost y en la nube (sin URLs absolutas a :3002 que romperían fuera de la máquina).
const uploadsProxy = createProxyMiddleware({ target: API_TARGET, changeOrigin: true, pathFilter: (p) => p.startsWith('/uploads') });
app.use(apiProxy);
app.use(wsProxy);
app.use(uploadsProxy);

// Archivos estáticos del build + fallback SPA (rutas de cliente → index.html).
app.use(express.static(DIST));
app.get('*', (_req, res) => res.sendFile(path.join(DIST, 'index.html')));

const server = app.listen(PORT, () => {
  console.log(`🌐 Web estático en http://localhost:${PORT} · proxy /api,/socket.io → ${API_TARGET}`);
});
// Upgrade de WebSocket (socket.io tiempo real) hacia la API.
server.on('upgrade', wsProxy.upgrade);
