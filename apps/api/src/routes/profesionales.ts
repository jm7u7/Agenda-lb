import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../db';
import { requireAuth, requireRol } from '../middleware/auth';
import { AppError } from '../middleware/errorHandler';
import { turnosDelDia } from '../services/disponibilidad';
import { fechaDb } from '../utils/fechaLima';
import { auditEnTx } from '../services/audit';
import { redis } from '../redis';

const router = Router();

router.get('/', requireAuth, async (req, res) => {
  const { sedeId, unidadNegocioId, fecha, activo } = req.query as Record<string, string>;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const where: Record<string, any> = { deletedAt: null };
  if (activo !== undefined) where.activo = activo === 'true';

  // Ids de profesionales con cita ese día (columna "bajo demanda"); se llena dentro del
  // bloque sedeId y se usa luego para filtrar columnas en días con excepción abierta.
  const idsConCita = new Set<string>();
  // Pertenece a la unidad O tiene competencia a un servicio activo de esa unidad
  // (permite que un profesional aparezca en otra unidad, p.ej. Daniel Doy en Baropodometría).
  if (unidadNegocioId) {
    where.OR = [
      { unidadNegocioId },
      { competencias: { some: { activa: true, servicio: { unidadNegocioId, activo: true, deletedAt: null } } } },
    ];
  }

  // Columnas de la agenda por sede+fecha. Dos fuentes:
  //  (1) Profesionales ASIGNADOS a la sede que NO son "solo por solicitud" (columnas fijas:
  //      podólogas/fisios de la sede + los slots automáticos de baro "1 Baro/2 Baro").
  //  (2) Cualquier profesional que TENGA una cita ese día en la sede (columna "bajo demanda":
  //      así aparecen Daniel o un médico solo el día que efectivamente atienden ahí).
  if (sedeId) {
    const fechaDate = fecha ? new Date(fecha + 'T00:00:00') : new Date();
    fechaDate.setHours(0, 0, 0, 0);

    const asignaciones = await prisma.asignacionSede.findMany({
      where: {
        sedeId,
        fechaInicio: { lte: fechaDate },
        OR: [{ fechaFin: null }, { fechaFin: { gte: fechaDate } }],
        profesional: unidadNegocioId ? {
          // Columna fija = tiene una competencia NORMAL (no solo-por-solicitud) a esta unidad.
          // Así Daniel sale como columna en Podología (competencia normal) pero NO en
          // Baropodometría (esa competencia es solo-por-solicitud → solo aparece si tiene cita).
          competencias: { some: { activa: true, soloPorSolicitud: false, servicio: { unidadNegocioId, activo: true, deletedAt: null } } },
        } : {},
      },
      select: { profesionalId: true },
    });

    const citasDelDia = await prisma.cita.findMany({
      where: {
        sedeId,
        fecha: new Date((fecha ?? new Date().toISOString().slice(0, 10)) + 'T12:00:00'),
        deletedAt: null,
        profesionalId: { not: null },
        ...(unidadNegocioId ? { unidadNegocioId } : {}),
      },
      select: { profesionalId: true },
      distinct: ['profesionalId'],
    });

    for (const c of citasDelDia) if (c.profesionalId) idsConCita.add(c.profesionalId);
    const ids = [...new Set([
      ...asignaciones.map((a: { profesionalId: string }) => a.profesionalId),
      ...[...idsConCita],
    ])];
    where.id = { in: ids };
    delete where.OR; // los ids ya quedaron acotados (asignados a la unidad + con cita en la unidad)
  }

  const fechaParaAsignacion = sedeId && fecha
    ? (() => { const d = new Date(fecha + 'T00:00:00'); d.setHours(0, 0, 0, 0); return d; })()
    : (() => { const d = new Date(); d.setHours(0, 0, 0, 0); return d; })();

  const profesionales = await prisma.profesional.findMany({
    where,
    include: {
      unidadNegocio: { select: { id: true, nombre: true, color: true, modoReserva: true } },
      asignaciones: {
        where: {
          fechaInicio: { lte: fechaParaAsignacion },
          OR: [{ fechaFin: null }, { fechaFin: { gte: fechaParaAsignacion } }],
        },
        include: {
          sede: { select: { id: true, nombre: true, color: true } },
          reemplazaProfesional: { select: { id: true, nombres: true, apellidos: true } },
        },
        orderBy: { fechaInicio: 'desc' },
        take: 5, // varias para detectar préstamo (cobertura aquí + su sede base)
      },
      horarios: { where: { activo: true }, select: { diaSemana: true, horaInicio: true, horaFin: true } },
    },
    orderBy: [{ apellidos: 'asc' }, { nombres: 'asc' }],
  });

  // Día de la semana de la fecha mostrada (para devolver el turno de ese día).
  const diaSemAgenda = (fecha ? new Date(fecha + 'T12:00:00Z') : new Date()).getUTCDay();

  // Overrides de entrada (8/9) específicos de la fecha mostrada — gestionados por
  // la Coordinadora de Sedes. Tienen prioridad sobre la entrada base del horario.
  const fechaOverride = fecha
    ? new Date(fecha + 'T00:00:00Z')
    : (() => { const d = new Date(); d.setUTCHours(0, 0, 0, 0); return d; })();
  const overrides = await prisma.entradaPodologa.findMany({
    where: { profesionalId: { in: profesionales.map((p) => p.id) }, fecha: fechaOverride },
    select: { profesionalId: true, horaInicio: true },
  });
  const overrideMap = new Map(overrides.map((o) => [o.profesionalId, o.horaInicio]));

  // Turno efectivo de cada profesional ese día (incluye DOMINGOS habilitados: excepción
  // de sede abierta + EntradaPodologa). Para días normales devuelve el horario base.
  const turnos = (sedeId && fecha)
    ? await turnosDelDia(sedeId, fecha, profesionales.map((p) => p.id))
    : new Map<string, { horaInicio: string; horaFin: string }>();

  // ¿La fecha tiene una EXCEPCIÓN de sede ABIERTA? Si sí, las columnas se limitan a las
  // podólogas marcadas (con turno) o con cita ese día. Los demás días NO se filtra.
  const excep = (sedeId && fecha)
    ? await prisma.excepcionHorario.findUnique({ where: { sedeId_fecha: { sedeId, fecha: fechaDb(fecha) } } })
    : null;
  const esDiaExcepcionAbierta = !!(excep && excep.abierto && excep.horaApertura && excep.horaCierre);

  let lista = profesionales.map((p: typeof profesionales[number]) => {
    const turno = turnos.get(p.id);
    return {
    id: p.id,
    nombres: p.nombres,
    apellidos: p.apellidos,
    tipo: p.tipo,
    colorAvatar: p.colorAvatar,
    activo: p.activo,
    unidadNegocio: p.unidadNegocio,
    ...(() => {
      // Asignación relevante para ESTA sede+fecha: la que apunta a la sede vista (si hay).
      // Para una podóloga en PRÉSTAMO (cobertura de un día) esa es la cobertura; su sede
      // ORIGEN es su asignación base (a otra sede, no cobertura).
      const asg = (sedeId ? p.asignaciones.find((a) => a.sedeId === sedeId) : undefined) ?? p.asignaciones[0];
      const esPrestamo = !!asg && esCoberturaUnDia(asg);
      const sedeOrigen = esPrestamo
        ? (p.asignaciones.find((a) => a.sedeId !== asg!.sedeId && !esCoberturaUnDia(a))?.sede.nombre ?? null)
        : null;
      return {
        sedeActual: asg?.sede ?? null,
        asignacionActual: asg
          ? {
              id: asg.id,
              fechaFin: asg.fechaFin?.toISOString().slice(0, 10) ?? null,
              motivo: asg.motivo,
              notas: asg.notas,
              reemplazaProfesional: asg.reemplazaProfesional ?? null,
              // Es un MOVIMIENTO real SOLO si reemplaza/cubre a alguien (`reemplazaA`) o si
              // cerró una asignación previa de ESTE profesional (transferencia entre sedes).
              // Un FICHAJE nuevo (inicio de labores) NO es movimiento.
              esMovimiento: !!(asg.reemplazaA || asg.cierraAsignacionId),
              // Préstamo = cobertura de un día traída de otra sede; se muestra "Préstamo {sedeOrigen}".
              esPrestamo,
              sedeOrigen,
            }
          : null,
      };
    })(),
    iniciales: `${p.nombres[0] ?? ''}${p.apellidos[0] ?? ''}`.toUpperCase(),
    // Turno del día mostrado (para que la agenda atenúe las horas fuera de jornada).
    // Sábado (diaSemana 6): la entrada es SIEMPRE 08:00. Lun-Vie: override ?? base.
    // La entrada mostrada NUNCA es antes de que ABRA la sede ese día: se recorta a
    // `turno.horaInicio` (que ya respeta la apertura de la excepción, ej. domingo 09:00).
    // El override (elección 8/9) solo la RETRASA cuando es más tarde que la apertura.
    horaEntrada: diaSemAgenda === 6
      ? (turno ? '08:00' : null)
      : (turno
          ? ((() => { const ov = overrideMap.get(p.id); return ov && ov > turno.horaInicio ? ov : turno.horaInicio; })())
          : (overrideMap.get(p.id) ?? null)),
    horaSalida: turno?.horaFin ?? null,
    };
  });

  if (esDiaExcepcionAbierta) {
    lista = lista.filter((row) => turnos.has(row.id) || idsConCita.has(row.id));
  }

  // Las podólogas "Adicional" (capacidad extra) van SIEMPRE al final de la lista (columnas
  // a la derecha en la agenda). El sort de V8 es estable → el resto conserva su orden alfabético.
  lista.sort((a, b) => (a.nombres === 'Adicional' ? 1 : 0) - (b.nombres === 'Adicional' ? 1 : 0));

  res.json(lista);
});

