import 'express-async-errors';
import dotenv from 'dotenv';
dotenv.config();

// Zona horaria del PROCESO fija a UTC: toda fecha @db.Date se ancla a UTC (mediodía
// para días, ver utils/fechaLima). Así el sistema se comporta IGUAL en cualquier host
// de producción (no depende de la TZ del servidor) y se eliminan los desfases de ±1 día.
process.env.TZ = 'UTC';

import express from 'express';
import http from 'http';
import path from 'path';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import morgan from 'morgan';
import swaggerUi from 'swagger-ui-express';

import { prisma } from './db';
import { redis } from './redis';
import { initSocket } from './socket';
import { corsOrigin } from './cors';
import { iniciarRecordatorioWorker } from './queue/recordatorioWorker';
import { outlookConfigurado, reintentarOutlookFallidos } from './services/outlookCalendarService';
import { errorHandler } from './middleware/errorHandler';
import { swaggerSpec } from './swagger';

import citasRouter, { autocompletarCitasPorTiempo } from './routes/citas';
import usersRouter from './routes/users';
import rolesRouter from './routes/roles';
import disponibilidadRouter from './routes/disponibilidad';
import pacientesRouter from './routes/pacientes';
import profesionalesRouter from './routes/profesionales';
import sedesRouter from './routes/sedes';
import servicesRouter from './routes/servicios';
import competenciasRouter from './routes/competencias';
import asignacionesRouter from './routes/asignaciones';
import paquetesRouter from './routes/paquetes';
import auditRouter from './routes/audit';
import authRouter from './routes/auth';
import webhooksRouter from './routes/webhooks';
import { horariosRouter } from './routes/horarios';
import analyticsRouter from './routes/analytics';
import analyticsAgentesRouter from './routes/analyticsAgentes';
import exportarRouter from './routes/exportar';
import movimientosRouter from './routes/movimientos';
import notificacionesRouter from './routes/notificaciones';
import almuerzosRouter from './routes/almuerzos';
import herramientasRouter from './routes/herramientas';
import permisosRouter from './routes/permisos';
import canalesRouter from './routes/canales';
import recordatoriosRouter from './routes/recordatorios';
import baroSolicitudRouter from './routes/baroSolicitud';
import combinacionesRouter from './routes/combinaciones';
import promocionesRouter from './routes/promociones';

const app = express();
const server = http.createServer(app);

// ─── Middleware ───────────────────────────────────────────────────────────────
app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors({
  origin: corsOrigin,
  credentials: true,
}));
app.use(compression());
app.use(express.json({ limit: '10mb' }));
app.use(morgan('combined'));

// ─── Archivos estáticos (comprobantes de pago) ────────────────────────────────
app.use('/uploads', express.static(path.join(process.cwd(), 'uploads')));

// ─── Swagger ──────────────────────────────────────────────────────────────────
app.use('/api/docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec, {
  customCss: '.swagger-ui .topbar { background-color: #1e40af; }',
  customSiteTitle: 'Limablue Agenda API',
}));

// ─── Health check ─────────────────────────────────────────────────────────────
app.get('/health', async (_req, res) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    await redis.ping();
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
  } catch (err) {
    res.status(503).json({ status: 'error', error: String(err) });
  }
});

