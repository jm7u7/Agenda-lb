import { Router } from 'express';
import { z } from 'zod';
import PDFDocument from 'pdfkit';
import { prisma } from '../db';
import { requireAuth, requireRol } from '../middleware/auth';
import { AppError } from '../middleware/errorHandler';

// ─── Composición de sede ──────────────────────────────────────────────────────
// Herramienta INTERNA (no de agenda): traza quién compone cada sede en un mes.
// Combina, SOLO LECTURA, los movimientos ya existentes de podólogas/fisios (AsignacionSede)
// con un ROSTER ADMINISTRATIVO nuevo (AsignacionAdministrativa) para doctores + recepcionistas.
// El roster NO alimenta la disponibilidad ni las reservas: es puramente informativo.

const router = Router();
const gestion = [requireAuth, requireRol('admin', 'coordinadora_sedes')] as const;

// Máquinas de baropodometría ("Baro 1/2") vs doctores reales — mismo criterio que baroSolicitud.ts.
const esMaquinaBaro = (nombres: string, apellidos: string) =>
  /^baro\s*\d+$/i.test(`${nombres} ${apellidos}`.trim());

const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const nombreCompleto = (nombres: string, apellidos: string) => `${nombres} ${apellidos}`.trim();
// @db.Date → Date a medianoche UTC (el proceso corre en UTC). Formatear con getters UTC.
const fmtFecha = (d: Date) => `${String(d.getUTCDate()).padStart(2, '0')}/${String(d.getUTCMonth() + 1).padStart(2, '0')}/${d.getUTCFullYear()}`;
const parseMes = (mes: string) => {
  const [y, m] = mes.split('-').map(Number);
  return { y: y!, m: m!, monthStart: new Date(Date.UTC(y!, m! - 1, 1)), monthEnd: new Date(Date.UTC(y!, m!, 0)) };
};

interface PersonaRoster { id: string; nombre: string; desde: string; hasta: string; indefinido: boolean; notas?: string | null; asignacionId?: string }
interface SedeComposicion {
  sedeId: string; nombre: string;
  podologas: PersonaRoster[]; fisioterapeutas: PersonaRoster[]; doctores: PersonaRoster[]; recepcionistas: PersonaRoster[];
}