// ─── GET /profesionales/seleccionables?sedeId&unidadNegocioId&fecha ───────────
// Opciones que la recepción puede ELEGIR explícitamente al reservar:
//  - Profesionales "solo por solicitud" con competencia a la unidad (médicos de baro + Daniel),
//    seleccionables en cualquier sede.
//  - Profesionales reales asignados a la sede (podólogas/fisios), excluyendo los slots
//    automáticos genéricos de baro (tipo medico no-solicitud).
// En Baropodometría: por defecto es automático; esto sólo aplica si el paciente pide a alguien.
router.get('/seleccionables', requireAuth, async (req, res) => {
  const { sedeId, unidadNegocioId, fecha, servicioId } = req.query as Record<string, string>;
  if (!unidadNegocioId) throw new AppError('unidadNegocioId requerido', 400);
  const fechaDate = fecha ? new Date(fecha + 'T12:00:00') : new Date();

  // Si viene servicioId, se filtra por competencia a ESE servicio (solo quienes realmente lo hacen);
  // si no, por cualquier servicio de la unidad (compatibilidad).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const compFiltro = (extra: Record<string, any> = {}) => ({
    some: servicioId
      ? { activa: true, servicioId, ...extra }
      : { activa: true, servicio: { unidadNegocioId, activo: true, deletedAt: null }, ...extra },
  });

  // Por solicitud: profesionales con una competencia SOLO-POR-SOLICITUD al servicio/unidad (médicos + Daniel en baro).
  const porSolicitud = await prisma.profesional.findMany({
    where: { deletedAt: null, activo: true, competencias: compFiltro({ soloPorSolicitud: true }) },
    select: { id: true, nombres: true, apellidos: true, tipo: true },
    orderBy: [{ apellidos: 'asc' }],
  });

  let asignadosReales: { id: string; nombres: string; apellidos: string; tipo: string }[] = [];
  if (sedeId) {
    const asg = await prisma.asignacionSede.findMany({
      where: {
        sedeId,
        fechaInicio: { lte: fechaDate },
        OR: [{ fechaFin: null }, { fechaFin: { gte: fechaDate } }],
        profesional: { activo: true, deletedAt: null, tipo: { not: 'medico' }, competencias: compFiltro() },
      },
      include: { profesional: { select: { id: true, nombres: true, apellidos: true, tipo: true } } },
      orderBy: [{ profesional: { apellidos: 'asc' } }],
    });
    asignadosReales = asg.map(a => a.profesional);
  }

  const map = new Map<string, { id: string; nombres: string; apellidos: string; tipo: string; porSolicitud: boolean }>();
  for (const p of asignadosReales) map.set(p.id, { ...p, porSolicitud: false });
  for (const p of porSolicitud) map.set(p.id, { ...p, porSolicitud: true });
  res.json([...map.values()]);
});

