import { Router, Request } from 'express';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { v4 as uuidv4 } from 'uuid';
import path from 'path';
import { prisma } from '../db';
import { acquireSlotLock, releaseSlotLock, invalidateDisponibilidadCache } from '../redis';
import { seleccionarProfesionalOptimo, turnosDelDia } from '../services/disponibilidad';
import { registrarAudit, auditEnTx } from '../services/audit';
import { dispararWebhooks } from '../services/webhooks';
import { emitirEventoCita } from '../socket';
import { requireAuth, requireScope, requireRol } from '../middleware/auth';
import { AppError } from '../middleware/errorHandler';
import { withDeadlockRetry, esDeadlockTransitorio, esConflictoDeSlot } from '../utils/dbRetry';
import { agregarRango } from '../services/agregacion';
import { uploadComprobante } from '../middleware/uploadComprobante';
import { construirIcsDeCita, logoAdjunto } from '../services/emailTemplates';
import { sincronizarCitaOutlook, reintentarOutlookFallidos } from '../services/outlookCalendarService';
import { alertasDePacientes } from '../services/alertaPaciente';
import { familiaresDePacientes } from '../services/familiaresPaciente';
import { programarRecordatoriosDeCita, cancelarRecordatoriosDeCita, reprogramarRecordatorioDeCita, forzarEnvioRecordatorioAhora } from '../services/recordatorioService';
import { sincronizarVideosDeCita, cancelarVideosDeCita } from '../services/videoEnvioService';
import { consumirTokenAccion } from '../services/tokenAccionCita';
import { sincronizarSesionPaquete } from '../services/paqueteSesionService';
import { recalcularPaquete } from '../services/consumoService';
import { getServicioAnclaId, esCombinacionPermitida } from '../services/combinacionService';
import { verificarTokenConfirmacion } from '../utils/confirmToken';
import { fechaDb } from '../utils/fechaLima';
import { horaInicioValidaParaDuracion, timeToMinutes } from '@limablue/shared';

const router = Router();

// Valida que el canal exista y esté activo en la tabla configurable `Canal`.
async function validarCanal(valor: string): Promise<string> {
  const canal = await prisma.canal.findFirst({ where: { valor, activo: true, deletedAt: null }, select: { valor: true } });
  if (!canal) throw new AppError('Canal de reserva inválido o inactivo', 400, 'CANAL_INVALIDO');
  return canal.valor;
}

// Resuelve/valida la subcategoría de una cita según su servicio. Si el servicio TIENE
// subcategorías activas, elegir una es OBLIGATORIO y debe pertenecer a ese servicio y
// estar activa. Si NO tiene, se ignora cualquier valor (devuelve null). Ver
// `SubcategoriaServicio` (ej. Profilaxis → Regular/Premium/Infantil/Adulto mayor).
async function resolverSubcategoria(servicioId: string, subcategoriaId?: string | null): Promise<string | null> {
  const activas = await prisma.subcategoriaServicio.findMany({
    where: { servicioId, deletedAt: null, activo: true },
    select: { id: true },
  });
  if (activas.length === 0) return null; // servicio sin subcategorías
  if (!subcategoriaId) throw new AppError('Este servicio requiere elegir una subcategoría', 400, 'SUBCATEGORIA_REQUERIDA');
  if (!activas.some((s) => s.id === subcategoriaId)) {
    throw new AppError('La subcategoría no corresponde a este servicio o está inactiva', 400, 'SUBCATEGORIA_INVALIDA');
  }
  return subcategoriaId;
}

const crearCitaSchema = z.object({
  pacienteId: z.string().uuid(),
  profesionalId: z.string().uuid().nullable().optional(),
  sedeId: z.string().uuid(),
  unidadNegocioId: z.string().uuid(),
  servicioId: z.string().uuid(),
  subcategoriaId: z.string().uuid().nullable().optional(), // obligatoria si el servicio tiene subcategorías
  fecha: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  horaInicio: z.string().regex(/^\d{2}:\d{2}$/),
  canal: z.string().default('recepcion'),
  comentarioRecepcion: z.string().optional(),
  paquetePacienteId: z.string().uuid().optional(),
  // Adjudicación MANUAL del número de sesión (SOLO paquetes origen GENEXIS_APERTURA):
  // recepción/contact mira el visor Genexis y elige del desplegable qué sesión toca.
  sesionNumeroManual: z.number().int().min(1).max(99).optional(),
  promocionId: z.string().uuid().nullable().optional(),
  comprobanteUrl: z.string().optional(),
  comprobanteNombre: z.string().optional(),
  comprobanteMimeType: z.string().optional(),
});

// Bloque combinado: ancla (profilaxis) + un servicio extra en el mismo slot de 1 h.
// El ancla replica los campos de crearCitaSchema; el extra trae su servicio y, opcional,
// otra profesional / paquete (default: misma profesional del ancla).
const crearCombinadaSchema = z.object({
  pacienteId: z.string().uuid(),
  profesionalId: z.string().uuid().nullable().optional(), // si no viene → asignación automática
  sedeId: z.string().uuid(),
  unidadNegocioId: z.string().uuid(),
  servicioId: z.string().uuid(), // debe coincidir con el ancla configurada
  subcategoriaId: z.string().uuid().nullable().optional(), // subcategoría del ancla (profilaxis)
  fecha: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  horaInicio: z.string().regex(/^\d{2}:\d{2}$/),
  canal: z.string().default('recepcion'),
  comentarioRecepcion: z.string().optional(),
  paquetePacienteId: z.string().uuid().optional(),
  promocionId: z.string().uuid().nullable().optional(), // promo del BLOQUE → va en la PRINCIPAL
  extra: z.object({
    servicioId: z.string().uuid(),
    profesionalId: z.string().uuid().optional(), // default: profesional del ancla
    paquetePacienteId: z.string().uuid().optional(),
    subcategoriaId: z.string().uuid().optional(), // obligatoria si el servicio extra tiene subcategorías
    comentarioRecepcion: z.string().optional(),
  }),
});

const moverCitaSchema = z.object({
  profesionalId: z.string().uuid().nullable().optional(),
  fecha: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  horaInicio: z.string().regex(/^\d{2}:\d{2}$/),
  origenAsignacion: z.enum(['elegida_por_paciente', 'asignada_automaticamente']).optional(),
});

const estadoSchema = z.object({
  estado: z.enum(['agendada', 'confirmada', 'llego', 'en_atencion', 'completada', 'no_show', 'cancelada']),
  comentario: z.string().optional(),
  motivoCancelacion: z.string().optional(),
});

const ESTADOS_FINALES = ['completada', 'no_show', 'cancelada'];

// Transiciones válidas: qué estados puede alcanzar cada estado actual
const TRANSICIONES_VALIDAS: Record<string, string[]> = {
  agendada:    ['confirmada', 'llego', 'no_show', 'cancelada'],
  confirmada:  ['llego', 'no_show', 'cancelada'],
  llego:       ['en_atencion', 'cancelada'],
  en_atencion: ['completada', 'no_show'],
  completada:  ['en_atencion'], // reversa de ATENDIDA (solo admin/coordinadora; reembolsa la sesión)
  no_show:     [],
  cancelada:   [],
  reprogramada: [],
};

// ─── Helper: validar que el slot no choca con un bloqueo del profesional ──────
// Cubre permisos/ausencias (no recurrentes) y almuerzos (recurrentes). Lanza
// SLOT_BLOQUEADO si hay solapamiento con el rango [horaInicio, horaInicio+duración).
async function validarSinBloqueo(profesionalId: string, fecha: string, horaInicio: string, duracionMin: number) {
  const slotStart = timeToMinutes(horaInicio);
  const slotEnd = slotStart + duracionMin;
  // Límites del día anclados a UTC (no dependen de la TZ del proceso).
  const dayStart = new Date(`${fecha}T00:00:00.000Z`);
  const dayEnd = new Date(`${fecha}T23:59:59.999Z`);
  const fechaPunto = fechaDb(fecha);

  // Bloqueos puntuales (permisos, reuniones, ausencias). La hora del bloqueo se toma de los
  // campos STRING `horaInicio`/`horaFin` (hora civil "HH:mm", fuente confiable e independiente
  // de la TZ). Fallback a la hora LOCAL del DateTime (así se creó el bloqueo) para filas legacy
  // sin string. NUNCA `getUTCHours` (en TZ ≠ UTC corría el bloqueo y no detectaba el solape).
  const puntuales = await prisma.bloqueoAgenda.findMany({
    where: { profesionalId, deletedAt: null, esRecurrente: false, fechaInicio: { lt: dayEnd }, fechaFin: { gt: dayStart } },
    select: { fechaInicio: true, fechaFin: true, horaInicio: true, horaFin: true, motivo: true },
  });
  for (const b of puntuales) {
    const bStart = b.horaInicio ? timeToMinutes(b.horaInicio) : b.fechaInicio.getHours() * 60 + b.fechaInicio.getMinutes();
    const bEnd = b.horaFin ? timeToMinutes(b.horaFin) : b.fechaFin.getHours() * 60 + b.fechaFin.getMinutes();
    if (slotStart < bEnd && slotEnd > bStart) {
      throw new AppError(`El profesional tiene un bloqueo en ese horario (${b.motivo})`, 409, 'SLOT_BLOQUEADO');
    }
  }

  // Almuerzos recurrentes vigentes en la fecha.
  const almuerzos = await prisma.bloqueoAgenda.findMany({
    where: { profesionalId, deletedAt: null, esRecurrente: true, tipo: 'ALMUERZO', fechaInicio: { lte: fechaPunto }, fechaFin: { gte: fechaPunto } },
    select: { horaInicio: true, horaFin: true },
  });
  for (const a of almuerzos) {
    if (!a.horaInicio || !a.horaFin) continue;
    const bStart = timeToMinutes(a.horaInicio);
    const bEnd = timeToMinutes(a.horaFin);
    if (slotStart < bEnd && slotEnd > bStart) {
      throw new AppError('El profesional tiene almuerzo en ese horario', 409, 'SLOT_BLOQUEADO');
    }
  }
}

// Include reutilizable del hilo de comentarios (append-only, orden cronológico).
// `autor` (vivo) para el nombre actual; `autorEtiqueta` (snapshot) como respaldo/legacy.
const comentariosInclude = {
  where: { deletedAt: null },
  orderBy: { creadoEn: 'asc' },
  select: { id: true, texto: true, creadoEn: true, autorEtiqueta: true, autor: { select: { id: true, nombre: true } } },
} as const;

// ─── Helper: el profesional no puede estar en dos lados a la vez ──────────────
// Una persona ocupa su tiempo aunque la cita esté en otra unidad: cuenta tanto las
// citas donde es el profesional de columna (profesionalId) como donde fue pedido
// "Solo X" (solicitadoProfesionalId, baro). Así un cupo de Daniel en Podología se
// anula si ya tiene una cita en Baropodometría a esa hora, y viceversa. Considera
// solape real de duraciones (no solo misma horaInicio). `excluirCitaId` para mover.
async function validarProfesionalLibre(
  profesionalId: string, fecha: string, horaInicio: string, duracionMin: number, excluirCitaId?: string, excluirCitaIds: string[] = [],
) {
  const slotStart = timeToMinutes(horaInicio);
  const slotEnd = slotStart + duracionMin;
  // Citas a excluir del chequeo de solape (la propia al mover; todo el grupo al mover un bloque).
  const excluidos = [...(excluirCitaId ? [excluirCitaId] : []), ...excluirCitaIds];
  const citas = await prisma.cita.findMany({
    where: {
      OR: [{ profesionalId }, { solicitadoProfesionalId: profesionalId }],
      fecha: fechaDb(fecha),
      deletedAt: null,
      estado: { notIn: ['cancelada', 'no_show', 'reprogramada'] },
      ...(excluidos.length ? { id: { notIn: excluidos } } : {}),
    },
    select: { horaInicio: true, duracionMinutos: true, unidadNegocio: { select: { nombre: true } } },
  });
  for (const c of citas) {
    const s = timeToMinutes(c.horaInicio);
    if (s < slotEnd && s + c.duracionMinutos > slotStart) {
      throw new AppError(
        `El profesional ya tiene una cita a esa hora (${c.horaInicio}, ${c.unidadNegocio.nombre}). No puede atender en dos lugares a la vez.`,
        409, 'PROFESIONAL_OCUPADO',
      );
    }
  }
}

// ─── Helper: serializar cita para respuestas ──────────────────────────────────
// Campos de la promoción que se exponen en la cita.
const promoCitaSelect = { id: true, nombre: true, tipo: true, valor: true } as const;

// FUENTE ÚNICA de la promo en un bloque combinado: la cita PORTADORA = la PRINCIPAL
// (profilaxis). Para una cita individual, la portadora es ella misma. Fallback (grupo sin
// PRINCIPAL, no debería pasar): la de menor `id`. Todo el backend usa este helper.
async function resolverCitaPortadora(cita: { id: string; slotGrupoId: string | null }): Promise<string> {
  if (!cita.slotGrupoId) return cita.id;
  const principal = await prisma.cita.findFirst({
    where: { slotGrupoId: cita.slotGrupoId, slotRol: 'PRINCIPAL', deletedAt: null },
    select: { id: true },
  });
  if (principal) return principal.id;
  const menor = await prisma.cita.findFirst({
    where: { slotGrupoId: cita.slotGrupoId, deletedAt: null },
    orderBy: { id: 'asc' }, select: { id: true },
  });
  return menor?.id ?? cita.id;
}

// Promo HEREDADA de una cita SECUNDARIO de un bloque: la de su portadora (PRINCIPAL).
// null si la cita no es la secundaria de un combinado. Su propio `promocion` es null.
async function promoHeredadaDe(cita: { slotGrupoId: string | null; slotRol: 'PRINCIPAL' | 'SECUNDARIO' | null }) {
  if (!cita.slotGrupoId || cita.slotRol !== 'SECUNDARIO') return null;
  const portadora = await prisma.cita.findFirst({
    where: { slotGrupoId: cita.slotGrupoId, slotRol: 'PRINCIPAL', deletedAt: null },
    select: { promocion: { select: promoCitaSelect } },
  });
  return portadora?.promocion ?? null;
}

async function getCitaCompleta(id: string) {
  const cita = await prisma.cita.findUnique({
    where: { id },
    include: {
      paciente: true,
      profesional: true,
      solicitadoProfesional: { select: { id: true, nombres: true, apellidos: true, tipo: true } },
      sede: true,
      unidadNegocio: true,
      servicio: true,
      subcategoria: { select: { id: true, nombre: true } },
      paquetePaciente: { include: { paquete: true } },
      promocion: { select: promoCitaSelect },
      creadoPorUsuario: { select: { id: true, nombre: true } },
      comentarios: comentariosInclude,
    },
  });
  if (!cita) return cita;
  return { ...cita, promocionHeredada: await promoHeredadaDe(cita) };
}

