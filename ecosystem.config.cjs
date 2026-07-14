// pm2 — proceso de producción de Limablue Agenda. Ver runbook en DEPLOY.md.
//
// Dos procesos:
//  - limablue-api: la API compilada (dist), con el worker de recordatorios IN-PROCESS
//    (RECORDATORIOS_WORKER_INLINE="true" en apps/api/.env). Sirve :3002. Carga apps/api/.env
//    vía dotenv (por eso cwd = apps/api). NODE_ENV=production activa CORS estricto (permitido:
//    CORS_ORIGIN=http://localhost:5180) y exige JWT_SECRET/CONFIRM_TOKEN_SECRET (presentes).
//  - limablue-web: el build estático servido con `vite preview` (proxy /api y /socket.io → :3002,
//    ver bloque preview en apps/web/vite.config.ts). Sirve :5180 — misma URL que usaba la clínica.
//
// Deploy:   npm run build && pm2 reload ecosystem.config.cjs
// Arranque: pm2 start ecosystem.config.cjs && pm2 save
const REPO = __dirname;

module.exports = {
  apps: [
    {
      name: 'limablue-api',
      cwd: REPO + '/apps/api',
      script: 'dist/apps/api/src/index.js',
      env: { NODE_ENV: 'production' },
      autorestart: true,
      max_restarts: 10,
      restart_delay: 3000,
      max_memory_restart: '600M',
      time: true,          // prefija timestamp en cada línea de log
      merge_logs: true,
      out_file: REPO + '/logs/api-out.log',
      error_file: REPO + '/logs/api-error.log',
    },
    {
      name: 'limablue-web',
      cwd: REPO + '/apps/web',
      // Servidor CJS que sirve dist + proxy /api,/socket.io → :3002 (ver serve-prod.cjs).
      // No usamos `vite preview` porque es ESM y pm2 no lo puede require() en fork mode.
      script: 'serve-prod.cjs',
      autorestart: true,
      max_restarts: 10,
      restart_delay: 3000,
      time: true,
      merge_logs: true,
      out_file: REPO + '/logs/web-out.log',
      error_file: REPO + '/logs/web-error.log',
    },
  ],
};