const profesionalSchema = z.object({
  nombres: z.string().min(2),
  apellidos: z.string().min(2),
  tipo: z.enum(['podologa', 'medico', 'fisioterapeuta']),
  unidadNegocioId: z.string().uuid(),
  colorAvatar: z.string().optional(),
  activo: z.boolean().optional(),
});

router.post('/', requireAuth, requireRol('admin', 'coordinadora_sedes'), async (req, res) => {
  const data = profesionalSchema.parse(req.body);
  const profesional = await prisma.profesional.create({
    data,
    include: { unidadNegocio: { select: { id: true, nombre: true, color: true, modoReserva: true } } },
  });
  res.status(201).json(profesional);
});

router.patch('/:id', requireAuth, requireRol('admin', 'coordinadora_sedes'), async (req, res) => {
  const data = profesionalSchema.partial().parse(req.body);
  const profesional = await prisma.profesional.update({
    where: { id: req.params.id, deletedAt: null },
    data,
    include: { unidadNegocio: { select: { id: true, nombre: true, color: true, modoReserva: true } } },
  });
  res.json(profesional);
});

// ─── Gestión de hora de entrada (8:00 / 9:00) por semana — Coordinadora de Sedes ─
// La Coordinadora de Sedes y el admin deciden, SEMANA A SEMANA, qué podólogas entran
// a las 8:00 o 9:00, con excepciones por día. Se guarda en EntradaPodologa (override
// por fecha); si una fecha no tiene override, se usa la entrada base de HorarioProfesional.
const HORAS_ENTRADA = ['08:00', '09:00'] as const;