// Construye la composición combinada de todas las sedes para un mes YYYY-MM.
async function construirComposicion(mes: string) {
  const { y, m, monthStart, monthEnd } = parseMes(mes);

  const sedes = await prisma.sede.findMany({
    where: { activa: true, deletedAt: null },
    orderBy: [{ orden: 'asc' }, { nombre: 'asc' }],
    select: { id: true, nombre: true },
  });

  // Podólogas + fisios desde Movimientos (AsignacionSede) — solo lectura, sin tocar nada.
  // AsignacionSede NO tiene soft-delete; la vigencia se resuelve por PURO rango de fechas
  // (misma semántica que el motor de disponibilidad y las columnas de la agenda).
  const asigSede = await prisma.asignacionSede.findMany({
    where: {
      fechaInicio: { lte: monthEnd },
      OR: [{ fechaFin: null }, { fechaFin: { gte: monthStart } }],
      profesional: {
        tipo: { in: ['podologa', 'fisioterapeuta'] },
        activo: true, deletedAt: null,
        NOT: { nombres: { equals: 'Adicional', mode: 'insensitive' } },
      },
    },
    select: {
      sedeId: true, fechaInicio: true, fechaFin: true, motivo: true,
      profesional: { select: { id: true, nombres: true, apellidos: true, tipo: true } },
    },
  });

  // Doctores + recepcionistas desde el roster administrativo nuevo.
  const asigAdmin = await prisma.asignacionAdministrativa.findMany({
    where: {
      deletedAt: null,
      fechaInicio: { lte: monthEnd },
      OR: [{ fechaFin: null }, { fechaFin: { gte: monthStart } }],
    },
    select: {
      id: true, sedeId: true, fechaInicio: true, fechaFin: true, notas: true,
      profesional: { select: { id: true, nombres: true, apellidos: true } },
      recepcionista: { select: { id: true, nombre: true } },
    },
  });

  const clamp = (fi: Date, ff: Date | null) => {
    const desde = fi < monthStart ? monthStart : fi;
    const hasta = ff && ff < monthEnd ? ff : monthEnd;
    return { desde: fmtFecha(desde), hasta: fmtFecha(hasta), indefinido: ff === null };
  };
  const byName = (arr: PersonaRoster[]) => arr.sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));

  const sedesComp: SedeComposicion[] = sedes.map((s) => {
    const comp: SedeComposicion = { sedeId: s.id, nombre: s.nombre, podologas: [], fisioterapeutas: [], doctores: [], recepcionistas: [] };
    for (const a of asigSede) {
      if (a.sedeId !== s.id) continue;
      // Excluir COBERTURAS DE UN DÍA (préstamo "día especial", motivo COBERTURA_EMERGENCIA con
      // fechaInicio==fechaFin): no son la distribución del mes. Si no se excluyen, duplican a quien
      // ya está en su sede base (Erika) y hacen aparecer a alguien en una sede que no es la suya
      // (Ivonne, cuya base es Lince, cubrió Los Olivos un día). Igual criterio que esCoberturaUnDia.
      if (a.fechaFin && +a.fechaInicio === +a.fechaFin && a.motivo === 'COBERTURA_EMERGENCIA') continue;
      const persona: PersonaRoster = { id: a.profesional.id, nombre: nombreCompleto(a.profesional.nombres, a.profesional.apellidos), ...clamp(a.fechaInicio, a.fechaFin) };
      (a.profesional.tipo === 'podologa' ? comp.podologas : comp.fisioterapeutas).push(persona);
    }
    for (const a of asigAdmin) {
      if (a.sedeId !== s.id) continue;
      const c = clamp(a.fechaInicio, a.fechaFin);
      if (a.profesional) comp.doctores.push({ id: a.profesional.id, nombre: nombreCompleto(a.profesional.nombres, a.profesional.apellidos), notas: a.notas, asignacionId: a.id, ...c });
      else if (a.recepcionista) comp.recepcionistas.push({ id: a.recepcionista.id, nombre: a.recepcionista.nombre, notas: a.notas, asignacionId: a.id, ...c });
    }
    byName(comp.podologas); byName(comp.fisioterapeutas); byName(comp.doctores); byName(comp.recepcionistas);
    return comp;
  });

  return { mes, mesLabel: `${MESES[m - 1]} ${y}`, inicio: fmtFecha(monthStart), fin: fmtFecha(monthEnd), sedes: sedesComp };
}

// ─── GET /composicion?mes=YYYY-MM ─── (datos para la visualización) ────────────
router.get('/composicion', ...gestion, async (req, res) => {
  const mes = String(req.query.mes ?? '');
  if (!/^\d{4}-\d{2}$/.test(mes)) throw new AppError('mes (YYYY-MM) requerido', 400);
  res.json(await construirComposicion(mes));
});