// Crea una ENTRADA del hilo append-only + su audit, DENTRO de una transacción.
// `autorId` null = legacy/sistema. `autorEtiqueta` se captura al escribir (snapshot
// del nombre) para que el hilo sea legible aunque el usuario se borre luego.
async function crearComentarioEnTx(
  tx: Parameters<Parameters<typeof prisma.$transaction>[0]>[0],
  args: { citaId: string; sedeId: string; autorId?: string | null; texto: string; ip?: string },
) {
  const texto = args.texto.trim();
  if (!texto) return;
  let autorEtiqueta: string | null = null;
  if (args.autorId) {
    const u = await tx.usuario.findUnique({ where: { id: args.autorId }, select: { nombre: true } });
    autorEtiqueta = u?.nombre ?? null;
  }
  const entrada = await tx.comentarioCita.create({
    data: { citaId: args.citaId, autorId: args.autorId ?? null, autorEtiqueta, texto },
  });
  await auditEnTx(tx, {
    citaId: args.citaId,
    usuarioId: args.autorId ?? undefined,
    accion: 'agregar_comentario',
    entidad: 'cita',
    entidadId: args.citaId,
    despues: { comentarioId: entrada.id, texto },
    sedeId: args.sedeId,
    ip: args.ip,
  });
  return entrada;
}

// ─── POST /citas/upload-comprobante ──────────────────────────────────────────
router.post(
  '/upload-comprobante',
  requireAuth,
  uploadComprobante.single('comprobante'),
  (req, res) => {
    if (!req.file) throw new AppError('No se recibió ningún archivo', 400);
    const baseUrl = `${req.protocol}://${req.get('host')}`;
    const url = `${baseUrl}/uploads/comprobantes/${req.file.filename}`;
    res.json({
      url,
      nombre: req.file.originalname,
      mimeType: req.file.mimetype,
      tamanioBytes: req.file.size,
    });
  },
);

// ─── GET /citas ───────────────────────────────────────────────────────────────
router.get('/', requireAuth, async (req, res) => {
  const { sedeId, fecha, profesionalId, unidadNegocioId, pacienteId, estado } = req.query as Record<string, string>;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const where: Record<string, any> = {
    deletedAt: null,
  };

  if (sedeId) where.sedeId = sedeId;
  if (fecha) where.fecha = fechaDb(fecha);
  if (profesionalId) where.profesionalId = profesionalId;
  if (unidadNegocioId) where.unidadNegocioId = unidadNegocioId;
  if (pacienteId) where.pacienteId = pacienteId;
  if (estado) where.estado = estado as never;

  const citas = await prisma.cita.findMany({
    where,
    include: {
      // email/fechaNacimiento/requiereActualizacionDatos alimentan el toggle
      // "Actualizar datos" del PopoverCita (la bandera es la calculada server-side).
      paciente: { select: { id: true, nombres: true, apellidoPaterno: true, apellidoMaterno: true, tipoDocumento: true, numeroDocumento: true, telefono: true, email: true, fechaNacimiento: true, requiereActualizacionDatos: true } },
      profesional: { select: { id: true, nombres: true, apellidos: true, colorAvatar: true } },
      solicitadoProfesional: { select: { id: true, nombres: true, apellidos: true, tipo: true } },
      sede: { select: { id: true, nombre: true, color: true } },
      unidadNegocio: { select: { id: true, nombre: true, color: true } },
      servicio: { select: { id: true, nombre: true, duracionMinutos: true, color: true } },
      subcategoria: { select: { id: true, nombre: true } },
      paquetePaciente: { select: { id: true, sesionesTotal: true, sesionesUsadas: true, paquete: { select: { nombre: true } } } },
      promocion: { select: promoCitaSelect },
      comentarios: comentariosInclude,
    },
    orderBy: [{ fecha: 'asc' }, { horaInicio: 'asc' }],
  });

  // Promo HEREDADA: para las citas SECUNDARIO de un bloque, su promo es la de la PRINCIPAL
  // (portadora). Se arma un mapa slotGrupoId → promo de la PRINCIPAL y se adjunta. Las
  // PRINCIPAL/individuales llevan su propio `promocion`; ningún conteo suma la heredada.
  const promoPorGrupo = new Map<string, typeof citas[number]['promocion']>();
  for (const c of citas) if (c.slotGrupoId && c.slotRol === 'PRINCIPAL') promoPorGrupo.set(c.slotGrupoId, c.promocion);

  // Alerta de comportamiento (no-show / reprogramador frecuente) y posibles
  // familiares (mismo teléfono) por paciente, para mostrarlos en la agenda/popover.
  const ids = citas.map((c) => c.pacienteId);
  const [alertas, familiares] = await Promise.all([
    alertasDePacientes(ids),
    familiaresDePacientes(ids),
  ]);
  const conAlerta = citas.map((c) => ({
    ...c,
    promocionHeredada: (c.slotGrupoId && c.slotRol === 'SECUNDARIO') ? (promoPorGrupo.get(c.slotGrupoId) ?? null) : null,
    paciente: {
      ...c.paciente,
      alerta: alertas.get(c.pacienteId) ?? null,
      familiares: familiares.get(c.pacienteId) ?? [],
    },
  }));

  res.json(conAlerta);
});

// ─── Página HTML pública (confirmar/cancelar desde el correo) ─────────────────
// Branding Limablue mínimo y autocontenido (sin assets externos = portable).
function paginaPublica(opts: { ok: boolean; titulo: string; mensaje: string; detalle?: string }): string {
  const color = opts.ok ? '#16a34a' : '#dc2626';
  const icono = opts.ok ? '✅' : '⚠️';
  const bloqueDetalle = opts.detalle
    ? `<div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:12px;padding:14px 18px;margin:0 0 20px;color:#334155;font-size:14px;line-height:1.6;">${opts.detalle}</div>`
    : '';
  // Mismo logo que el correo (assets/correo/logo-correo.png) incrustado como data-URI.
  // La página web no puede usar `cid:`, así que se embebe en base64. Si no hay archivo,
  // cae al recuadro "LB" + nombre (comportamiento previo).
  const logo = logoAdjunto();
  const cabecera = logo
    ? `<img src="data:${logo.mime};base64,${logo.base64}" alt="Limablue · Salud del pie" width="160" style="display:inline-block;max-width:75%;height:auto;">`
    : `<span style="display:inline-block;background:#fff;color:#1e40af;font-weight:800;font-size:16px;width:38px;height:38px;line-height:38px;border-radius:10px;">LB</span>
      <div style="color:#fff;font-weight:700;font-size:16px;margin-top:8px;">Limablue · Salud del pie</div>`;
  return `<!DOCTYPE html>
<html lang="es"><head><meta charset="UTF-8"/><meta name="viewport" content="width=device-width,initial-scale=1.0"/>
<title>Limablue · ${opts.titulo}</title></head>
<body style="font-family:Arial,Helvetica,sans-serif;background:#eef2f7;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;padding:24px;">
  <div style="background:#fff;border-radius:18px;max-width:420px;width:100%;overflow:hidden;box-shadow:0 2px 10px rgba(15,23,42,.1);">
    <div style="background:#1e3a8a;padding:22px;text-align:center;">
      ${cabecera}
    </div>
    <div style="padding:32px;text-align:center;">
      <div style="font-size:46px;margin-bottom:10px;">${icono}</div>
      <h1 style="color:${color};font-size:21px;margin:0 0 10px;">${opts.titulo}</h1>
      ${bloqueDetalle}
      <p style="color:#475569;font-size:15px;line-height:1.6;margin:0;">${opts.mensaje}</p>
    </div>
  </div>
</body></html>`;
}

function detalleCita(c: { servicio: { nombre: string }; fecha: Date; horaInicio: string; sede: { nombre: string } }): string {
  // fecha es @db.Date (medianoche UTC) → usamos getters UTC para no desfasar el día.
  const f = c.fecha;
  const dd = String(f.getUTCDate()).padStart(2, '0');
  const mm = String(f.getUTCMonth() + 1).padStart(2, '0');
  const yyyy = f.getUTCFullYear();
  return `<strong>${c.servicio.nombre}</strong><br/>${dd}/${mm}/${yyyy} · ${c.horaInicio}<br/>${c.sede.nombre}`;
}

// ─── POST /citas/outlook/reintentar ──── (reprocesa sincronizaciones fallidas) ─
router.post('/outlook/reintentar', requireAuth, requireRol('admin'), async (_req, res) => {
  const resultado = await reintentarOutlookFallidos();
  res.json(resultado);
});

// ─── POST /citas/:id/confirmar-mail ──── (reenvío manual del recordatorio) ─────
// Reenvía AHORA el Correo 2 (recordatorio con botones confirmar/reprogramar).
router.post('/:id/confirmar-mail', requireAuth, async (req, res) => {
  const cita = await prisma.cita.findUnique({
    where: { id: req.params.id, deletedAt: null },
    include: { paciente: { select: { email: true } } },
  });
  if (!cita) throw new AppError('Cita no encontrada', 404);
  if (ESTADOS_FINALES.includes(cita.estado)) {
    throw new AppError('No se puede enviar confirmación de una cita cancelada o finalizada', 400, 'ESTADO_FINAL');
  }
  if (!cita.paciente.email) {
    throw new AppError('El paciente no tiene correo registrado. Agrega un correo en su ficha.', 400, 'SIN_CORREO');
  }

  try {
    const { to, estado } = await forzarEnvioRecordatorioAhora(cita.id);
    if (estado === 'diferido') throw new AppError('Se alcanzó el límite diario de correos. El recordatorio quedó en cola para el día siguiente.', 429, 'CUOTA_DIARIA');
    await registrarAudit({ citaId: cita.id, usuarioId: req.user?.userId, accion: 'recordatorio_reenvio_manual', entidad: 'cita', entidadId: cita.id, ip: req.ip });
    res.json({ ok: true, to });
  } catch (err) {
    if (err instanceof AppError) throw err;
    const msg = err instanceof Error ? err.message : 'Error al enviar';
    throw new AppError(`No se pudo enviar el correo: ${msg}`, 502, 'ENVIO_FALLIDO');
  }
});

// ─── GET /citas/confirmar?token= ──────────── (público, desde el correo) ───────
// ─── GET /citas/calendario?token= ───────── (público, botón "Agregar a mi agenda") ─
// Entrega el .ics de la cita. Al abrirlo desde el celular, el sistema lo agrega
// al calendario del paciente en cualquier proveedor (Google, Apple, Outlook).
router.get('/calendario', async (req, res) => {
  const token = req.query.token as string | undefined;
  if (!token) { res.status(400).send('Falta el token.'); return; }

  let citaId: string;
  try {
    citaId = verificarTokenConfirmacion(token).citaId;
  } catch {
    res.status(400).send('Enlace inválido o vencido.');
    return;
  }

  const cita = await prisma.cita.findUnique({
    where: { id: citaId },
    include: {
      servicio: { select: { nombre: true, duracionMinutos: true } },
      profesional: { select: { nombres: true, apellidos: true } },
      sede: { select: { nombre: true, direccion: true } },
    },
  });
  if (!cita || cita.deletedAt) { res.status(404).send('Cita no encontrada.'); return; }

  const ics = construirIcsDeCita(cita);
  res.setHeader('Content-Type', 'text/calendar; charset=utf-8; method=PUBLISH');
  res.setHeader('Content-Disposition', 'attachment; filename="cita-limablue.ics"');
  res.send(ics);
});

router.get('/confirmar', async (req, res) => {
  const token = req.query.token as string | undefined;
  if (!token) {
    res.status(400).send(paginaPublica({ ok: false, titulo: 'Enlace inválido', mensaje: 'Falta el token de confirmación.' }));
    return;
  }

  let citaId: string;
  try {
    citaId = verificarTokenConfirmacion(token).citaId;
  } catch {
    res.status(400).send(paginaPublica({ ok: false, titulo: 'Enlace inválido o vencido', mensaje: 'Este enlace ya no es válido. Comunícate con Limablue para confirmar tu cita.' }));
    return;
  }

  const cita = await prisma.cita.findUnique({
    where: { id: citaId },
    include: { servicio: { select: { nombre: true } }, sede: { select: { nombre: true } } },
  });
  if (!cita || cita.deletedAt) {
    res.status(404).send(paginaPublica({ ok: false, titulo: 'Cita no encontrada', mensaje: 'No encontramos esta cita.' }));
    return;
  }

  const detalle = detalleCita(cita);

  // Idempotente: confirmar dos veces no rompe nada.
  if (cita.estadoConfirmacion === 'confirmada') {
    res.send(paginaPublica({ ok: true, titulo: 'Tu cita ya estaba confirmada', mensaje: '¡Te esperamos!', detalle }));
    return;
  }
  if (cita.estado === 'cancelada' || cita.estadoConfirmacion === 'cancelada') {
    res.send(paginaPublica({ ok: false, titulo: 'Esta cita fue cancelada', mensaje: 'Si necesitas reagendar, comunícate con Limablue.', detalle }));
    return;
  }

  const nuevoEstado = cita.estado === 'agendada' ? 'confirmada' : cita.estado;
  await prisma.cita.update({
    where: { id: cita.id },
    data: { estadoConfirmacion: 'confirmada', confirmadaEn: new Date(), estado: nuevoEstado as never },
  });
  // Ya confirmó: detener el recordatorio pendiente y su job para no reenviar
  // "confirma tu asistencia" después de que el paciente ya confirmó.
  void cancelarRecordatoriosDeCita(cita.id);

  // Refrescar agenda en vivo (best effort).
  try {
    const fechaStr = cita.fecha.toISOString().split('T')[0]!;
    emitirEventoCita({ tipo: 'cita:estadoCambiado', sedeId: cita.sedeId, fecha: fechaStr, cita: { id: cita.id, estado: nuevoEstado } as never, cambiadoPor: 'paciente' });
    await invalidateDisponibilidadCache(cita.sedeId, fechaStr);
  } catch { /* no crítico */ }

  res.send(paginaPublica({ ok: true, titulo: '¡Cita confirmada!', mensaje: 'Gracias por confirmar. ¡Te esperamos en Limablue!', detalle }));
});