// Lunes (00:00 UTC) de la semana que contiene la fecha dada.
function lunesDeLaSemana(fechaISO: string): Date {
  const d = new Date(fechaISO + 'T00:00:00Z');
  const dow = d.getUTCDay(); // 0=Dom..6=Sáb
  const diff = dow === 0 ? -6 : 1 - dow;
  d.setUTCDate(d.getUTCDate() + diff);
  d.setUTCHours(0, 0, 0, 0);
  return d;
}
// Las 5 fechas Lun..Vie de la semana que contiene la fecha dada.
// (Los sábados la entrada es SIEMPRE 08:00, no es configurable.)
function fechasSemana(fechaISO: string): { fecha: Date; iso: string; diaSemana: number }[] {
  const lun = lunesDeLaSemana(fechaISO);
  const out: { fecha: Date; iso: string; diaSemana: number }[] = [];
  for (let i = 0; i < 5; i++) {
    const d = new Date(lun); d.setUTCDate(lun.getUTCDate() + i);
    out.push({ fecha: d, iso: d.toISOString().slice(0, 10), diaSemana: d.getUTCDay() });
  }
  return out;
}

// GET /profesionales/horarios-entrada?sedeId=X&semana=YYYY-MM-DD
// Devuelve, por podóloga, la entrada (8/9) de cada día Lun-Sáb de esa semana.
router.get('/horarios-entrada', requireAuth, requireRol('admin', 'coordinadora_sedes'), async (req, res) => {
  const { sedeId, semana } = req.query as { sedeId?: string; semana?: string };
  if (!sedeId) throw new AppError('sedeId requerido', 400);
  const semanaRef = semana && /^\d{4}-\d{2}-\d{2}$/.test(semana) ? semana : new Date().toISOString().slice(0, 10);
  const dias = fechasSemana(semanaRef);

  const hoy = new Date(); hoy.setHours(0, 0, 0, 0);
  const asignaciones = await prisma.asignacionSede.findMany({
    where: { sedeId, activa: true, fechaInicio: { lte: hoy }, OR: [{ fechaFin: null }, { fechaFin: { gte: hoy } }] },
    select: { profesionalId: true },
  });
  const ids = asignaciones.map(a => a.profesionalId);

  const profs = await prisma.profesional.findMany({
    where: { id: { in: ids }, tipo: 'podologa', deletedAt: null, activo: true },
    select: {
      id: true, nombres: true, apellidos: true, colorAvatar: true,
      horarios: { where: { activo: true }, select: { diaSemana: true, horaInicio: true } },
    },
    orderBy: [{ apellidos: 'asc' }, { nombres: 'asc' }],
  });

  // Overrides de la semana (Lun-Vie)
  const overrides = await prisma.entradaPodologa.findMany({
    where: { profesionalId: { in: profs.map(p => p.id) }, fecha: { gte: dias[0]!.fecha, lte: dias[4]!.fecha } },
    select: { profesionalId: true, fecha: true, horaInicio: true },
  });
  const ovMap = new Map<string, string>();
  for (const o of overrides) ovMap.set(`${o.profesionalId}|${o.fecha.toISOString().slice(0, 10)}`, o.horaInicio);

  res.json({
    semana: { lunes: dias[0]!.iso, viernes: dias[4]!.iso },
    podologas: profs.map(p => ({
      id: p.id,
      nombres: p.nombres,
      apellidos: p.apellidos,
      colorAvatar: p.colorAvatar,
      dias: dias.map(d => {
        const base = p.horarios.find(h => h.diaSemana === d.diaSemana)?.horaInicio ?? '08:00';
        const ov = ovMap.get(`${p.id}|${d.iso}`);
        return { fecha: d.iso, diaSemana: d.diaSemana, horaEntrada: ov ?? base, esExcepcion: !!ov };
      }),
    })),
  });
});

// PATCH /profesionales/:id/entrada  { fechas: string[], horaInicio: '08:00'|'09:00' }
// Fija la entrada de 1 o varias fechas (toda la semana = 5 fechas Lun-Vie; excepción = 1 fecha).
// La entrada 8/9 SOLO aplica de lunes a viernes; los sábados se ignoran (siempre 08:00).
router.patch('/:id/entrada', requireAuth, requireRol('admin', 'coordinadora_sedes'), async (req, res) => {
  const { fechas, horaInicio } = z.object({
    fechas: z.array(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)).min(1).max(7),
    horaInicio: z.enum(HORAS_ENTRADA),
  }).parse(req.body);

  const prof = await prisma.profesional.findUnique({ where: { id: req.params.id, deletedAt: null }, select: { id: true, tipo: true } });
  if (!prof) throw new AppError('Profesional no encontrado', 404);
  if (prof.tipo !== 'podologa') throw new AppError('La hora de entrada solo aplica a podólogas', 400);

  // Solo Lun-Vie: descartar sábados/domingos.
  const fechasLV = fechas.filter(f => { const dow = new Date(f + 'T00:00:00Z').getUTCDay(); return dow >= 1 && dow <= 5; });

  const usuarioId = req.user?.userId;
  for (const f of fechasLV) {
    const fecha = new Date(f + 'T00:00:00Z');
    await prisma.entradaPodologa.upsert({
      where: { profesionalId_fecha: { profesionalId: prof.id, fecha } },
      create: { profesionalId: prof.id, fecha, horaInicio, creadoPor: usuarioId },
      update: { horaInicio, creadoPor: usuarioId },
    });
  }

  res.json({ ok: true, id: prof.id, fechas: fechasLV, horaInicio });
});