// ─── GET /composicion.pdf?mes=YYYY-MM ─── (imprimible, una sección por sede) ────
router.get('/composicion.pdf', ...gestion, async (req, res) => {
  const mes = String(req.query.mes ?? '');
  if (!/^\d{4}-\d{2}$/.test(mes)) throw new AppError('mes (YYYY-MM) requerido', 400);
  const data = await construirComposicion(mes);

  const doc = new PDFDocument({ size: 'A4', margin: 48, bufferPages: true });
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="composicion-sedes-${mes}.pdf"`);
  doc.pipe(res);

  const AZUL = '#2563EB', GRIS = '#64748B', OSCURO = '#1E293B';
  const left = doc.page.margins.left;
  const ancho = doc.page.width - doc.page.margins.left - doc.page.margins.right;
  const limiteInferior = doc.page.height - doc.page.margins.bottom;

  // Encabezado del documento
  doc.fontSize(20).fillColor(OSCURO).font('Helvetica-Bold').text('Composición de sedes', left, doc.page.margins.top);
  doc.fontSize(11).fillColor(GRIS).font('Helvetica').text(`Personal por sede — ${data.mesLabel} (${data.inicio} a ${data.fin})`, { align: 'left' });
  doc.moveDown(1);

  const grupo = (titulo: string, personas: PersonaRoster[]) => {
    if (doc.y > limiteInferior - 40) doc.addPage();
    doc.fontSize(10.5).fillColor(AZUL).font('Helvetica-Bold').text(`${titulo}  (${personas.length})`, left);
    doc.moveDown(0.15);
    if (personas.length === 0) {
      doc.fontSize(9).fillColor(GRIS).font('Helvetica-Oblique').text('    — sin personal asignado —', left);
    } else {
      for (const p of personas) {
        if (doc.y > limiteInferior - 16) doc.addPage();
        const periodo = p.indefinido ? `desde ${p.desde} (indefinido)` : `${p.desde} – ${p.hasta}`;
        doc.fontSize(9.5).fillColor(OSCURO).font('Helvetica')
          .text(`    •  ${p.nombre}`, left, doc.y, { continued: true, width: ancho * 0.55 })
          .fillColor(GRIS).font('Helvetica')
          .text(`   ${periodo}${p.notas ? '  ·  ' + p.notas : ''}`, { width: ancho * 0.45 });
      }
    }
    doc.moveDown(0.5);
  };

  data.sedes.forEach((sede, i) => {
    // Barra de sede — nueva página si no cabe la barra + al menos un grupo.
    if (i > 0 && doc.y > limiteInferior - 90) doc.addPage();
    const barY = doc.y;
    doc.rect(left, barY, ancho, 24).fill(AZUL);
    doc.fillColor('#FFFFFF').font('Helvetica-Bold').fontSize(13).text(sede.nombre, left + 8, barY + 6, { width: ancho - 16 });
    doc.y = barY + 24;
    doc.moveDown(0.6);
    grupo('Podólogas', sede.podologas);
    grupo('Fisioterapeutas', sede.fisioterapeutas);
    grupo('Doctores (baropodometría)', sede.doctores);
    grupo('Recepcionistas', sede.recepcionistas);
    doc.moveDown(0.5);
  });

  // Numeración de páginas
  const rango = doc.bufferedPageRange();
  for (let i = 0; i < rango.count; i++) {
    doc.switchToPage(rango.start + i);
    doc.fontSize(8).fillColor(GRIS).font('Helvetica')
      .text(`Limablue — Composición de sedes · ${data.mesLabel}    ·    Página ${i + 1} de ${rango.count}`,
        left, limiteInferior + 12, { width: ancho, align: 'center' });
  }

  doc.end();
});

// ─── GET /doctores ─── (Profesionales tipo=medico que NO son máquinas Baro) ─────
router.get('/doctores', ...gestion, async (_req, res) => {
  const meds = await prisma.profesional.findMany({
    where: { tipo: 'medico', activo: true, deletedAt: null },
    select: { id: true, nombres: true, apellidos: true },
    orderBy: [{ nombres: 'asc' }],
  });
  res.json(meds.filter((p) => !esMaquinaBaro(p.nombres, p.apellidos))
    .map((p) => ({ id: p.id, nombre: nombreCompleto(p.nombres, p.apellidos) })));
});

// ─── Recepcionistas (ficha de personal sin login) ──────────────────────────────
router.get('/recepcionistas', ...gestion, async (_req, res) => {
  const list = await prisma.recepcionista.findMany({ where: { deletedAt: null }, orderBy: { nombre: 'asc' } });
  res.json(list);
});

router.post('/recepcionistas', ...gestion, async (req, res) => {
  const { nombre } = z.object({ nombre: z.string().min(2).max(120) }).parse(req.body);
  const r = await prisma.recepcionista.create({ data: { nombre: nombre.trim() } });
  res.status(201).json(r);
});

router.patch('/recepcionistas/:id', ...gestion, async (req, res) => {
  const data = z.object({ nombre: z.string().min(2).max(120).optional(), activo: z.boolean().optional() }).parse(req.body);
  const existe = await prisma.recepcionista.findFirst({ where: { id: req.params.id, deletedAt: null } });
  if (!existe) throw new AppError('Recepcionista no encontrada', 404);
  const r = await prisma.recepcionista.update({ where: { id: req.params.id }, data: { ...(data.nombre ? { nombre: data.nombre.trim() } : {}), ...(data.activo !== undefined ? { activo: data.activo } : {}) } });
  res.json(r);
});

router.delete('/recepcionistas/:id', ...gestion, async (req, res) => {
  const existe = await prisma.recepcionista.findFirst({ where: { id: req.params.id, deletedAt: null } });
  if (!existe) throw new AppError('Recepcionista no encontrada', 404);
  const ahora = new Date();
  await prisma.$transaction([
    prisma.recepcionista.update({ where: { id: req.params.id }, data: { deletedAt: ahora } }),
    // Al borrar la ficha, retira también sus asignaciones del roster (soft delete).
    prisma.asignacionAdministrativa.updateMany({ where: { recepcionistaId: req.params.id, deletedAt: null }, data: { deletedAt: ahora } }),
  ]);
  res.json({ ok: true });
});

// ─── Asignaciones administrativas (roster) ─────────────────────────────────────
const asignacionSchema = z.object({
  sedeId: z.string().uuid(),
  fechaInicio: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  fechaFin: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  profesionalId: z.string().uuid().nullable().optional(),
  recepcionistaId: z.string().uuid().nullable().optional(),
  notas: z.string().max(300).optional(),
});

// ¿La persona ya tiene una asignación (en cualquier sede) que solape el rango nuevo?
async function haySolape(campo: 'profesionalId' | 'recepcionistaId', personaId: string, inicio: string, fin: string | null, excluirId?: string) {
  const nuevoInicio = new Date(inicio);
  const nuevoFin = fin ? new Date(fin) : null;
  const existentes = await prisma.asignacionAdministrativa.findMany({
    where: { [campo]: personaId, deletedAt: null, ...(excluirId ? { id: { not: excluirId } } : {}) },
    select: { fechaInicio: true, fechaFin: true },
  });
  return existentes.some((a) => {
    const finSolapa = nuevoFin === null || a.fechaInicio <= nuevoFin;
    const inicioSolapa = a.fechaFin === null || a.fechaFin >= nuevoInicio;
    return finSolapa && inicioSolapa;
  });
}

// Valida cuerpo + reglas comunes; devuelve el campo/persona resueltos.
async function validarAsignacion(data: z.infer<typeof asignacionSchema>): Promise<{ campo: 'profesionalId' | 'recepcionistaId'; personaId: string }> {
  const tieneProf = !!data.profesionalId, tieneRec = !!data.recepcionistaId;
  if (tieneProf === tieneRec) throw new AppError('Asigna exactamente un doctor O una recepcionista', 400, 'PERSONA_INVALIDA');
  if (data.fechaFin && data.fechaFin < data.fechaInicio) throw new AppError('La fecha de fin no puede ser anterior a la de inicio', 400);
  const sede = await prisma.sede.findFirst({ where: { id: data.sedeId, deletedAt: null } });
  if (!sede) throw new AppError('Sede no encontrada', 404);
  if (tieneProf) {
    const p = await prisma.profesional.findFirst({ where: { id: data.profesionalId!, tipo: 'medico', activo: true, deletedAt: null }, select: { nombres: true, apellidos: true } });
    if (!p || esMaquinaBaro(p.nombres, p.apellidos)) throw new AppError('Doctor no válido (debe ser un médico, no una máquina de baro)', 400, 'DOCTOR_INVALIDO');
    return { campo: 'profesionalId', personaId: data.profesionalId! };
  }
  const r = await prisma.recepcionista.findFirst({ where: { id: data.recepcionistaId!, deletedAt: null } });
  if (!r) throw new AppError('Recepcionista no encontrada', 404, 'RECEPCIONISTA_INVALIDA');
  return { campo: 'recepcionistaId', personaId: data.recepcionistaId! };
}

// Lista de asignaciones (roster) para gestionar; opcionalmente filtradas por mes.
router.get('/asignaciones', ...gestion, async (req, res) => {
  const mes = String(req.query.mes ?? '');
  let filtroMes = {};
  if (/^\d{4}-\d{2}$/.test(mes)) {
    const { monthStart, monthEnd } = parseMes(mes);
    filtroMes = { fechaInicio: { lte: monthEnd }, OR: [{ fechaFin: null }, { fechaFin: { gte: monthStart } }] };
  }
  const list = await prisma.asignacionAdministrativa.findMany({
    where: { deletedAt: null, ...filtroMes },
    orderBy: [{ fechaInicio: 'desc' }],
    select: {
      id: true, sedeId: true, fechaInicio: true, fechaFin: true, notas: true,
      sede: { select: { nombre: true } },
      profesional: { select: { id: true, nombres: true, apellidos: true } },
      recepcionista: { select: { id: true, nombre: true } },
    },
  });
  res.json(list.map((a) => ({
    id: a.id,
    sedeId: a.sedeId,
    sedeNombre: a.sede.nombre,
    fechaInicio: fmtFecha(a.fechaInicio),
    fechaFin: a.fechaFin ? fmtFecha(a.fechaFin) : null,
    notas: a.notas,
    cargo: a.profesional ? 'doctor' : 'recepcionista',
    personaId: a.profesional?.id ?? a.recepcionista?.id ?? null,
    personaNombre: a.profesional ? nombreCompleto(a.profesional.nombres, a.profesional.apellidos) : (a.recepcionista?.nombre ?? '—'),
  })));
});

router.post('/asignaciones', ...gestion, async (req, res) => {
  const data = asignacionSchema.parse(req.body);
  const { campo, personaId } = await validarAsignacion(data);
  if (await haySolape(campo, personaId, data.fechaInicio, data.fechaFin ?? null)) {
    throw new AppError('Esa persona ya tiene una asignación que se cruza con ese rango de fechas', 409, 'SOLAPE');
  }
  const nueva = await prisma.asignacionAdministrativa.create({
    data: {
      sedeId: data.sedeId,
      fechaInicio: new Date(data.fechaInicio),
      fechaFin: data.fechaFin ? new Date(data.fechaFin) : null,
      profesionalId: campo === 'profesionalId' ? personaId : null,
      recepcionistaId: campo === 'recepcionistaId' ? personaId : null,
      notas: data.notas?.trim() || null,
      creadoPor: req.user?.userId,
    },
  });
  res.status(201).json(nueva);
});

router.patch('/asignaciones/:id', ...gestion, async (req, res) => {
  const actual = await prisma.asignacionAdministrativa.findFirst({ where: { id: req.params.id, deletedAt: null } });
  if (!actual) throw new AppError('Asignación no encontrada', 404);
  // Se pueden editar sede, fechas y notas; NO se cambia la persona (para eso, borrar y crear).
  const data = z.object({
    sedeId: z.string().uuid().optional(),
    fechaInicio: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    fechaFin: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
    notas: z.string().max(300).nullable().optional(),
  }).parse(req.body);

  const fechaInicio = data.fechaInicio ?? fmtISO(actual.fechaInicio);
  const fechaFin = data.fechaFin === undefined ? (actual.fechaFin ? fmtISO(actual.fechaFin) : null) : data.fechaFin;
  if (fechaFin && fechaFin < fechaInicio) throw new AppError('La fecha de fin no puede ser anterior a la de inicio', 400);
  if (data.sedeId) {
    const sede = await prisma.sede.findFirst({ where: { id: data.sedeId, deletedAt: null } });
    if (!sede) throw new AppError('Sede no encontrada', 404);
  }
  const campo: 'profesionalId' | 'recepcionistaId' = actual.profesionalId ? 'profesionalId' : 'recepcionistaId';
  const personaId = (actual.profesionalId ?? actual.recepcionistaId)!;
  if (await haySolape(campo, personaId, fechaInicio, fechaFin, actual.id)) {
    throw new AppError('Esa persona ya tiene otra asignación que se cruza con ese rango', 409, 'SOLAPE');
  }
  const upd = await prisma.asignacionAdministrativa.update({
    where: { id: actual.id },
    data: {
      ...(data.sedeId ? { sedeId: data.sedeId } : {}),
      fechaInicio: new Date(fechaInicio),
      fechaFin: fechaFin ? new Date(fechaFin) : null,
      ...(data.notas !== undefined ? { notas: data.notas?.trim() || null } : {}),
    },
  });
  res.json(upd);
});

router.delete('/asignaciones/:id', ...gestion, async (req, res) => {
  const actual = await prisma.asignacionAdministrativa.findFirst({ where: { id: req.params.id, deletedAt: null } });
  if (!actual) throw new AppError('Asignación no encontrada', 404);
  await prisma.asignacionAdministrativa.update({ where: { id: actual.id }, data: { deletedAt: new Date() } });
  res.json({ ok: true });
});

// @db.Date → 'YYYY-MM-DD' (UTC) para reusar valores previos en updates.
function fmtISO(d: Date) { return d.toISOString().slice(0, 10); }

export default router;