// ─── GET /citas/cancelar?token= ──────────── (público, desde el correo) ────────
router.get('/cancelar', async (req, res) => {
  const token = req.query.token as string | undefined;
  if (!token) {
    res.status(400).send(paginaPublica({ ok: false, titulo: 'Enlace inválido', mensaje: 'Falta el token de cancelación.' }));
    return;
  }

  let citaId: string;
  try {
    citaId = verificarTokenConfirmacion(token).citaId;
  } catch {
    res.status(400).send(paginaPublica({ ok: false, titulo: 'Enlace inválido o vencido', mensaje: 'Este enlace ya no es válido. Comunícate con Limablue.' }));
    return;
  }

  const cita = await prisma.cita.findUnique({
    where: { id: citaId },
    include: { servicio: { select: { nombre: true } }, sede: { select: { nombre: true } } },
  });
  if (!cita || cita.deletedAt) {
    res.status(404).send(paginaPublica({ ok: false, titulo: 'Cita no encontrada', mensaje: 'No encontramos esta cita.' }));
    return;
  }

  const detalle = detalleCita(cita);

  // Idempotente.
  if (cita.estado === 'cancelada' || cita.estadoConfirmacion === 'cancelada') {
    res.send(paginaPublica({ ok: true, titulo: 'Tu cita ya estaba cancelada', mensaje: 'No se realizó ningún cobro. Comunícate con Limablue si deseas reagendar.', detalle }));
    return;
  }
  if (['completada', 'no_show', 'en_atencion', 'llego'].includes(cita.estado)) {
    res.send(paginaPublica({ ok: false, titulo: 'No se puede cancelar', mensaje: 'Esta cita ya está en curso o fue atendida. Comunícate con Limablue.', detalle }));
    return;
  }

  await prisma.cita.update({
    where: { id: cita.id },
    data: {
      estado: 'cancelada',
      estadoConfirmacion: 'cancelada',
      motivoCancelacion: 'Cancelada por el paciente desde el correo de confirmación',
    },
  });
  // Cancelación de ORIGEN PACIENTE (vía token del correo): acción propia y sin usuarioId,
  // para distinguirla de las cancelaciones internas ('cancelar'/'cambiar_estado').
  await registrarAudit({
    citaId: cita.id, accion: 'cancelar_por_paciente', entidad: 'cita', entidadId: cita.id,
    antes: { estado: cita.estado }, despues: { estado: 'cancelada', origen: 'token_correo' },
    sedeId: cita.sedeId, ip: req.ip,
  });

  try {
    const fechaStr = cita.fecha.toISOString().split('T')[0]!;
    emitirEventoCita({ tipo: 'cita:estadoCambiado', sedeId: cita.sedeId, fecha: fechaStr, cita: { id: cita.id, estado: 'cancelada' } as never, cambiadoPor: 'paciente' });
    await invalidateDisponibilidadCache(cita.sedeId, fechaStr);
  } catch { /* no crítico */ }

  res.send(paginaPublica({ ok: true, titulo: 'Cita cancelada', mensaje: 'Tu cita fue cancelada. Si deseas reagendar, comunícate con Limablue.', detalle }));
});

// ─── GET /citas/confirmar/:token ─── (público, botón del recordatorio) ─────────
// Token de un solo uso. Cambia el estado de la cita a CONFIRMADO sin login.
router.get('/confirmar/:token', async (req, res) => {
  const r = await consumirTokenAccion(req.params.token, 'confirmar');
  if (!r.ok) {
    const msg = r.motivo === 'ya_usado'
      ? 'Este enlace ya fue utilizado. Tu cita ya estaba confirmada.'
      : r.motivo === 'expirado'
        ? 'Este enlace ya venció. Comunícate con Limablue para confirmar tu cita.'
        : 'Enlace inválido.';
    res.status(r.motivo === 'ya_usado' ? 200 : 400).send(paginaPublica({ ok: r.motivo === 'ya_usado', titulo: r.motivo === 'ya_usado' ? 'Tu cita ya estaba confirmada' : 'Enlace no válido', mensaje: msg }));
    return;
  }

  const cita = await prisma.cita.findUnique({
    where: { id: r.citaId! },
    include: { servicio: { select: { nombre: true } }, sede: { select: { nombre: true } } },
  });
  if (!cita || cita.deletedAt) {
    res.status(404).send(paginaPublica({ ok: false, titulo: 'Cita no encontrada', mensaje: 'No encontramos esta cita.' }));
    return;
  }
  const detalle = detalleCita(cita);
  if (cita.estado === 'cancelada' || cita.estadoConfirmacion === 'cancelada') {
    res.send(paginaPublica({ ok: false, titulo: 'Esta cita fue cancelada', mensaje: 'Comunícate con Limablue para reagendar.', detalle }));
    return;
  }

  const nuevoEstado = cita.estado === 'agendada' ? 'confirmada' : cita.estado;
  const ahora = new Date();
  await prisma.cita.update({
    where: { id: cita.id },
    data: { estado: nuevoEstado as never, estadoConfirmacion: 'confirmada', confirmadaEn: ahora },
  });
  await prisma.recordatorioCita.updateMany({
    where: { citaId: cita.id, tipo: 'RECORDATORIO', deletedAt: null },
    data: { clickConfirmarAt: ahora, confirmadoAt: ahora },
  });
  // Ya confirmó: detener el recordatorio pendiente y su job (no reenviar tras confirmar).
  void cancelarRecordatoriosDeCita(cita.id);

  try {
    const fechaStr = cita.fecha.toISOString().split('T')[0]!;
    emitirEventoCita({ tipo: 'cita:estadoCambiado', sedeId: cita.sedeId, fecha: fechaStr, cita: { id: cita.id, estado: nuevoEstado } as never, cambiadoPor: 'paciente' });
    await invalidateDisponibilidadCache(cita.sedeId, fechaStr);
  } catch { /* no crítico */ }
  await registrarAudit({ citaId: cita.id, accion: 'confirmar_recordatorio', entidad: 'cita', entidadId: cita.id, despues: { estadoConfirmacion: 'confirmada' }, sedeId: cita.sedeId, ip: req.ip });

  res.send(paginaPublica({ ok: true, titulo: '¡Cita confirmada!', mensaje: 'Gracias por confirmar. ¡Te esperamos en Limablue!', detalle }));
});

// ─── GET /citas/reprogramar/:token ─── (público; registra y redirige a WhatsApp) ─
router.get('/reprogramar/:token', async (req, res) => {
  const numero = (process.env.WHATSAPP_NUMERO || '').replace(/\D/g, '');
  const texto = encodeURIComponent('Hola, deseo reprogramar mi cita, por favor.');
  const waUrl = `https://wa.me/${numero}?text=${texto}`;

  const r = await consumirTokenAccion(req.params.token, 'reprogramar');
  if (r.ok && r.citaId) {
    const ahora = new Date();
    await prisma.recordatorioCita.updateMany({
      where: { citaId: r.citaId, tipo: 'RECORDATORIO', deletedAt: null },
      data: { clickReprogramarAt: ahora },
    });
    await registrarAudit({ citaId: r.citaId, accion: 'click_reprogramar', entidad: 'cita', entidadId: r.citaId, ip: req.ip });
  }
  // Aunque el token sea inválido/expirado, redirigimos igual a WhatsApp (no romper al paciente).
  res.redirect(302, waUrl);
});

// ─── GET /citas/:id ───────────────────────────────────────────────────────────
router.get('/:id', requireAuth, async (req, res) => {
  const cita = await getCitaCompleta(req.params.id);
  if (!cita || cita.deletedAt) throw new AppError('Cita no encontrada', 404);
  res.json(cita);
});