// ─── Personal de un DÍA EXCEPCIONAL habilitado (domingo/feriado que la sede abre) ──
// Lista las podólogas asignadas a la sede con su estado de PRESENCIA ese día (si tienen
// EntradaPodologa = vienen). Solo tiene sentido en una fecha con excepción de sede abierta.
router.get('/personal-excepcion', requireAuth, requireRol('admin', 'coordinadora_sedes'), async (req, res) => {
  const { sedeId, fecha } = req.query as { sedeId?: string; fecha?: string };
  if (!sedeId || !fecha || !/^\d{4}-\d{2}-\d{2}$/.test(fecha)) throw new AppError('sedeId y fecha (YYYY-MM-DD) requeridos', 400);
  const fechaPunto = fechaDb(fecha);

  const exc = await prisma.excepcionHorario.findUnique({ where: { sedeId_fecha: { sedeId, fecha: fechaPunto } } });
  const abierto = !!(exc && exc.abierto && exc.horaApertura && exc.horaCierre);

  const asigs = await prisma.asignacionSede.findMany({
    where: {
      sedeId, fechaInicio: { lte: fechaPunto }, OR: [{ fechaFin: null }, { fechaFin: { gte: fechaPunto } }],
      profesional: { tipo: 'podologa', activo: true, deletedAt: null },
    },
    select: { profesionalId: true },
  });
  const ids = [...new Set(asigs.map((a) => a.profesionalId))];
  const profs = await prisma.profesional.findMany({
    where: { id: { in: ids } },
    select: { id: true, nombres: true, apellidos: true, colorAvatar: true },
    orderBy: [{ apellidos: 'asc' }, { nombres: 'asc' }],
  });
  const entradas = await prisma.entradaPodologa.findMany({ where: { profesionalId: { in: ids }, fecha: fechaPunto }, select: { profesionalId: true, horaInicio: true } });
  const entMap = new Map(entradas.map((e) => [e.profesionalId, e.horaInicio]));

  res.json({
    fecha, abierto, esExcepcion: !!exc,
    apertura: exc?.horaApertura ?? null, cierre: exc?.horaCierre ?? null,
    podologas: profs.map((p) => ({
      id: p.id, nombres: p.nombres, apellidos: p.apellidos, colorAvatar: p.colorAvatar,
      presente: entMap.has(p.id), horaEntrada: entMap.get(p.id) ?? '08:00',
    })),
  });
});

// PATCH /:id/presencia-excepcion { sedeId, fecha, presente, horaInicio? }
// Marca/desmarca a una podóloga como presente un día excepcional habilitado. Presente =
// crea/actualiza su EntradaPodologa (turno [entrada, cierre de la excepción]); ausente = la borra.
router.patch('/:id/presencia-excepcion', requireAuth, requireRol('admin', 'coordinadora_sedes'), async (req, res) => {
  const { sedeId, fecha, presente, horaInicio } = z.object({
    sedeId: z.string().uuid(),
    fecha: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    presente: z.boolean(),
    horaInicio: z.enum(HORAS_ENTRADA).optional(),
  }).parse(req.body);

  const prof = await prisma.profesional.findUnique({ where: { id: req.params.id, deletedAt: null }, select: { id: true, tipo: true } });
  if (!prof) throw new AppError('Profesional no encontrado', 404);
  if (prof.tipo !== 'podologa') throw new AppError('Solo aplica a podólogas', 400);

  const fechaPunto = fechaDb(fecha);
  // El día debe estar HABILITADO (excepción de sede abierta) para poder marcar presencia.
  const exc = await prisma.excepcionHorario.findUnique({ where: { sedeId_fecha: { sedeId, fecha: fechaPunto } } });
  if (!(exc && exc.abierto && exc.horaApertura && exc.horaCierre)) {
    throw new AppError('Ese día no está habilitado para la sede. Ábrelo primero en Horarios (excepción).', 400, 'DIA_NO_HABILITADO');
  }

  if (presente) {
    await prisma.entradaPodologa.upsert({
      where: { profesionalId_fecha: { profesionalId: prof.id, fecha: fechaPunto } },
      create: { profesionalId: prof.id, fecha: fechaPunto, horaInicio: horaInicio ?? '08:00', creadoPor: req.user?.userId },
      update: { horaInicio: horaInicio ?? '08:00', creadoPor: req.user?.userId },
    });
  } else {
    await prisma.entradaPodologa.deleteMany({ where: { profesionalId: prof.id, fecha: fechaPunto } });
  }
  res.json({ ok: true, id: prof.id, fecha, presente });
});