// ─── Rutas API ────────────────────────────────────────────────────────────────
const v1 = '/api/v1';
app.use(`${v1}/auth`, authRouter);
app.use(`${v1}/users`, usersRouter);
app.use(`${v1}/roles`, rolesRouter);
app.use(`${v1}/citas`, citasRouter);
app.use(`${v1}/disponibilidad`, disponibilidadRouter);
app.use(`${v1}/pacientes`, pacientesRouter);
app.use(`${v1}/profesionales`, profesionalesRouter);
app.use(`${v1}/sedes`, sedesRouter);
app.use(`${v1}/servicios`, servicesRouter);
app.use(`${v1}/competencias`, competenciasRouter);
app.use(`${v1}/asignaciones`, asignacionesRouter);
app.use(`${v1}/paquetes`, paquetesRouter);
app.use(`${v1}/audit`, auditRouter);
app.use(`${v1}/webhooks`, webhooksRouter);
app.use(`${v1}/horarios`, horariosRouter);
app.use(`${v1}/analytics/agentes`, analyticsAgentesRouter); // antes que /analytics (prefijo más específico)
app.use(`${v1}/analytics`, analyticsRouter);
app.use(`${v1}/exportar`, exportarRouter);
app.use(`${v1}/movimientos`, movimientosRouter);
app.use(`${v1}/notificaciones`, notificacionesRouter);
app.use(`${v1}/almuerzos`, almuerzosRouter);
app.use(`${v1}/herramientas`, herramientasRouter);
app.use(`${v1}/permisos`, permisosRouter);
app.use(`${v1}/canales`, canalesRouter);
app.use(`${v1}/recordatorios`, recordatoriosRouter);
app.use(`${v1}/baro-solicitud`, baroSolicitudRouter);
app.use(`${v1}/combinaciones`, combinacionesRouter);
app.use(`${v1}/promociones`, promocionesRouter);

// ─── Error handler ────────────────────────────────────────────────────────────
app.use(errorHandler);

// ─── Socket.io ────────────────────────────────────────────────────────────────
initSocket(server);

// ─── Worker de recordatorios (BullMQ) ─────────────────────────────────────────
// Por defecto corre en proceso. Para separarlo, pon RECORDATORIOS_WORKER_INLINE="false"
// en el API y arranca `npm run worker` aparte.
if (process.env.RECORDATORIOS_WORKER_INLINE !== 'false') {
  iniciarRecordatorioWorker();
}

// ─── Reintento periódico de sincronizaciones Outlook fallidas ─────────────────
// Solo si Azure está configurado. Cada 10 min reprocesa las citas con outlookSyncError.
if (outlookConfigurado()) {
  setInterval(() => {
    void reintentarOutlookFallidos().then((r) => { if (r.intentadas) console.log('[outlook] reintento:', r); });
  }, 10 * 60_000).unref();
}

// ─── Auto-completado de citas por tiempo ──────────────────────────────────────
// Una cita marcada "Llegó" pasa sola a "Completada" tras AUTOCOMPLETAR_MIN (default 90) min.
// Barrido cada 5 min + una corrida al arrancar (para citas ya vencidas). No bloqueante.
const autocompletar = () => void autocompletarCitasPorTiempo().catch((e) => console.error('[autocompletar] error:', e));
setTimeout(autocompletar, 15_000); // al arrancar (deja que la BD/redis estén listos)
setInterval(autocompletar, 5 * 60_000).unref();

// ─── Red de seguridad de procesos ─────────────────────────────────────────────
// Las tareas "fire-and-forget" del POST de citas (correo de reserva, sync Outlook,
// webhooks) se lanzan con `void X()`. Si alguna RECHAZA sin que su propio catch la
// atrape, en Node 20 una promesa rechazada sin manejar TUMBA el proceso → la API se
// reinicia y las peticiones en vuelo devuelven "Error interno del servidor" a la
// recepcionista, aunque la cita SÍ se haya creado. Aquí registramos esos errores y
// mantenemos el servidor vivo (nunca dejamos que un fallo de fondo derribe la API).
process.on('unhandledRejection', (motivo) => {
  console.error('[unhandledRejection] tarea de fondo falló (la API sigue viva):', motivo);
});
process.on('uncaughtException', (err) => {
  console.error('[uncaughtException] error no atrapado (la API sigue viva):', err);
});

// ─── Start ────────────────────────────────────────────────────────────────────
const PORT = Number(process.env.PORT) || 3001;
server.listen(PORT, () => {
  console.log(`🚀 Limablue Agenda API corriendo en http://localhost:${PORT}`);
  console.log(`📚 Documentación: http://localhost:${PORT}/api/docs`);
});

export { app, server };