// ─── POST /citas (crear cita) ─────────────────────────────────────────────────
router.post('/', requireAuth, requireScope('appointments:write'), async (req: Request, res) => {
  const idempotencyKey = req.headers['idempotency-key'] as string | undefined;

  // Idempotencia: si ya existe una cita con esta key, devolverla
  if (idempotencyKey) {
    const existe = await prisma.cita.findFirst({
      where: { idempotencyKey, deletedAt: null },
    });
    if (existe) {
      res.status(200).json(await getCitaCompleta(existe.id));
      return;
    }
  }

  const data = crearCitaSchema.parse(req.body);
  await validarCanal(data.canal);
  const usuarioId = req.user?.userId;

  // Verificar que la unidad opera en la sede
  const sedeUnidad = await prisma.sedeUnidadNegocio.findUnique({
    where: { sedeId_unidadNegocioId: { sedeId: data.sedeId, unidadNegocioId: data.unidadNegocioId } },
  });
  if (!sedeUnidad) throw new AppError('La unidad de negocio no opera en esta sede', 400, 'UNIDAD_NO_EN_SEDE');

  // Obtener servicio
  const servicio = await prisma.servicio.findUnique({ where: { id: data.servicioId } });
  if (!servicio || !servicio.activo) throw new AppError('Servicio no encontrado o inactivo', 404);
  if (servicio.unidadNegocioId !== data.unidadNegocioId) {
    throw new AppError('El servicio no pertenece a la unidad de negocio indicada', 400);
  }

  // Servicios de 1 hora solo en hora entera (08:00, 09:00, …)
  if (!horaInicioValidaParaDuracion(data.horaInicio, servicio.duracionMinutos)) {
    throw new AppError('Los servicios de 1 hora solo pueden iniciarse en hora entera (08:00, 09:00, …)', 400, 'SLOT_HORA_INVALIDA');
  }

  // Subcategoría (ej. Profilaxis → Regular/Premium/…): obligatoria si el servicio la tiene.
  const subcategoriaId = await resolverSubcategoria(data.servicioId, data.subcategoriaId);

  // Obtener unidad de negocio
  const unidad = await prisma.unidadNegocio.findUnique({ where: { id: data.unidadNegocioId } });
  if (!unidad) throw new AppError('Unidad de negocio no encontrada', 404);

  // Determinar profesional
  let profesionalId: string | null = data.profesionalId ?? null;
  // Doctor pedido "Solo X" (baro): la cita va en una máquina, este guarda al médico.
  let solicitadoProfesionalId: string | null = null;
  let origenAsignacion: 'elegida_por_paciente' | 'asignada_automaticamente' | null = null;

  if (unidad.modoReserva === 'sin_eleccion') {
    // Baropodometría: siempre asignación automática
    profesionalId = await seleccionarProfesionalOptimo(
      data.sedeId, data.unidadNegocioId, data.servicioId, data.fecha, data.horaInicio
    );
    if (!profesionalId) throw new AppError('No hay profesionales disponibles para este slot', 409, 'NO_DISPONIBLE');
    origenAsignacion = 'asignada_automaticamente';
  } else if (unidad.modoReserva === 'preferencia_opcional') {
    if (!profesionalId) {
      // Sin preferencia: asignación automática
      profesionalId = await seleccionarProfesionalOptimo(
        data.sedeId, data.unidadNegocioId, data.servicioId, data.fecha, data.horaInicio
      );
      if (!profesionalId) throw new AppError('No hay profesionales disponibles para este slot', 409, 'NO_DISPONIBLE');
      origenAsignacion = 'asignada_automaticamente';
    } else {
      // Si el elegido atiende este servicio SOLO POR SOLICITUD (médicos de baro, Daniel en
      // baro), NO se le crea columna: la cita ocupa una MÁQUINA libre (Baro 1/2) y se guarda
      // el médico pedido para mostrar "Solo X". Solo hay tantas máquinas como slots existan.
      const compElegida = await prisma.competenciaProfesional.findFirst({
        where: { profesionalId, servicioId: data.servicioId, activa: true },
      });
      if (compElegida?.soloPorSolicitud) {
        solicitadoProfesionalId = profesionalId;
        profesionalId = await seleccionarProfesionalOptimo(
          data.sedeId, data.unidadNegocioId, data.servicioId, data.fecha, data.horaInicio
        );
        if (!profesionalId) throw new AppError('No hay máquina disponible para baropodometría en este horario', 409, 'NO_DISPONIBLE');
      }
      origenAsignacion = 'elegida_por_paciente';
    }
  } else {
    // preferencia_obligatoria (Fisioterapia)
    if (!profesionalId) throw new AppError('Se requiere seleccionar una fisioterapeuta', 400, 'PROFESIONAL_REQUERIDO');
    origenAsignacion = 'elegida_por_paciente';
  }

  // ─── LOCK anti doble-booking ──────────────────────────────────────────────
  const lockId = uuidv4();
  const lockAcquired = await acquireSlotLock(data.sedeId, profesionalId!, data.fecha, data.horaInicio, lockId);
  if (!lockAcquired) {
    throw new AppError('Slot en proceso de reserva, intente nuevamente', 409, 'SLOT_LOCKED');
  }

  try {
    // Verificar que el profesional tiene el servicio habilitado
    const competencia = await prisma.competenciaProfesional.findFirst({
      where: { profesionalId: profesionalId!, servicioId: data.servicioId, activa: true },
    });
    if (!competencia) throw new AppError('El profesional no tiene habilitado este servicio', 400, 'SIN_COMPETENCIA');

    // Si la competencia usada es "solo por solicitud" (médicos de baro, Daniel en baro), el
    // profesional atiende en CUALQUIER sede a pedido del paciente, sin asignación fija. Para
    // competencias normales (p.ej. Daniel en podología) sí debe estar asignado a la sede.
    if (!competencia.soloPorSolicitud) {
      const fechaAsignacion = fechaDb(data.fecha);
      const asignacionSede = await prisma.asignacionSede.findFirst({
        where: {
          profesionalId: profesionalId!,
          sedeId: data.sedeId,
          activa: true,
          fechaInicio: { lte: fechaAsignacion },
          OR: [{ fechaFin: null }, { fechaFin: { gte: fechaAsignacion } }],
        },
      });
      if (!asignacionSede) throw new AppError('El profesional no está asignado a esta sede en la fecha indicada', 400, 'SIN_ASIGNACION_SEDE');
    }

    const fechaDate = fechaDb(data.fecha);
    // Verificar el TURNO del profesional ese día (normal por HorarioProfesional, o
    // excepcional por excepción-de-sede-abierta + EntradaPodologa — ver turnosDelDia).
    const turnos = await turnosDelDia(data.sedeId, data.fecha, [profesionalId!]);
    const horario = turnos.get(profesionalId!);
    if (!horario) throw new AppError('El profesional no atiende este día', 400, 'SIN_HORARIO');

    // Verificar que el slot está dentro del rango horaInicio..horaFin del turno
    if (data.horaInicio < horario.horaInicio || data.horaInicio >= horario.horaFin) {
      throw new AppError(
        `El slot ${data.horaInicio} está fuera del horario del profesional (${horario.horaInicio}–${horario.horaFin})`,
        400,
        'SLOT_FUERA_HORARIO',
      );
    }

    // Verificar que el slot no choca con un bloqueo del profesional (permiso, almuerzo, etc.)
    await validarSinBloqueo(profesionalId!, data.fecha, data.horaInicio, servicio.duracionMinutos);

    // Anti doble-booking CRUZADO entre unidades: el profesional efectivo y, si la cita
    // es "Solo X" (baro), el médico solicitado, no pueden estar ocupados en otra unidad
    // a esa hora. (El índice de slot solo cubre el mismo profesionalId; esto cubre el
    // caso Daniel en Podología ↔ Baropodometría.)
    await validarProfesionalLibre(profesionalId!, data.fecha, data.horaInicio, servicio.duracionMinutos);
    if (solicitadoProfesionalId) {
      await validarProfesionalLibre(solicitadoProfesionalId, data.fecha, data.horaInicio, servicio.duracionMinutos);
      // El médico pedido "Solo X" (p.ej. Daniel en baro) también debe estar libre de BLOQUEOS
      // (reunión, permiso, almuerzo): la cita va en una máquina, pero él no puede atenderla si
      // tiene una reunión a esa hora. Sin esto, su reunión bloqueaba podología pero NO baro.
      await validarSinBloqueo(solicitadoProfesionalId, data.fecha, data.horaInicio, servicio.duracionMinutos);
    }

    // Comentario inicial (opcional): se guarda como primera ENTRADA del hilo
    // append-only (ya no en una columna de la cita).
    const comentarioInicial = data.comentarioRecepcion?.trim() || null;

    // Calcular número de sesión si hay paquete.
    // sesionesUsadas = sesiones ya CONSUMIDAS (solo citas completada; no_show NO consume).
    // citasProgramadas = citas activas (aún no completadas) que ya reservaron una sesión.
    // La nueva cita toma el siguiente número disponible.
    let sesionNumero: number | null = null;
    let reanclajeGenexis: { paqueteId: string; objetivoApertura: number; sesionElegida: number } | null = null;
    if (data.paquetePacienteId) {
      const paquetePac = await prisma.paquetePaciente.findUnique({ where: { id: data.paquetePacienteId } });
      if (paquetePac) {
        // Candado de sede TAMBIÉN al agendar: el paquete se atiende donde se compró.
        if (paquetePac.sedeId && paquetePac.sedeId !== data.sedeId) {
          const sedePaquete = await prisma.sede.findUnique({ where: { id: paquetePac.sedeId }, select: { nombre: true } });
          throw new AppError(
            `El paquete de este paciente pertenece a ${sedePaquete?.nombre ?? 'otra sede'} — agenda la sesión allá o usa consumo manual auditado.`,
            409,
            'PAQUETE_OTRA_SEDE',
          );
        }
        const citasProgramadas = await prisma.cita.count({
          where: {
            paquetePacienteId: data.paquetePacienteId,
            estado: { in: ['agendada', 'confirmada', 'llego', 'en_atencion'] },
            deletedAt: null,
          },
        });
        const citasVivasPaquete = await prisma.cita.count({
          where: { paquetePacienteId: data.paquetePacienteId, deletedAt: null, estado: { notIn: ['cancelada', 'no_show', 'reprogramada'] } },
        });
        const esGenexisSinAnclar = paquetePac.origen === 'GENEXIS_APERTURA' && citasVivasPaquete === 0;
        if (esGenexisSinAnclar) {
          // MIGRACIÓN GENEXIS — ADJUDICACIÓN MANUAL CON REANCLAJE: la primera cita
          // del paquete en la Agenda nueva la numera RECEPCIÓN mirando el visor
          // Genexis (desplegable con TODAS las sesiones). Su elección re-ancla el
          // paquete: sesiones previas = tomadas en Genexis (se ajusta la apertura),
          // y DESDE LA SIGUIENTE la numeración es automática (como paquete nativo).
          if (!data.sesionNumeroManual) {
            throw new AppError(
              'Este paquete viene de Genexis: elige del desplegable qué sesión corresponde (revisa el Historial Genexis).',
              400,
              'SESION_MANUAL_REQUERIDA',
            );
          }
          if (data.sesionNumeroManual > paquetePac.sesionesTotal) {
            throw new AppError(`La sesión ${data.sesionNumeroManual} excede el paquete (${paquetePac.sesionesTotal})`, 400, 'SESION_FUERA_DE_RANGO');
          }
          const otrosVivos = await prisma.consumoSesion.count({
            where: { paqueteId: data.paquetePacienteId, deletedAt: null, origen: { not: 'APERTURA' } },
          });
          const objetivoApertura = data.sesionNumeroManual - 1 - otrosVivos;
          if (objetivoApertura < 0) {
            throw new AppError(
              `Ya hay ${otrosVivos} sesión(es) consumidas en la Agenda — la sesión ${data.sesionNumeroManual} no es posible`,
              409,
              'SESION_INCOMPATIBLE',
            );
          }
          sesionNumero = data.sesionNumeroManual;
          reanclajeGenexis = { paqueteId: data.paquetePacienteId, objetivoApertura, sesionElegida: data.sesionNumeroManual };
        } else {
          // Numeración AUTOMÁTICA: paquetes nacidos en la Agenda y paquetes Genexis
          // YA ANCLADOS por una primera adjudicación manual.
          if (paquetePac.sesionesUsadas + citasProgramadas >= paquetePac.sesionesTotal) {
            throw new AppError(
              `El paquete ya no tiene sesiones disponibles (${paquetePac.sesionesTotal}/${paquetePac.sesionesTotal} usadas o agendadas). Active un paquete nuevo si el paciente lo requiere.`,
              409,
              'PAQUETE_SIN_SESIONES',
            );
          }
          sesionNumero = paquetePac.sesionesUsadas + citasProgramadas + 1;
        }
      }
    }

    // Creación + audit en la MISMA transacción (historial inmutable y atómico).
    // `withDeadlockRetry` + Serializable: bajo alta concurrencia dos INSERT de citas que
    // referencian filas padre compartidas por FK (profesional/sede/servicio/promoción)
    // pueden deadlockear (Postgres 40P01 → Prisma P2034). El retry reintenta la víctima
    // ya sin contención; el índice único parcial sigue siendo la última defensa real. El
    // retry vive DENTRO del try/finally externo → el lock Redis se sostiene entre intentos
    // y se libera una sola vez al final (nunca huérfano). Igual patrón que /citas/combinada.
    let cita;
    try {
      cita = await withDeadlockRetry(
        () => prisma.$transaction(async (tx) => {
          // REANCLAJE GENEXIS: ajustar la apertura para que las sesiones previas a la
      // elegida queden como tomadas en Genexis (recepción manda sobre la conciliación).
      if (reanclajeGenexis) {
        const aperturaVivos = await tx.consumoSesion.findMany({
          where: { paqueteId: reanclajeGenexis.paqueteId, origen: 'APERTURA', deletedAt: null },
          orderBy: { creadoEn: 'desc' },
          select: { id: true },
        });
        const diff = aperturaVivos.length - reanclajeGenexis.objetivoApertura;
        if (diff > 0) {
          await tx.consumoSesion.updateMany({
            where: { id: { in: aperturaVivos.slice(0, diff).map((k) => k.id) } },
            data: { deletedAt: new Date(), anuladoMotivo: `Reanclaje: recepción adjudicó la sesión ${reanclajeGenexis.sesionElegida} (visor Genexis)` },
          });
        } else if (diff < 0) {
          await tx.consumoSesion.createMany({
            data: Array.from({ length: -diff }, () => ({
              paqueteId: reanclajeGenexis!.paqueteId,
              fecha: new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Lima' })).toISOString().slice(0, 10),
              origen: 'APERTURA',
              registradoPor: `Reanclaje: recepción adjudicó la sesión ${reanclajeGenexis.sesionElegida} (visor Genexis)`,
              registradoPorId: usuarioId ?? null,
            })),
          });
        }
        await recalcularPaquete(tx, reanclajeGenexis.paqueteId);
        await auditEnTx(tx, {
          usuarioId,
          accion: 'reanclar_apertura_genexis',
          entidad: 'paquete_paciente',
          entidadId: reanclajeGenexis.paqueteId,
          antes: { aperturaConsumidas: aperturaVivos.length },
          despues: { aperturaConsumidas: reanclajeGenexis.objetivoApertura, sesionAdjudicada: reanclajeGenexis.sesionElegida },
        });
      }
      const c = await tx.cita.create({
        data: {
          pacienteId: data.pacienteId,
          profesionalId,
          solicitadoProfesionalId,
          sedeId: data.sedeId,
          unidadNegocioId: data.unidadNegocioId,
          servicioId: data.servicioId,
          subcategoriaId,
          fecha: fechaDate,
          horaInicio: data.horaInicio,
          duracionMinutos: servicio.duracionMinutos,
          estado: 'agendada',
          canal: data.canal,
          origenAsignacion,
          creadoPorUsuarioId: usuarioId ?? null, // quién hizo la reserva
          idempotencyKey: idempotencyKey ?? null,
          paquetePacienteId: data.paquetePacienteId,
          promocionId: data.promocionId ?? null,
          sesionNumero,
          comprobanteUrl:      data.comprobanteUrl      ?? null,
          comprobanteNombre:   data.comprobanteNombre   ?? null,
          comprobanteMimeType: data.comprobanteMimeType ?? null,
          comprobanteSubidoPor: data.comprobanteUrl ? usuarioId : null,
          comprobanteSubidoEn:  data.comprobanteUrl ? new Date() : null,
        },
      });
      await auditEnTx(tx, {
        citaId: c.id,
        usuarioId,
        accion: 'crear',
        entidad: 'cita',
        entidadId: c.id,
        despues: c,
        sedeId: data.sedeId,
        ip: req.ip,
      });
      if (comentarioInicial) {
        await crearComentarioEnTx(tx, { citaId: c.id, sedeId: data.sedeId, autorId: usuarioId ?? null, texto: comentarioInicial, ip: req.ip });
      }
          return c;
        }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }),
        {
          onRetry: ({ intento, esperaMs }) =>
            console.warn(`[citas] deadlock al crear cita — reintento ${intento} en ${esperaMs}ms (slot ${data.sedeId}/${profesionalId}/${data.fecha} ${data.horaInicio})`),
        },
      );
    } catch (err) {
      // Unicidad (P2002) o deadlock que agotó los reintentos → 409 limpio, nunca 500. El
      // índice único parcial es la última defensa; un AppError de negocio (slot ocupado,
      // horario inválido…) pasa intacto sin convertirse en SLOT_OCUPADO. `esConflictoDeSlot`
      // cubre tanto el P2034 clasificado por Prisma como el 40P01/40001 CRUDO que Prisma
      // re-lanza como PrismaClientUnknownRequestError (que antes caía al 500, ver Gate 0).
      if (esConflictoDeSlot(err)) {
        throw new AppError('Ese horario acaba de ocuparse. Refresque e intente otra vez.', 409, 'SLOT_OCUPADO');
      }
      throw err;
    }

    // Invalidar cache
    await invalidateDisponibilidadCache(data.sedeId, data.fecha);

    // Obtener cita completa
    const citaCompleta = await getCitaCompleta(cita.id);

    // Emitir evento WebSocket
    emitirEventoCita({
      tipo: 'cita:creada',
      sedeId: data.sedeId,
      fecha: data.fecha,
      cita: citaCompleta as never,
      cambiadoPor: req.user?.userId ?? 'sistema',
    });

    // Disparar webhooks
    await dispararWebhooks('appointment.created', data.sedeId, citaCompleta);

    // RECORDATORIOS: Correo 1 (reserva, inmediato) + programa Correo 2
    // (recordatorio con acciones) según las reglas de tiempo. Fire-and-forget.
    void programarRecordatoriosDeCita(cita.id);
    // VIDEOS POR SERVICIO: registra los envíos programados de los videos del servicio.
    void sincronizarVideosDeCita(cita.id);
    // Replica en Outlook si la cita es de Yasica/Daniel Doy (no bloqueante).
    void sincronizarCitaOutlook('crear', cita.id);

    res.status(201).json(citaCompleta);
  } finally {
    await releaseSlotLock(data.sedeId, profesionalId!, data.fecha, data.horaInicio, lockId);
  }
});

// ─── Helpers para bloques combinados ──────────────────────────────────────────

// Valida una "pata" del bloque (ancla o extra) tratándola como una ocupación
// independiente: competencia, asignación a sede, turno, bloqueos y cruce de horario.
// Reutiliza exactamente los mismos chequeos que el POST individual. `duracionSlot` es
// la duración del SLOT físico (la del ancla, 60 min) — ambas patas comparten inicio/fin.
async function validarLegBloque(opts: {
  profesionalId: string; sedeId: string; servicioId: string; unidadNegocioId: string;
  fecha: string; horaInicio: string; duracionSlot: number;
}) {
  const competencia = await prisma.competenciaProfesional.findFirst({
    where: { profesionalId: opts.profesionalId, servicioId: opts.servicioId, activa: true },
  });
  if (!competencia) throw new AppError('El profesional no tiene habilitado ese servicio', 400, 'SIN_COMPETENCIA');

  if (!competencia.soloPorSolicitud) {
    const fechaAsignacion = fechaDb(opts.fecha);
    const asignacionSede = await prisma.asignacionSede.findFirst({
      where: {
        profesionalId: opts.profesionalId, sedeId: opts.sedeId, activa: true,
        fechaInicio: { lte: fechaAsignacion },
        OR: [{ fechaFin: null }, { fechaFin: { gte: fechaAsignacion } }],
      },
    });
    if (!asignacionSede) throw new AppError('El profesional no está asignado a esa sede en la fecha', 400, 'SIN_ASIGNACION_SEDE');
  }

  const turnos = await turnosDelDia(opts.sedeId, opts.fecha, [opts.profesionalId]);
  const horario = turnos.get(opts.profesionalId);
  if (!horario) throw new AppError('El profesional no atiende ese día', 400, 'SIN_HORARIO');
  if (opts.horaInicio < horario.horaInicio || opts.horaInicio >= horario.horaFin) {
    throw new AppError(`El slot ${opts.horaInicio} está fuera del horario del profesional (${horario.horaInicio}–${horario.horaFin})`, 400, 'SLOT_FUERA_HORARIO');
  }

  await validarSinBloqueo(opts.profesionalId, opts.fecha, opts.horaInicio, opts.duracionSlot);
  await validarProfesionalLibre(opts.profesionalId, opts.fecha, opts.horaInicio, opts.duracionSlot);
}

// Calcula el siguiente número de sesión de un paquete DENTRO de una transacción
// (mismo criterio que el POST individual: usadas + programadas + 1, sin pasarse del total).
async function calcularSesionNumeroTx(tx: Prisma.TransactionClient, paquetePacienteId: string, sedeIdCita: string): Promise<number | null> {
  const paquetePac = await tx.paquetePaciente.findUnique({ where: { id: paquetePacienteId } });
  if (!paquetePac) return null;
  // Candado de sede — MISMA regla que el create individual: el paquete se atiende
  // donde se compró. Antes el bloque combinado se saltaba este candado.
  if (paquetePac.sedeId && paquetePac.sedeId !== sedeIdCita) {
    const sedePaquete = await tx.sede.findUnique({ where: { id: paquetePac.sedeId }, select: { nombre: true } });
    throw new AppError(
      `El paquete de este paciente pertenece a ${sedePaquete?.nombre ?? 'otra sede'} — agenda la sesión allá o usa consumo manual auditado.`,
      409,
      'PAQUETE_OTRA_SEDE',
    );
  }
  // Un paquete Genexis SIN ANCLAR exige adjudicación manual de la sesión (desplegable del
  // create individual). El bloque combinado no tiene ese flujo → se pide agendar la
  // PRIMERA sesión como cita individual, en vez de auto-numerar mal.
  const citasVivas = await tx.cita.count({
    where: { paquetePacienteId, deletedAt: null, estado: { notIn: ['cancelada', 'no_show', 'reprogramada'] } },
  });
  if (paquetePac.origen === 'GENEXIS_APERTURA' && citasVivas === 0) {
    throw new AppError(
      'Este paquete viene de Genexis y su primera sesión requiere adjudicación manual: agéndala como cita individual (no en bloque combinado).',
      400, 'SESION_MANUAL_REQUERIDA',
    );
  }
  const citasProgramadas = await tx.cita.count({
    where: {
      paquetePacienteId, estado: { in: ['agendada', 'confirmada', 'llego', 'en_atencion'] }, deletedAt: null,
    },
  });
  if (paquetePac.sesionesUsadas + citasProgramadas >= paquetePac.sesionesTotal) {
    throw new AppError(
      `El paquete ya no tiene sesiones disponibles (${paquetePac.sesionesTotal}/${paquetePac.sesionesTotal}).`,
      409, 'PAQUETE_SIN_SESIONES',
    );
  }
  return paquetePac.sesionesUsadas + citasProgramadas + 1;
}