// ─── DÍAS ESPECIALES / EXCEPCIONES — herramienta unificada ───────────────────
// Una "cobertura de día especial" es una AsignacionSede de UN día
// (fechaInicio == fechaFin, motivo COBERTURA_EMERGENCIA): trae a una podóloga de
// OTRA sede a trabajar aquí solo esa fecha, SIN tocar su sede base (su asignación
// normal sigue intacta). Aparece como columna porque el agenda filtra por
// AsignacionSede que cubra la fecha. Presencia de las propias = EntradaPodologa.
function esCoberturaUnDia(a: { fechaInicio: Date; fechaFin: Date | null; motivo: string }): boolean {
  return a.motivo === 'COBERTURA_EMERGENCIA' && !!a.fechaFin && a.fechaInicio.getTime() === a.fechaFin.getTime();
}

// GET /profesionales/dia-especial?sedeId&fecha → quién trabaja en la sede esa fecha,
// con TODAS las podólogas (las de la sede + las traíbles de otras) y su estado.
router.get('/dia-especial', requireAuth, requireRol('admin', 'coordinadora_sedes'), async (req, res) => {
  const { sedeId, fecha } = req.query as { sedeId?: string; fecha?: string };
  if (!sedeId || !fecha || !/^\d{4}-\d{2}-\d{2}$/.test(fecha)) throw new AppError('sedeId y fecha (YYYY-MM-DD) requeridos', 400);
  const fechaPunto = fechaDb(fecha);

  const exc = await prisma.excepcionHorario.findUnique({ where: { sedeId_fecha: { sedeId, fecha: fechaPunto } } });
  const abierto = !!(exc && exc.abierto && exc.horaApertura && exc.horaCierre);

  const podologas = await prisma.profesional.findMany({
    where: { tipo: 'podologa', activo: true, deletedAt: null },
    select: {
      id: true, nombres: true, apellidos: true, colorAvatar: true,
      asignaciones: {
        where: { fechaInicio: { lte: fechaPunto }, OR: [{ fechaFin: null }, { fechaFin: { gte: fechaPunto } }] },
        select: { sedeId: true, fechaInicio: true, fechaFin: true, motivo: true, sede: { select: { nombre: true } } },
      },
    },
    orderBy: [{ apellidos: 'asc' }, { nombres: 'asc' }],
  });
  const entradas = await prisma.entradaPodologa.findMany({ where: { profesionalId: { in: podologas.map((p) => p.id) }, fecha: fechaPunto }, select: { profesionalId: true, horaInicio: true } });
  const entMap = new Map(entradas.map((e) => [e.profesionalId, e.horaInicio]));

  const filas = podologas.map((p) => {
    const base = p.asignaciones.find((a) => !esCoberturaUnDia(a)); // asignación normal (no cobertura de un día)
    const coberturaAqui = p.asignaciones.some((a) => a.sedeId === sedeId && esCoberturaUnDia(a));
    const esDeLaSede = base?.sedeId === sedeId;
    return {
      id: p.id, nombres: p.nombres, apellidos: p.apellidos, colorAvatar: p.colorAvatar,
      sedeBase: base?.sede.nombre ?? null,
      esDeLaSede,
      esCobertura: coberturaAqui,
      viene: esDeLaSede ? entMap.has(p.id) : coberturaAqui,
      horaEntrada: entMap.get(p.id) ?? '08:00',
    };
  }).filter((f) => f.esDeLaSede || f.sedeBase); // debe tener sede base para poder traerla

  res.json({
    fecha, abierto, esExcepcion: !!exc,
    apertura: exc?.horaApertura ?? null, cierre: exc?.horaCierre ?? null, nota: exc?.nota ?? null,
    propias: filas.filter((f) => f.esDeLaSede),
    otras: filas.filter((f) => !f.esDeLaSede),
  });
});

// POST /profesionales/dia-especial/set { profesionalId, sedeId, fechas: string[], viene, horaInicio? }
// Aplica a CADA fecha del array (una fecha o un rango). Propia → EntradaPodologa;
// otra sede → cobertura de un día (asignación + entrada). Todo idempotente y auditado.
router.post('/dia-especial/set', requireAuth, requireRol('admin', 'coordinadora_sedes'), async (req, res) => {
  const { profesionalId, sedeId, fechas, viene, horaInicio } = z.object({
    profesionalId: z.string().uuid(),
    sedeId: z.string().uuid(),
    fechas: z.array(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)).min(1).max(31),
    viene: z.boolean(),
    horaInicio: z.enum(HORAS_ENTRADA).optional(),
  }).parse(req.body);

  const prof = await prisma.profesional.findFirst({ where: { id: profesionalId, tipo: 'podologa', activo: true, deletedAt: null }, select: { id: true } });
  if (!prof) throw new AppError('Podóloga no encontrada', 404);

  const resultados: { fecha: string; accion: string }[] = [];
  const errores: { fecha: string; error: string }[] = [];

  for (const fecha of [...new Set(fechas)]) {
    try {
      const fechaPunto = fechaDb(fecha);
      const exc = await prisma.excepcionHorario.findUnique({ where: { sedeId_fecha: { sedeId, fecha: fechaPunto } } });
      if (!(exc && exc.abierto && exc.horaApertura && exc.horaCierre)) {
        errores.push({ fecha, error: 'Día no habilitado (abre la excepción en Horarios primero)' });
        continue;
      }
      // ¿Es de la sede? (tiene asignación normal a esta sede que cubre la fecha)
      const base = await prisma.asignacionSede.findFirst({
        where: { profesionalId, sedeId, fechaInicio: { lte: fechaPunto }, OR: [{ fechaFin: null }, { fechaFin: { gte: fechaPunto } }], NOT: { motivo: 'COBERTURA_EMERGENCIA', fechaFin: fechaPunto } },
      });
      const esDeLaSede = !!base;

      await prisma.$transaction(async (tx) => {
        if (esDeLaSede) {
          if (viene) {
            await tx.entradaPodologa.upsert({
              where: { profesionalId_fecha: { profesionalId, fecha: fechaPunto } },
              create: { profesionalId, fecha: fechaPunto, horaInicio: horaInicio ?? '08:00', creadoPor: req.user?.userId },
              update: { horaInicio: horaInicio ?? '08:00', creadoPor: req.user?.userId },
            });
          } else {
            await tx.entradaPodologa.deleteMany({ where: { profesionalId, fecha: fechaPunto } });
          }
        } else if (viene) {
          // Traer de otra sede: cobertura de un día (no toca su sede base) + entrada.
          const yaCobertura = await tx.asignacionSede.findFirst({ where: { profesionalId, sedeId, fechaInicio: fechaPunto, fechaFin: fechaPunto, motivo: 'COBERTURA_EMERGENCIA' } });
          if (!yaCobertura) {
            await tx.asignacionSede.create({ data: { profesionalId, sedeId, fechaInicio: fechaPunto, fechaFin: fechaPunto, motivo: 'COBERTURA_EMERGENCIA', creadoPor: req.user?.userId, notas: `Cobertura día especial ${fecha}` } });
          }
          await tx.entradaPodologa.upsert({
            where: { profesionalId_fecha: { profesionalId, fecha: fechaPunto } },
            create: { profesionalId, fecha: fechaPunto, horaInicio: horaInicio ?? '08:00', creadoPor: req.user?.userId },
            update: { horaInicio: horaInicio ?? '08:00', creadoPor: req.user?.userId },
          });
        } else {
          // Quitar cobertura: borra la asignación de un día + su entrada.
          await tx.asignacionSede.deleteMany({ where: { profesionalId, sedeId, fechaInicio: fechaPunto, fechaFin: fechaPunto, motivo: 'COBERTURA_EMERGENCIA' } });
          await tx.entradaPodologa.deleteMany({ where: { profesionalId, fecha: fechaPunto } });
        }
        await tx.auditLog.create({
          data: {
            usuarioId: req.user?.userId, accion: 'dia_especial_personal', entidad: 'profesional', entidadId: profesionalId,
            despues: { sedeId, fecha, viene, esDeLaSede, horaInicio: horaInicio ?? '08:00' } as never,
          },
        });
      });
      resultados.push({ fecha, accion: esDeLaSede ? (viene ? 'presente' : 'ausente') : (viene ? 'cobertura' : 'quitada') });
    } catch (e) {
      errores.push({ fecha, error: e instanceof Error ? e.message : String(e) });
    }
  }
  res.json({ resultados, errores });
});

router.get('/:id', requireAuth, async (req, res) => {
  const prof = await prisma.profesional.findUnique({
    where: { id: req.params.id, deletedAt: null },
    include: {
      unidadNegocio: true,
      asignaciones: {
        include: { sede: true },
        orderBy: { fechaInicio: 'desc' },
      },
      horarios: { where: { activo: true }, orderBy: { diaSemana: 'asc' } },
      bloqueos: { where: { deletedAt: null }, orderBy: { fechaInicio: 'asc' } },
      competencias: {
        where: { activa: true },
        include: { servicio: { select: { id: true, nombre: true, codigo: true, color: true } } },
      },
    },
  });
  if (!prof) throw new AppError('Profesional no encontrado', 404);
  res.json(prof);
});