// ─── POST /citas/combinada ────────────────────────────────────────────────────
// Crea ATÓMICAMENTE las 2 citas de un bloque combinado (profilaxis ancla + extra)
// que comparten `slotGrupoId` y el mismo intervalo de 1 h. Anti-doble-booking
// garantizado por los índices parciales `citas_slot_primario/secundario_unique`.
router.post('/combinada', requireAuth, requireScope('appointments:write'), async (req: Request, res) => {
  const data = crearCombinadaSchema.parse(req.body);
  const usuarioId = req.user?.userId;
  await validarCanal(data.canal);

  // 1) El servicio del ancla debe ser el ancla configurado.
  const anclaId = await getServicioAnclaId();
  if (!anclaId) throw new AppError('No hay un servicio ancla configurado para combinaciones', 400, 'SIN_ANCLA');
  if (data.servicioId !== anclaId) throw new AppError('El servicio principal no es el ancla configurada (profilaxis)', 400, 'NO_ES_ANCLA');

  // 2) El extra debe estar en la lista de combinables activos, y no ser el propio ancla.
  if (data.extra.servicioId === anclaId) throw new AppError('El extra no puede ser el mismo servicio ancla', 400, 'EXTRA_ES_ANCLA');
  if (!(await esCombinacionPermitida(data.extra.servicioId))) {
    throw new AppError('Ese servicio no está permitido como combinación', 400, 'COMBINACION_NO_PERMITIDA');
  }

  // 3) Servicios y unidades.
  const [anclaSrv, extraSrv] = await Promise.all([
    prisma.servicio.findUnique({ where: { id: data.servicioId } }),
    prisma.servicio.findUnique({ where: { id: data.extra.servicioId } }),
  ]);
  if (!anclaSrv || !anclaSrv.activo) throw new AppError('Servicio ancla no encontrado o inactivo', 404);
  if (!extraSrv || !extraSrv.activo) throw new AppError('Servicio extra no encontrado o inactivo', 404);
  if (anclaSrv.unidadNegocioId !== data.unidadNegocioId) throw new AppError('El servicio ancla no pertenece a la unidad indicada', 400);

  const duracionSlot = anclaSrv.duracionMinutos; // el bloque ocupa 1 slot (la duración del ancla)
  if (!horaInicioValidaParaDuracion(data.horaInicio, duracionSlot)) {
    throw new AppError('Los bloques combinados solo pueden iniciarse en hora entera (08:00, 09:00, …)', 400, 'SLOT_HORA_INVALIDA');
  }

  // Subcategoría del ANCLA (profilaxis → Regular/Premium/…): obligatoria si la tiene.
  const subcategoriaAncla = await resolverSubcategoria(data.servicioId, data.subcategoriaId);
  // El EXTRA también respeta la obligatoriedad de subcategoría (misma regla que el
  // create individual): si su servicio tiene subcategorías activas, debe venir una.
  const subcategoriaExtra = await resolverSubcategoria(data.extra.servicioId, data.extra.subcategoriaId);

  // Profesional del ANCLA: si la recepción no eligió una, se asigna automáticamente
  // (igual que una profilaxis normal "Sin preferencia"). El extra usa la suya o, por
  // defecto, la misma del ancla.
  let anclaProfesionalId = data.profesionalId ?? null;
  let origenAncla: 'elegida_por_paciente' | 'asignada_automaticamente' = 'elegida_por_paciente';
  if (!anclaProfesionalId) {
    anclaProfesionalId = await seleccionarProfesionalOptimo(data.sedeId, data.unidadNegocioId, data.servicioId, data.fecha, data.horaInicio);
    if (!anclaProfesionalId) throw new AppError('No hay profesionales disponibles para este slot', 409, 'NO_DISPONIBLE');
    origenAncla = 'asignada_automaticamente';
  }
  const extraProfesionalId = data.extra.profesionalId ?? anclaProfesionalId;

  // La sede debe operar ambas unidades.
  for (const unId of new Set([data.unidadNegocioId, extraSrv.unidadNegocioId])) {
    const su = await prisma.sedeUnidadNegocio.findUnique({
      where: { sedeId_unidadNegocioId: { sedeId: data.sedeId, unidadNegocioId: unId } },
    });
    if (!su) throw new AppError('La unidad de negocio no opera en esta sede', 400, 'UNIDAD_NO_EN_SEDE');
  }

  // 4) Validar disponibilidad de cada pata por separado (antes de tomar locks).
  await validarLegBloque({
    profesionalId: anclaProfesionalId, sedeId: data.sedeId, servicioId: data.servicioId,
    unidadNegocioId: data.unidadNegocioId, fecha: data.fecha, horaInicio: data.horaInicio, duracionSlot,
  });
  await validarLegBloque({
    profesionalId: extraProfesionalId, sedeId: data.sedeId, servicioId: data.extra.servicioId,
    unidadNegocioId: extraSrv.unidadNegocioId, fecha: data.fecha, horaInicio: data.horaInicio, duracionSlot,
  });

  // 5) Locks de slot en orden determinista (profesionalId asc) para evitar deadlocks.
  const profesionalesUnicos = [...new Set([anclaProfesionalId, extraProfesionalId])].sort();
  const lockId = uuidv4();
  const adquiridos: string[] = [];
  try {
    for (const pid of profesionalesUnicos) {
      const ok = await acquireSlotLock(data.sedeId, pid, data.fecha, data.horaInicio, lockId);
      if (!ok) throw new AppError('Slot en proceso de reserva, intente nuevamente', 409, 'SLOT_LOCKED');
      adquiridos.push(pid);
    }

    const slotGrupoId = uuidv4();
    const fechaDate = fechaDb(data.fecha);

    // 6) Crear ambas citas + audits en UNA transacción Serializable. Si la DB rechaza
    // por violación de unicidad o conflicto de serialización (carrera) → 409.
    let citas: { anclaId: string; extraId: string };
    try {
      citas = await prisma.$transaction(async (tx) => {
        const sesionAncla = data.paquetePacienteId ? await calcularSesionNumeroTx(tx, data.paquetePacienteId, data.sedeId) : null;
        const sesionExtra = data.extra.paquetePacienteId ? await calcularSesionNumeroTx(tx, data.extra.paquetePacienteId, data.sedeId) : null;

        const ancla = await tx.cita.create({
          data: {
            pacienteId: data.pacienteId, profesionalId: anclaProfesionalId, sedeId: data.sedeId,
            unidadNegocioId: data.unidadNegocioId, servicioId: data.servicioId, subcategoriaId: subcategoriaAncla, fecha: fechaDate,
            horaInicio: data.horaInicio, duracionMinutos: duracionSlot, estado: 'agendada',
            canal: data.canal, origenAsignacion: origenAncla, creadoPorUsuarioId: usuarioId ?? null,
            paquetePacienteId: data.paquetePacienteId, sesionNumero: sesionAncla,
            // FUENTE ÚNICA: la promo del bloque vive SOLO aquí (PRINCIPAL/profilaxis); la
            // SECUNDARIO va con promocionId null. Así analytics/conteos nunca duplican.
            promocionId: data.promocionId ?? null,
            slotGrupoId, slotRol: 'PRINCIPAL',
          },
        });
        const extra = await tx.cita.create({
          data: {
            pacienteId: data.pacienteId, profesionalId: extraProfesionalId, sedeId: data.sedeId,
            unidadNegocioId: extraSrv.unidadNegocioId, servicioId: data.extra.servicioId, subcategoriaId: subcategoriaExtra, fecha: fechaDate,
            horaInicio: data.horaInicio, duracionMinutos: duracionSlot, estado: 'agendada',
            canal: data.canal, origenAsignacion: 'elegida_por_paciente', creadoPorUsuarioId: usuarioId ?? null,
            paquetePacienteId: data.extra.paquetePacienteId, sesionNumero: sesionExtra,
            slotGrupoId, slotRol: 'SECUNDARIO',
          },
        });
        for (const c of [ancla, extra]) {
          await auditEnTx(tx, {
            citaId: c.id, usuarioId, accion: 'crear', entidad: 'cita', entidadId: c.id,
            despues: c, sedeId: data.sedeId, ip: req.ip,
          });
        }
        if (data.comentarioRecepcion?.trim()) {
          await crearComentarioEnTx(tx, { citaId: ancla.id, sedeId: data.sedeId, autorId: usuarioId ?? null, texto: data.comentarioRecepcion, ip: req.ip });
        }
        if (data.extra.comentarioRecepcion?.trim()) {
          await crearComentarioEnTx(tx, { citaId: extra.id, sedeId: data.sedeId, autorId: usuarioId ?? null, texto: data.extra.comentarioRecepcion, ip: req.ip });
        }
        return { anclaId: ancla.id, extraId: extra.id };
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    } catch (err) {
      // Idéntico a POST /citas: unicidad o deadlock exhausto (incluido el 40P01 crudo) → 409.
      if (esConflictoDeSlot(err)) {
        throw new AppError('Ese horario acaba de ocuparse para una de las citas del bloque. Refresque e intente otra vez.', 409, 'SLOT_OCUPADO');
      }
      throw err;
    }

    await invalidateDisponibilidadCache(data.sedeId, data.fecha);

    const [anclaCompleta, extraCompleta] = await Promise.all([
      getCitaCompleta(citas.anclaId), getCitaCompleta(citas.extraId),
    ]);

    for (const c of [anclaCompleta, extraCompleta]) {
      emitirEventoCita({
        tipo: 'cita:creada', sedeId: data.sedeId, fecha: data.fecha,
        cita: c as never, cambiadoPor: usuarioId ?? 'sistema',
      });
      await dispararWebhooks('appointment.created', data.sedeId, c);
    }
    void programarRecordatoriosDeCita(citas.anclaId);
    void programarRecordatoriosDeCita(citas.extraId);
    void sincronizarVideosDeCita(citas.anclaId);
    void sincronizarVideosDeCita(citas.extraId);
    void sincronizarCitaOutlook('crear', citas.anclaId);
    void sincronizarCitaOutlook('crear', citas.extraId);

    res.status(201).json({ slotGrupoId, ancla: anclaCompleta, extra: extraCompleta });
  } finally {
    for (const pid of adquiridos) {
      await releaseSlotLock(data.sedeId, pid, data.fecha, data.horaInicio, lockId);
    }
  }
});

// ─── PATCH /citas/:id/estado ──────────────────────────────────────────────────
router.patch('/:id/estado', requireAuth, async (req, res) => {
  const { estado, comentario, motivoCancelacion } = estadoSchema.parse(req.body);
  const usuarioId = req.user?.userId;

  const cita = await prisma.cita.findUnique({ where: { id: req.params.id, deletedAt: null } });
  if (!cita) throw new AppError('Cita no encontrada', 404);

  // Permitir mismo estado solo para actualizar comentario (sin cambio de estado real)
  if (estado !== cita.estado) {
    const transicionesPermitidas = TRANSICIONES_VALIDAS[cita.estado] ?? [];
    if (!transicionesPermitidas.includes(estado)) {
      throw new AppError(
        `Transición inválida: ${cita.estado} → ${estado}`,
        400,
        'TRANSICION_INVALIDA',
      );
    }
    // Revertir una cita ATENDIDA (completada → en_atencion) es una acción sensible:
    // solo admin / coordinadora. El reembolso de la sesión lo hace el service único.
    if (cita.estado === 'completada' && estado === 'en_atencion') {
      const rol = req.user?.rol;
      if (rol !== 'admin' && rol !== 'coordinadora_sedes') {
        throw new AppError('Solo un administrador o coordinadora puede revertir una cita ya atendida', 403, 'REVERSA_NO_PERMITIDA');
      }
    }
  }

  // Bloque combinado: un cambio de estado se PROPAGA a las citas hermanas del grupo (mismo
  // slotGrupoId) — son UNA sola visita física de 1 h (profilaxis + extra). Reglas:
  //  - Solo cascadea un CAMBIO REAL de estado (re-enviar el mismo estado para agregar un
  //    comentario NO debe mover a las hermanas ni re-consumir sesiones).
  //  - Nunca se resucita una hermana ya 'cancelada'.
  //  - Al CANCELAR, no se tocan hermanas ya finalizadas (completada/no_show) — se respeta lo hecho.
  //  - Para otros estados, la hermana solo se sincroniza si SU transición es válida en la
  //    máquina de estados (una hermana en no_show NO se resucita a completada; una desfasada
  //    no salta pasos — se queda como está en vez de forzarla).
  const esCancelacion = estado === 'cancelada';
  const cambioReal = estado !== cita.estado;
  const hermanas = (cita.slotGrupoId && cambioReal)
    ? (await prisma.cita.findMany({
        where: { slotGrupoId: cita.slotGrupoId, id: { not: cita.id }, deletedAt: null },
      })).filter((c) =>
        c.estado !== estado &&
        c.estado !== 'cancelada' &&
        (esCancelacion
          ? !ESTADOS_FINALES.includes(c.estado)
          : (TRANSICIONES_VALIDAS[c.estado] ?? []).includes(estado))
      )
    : [];

  const antes = { estado: cita.estado };
  // Ancla del auto-completado por tiempo: se (re)inicia al marcar 'llego' y al REVERTIR una
  // cita atendida (completada→en_atencion), para que el reloj de 90 min cuente de nuevo.
  // Solo en cambios REALES: comentar una cita que ya está en 'llego' no reinicia el reloj.
  const reiniciaLlegoEn = cambioReal && (estado === 'llego' || (cita.estado === 'completada' && estado === 'en_atencion'));
  const llegoEnData = reiniciaLlegoEn ? { llegoEn: new Date() } : {};
  const updatedCita = await prisma.$transaction(async (tx) => {
    const u = await tx.cita.update({
      where: { id: req.params.id },
      data: {
        estado,
        motivoCancelacion: motivoCancelacion ?? cita.motivoCancelacion,
        ...llegoEnData,
      },
    });
    await auditEnTx(tx, {
      citaId: cita.id,
      usuarioId,
      accion: 'cambiar_estado',
      entidad: 'cita',
      entidadId: cita.id,
      antes,
      despues: { estado },
      sedeId: cita.sedeId,
      ip: req.ip,
    });
    // Comentario opcional del cambio de estado → entrada del hilo append-only.
    if (comentario?.trim()) {
      await crearComentarioEnTx(tx, { citaId: cita.id, sedeId: cita.sedeId, autorId: usuarioId ?? null, texto: comentario, ip: req.ip });
    }
    // Cascada del bloque combinado: aplicar EL MISMO estado a las hermanas del grupo.
    for (const h of hermanas) {
      await tx.cita.update({
        where: { id: h.id },
        data: { estado, ...llegoEnData, ...(esCancelacion ? { motivoCancelacion: motivoCancelacion ?? h.motivoCancelacion } : {}) },
      });
      await auditEnTx(tx, {
        citaId: h.id, usuarioId, accion: 'cambiar_estado', entidad: 'cita', entidadId: h.id,
        antes: { estado: h.estado }, despues: { estado, slotGrupoId: cita.slotGrupoId, cascada: true },
        sedeId: h.sedeId, ip: req.ip,
      });
    }
    return u;
  });

  // Conteo de sesiones: punto ÚNICO e idempotente. Consume 1 sesión solo si quedó
  // en 'completada' (y aún no consumió); reembolsa si se revirtió. no_show/cancelada → 0.
  await sincronizarSesionPaquete(cita.id);

  // Side-effects de las hermanas sincronizadas en cascada. El conteo de sesiones se
  // recalcula SIEMPRE (consume al completar el extra, reembolsa si se revierte). Los
  // webhooks/Outlook siguen las MISMAS reglas que la cita principal — las integraciones
  // externas también deben enterarse del servicio extra del bloque.
  for (const h of hermanas) {
    await sincronizarSesionPaquete(h.id);
    if (esCancelacion) {
      void sincronizarCitaOutlook('cancelar', h.id);
      void cancelarRecordatoriosDeCita(h.id);
      void cancelarVideosDeCita(h.id);
      await dispararWebhooks('appointment.cancelled', h.sedeId, await getCitaCompleta(h.id));
      emitirEventoCita({
        tipo: 'cita:cancelada', sedeId: h.sedeId, fecha: h.fecha.toISOString().split('T')[0]!,
        cita: { id: h.id, estado: 'cancelada' } as never, cambiadoPor: usuarioId ?? 'sistema',
      });
    } else {
      if (['no_show', 'reprogramada'].includes(estado)) { void cancelarRecordatoriosDeCita(h.id); void cancelarVideosDeCita(h.id); }
      if (estado === 'confirmada') void sincronizarCitaOutlook('crear', h.id);
      const hCompleta = await getCitaCompleta(h.id);
      if (estado === 'completada') await dispararWebhooks('appointment.completed', h.sedeId, hCompleta);
      emitirEventoCita({
        tipo: 'cita:estadoCambiado', sedeId: h.sedeId, fecha: h.fecha.toISOString().split('T')[0]!,
        cita: hCompleta as never, cambiadoPor: usuarioId ?? 'sistema',
      });
    }
  }

  const citaCompleta = await getCitaCompleta(updatedCita.id);
  const fecha = cita.fecha.toISOString().split('T')[0]!;

  emitirEventoCita({
    tipo: 'cita:estadoCambiado',
    sedeId: cita.sedeId,
    fecha,
    cita: citaCompleta as never,
    cambiadoPor: usuarioId ?? 'sistema',
  });

  if (estado === 'completada') {
    await dispararWebhooks('appointment.completed', cita.sedeId, citaCompleta);
  }
  if (estado === 'cancelada') {
    await dispararWebhooks('appointment.cancelled', cita.sedeId, citaCompleta);
  }

  // Outlook (no bloqueante): cancelada → eliminar evento; confirmada → asegurar/crear evento.
  if (estado === 'cancelada') void sincronizarCitaOutlook('cancelar', cita.id);
  else if (estado === 'confirmada') void sincronizarCitaOutlook('crear', cita.id);

  // Recordatorio: si la cita pasa a un estado inactivo, cancelar el envío programado.
  if (['cancelada', 'no_show', 'reprogramada'].includes(estado)) { void cancelarRecordatoriosDeCita(cita.id); void cancelarVideosDeCita(cita.id); }

  // Un slot LIBERADO (cancelación) debe volver a ofrecerse de inmediato: sin esto, la
  // caché de disponibilidad seguía mostrando la hora como ocupada hasta expirar.
  if (esCancelacion && cambioReal) {
    await invalidateDisponibilidadCache(cita.sedeId, fecha);
  }

  // Reagregar en background sin bloquear la respuesta
  const fechaCita = cita.fecha;
  setImmediate(() => {
    const d = new Date(fechaCita); d.setHours(0, 0, 0, 0);
    const h = new Date(fechaCita); h.setHours(23, 59, 59, 999);
    agregarRango(d, h).catch(() => {/* silencioso */});
  });

  res.json(citaCompleta);
});

// ─── PATCH /citas/:id/gestionar-movimiento ───────────────────────────────────
// Endpoint exclusivo para gestionar citas bloqueantes previo a un movimiento de podóloga.
// Permite cancelar o marcar como reprogramada desde cualquier estado activo,
// bypassing las transiciones normales de recepción.
router.patch('/:id/gestionar-movimiento', requireAuth, requireRol('admin', 'coordinadora_sedes'), async (req, res) => {
  const { estado, motivo } = z.object({
    estado: z.enum(['cancelada', 'reprogramada']),
    motivo: z.string().max(300).optional(),
  }).parse(req.body);

  const cita = await prisma.cita.findUnique({ where: { id: req.params.id, deletedAt: null } });
  if (!cita) throw new AppError('Cita no encontrada', 404);

  const ESTADOS_ACTIVOS = ['agendada', 'confirmada', 'llego', 'en_atencion'];
  if (!ESTADOS_ACTIVOS.includes(cita.estado)) {
    throw new AppError(`No se puede gestionar una cita en estado "${cita.estado}"`, 400, 'ESTADO_INVALIDO');
  }

  const estadoAnterior = cita.estado;
  // El bloque combinado se gestiona COMPLETO: si se cancela/reprograma la ancla, el
  // servicio extra del mismo slot corre la misma suerte (siguen siendo UNA visita).
  const hermanas = cita.slotGrupoId
    ? (await prisma.cita.findMany({
        where: { slotGrupoId: cita.slotGrupoId, id: { not: cita.id }, deletedAt: null },
      })).filter((c) => ESTADOS_ACTIVOS.includes(c.estado))
    : [];

  await prisma.$transaction(async (tx) => {
    await tx.cita.update({
      where: { id: req.params.id },
      data: {
        estado,
        ...(motivo && estado === 'cancelada' ? { motivoCancelacion: motivo } : {}),
      },
    });
    await auditEnTx(tx, {
      citaId: cita.id,
      usuarioId: req.user?.userId,
      accion: 'ESTADO_CAMBIADO_POR_MOVIMIENTO',
      entidad: 'cita',
      entidadId: cita.id,
      antes: { estado: estadoAnterior },
      despues: { estado, motivo: motivo ?? null, contexto: 'Gestión previa a movimiento de podóloga' },
      sedeId: cita.sedeId,
      ip: req.ip,
    });
    for (const h of hermanas) {
      await tx.cita.update({
        where: { id: h.id },
        data: { estado, ...(motivo && estado === 'cancelada' ? { motivoCancelacion: motivo } : {}) },
      });
      await auditEnTx(tx, {
        citaId: h.id, usuarioId: req.user?.userId, accion: 'ESTADO_CAMBIADO_POR_MOVIMIENTO',
        entidad: 'cita', entidadId: h.id,
        antes: { estado: h.estado }, despues: { estado, slotGrupoId: cita.slotGrupoId, cascada: true },
        sedeId: h.sedeId, ip: req.ip,
      });
    }
  });

  const fechaStr = cita.fecha.toISOString().split('T')[0]!;
  // Mismos efectos que una cancelación normal: reembolso de sesión, recordatorios y
  // videos cancelados, evento de Outlook eliminado, slot liberado en la caché y
  // webhook a integraciones. Sin esto, el paciente seguía recibiendo el recordatorio
  // de una cita que ya se había cancelado desde Movimientos.
  for (const c of [cita, ...hermanas]) {
    await sincronizarSesionPaquete(c.id);
    void cancelarRecordatoriosDeCita(c.id);
    void cancelarVideosDeCita(c.id);
    void sincronizarCitaOutlook('cancelar', c.id);
    if (estado === 'cancelada') {
      await dispararWebhooks('appointment.cancelled', c.sedeId, await getCitaCompleta(c.id));
    }
    emitirEventoCita({
      tipo: 'cita:estadoCambiado',
      sedeId: c.sedeId,
      fecha: fechaStr,
      cita: { id: c.id, estado } as never,
      cambiadoPor: req.user?.userId ?? 'sistema',
    });
  }
  await invalidateDisponibilidadCache(cita.sedeId, fechaStr);

  setImmediate(() => {
    const d = new Date(cita.fecha); d.setHours(0, 0, 0, 0);
    const h = new Date(cita.fecha); h.setHours(23, 59, 59, 999);
    agregarRango(d, h).catch(() => {/* silencioso */});
  });

  res.json({ ok: true, id: cita.id, estadoAnterior, estadoNuevo: estado });
});

// ─── POST /citas/reportar-enfermedad ──────────────────────────────────────────
// Acción COMPUESTA (B-2): reporta que un profesional se enfermó/ausenta un día y
// libera su agenda en UN paso. En una sola transacción: (1) cancela en lote sus
// citas ACTIVAS del rango y (2) crea el bloqueo (permiso) del rango. Devuelve la
// lista de pacientes afectados (con teléfono) para que recepción los contacte y
// reagende. Reemplaza el flujo manual de dos pasos (cancelar cita por cita → luego
// bloquear, que además fallaba con 409 CITAS_EN_RANGO mientras quedara una).
router.post('/reportar-enfermedad', requireAuth, requireRol('admin', 'coordinadora_sedes'), async (req, res) => {
  const data = z.object({
    profesionalId: z.string().uuid(),
    sedeId: z.string().uuid(),
    fecha: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    // Rango a liberar. Por defecto, el día completo de atención (08:00–20:00).
    horaInicio: z.string().regex(/^\d{2}:\d{2}$/).default('08:00'),
    horaFin: z.string().regex(/^\d{2}:\d{2}$/).default('20:00'),
    motivo: z.string().min(3).max(200).default('Enfermedad'),
  }).parse(req.body);
  if (data.horaFin <= data.horaInicio) throw new AppError('La hora de fin debe ser mayor que la de inicio', 400);

  const usuarioId = req.user?.userId;
  const prof = await prisma.profesional.findUnique({
    where: { id: data.profesionalId },
    select: { tipo: true, activo: true, deletedAt: true, nombres: true, apellidos: true },
  });
  if (!prof || !prof.activo || prof.deletedAt) throw new AppError('Profesional no encontrado', 404);
  if (prof.tipo !== 'podologa' && prof.tipo !== 'fisioterapeuta' && prof.tipo !== 'medico') {
    throw new AppError('Solo se puede reportar enfermedad de podólogas, fisioterapeutas o baropodometría', 400, 'TIPO_NO_BLOQUEABLE');
  }

  // Citas ACTIVAS del profesional en el rango (mismo criterio que el bloqueo de permisos:
  // no cuentan canceladas/no-show/reprogramadas ni ya completadas). Se incluye
  // `solicitadoProfesionalId` para el caso baro "Solo X" (la cita ocupa una máquina pero
  // pide a un médico). Un bloque combinado comparte profesional+slot → sus hermanas ya
  // caen en esta consulta.
  const toMin = (s: string) => { const [h, m] = s.split(':').map(Number); return h! * 60 + m!; };
  const desdeMin = toMin(data.horaInicio);
  const hastaMin = toMin(data.horaFin);
  const dayStart = new Date(`${data.fecha}T00:00:00`);
  const dayEnd = new Date(`${data.fecha}T23:59:59`);
  const citasDelDia = await prisma.cita.findMany({
    where: {
      OR: [{ profesionalId: data.profesionalId }, { solicitadoProfesionalId: data.profesionalId }],
      sedeId: data.sedeId,
      fecha: { gte: dayStart, lte: dayEnd },
      deletedAt: null,
      estado: { notIn: ['cancelada', 'no_show', 'reprogramada', 'completada'] },
    },
    select: {
      id: true, estado: true, horaInicio: true, duracionMinutos: true, sedeId: true, motivoCancelacion: true,
      paciente: { select: { nombres: true, apellidoPaterno: true, apellidoMaterno: true, telefono: true } },
      servicio: { select: { nombre: true } },
    },
    orderBy: { horaInicio: 'asc' },
  });
  const enRango = citasDelDia.filter((c) => {
    const ini = toMin(c.horaInicio);
    return ini < hastaMin && ini + c.duracionMinutos > desdeMin; // solape [ini, ini+dur) con [desde, hasta)
  });

  const fechaInicio = new Date(`${data.fecha}T${data.horaInicio}:00`);
  const fechaFin = new Date(`${data.fecha}T${data.horaFin}:00`);

  // Transacción atómica: o quedan canceladas TODAS las citas + creado el bloqueo, o nada.
  // Serializable + retry ante deadlock, coherente con el resto de escrituras de citas.
  const bloqueo = await withDeadlockRetry(() => prisma.$transaction(async (tx) => {
    for (const c of enRango) {
      await tx.cita.update({ where: { id: c.id }, data: { estado: 'cancelada', motivoCancelacion: data.motivo } });
      await auditEnTx(tx, {
        citaId: c.id, usuarioId, accion: 'ENFERMEDAD_CANCELAR_CITA', entidad: 'cita', entidadId: c.id,
        antes: { estado: c.estado }, despues: { estado: 'cancelada', motivo: data.motivo, contexto: 'Reporte de enfermedad — liberar día' },
        sedeId: c.sedeId, ip: req.ip,
      });
    }
    const b = await tx.bloqueoAgenda.create({
      data: {
        profesionalId: data.profesionalId, sedeId: data.sedeId, tipo: 'PERMISO', esRecurrente: false,
        fechaInicio, fechaFin, horaInicio: data.horaInicio, horaFin: data.horaFin,
        motivo: `🤒 ${data.motivo}`, creadoPor: usuarioId,
      },
    });
    await auditEnTx(tx, {
      usuarioId, accion: 'ENFERMEDAD_BLOQUEO_CREADO', entidad: 'bloqueo_agenda', entidadId: b.id,
      despues: { profesionalId: data.profesionalId, horaInicio: data.horaInicio, horaFin: data.horaFin, motivo: data.motivo, citasCanceladas: enRango.length },
      sedeId: data.sedeId, ip: req.ip,
    });
    return b;
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable })).catch((err) => {
    // A diferencia de reservar un slot, aquí no hay unicidad en juego: un deadlock que agotó
    // los reintentos (P2034 o el 40P01/40001 CRUDO que Prisma no clasifica) es un choque
    // transitorio de locks al cancelar el día. Se mapea a un 409 "reintente" en vez de dejar
    // escapar un 500 opaco al errorHandler. Cualquier otro error se propaga intacto.
    if (esDeadlockTransitorio(err)) {
      throw new AppError('El sistema está ocupado procesando esa agenda. Reintente en unos segundos.', 409, 'CONFLICTO_TRANSITORIO');
    }
    throw err;
  });

  // Side-effects best-effort de cada cita cancelada (idénticos a gestionar-movimiento):
  // reembolso de sesión, recordatorios y videos cancelados, evento Outlook eliminado,
  // webhook a integraciones y evento en tiempo real.
  const fechaStr = data.fecha;
  for (const c of enRango) {
    await sincronizarSesionPaquete(c.id);
    void cancelarRecordatoriosDeCita(c.id);
    void cancelarVideosDeCita(c.id);
    void sincronizarCitaOutlook('cancelar', c.id);
    await dispararWebhooks('appointment.cancelled', c.sedeId, await getCitaCompleta(c.id));
    emitirEventoCita({
      tipo: 'cita:estadoCambiado', sedeId: c.sedeId, fecha: fechaStr,
      cita: { id: c.id, estado: 'cancelada' } as never, cambiadoPor: usuarioId ?? 'sistema',
    });
  }
  await invalidateDisponibilidadCache(data.sedeId, fechaStr);

  setImmediate(() => {
    const d = new Date(`${data.fecha}T00:00:00`); d.setHours(0, 0, 0, 0);
    const h = new Date(`${data.fecha}T00:00:00`); h.setHours(23, 59, 59, 999);
    agregarRango(d, h).catch(() => {/* silencioso */});
  });

  // Lista de pacientes afectados para que recepción los contacte y reagende.
  const pacientes = enRango.map((c) => ({
    horaInicio: c.horaInicio,
    estado: c.estado as string,
    servicio: c.servicio.nombre,
    paciente: `${c.paciente.nombres} ${c.paciente.apellidoPaterno} ${c.paciente.apellidoMaterno}`.trim(),
    telefono: c.paciente.telefono,
  }));

  res.status(201).json({
    ok: true,
    bloqueoId: bloqueo.id,
    profesional: `${prof.nombres.split(' ')[0]} ${prof.apellidos.split(' ')[0]}`.trim(),
    citasCanceladas: enRango.length,
    pacientes,
  });
});

// ─── PATCH /citas/:id/mover ───────────────────────────────────────────────────
router.patch('/:id/mover', requireAuth, async (req, res) => {
  const data = moverCitaSchema.parse(req.body);
  const usuarioId = req.user?.userId;

  const cita = await prisma.cita.findUnique({
    where: { id: req.params.id, deletedAt: null },
    include: { profesional: true, unidadNegocio: true },
  });
  if (!cita) throw new AppError('Cita no encontrada', 404);

  if (ESTADOS_FINALES.includes(cita.estado)) {
    throw new AppError('No se puede mover una cita finalizada', 400, 'ESTADO_FINAL');
  }

  // Servicios de 1 hora solo en hora entera
  if (!horaInicioValidaParaDuracion(data.horaInicio, cita.duracionMinutos)) {
    throw new AppError('Los servicios de 1 hora solo pueden iniciarse en hora entera (08:00, 09:00, …)', 400, 'SLOT_HORA_INVALIDA');
  }

  const nuevoProfesionalId = data.profesionalId !== undefined ? data.profesionalId : cita.profesionalId;

  // Re-validar modo de reserva: sin_eleccion no puede recibir profesional específico por movimiento
  if (cita.unidadNegocio.modoReserva === 'sin_eleccion' && data.profesionalId !== undefined) {
    throw new AppError('Unidad sin elección: el profesional es asignado automáticamente', 400, 'MODO_SIN_ELECCION');
  }

  // Re-validar competencia del profesional destino
  if (nuevoProfesionalId) {
    const competencia = await prisma.competenciaProfesional.findFirst({
      where: { profesionalId: nuevoProfesionalId, servicioId: cita.servicioId, activa: true },
    });
    if (!competencia) {
      throw new AppError('El profesional destino no tiene habilitado el servicio de esta cita', 400, 'SIN_COMPETENCIA');
    }
  }

  // Re-validar AsignacionSede: el profesional destino debe estar asignado a esta sede en la fecha destino
  if (nuevoProfesionalId) {
    const fechaDestino = fechaDb(data.fecha);
    // Misma regla que el CREATE: si la competencia usada es "solo por solicitud"
    // (médicos de baro, Daniel en baro), el profesional atiende en cualquier sede
    // sin asignación fija — no se le exige asignación al mover.
    const competenciaMover = await prisma.competenciaProfesional.findFirst({
      where: { profesionalId: nuevoProfesionalId, servicioId: cita.servicioId, activa: true },
    });
    if (!competenciaMover?.soloPorSolicitud) {
      const asignacion = await prisma.asignacionSede.findFirst({
        where: {
          profesionalId: nuevoProfesionalId,
          sedeId: cita.sedeId,
          activa: true,
          fechaInicio: { lte: fechaDestino },
          OR: [{ fechaFin: null }, { fechaFin: { gte: fechaDestino } }],
        },
      });
      if (!asignacion) {
        throw new AppError('El profesional destino no está asignado a esta sede en la fecha indicada', 400, 'SIN_ASIGNACION_SEDE');
      }
    }

    // TURNO del profesional destino — misma validación que el CREATE. Sin esto se podía
    // reprogramar una cita a una hora en que la profesional ya salió o a un día que no
    // atiende, y la cita quedaba fuera de horario sin que nadie lo notara.
    const turnosDestino = await turnosDelDia(cita.sedeId, data.fecha, [nuevoProfesionalId]);
    const turnoDestino = turnosDestino.get(nuevoProfesionalId);
    if (!turnoDestino) throw new AppError('El profesional no atiende este día', 400, 'SIN_HORARIO');
    if (data.horaInicio < turnoDestino.horaInicio || data.horaInicio >= turnoDestino.horaFin) {
      throw new AppError(
        `El slot ${data.horaInicio} está fuera del horario del profesional (${turnoDestino.horaInicio}–${turnoDestino.horaFin})`,
        400,
        'SLOT_FUERA_HORARIO',
      );
    }
  }

  const lockId = uuidv4();
  const lockAcquired = await acquireSlotLock(
    cita.sedeId, nuevoProfesionalId!, data.fecha, data.horaInicio, lockId
  );
  if (!lockAcquired) {
    throw new AppError('Slot en proceso de reserva, intente nuevamente', 409, 'SLOT_LOCKED');
  }

  try {
    // No permitir mover la cita encima de un bloqueo (permiso/almuerzo) del profesional destino.
    await validarSinBloqueo(nuevoProfesionalId!, data.fecha, data.horaInicio, cita.duracionMinutos);

    // Anti doble-booking cruzado entre unidades (excluyendo la propia cita que se mueve).
    await validarProfesionalLibre(nuevoProfesionalId!, data.fecha, data.horaInicio, cita.duracionMinutos, cita.id);
    if (cita.solicitadoProfesionalId) {
      await validarProfesionalLibre(cita.solicitadoProfesionalId, data.fecha, data.horaInicio, cita.duracionMinutos, cita.id);
      // El médico solicitado ("Solo Daniel") tampoco puede quedar sobre un bloqueo suyo
      // (reunión/permiso) — el CREATE ya lo validaba; el MOVER lo omitía.
      await validarSinBloqueo(cita.solicitadoProfesionalId, data.fecha, data.horaInicio, cita.duracionMinutos);
    }

    const antes = {
      profesionalId: cita.profesionalId,
      fecha: cita.fecha,
      horaInicio: cita.horaInicio,
    };

    const updatedCita = await prisma.$transaction(async (tx) => {
      const u = await tx.cita.update({
        where: { id: req.params.id },
        data: {
          profesionalId: nuevoProfesionalId,
          fecha: fechaDb(data.fecha),
          horaInicio: data.horaInicio,
          estado: ['completada', 'confirmada'].includes(cita.estado) ? cita.estado : 'agendada',
          ...(data.origenAsignacion ? { origenAsignacion: data.origenAsignacion } : {}),
        },
      });
      await auditEnTx(tx, {
        citaId: cita.id,
        usuarioId,
        accion: 'mover',
        entidad: 'cita',
        entidadId: cita.id,
        antes,
        despues: { profesionalId: nuevoProfesionalId, fecha: data.fecha, horaInicio: data.horaInicio },
        sedeId: cita.sedeId,
        ip: req.ip,
      });
      return u;
    });

    await invalidateDisponibilidadCache(cita.sedeId, cita.fecha.toISOString().split('T')[0]!);
    await invalidateDisponibilidadCache(cita.sedeId, data.fecha);

    const citaCompleta = await getCitaCompleta(updatedCita.id);
    emitirEventoCita({
      tipo: 'cita:movida',
      sedeId: cita.sedeId,
      fecha: data.fecha,
      cita: citaCompleta as never,
      cambiadoPor: usuarioId ?? 'sistema',
    });

    await dispararWebhooks('appointment.rescheduled', cita.sedeId, citaCompleta);

    // Outlook (no bloqueante): reprogramación → actualizar el evento existente (no duplica).
    void sincronizarCitaOutlook('actualizar', cita.id);

    // Recordatorio: reagendar el envío a la nueva fecha/hora (si aún no se envió).
    void reprogramarRecordatorioDeCita(cita.id);
    // VIDEOS: recalcula los envíos no enviados a la nueva fecha/hora (R2).
    void sincronizarVideosDeCita(cita.id);

    res.json(citaCompleta);
  } finally {
    await releaseSlotLock(cita.sedeId, nuevoProfesionalId!, data.fecha, data.horaInicio, lockId);
  }
});

// ─── PATCH /citas/grupo/:slotGrupoId/mover ────────────────────────────────────
// Mueve un BLOQUE COMBINADO completo (ambas citas comparten slot) a otro horario/profesional,
// de forma atómica. No se puede mover cada mitad por separado: la 2da chocaría con la 1ra ya
// movida al mismo slot. El chequeo de solape EXCLUYE las citas del propio grupo.
router.patch('/grupo/:slotGrupoId/mover', requireAuth, async (req, res) => {
  const data = moverCitaSchema.parse(req.body);
  const usuarioId = req.user?.userId;
  const slotGrupoId = req.params.slotGrupoId;

  const citas = await prisma.cita.findMany({
    where: { slotGrupoId, deletedAt: null },
    include: { unidadNegocio: true, servicio: true },
    orderBy: { slotRol: 'asc' }, // PRINCIPAL antes que SECUNDARIO
  });
  if (citas.length === 0) throw new AppError('Bloque combinado no encontrado', 404);
  if (citas.some(c => ESTADOS_FINALES.includes(c.estado))) {
    throw new AppError('No se puede mover un bloque con citas ya finalizadas', 400, 'ESTADO_FINAL');
  }

  const ancla = citas.find(c => c.slotRol === 'PRINCIPAL') ?? citas[0]!;
  const sedeId = ancla.sedeId;
  const nuevoProfesionalId = data.profesionalId !== undefined ? data.profesionalId : ancla.profesionalId;
  const grupoIds = citas.map(c => c.id);

  // La duración del bloque = la del ancla (1 h). Hora entera para servicios de 1 h.
  if (!horaInicioValidaParaDuracion(data.horaInicio, ancla.duracionMinutos)) {
    throw new AppError('Los servicios de 1 hora solo pueden iniciarse en hora entera (08:00, 09:00, …)', 400, 'SLOT_HORA_INVALIDA');
  }

  // El profesional destino debe atender AMBOS servicios del bloque y estar asignado a la sede.
  if (nuevoProfesionalId) {
    for (const c of citas) {
      const comp = await prisma.competenciaProfesional.findFirst({ where: { profesionalId: nuevoProfesionalId, servicioId: c.servicioId, activa: true } });
      if (!comp) throw new AppError(`El profesional destino no tiene habilitado "${c.servicio.nombre}"`, 400, 'SIN_COMPETENCIA');
    }
    const fechaDestino = fechaDb(data.fecha);
    const asignacion = await prisma.asignacionSede.findFirst({
      where: { profesionalId: nuevoProfesionalId, sedeId, activa: true, fechaInicio: { lte: fechaDestino }, OR: [{ fechaFin: null }, { fechaFin: { gte: fechaDestino } }] },
    });
    if (!asignacion) throw new AppError('El profesional destino no está asignado a esta sede en la fecha indicada', 400, 'SIN_ASIGNACION_SEDE');

    // TURNO del profesional destino — misma validación que el CREATE y que el mover
    // individual: el bloque completo debe caber dentro de su jornada de ese día.
    const turnosDestino = await turnosDelDia(sedeId, data.fecha, [nuevoProfesionalId]);
    const turnoDestino = turnosDestino.get(nuevoProfesionalId);
    if (!turnoDestino) throw new AppError('El profesional no atiende este día', 400, 'SIN_HORARIO');
    if (data.horaInicio < turnoDestino.horaInicio || data.horaInicio >= turnoDestino.horaFin) {
      throw new AppError(
        `El slot ${data.horaInicio} está fuera del horario del profesional (${turnoDestino.horaInicio}–${turnoDestino.horaFin})`,
        400,
        'SLOT_FUERA_HORARIO',
      );
    }
  }

  const lockId = uuidv4();
  const lockAcquired = await acquireSlotLock(sedeId, nuevoProfesionalId!, data.fecha, data.horaInicio, lockId);
  if (!lockAcquired) throw new AppError('Slot en proceso de reserva, intente nuevamente', 409, 'SLOT_LOCKED');

  try {
    await validarSinBloqueo(nuevoProfesionalId!, data.fecha, data.horaInicio, ancla.duracionMinutos);
    // Libre EXCLUYENDO las citas del propio grupo (comparten el slot a propósito).
    await validarProfesionalLibre(nuevoProfesionalId!, data.fecha, data.horaInicio, ancla.duracionMinutos, undefined, grupoIds);

    await prisma.$transaction(async (tx) => {
      for (const c of citas) {
        await tx.cita.update({
          where: { id: c.id },
          data: {
            profesionalId: nuevoProfesionalId,
            fecha: fechaDb(data.fecha),
            horaInicio: data.horaInicio,
            estado: ['completada', 'confirmada'].includes(c.estado) ? c.estado : 'agendada',
            ...(data.origenAsignacion ? { origenAsignacion: data.origenAsignacion } : {}),
          },
        });
        await auditEnTx(tx, {
          citaId: c.id, usuarioId, accion: 'mover', entidad: 'cita', entidadId: c.id,
          antes: { profesionalId: c.profesionalId, fecha: c.fecha, horaInicio: c.horaInicio },
          despues: { profesionalId: nuevoProfesionalId, fecha: data.fecha, horaInicio: data.horaInicio, bloque: slotGrupoId },
          sedeId, ip: req.ip,
        });
      }
    });

    await invalidateDisponibilidadCache(sedeId, ancla.fecha.toISOString().split('T')[0]!);
    await invalidateDisponibilidadCache(sedeId, data.fecha);

    for (const c of citas) {
      const completa = await getCitaCompleta(c.id);
      emitirEventoCita({ tipo: 'cita:movida', sedeId, fecha: data.fecha, cita: completa as never, cambiadoPor: usuarioId ?? 'sistema' });
      void sincronizarCitaOutlook('actualizar', c.id);
      void reprogramarRecordatorioDeCita(c.id);
      void sincronizarVideosDeCita(c.id);
    }

    res.json(await getCitaCompleta(ancla.id));
  } finally {
    await releaseSlotLock(sedeId, nuevoProfesionalId!, data.fecha, data.horaInicio, lockId);
  }
});

// ─── DELETE /citas/:id (cancelar — NO pone deletedAt para conservar historial) ─
router.delete('/:id', requireAuth, async (req, res) => {
  const cita = await prisma.cita.findUnique({ where: { id: req.params.id, deletedAt: null } });
  if (!cita) throw new AppError('Cita no encontrada', 404);
  if (ESTADOS_FINALES.includes(cita.estado)) {
    throw new AppError('No se puede cancelar una cita finalizada', 400);
  }

  // Bloque combinado: cancelar una mitad cancela TODO el grupo. Si es individual,
  // el grupo es solo esta cita. Solo se cancelan las que aún no están finalizadas.
  const grupo = cita.slotGrupoId
    ? await prisma.cita.findMany({ where: { slotGrupoId: cita.slotGrupoId, deletedAt: null } })
    : [cita];
  const aCancelar = grupo.filter((c) => !ESTADOS_FINALES.includes(c.estado));

  // Solo cambia el estado a 'cancelada', sin tocar deletedAt (conserva trazabilidad).
  await prisma.$transaction(async (tx) => {
    for (const c of aCancelar) {
      await tx.cita.update({ where: { id: c.id }, data: { estado: 'cancelada' } });
      await auditEnTx(tx, {
        citaId: c.id,
        usuarioId: req.user?.userId,
        accion: 'cancelar',
        entidad: 'cita',
        entidadId: c.id,
        antes: { estado: c.estado },
        despues: { estado: 'cancelada', ...(cita.slotGrupoId ? { slotGrupoId: cita.slotGrupoId, cascada: true } : {}) },
        sedeId: c.sedeId,
        ip: req.ip,
      });
    }
  });

  // Para cada cita cancelada: devolver sesión de paquete (helper canónico idempotente),
  // sincronizar Outlook, cancelar recordatorios y emitir evento. Mismo trato que el
  // DELETE individual, aplicado a ambas mitades del bloque. El reembolso de sesión se
  // AWAITEA (como en PATCH /estado): un fallo debe verse, no perderse en silencio.
  for (const c of aCancelar) {
    await sincronizarSesionPaquete(c.id);
    void sincronizarCitaOutlook('cancelar', c.id);
    void cancelarRecordatoriosDeCita(c.id);
    void cancelarVideosDeCita(c.id);
    emitirEventoCita({
      tipo: 'cita:cancelada',
      sedeId: c.sedeId,
      fecha: c.fecha.toISOString().split('T')[0]!,
      cita: { id: c.id, estado: 'cancelada' } as never,
      cambiadoPor: req.user?.userId ?? 'sistema',
    });
  }
  // El slot liberado vuelve a ofrecerse de inmediato.
  await invalidateDisponibilidadCache(cita.sedeId, cita.fecha.toISOString().split('T')[0]!);

  res.json({ ok: true, canceladas: aCancelar.map((c) => c.id) });
});

// ─── PATCH /citas/:id/consultorio ────────────────────────────────────────────
router.patch('/:id/consultorio', requireAuth, async (req, res) => {
  const { consultorioNumero } = req.body as { consultorioNumero: number | null };
  const cita = await prisma.cita.findUnique({ where: { id: req.params.id, deletedAt: null } });
  if (!cita) throw new AppError('Cita no encontrada', 404);

  await prisma.$transaction(async (tx) => {
    await tx.cita.update({
      where: { id: req.params.id },
      data: { consultorioNumero: consultorioNumero ?? null },
    });
    await auditEnTx(tx, {
      citaId: cita.id,
      usuarioId: req.user?.userId,
      accion: 'cambiar_consultorio',
      entidad: 'cita',
      entidadId: cita.id,
      antes: { consultorioNumero: cita.consultorioNumero },
      despues: { consultorioNumero: consultorioNumero ?? null },
      sedeId: cita.sedeId,
      ip: req.ip,
    });
  });

  const citaCompleta = await getCitaCompleta(req.params.id);
  emitirEventoCita({
    tipo: 'cita:actualizada',
    sedeId: cita.sedeId,
    fecha: cita.fecha.toISOString().split('T')[0]!,
    cita: citaCompleta as never,
    cambiadoPor: req.user?.userId ?? 'sistema',
  });
  res.json(citaCompleta);
});

// ─── PATCH /citas/:id/comentario ──────────────────────────────────────────────
// AGREGA una entrada al hilo append-only (en cualquier estado). YA NO reemplaza:
// dos usuarios comentando a la vez generan dos entradas → imposible pisarse (fin de M2).
// Se mantiene el verbo/ruta para no romper el frontend; internamente es un INSERT.
router.patch('/:id/comentario', requireAuth, async (req, res) => {
  const { comentario } = z.object({ comentario: z.string().max(2000) }).parse(req.body);
  const cita = await prisma.cita.findUnique({ where: { id: req.params.id, deletedAt: null } });
  if (!cita) throw new AppError('Cita no encontrada', 404);

  const texto = comentario.trim();
  if (!texto) throw new AppError('El comentario está vacío', 400, 'COMENTARIO_VACIO');

  await prisma.$transaction(async (tx) => {
    await crearComentarioEnTx(tx, { citaId: cita.id, sedeId: cita.sedeId, autorId: req.user?.userId ?? null, texto, ip: req.ip });
  });

  const citaCompleta = await getCitaCompleta(cita.id);
  emitirEventoCita({
    tipo: 'cita:actualizada',
    sedeId: cita.sedeId,
    fecha: cita.fecha.toISOString().split('T')[0]!,
    cita: citaCompleta as never,
    cambiadoPor: req.user?.userId ?? 'sistema',
  });
  res.json(citaCompleta);
});

// ─── PATCH /citas/:id/canal ───────────────────────────────────────────────────
// Canal de reserva (de dónde viene el cliente). Editable en cualquier estado.
router.patch('/:id/canal', requireAuth, async (req, res) => {
  const { canal } = z.object({ canal: z.string() }).parse(req.body);
  await validarCanal(canal);
  const cita = await prisma.cita.findUnique({ where: { id: req.params.id, deletedAt: null } });
  if (!cita) throw new AppError('Cita no encontrada', 404);

  await prisma.$transaction(async (tx) => {
    await tx.cita.update({ where: { id: cita.id }, data: { canal } });
    await auditEnTx(tx, {
      citaId: cita.id, usuarioId: req.user?.userId, accion: 'editar_canal', entidad: 'cita', entidadId: cita.id,
      antes: { canal: cita.canal }, despues: { canal }, sedeId: cita.sedeId, ip: req.ip,
    });
  });
  const citaCompleta = await getCitaCompleta(cita.id);
  emitirEventoCita({
    tipo: 'cita:actualizada',
    sedeId: cita.sedeId,
    fecha: cita.fecha.toISOString().split('T')[0]!,
    cita: citaCompleta as never,
    cambiadoPor: req.user?.userId ?? 'sistema',
  });
  res.json(citaCompleta);
});

// ─── PATCH /citas/:id/promocion ───────────────────────────────────────────────
// Set/limpiar la promoción de una cita. En un bloque combinado, la promo SIEMPRE se escribe
// en la cita PORTADORA (PRINCIPAL/profilaxis), aunque se edite desde la secundaria. Emite
// evento para AMBAS citas del bloque para que la UI refresque.
router.patch('/:id/promocion', requireAuth, async (req, res) => {
  const { promocionId } = z.object({ promocionId: z.string().uuid().nullable() }).parse(req.body);
  const cita = await prisma.cita.findUnique({
    where: { id: req.params.id, deletedAt: null },
    select: { id: true, sedeId: true, fecha: true, slotGrupoId: true },
  });
  if (!cita) throw new AppError('Cita no encontrada', 404);

  if (promocionId) {
    const promo = await prisma.promocion.findFirst({ where: { id: promocionId, deletedAt: null } });
    if (!promo) throw new AppError('Promoción no encontrada', 404);
  }

  const portadoraId = await resolverCitaPortadora(cita);
  const antes = await prisma.cita.findUnique({ where: { id: portadoraId }, select: { promocionId: true } });

  await prisma.$transaction(async (tx) => {
    await tx.cita.update({ where: { id: portadoraId }, data: { promocionId } });
    await auditEnTx(tx, {
      citaId: portadoraId, usuarioId: req.user?.userId, accion: 'editar_promocion', entidad: 'cita', entidadId: portadoraId,
      antes: { promocionId: antes?.promocionId ?? null }, despues: { promocionId }, sedeId: cita.sedeId, ip: req.ip,
    });
  });

  // Refrescar ambas citas del bloque (o la única).
  const idsBloque = cita.slotGrupoId
    ? (await prisma.cita.findMany({ where: { slotGrupoId: cita.slotGrupoId, deletedAt: null }, select: { id: true } })).map(c => c.id)
    : [cita.id];
  const fecha = cita.fecha.toISOString().split('T')[0]!;
  for (const cid of idsBloque) {
    emitirEventoCita({ tipo: 'cita:actualizada', sedeId: cita.sedeId, fecha, cita: await getCitaCompleta(cid) as never, cambiadoPor: req.user?.userId ?? 'sistema' });
  }
  res.json(await getCitaCompleta(req.params.id));
});

// ─── GET /citas/sede/:sedeId/stats ─────────────────────────────────────────────
router.get('/sede/:sedeId/stats', requireAuth, async (req, res) => {
  const { fecha } = req.query as { fecha?: string };
  const fechaDate = fecha ? fechaDb(fecha) : new Date();
  fechaDate.setHours(0, 0, 0, 0);

  const citas = await prisma.cita.groupBy({
    by: ['estado'],
    where: {
      sedeId: req.params.sedeId,
      fecha: fechaDate,
      deletedAt: null,
      estado: { not: 'cancelada' },
    },
    _count: { estado: true },
  });

  const stats = {
    total: 0, confirmadas: 0, llegaron: 0, noShows: 0, completadas: 0, agendadas: 0, enAtencion: 0,
  };

  for (const g of citas) {
    const count = g._count.estado;
    stats.total += count;
    if (g.estado === 'confirmada') stats.confirmadas += count;
    if (g.estado === 'llego') stats.llegaron += count;
    if (g.estado === 'no_show') stats.noShows += count;
    if (g.estado === 'completada') stats.completadas += count;
    if (g.estado === 'agendada') stats.agendadas += count;
    if (g.estado === 'en_atencion') stats.enAtencion += count;
  }

  // Capacidad real: suma de slots de 30 min disponibles por profesional activo ese día en la sede
  const diaSemana = fechaDate.getDay();
  const horariosDia = await prisma.horarioProfesional.findMany({
    where: {
      diaSemana,
      activo: true,
      profesional: {
        activo: true,
        deletedAt: null,
        asignaciones: { some: { sedeId: req.params.sedeId, activa: true } },
      },
    },
  });
  let capacidadMaxima = horariosDia.reduce((sum, h) => {
    const [hI = 0, mI = 0] = h.horaInicio.split(':').map(Number);
    const [hF = 0, mF = 0] = h.horaFin.split(':').map(Number);
    return sum + Math.floor(((hF * 60 + mF) - (hI * 60 + mI)) / 30);
  }, 0);
  if (capacidadMaxima === 0) capacidadMaxima = 1; // evitar división por cero en días sin horario

  // Ocupación = ocupación FÍSICA de slots: un bloque combinado (ancla + extra) ocupa
  // una sola hora física, así que las mitades SECUNDARIAS no suman a la ocupación (sí
  // a las atenciones/`stats.total`, que cuentan los 2 servicios — ver decisión de KPIs).
  const secundarios = await prisma.cita.count({
    where: { sedeId: req.params.sedeId, fecha: fechaDate, deletedAt: null, estado: { not: 'cancelada' }, slotRol: 'SECUNDARIO' },
  });
  const totalFisico = Math.max(0, stats.total - secundarios);

  res.json({ ...stats, ocupacion: Math.round((totalFisico / capacidadMaxima) * 100) });
});

// ─── Auto-completado por tiempo ───────────────────────────────────────────────
// Una cita marcada "Llegó" pasa SOLA a 'completada' a los N minutos (default 90), por
// cumplimiento de tiempo. Aplica a citas en 'llego'/'en_atencion' cuyo `llegoEn` superó el
// umbral. Idempotente (corre cada pocos minutos). Hace los MISMOS efectos que completar a
// mano (consume sesión de paquete, evento socket, webhook) y audita como 'auto_completar'.
const AUTOCOMPLETAR_MIN = Number(process.env.AUTOCOMPLETAR_MIN) || 90;

export async function autocompletarCitasPorTiempo(minutos = AUTOCOMPLETAR_MIN): Promise<number> {
  const limite = new Date(Date.now() - minutos * 60_000);
  const candidatas = await prisma.cita.findMany({
    where: { estado: { in: ['llego', 'en_atencion'] }, llegoEn: { lte: limite }, deletedAt: null },
    select: { id: true, sedeId: true, fecha: true },
  });
  const diasAfectados = new Set<string>();
  let completadas = 0;

  for (const c of candidatas) {
    try {
      const cambiada = await prisma.$transaction(async (tx) => {
        const actual = await tx.cita.findUnique({ where: { id: c.id }, select: { estado: true } });
        if (!actual || (actual.estado !== 'llego' && actual.estado !== 'en_atencion')) return false; // ya cambió
        await tx.cita.update({ where: { id: c.id }, data: { estado: 'completada' } });
        await auditEnTx(tx, {
          citaId: c.id, usuarioId: undefined, accion: 'auto_completar', entidad: 'cita', entidadId: c.id,
          antes: { estado: actual.estado },
          despues: { estado: 'completada', motivo: `auto por tiempo (${minutos} min desde "Llegó")` },
          sedeId: c.sedeId, ip: undefined,
        });
        return true;
      });
      if (!cambiada) continue;

      await sincronizarSesionPaquete(c.id);
      const completa = await getCitaCompleta(c.id);
      const fecha = c.fecha.toISOString().split('T')[0]!;
      emitirEventoCita({ tipo: 'cita:estadoCambiado', sedeId: c.sedeId, fecha, cita: completa as never, cambiadoPor: 'sistema' });
      void dispararWebhooks('appointment.completed', c.sedeId, completa);
      diasAfectados.add(fecha);
      completadas++;
    } catch (e) {
      console.error(`[autocompletar] cita ${c.id} falló:`, e instanceof Error ? e.message : e);
    }
  }

  // Reagregar los KPIs de los días afectados (las completadas cambian los agregados).
  for (const fecha of diasAfectados) {
    // Anclas UTC explícitas (@db.Date vive a medianoche UTC) — no depender de la TZ del proceso.
    const d = new Date(`${fecha}T00:00:00Z`); const h = new Date(`${fecha}T23:59:59Z`);
    agregarRango(d, h).catch(() => {/* silencioso */});
  }
  if (completadas) console.log(`[autocompletar] ${completadas} cita(s) completadas por tiempo (${minutos} min)`);
  return completadas;
}

export default router;