// Horarios del profesional para la semana actual
router.get('/:id/horario', requireAuth, async (req, res) => {
  const horarios = await prisma.horarioProfesional.findMany({
    where: { profesionalId: req.params.id, activo: true },
    orderBy: { diaSemana: 'asc' },
  });

  const bloqueos = await prisma.bloqueoAgenda.findMany({
    where: {
      profesionalId: req.params.id,
      deletedAt: null,
      fechaFin: { gte: new Date() },
    },
    orderBy: { fechaInicio: 'asc' },
  });

  res.json({ horarios, bloqueos });
});

// ─── PUT /profesionales/:id/horario ───────────────────────────────────────────
// Define el HORARIO SEMANAL PERMANENTE (días + rango horario) de un trabajador —
// vigente hasta que se vuelva a editar. `dias` es la lista COMPLETA de días que
// trabaja; los días que NO estén en la lista quedan desactivados (no atiende).
// Additive: reusa el modelo existente `HorarioProfesional` (no cambia la BD).
// Distinto de Permisos/Bloqueos (excepciones puntuales) y de Días especiales.
const horarioDiaSchema = z.object({
  diaSemana: z.number().int().min(0).max(6),
  horaInicio: z.string().regex(/^\d{2}:\d{2}$/),
  horaFin: z.string().regex(/^\d{2}:\d{2}$/),
  turno: z.enum(['manana', 'tarde', 'completo']).optional(),
});
router.put('/:id/horario', requireAuth, requireRol('admin', 'coordinadora_sedes'), async (req, res) => {
  const data = z.object({ dias: z.array(horarioDiaSchema).max(7) }).parse(req.body);
  const prof = await prisma.profesional.findFirst({ where: { id: req.params.id, deletedAt: null }, select: { id: true, nombres: true, apellidos: true } });
  if (!prof) throw new AppError('Profesional no encontrado', 404);

  const vistos = new Set<number>();
  for (const d of data.dias) {
    if (vistos.has(d.diaSemana)) throw new AppError('Hay un día repetido en el horario', 400, 'DIA_DUPLICADO');
    vistos.add(d.diaSemana);
    if (d.horaFin <= d.horaInicio) throw new AppError('La hora de fin debe ser mayor que la de inicio', 400, 'RANGO_INVALIDO');
  }

  const antes = await prisma.horarioProfesional.findMany({
    where: { profesionalId: prof.id, activo: true },
    select: { diaSemana: true, horaInicio: true, horaFin: true },
    orderBy: { diaSemana: 'asc' },
  });

  await prisma.$transaction(async (tx) => {
    for (let dia = 0; dia <= 6; dia++) {
      const d = data.dias.find((x) => x.diaSemana === dia);
      if (d) {
        await tx.horarioProfesional.upsert({
          where: { profesionalId_diaSemana: { profesionalId: prof.id, diaSemana: dia } },
          create: { profesionalId: prof.id, diaSemana: dia, horaInicio: d.horaInicio, horaFin: d.horaFin, turno: (d.turno ?? 'completo') as never, activo: true },
          update: { horaInicio: d.horaInicio, horaFin: d.horaFin, turno: (d.turno ?? 'completo') as never, activo: true },
        });
      } else {
        // Día sin trabajar: desactiva la fila si existía (no atiende ese día).
        await tx.horarioProfesional.updateMany({ where: { profesionalId: prof.id, diaSemana: dia }, data: { activo: false } });
      }
    }
    await auditEnTx(tx, {
      usuarioId: req.user?.userId,
      accion: 'editar_horario_semanal',
      entidad: 'profesional',
      entidadId: prof.id,
      antes: { dias: antes },
      despues: { dias: data.dias },
      ip: req.ip,
    });
  });

  // El horario semanal afecta la disponibilidad de MUCHAS fechas futuras (no una sola),
  // así que se limpia toda la caché de disponibilidad (acción admin poco frecuente).
  try {
    const keys = await redis.keys('cache:disponibilidad:*');
    if (keys.length > 0) await redis.del(...keys);
  } catch { /* la caché tiene TTL; no es crítico */ }

  const horarios = await prisma.horarioProfesional.findMany({ where: { profesionalId: prof.id, activo: true }, orderBy: { diaSemana: 'asc' } });
  res.json({ ok: true, horarios });
});

// Crear bloqueo de agenda
router.post('/:id/bloqueos', requireAuth, async (req, res) => {
  const { fechaInicio, fechaFin, motivo } = z.object({
    fechaInicio: z.string(),
    fechaFin: z.string(),
    motivo: z.string().min(3),
  }).parse(req.body);

  const bloqueo = await prisma.bloqueoAgenda.create({
    data: {
      profesionalId: req.params.id,
      fechaInicio: new Date(fechaInicio),
      fechaFin: new Date(fechaFin),
      motivo,
    },
  });
  res.status(201).json(bloqueo);
});

export default router;
