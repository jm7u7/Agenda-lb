import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../db';
import { requireAuth, requireRol } from '../middleware/auth';
import { AppError } from '../middleware/errorHandler';
import { recalcularPaquete } from '../services/consumoService';

const router = Router();

// ─── PATCH /paquetes/instancia/:id/tamano — CORREGIR tamaño (SOLO ADMIN) ─────
// Si recepción/contact eligió mal el tamaño (ej. 12 cuando era 4), solo un admin
// puede corregirlo. Ajusta sesionesTotal, capa consumos sobrantes (soft-delete) y
// recalcula el estado. Siempre con motivo y auditado. Nunca edita el saldo a mano:
// el saldo = tamaño − consumos vivos.
router.patch('/instancia/:id/tamano', requireAuth, requireRol('admin'), async (req, res) => {
  const { sesionesTotal, motivo } = z
    .object({ sesionesTotal: z.number().int().min(1).max(60), motivo: z.string().trim().min(3).max(500) })
    .parse(req.body);

  const pp = await prisma.paquetePaciente.findFirst({
    where: { id: req.params.id, deletedAt: null },
    include: { consumos: { where: { deletedAt: null }, orderBy: { creadoEn: 'asc' } } },
  });
  if (!pp) throw new AppError('Paquete no encontrado', 404);

  const resultado = await prisma.$transaction(async (tx) => {
    // Si el nuevo tamaño es menor que los consumos vivos, los que sobran se anulan
    // (soft-delete) — el paquete no puede tener más consumos que su tamaño.
    if (pp.consumos.length > sesionesTotal) {
      const sobran = pp.consumos.slice(sesionesTotal).map((c) => c.id);
      await tx.consumoSesion.updateMany({
        where: { id: { in: sobran } },
        data: { deletedAt: new Date(), anuladoMotivo: `Corrección de tamaño a ${sesionesTotal}: ${motivo}` },
      });
    }
    await tx.paquetePaciente.update({ where: { id: pp.id }, data: { sesionesTotal } });
    const { saldo, estado } = await recalcularPaquete(tx, pp.id);
    await tx.auditLog.create({
      data: {
        usuarioId: req.user?.userId,
        accion: 'corregir_tamano_paquete_manual',
        entidad: 'paquete_paciente',
        entidadId: pp.id,
        antes: { sesionesTotal: pp.sesionesTotal } as never,
        despues: { sesionesTotal, saldo, estado, motivo } as never,
      },
    });
    return { saldo, estado };
  });
  res.json(resultado);
});

// Plantillas de paquetes
router.get('/', requireAuth, async (req, res) => {
  const paquetes = await prisma.paquete.findMany({
    where: { deletedAt: null },
    include: { servicio: { select: { id: true, nombre: true, color: true, unidadNegocioId: true, duracionMinutos: true } } },
    orderBy: { nombre: 'asc' },
  });
  res.json(paquetes);
});

// Instancias de paquete por paciente
router.get('/paciente/:pacienteId', requireAuth, async (req, res) => {
  const paquetes = await prisma.paquetePaciente.findMany({
    where: { pacienteId: req.params.pacienteId, deletedAt: null },
    include: {
      paquete: { include: { servicio: { select: { id: true, nombre: true, color: true, unidadNegocioId: true, duracionMinutos: true } } } },
      citas: {
        where: { deletedAt: null },
        orderBy: [{ fecha: 'asc' }, { horaInicio: 'asc' }],
        select: { id: true, fecha: true, horaInicio: true, estado: true, sesionNumero: true },
      },
      consumos: { where: { deletedAt: null, origen: 'APERTURA' }, select: { id: true } },
    },
    orderBy: { creadoEn: 'desc' },
  });
  // Adjudicación manual Genexis: se ofrecen TODAS las sesiones (recepción puede
  // saber más que la conciliación — su elección REANCLA la apertura). Ocupados =
  // solo números adjudicados a citas vivas. `anclado` = ya hubo una primera
  // adjudicación (cita viva) → desde ahí la numeración es automática.
  res.json(paquetes.map(({ consumos, ...pp }) => {
    const citasVivas = pp.citas.filter((c) => !['cancelada', 'no_show', 'reprogramada'].includes(c.estado));
    const ocupados = new Set<number>();
    for (const c of citasVivas) if (c.sesionNumero) ocupados.add(c.sesionNumero);
    return {
      ...pp,
      origen: pp.origen,
      aperturaConsumidas: consumos.length,
      numerosOcupados: [...ocupados].sort((a, b) => a - b),
      anclado: citasVivas.length > 0,
    };
  }));
});

// Asignar paquete a paciente
router.post('/paciente/:pacienteId', requireAuth, async (req, res) => {
  const data = z.object({
    paqueteId: z.string().uuid(),
    fechaCompra: z.string(),
    notas: z.string().optional(),
    // Candado de sede (módulo Sesiones): el paquete se atiende donde se compró.
    sedeId: z.string().uuid().optional(),
    // CONTINUACIÓN DE GENEXIS: recepción crea el paquete ella misma (mirando el
    // visor Historial Genexis) para los casos que NO se concilian por admin (rojos).
    // Nace GENEXIS_APERTURA sin anclar → el drawer le pide la sesión y al agendar
    // se reancla (las previas quedan como tomadas en Genexis).
    origenGenexis: z.boolean().optional(),
  }).parse(req.body);

  const paquete = await prisma.paquete.findUnique({ where: { id: data.paqueteId, deletedAt: null } });
  if (!paquete) throw new AppError('Plantilla de paquete no encontrada', 404);
  if (!paquete.activo) throw new AppError('Este paquete ya no está a la venta', 409, 'PAQUETE_NO_VENDIBLE');
  if (data.origenGenexis && !data.sedeId) throw new AppError('Indica la sede (candado de sede)', 400, 'SEDE_REQUERIDA');

  // Control: no activar otro paquete del MISMO servicio si el existente aún tiene CUPO para
  // agendar sesiones (comprometidas = usadas + agendadas pendientes < total). Si ya está lleno
  // (todas las sesiones usadas o agendadas), SÍ se permite activar uno nuevo (6 o 12 más).
  const activosMismoServicio = await prisma.paquetePaciente.findMany({
    where: { pacienteId: req.params.pacienteId, deletedAt: null, activo: true, paquete: { servicioId: paquete.servicioId } },
    include: {
      paquete: { select: { nombre: true, servicio: { select: { nombre: true } } } },
      citas: { where: { deletedAt: null, estado: { in: ['agendada', 'confirmada', 'llego', 'en_atencion'] } }, select: { id: true } },
    },
  });
  const conCupo = activosMismoServicio.find(pp => pp.sesionesUsadas + pp.citas.length < pp.sesionesTotal);
  if (conCupo) {
    throw new AppError(
      `El paciente ya tiene un paquete activo de «${conCupo.paquete.servicio.nombre}» («${conCupo.paquete.nombre}») con sesiones disponibles. Usa ese paquete; solo cuando se llene podrás activar otro.`,
      409,
      'PAQUETE_ACTIVO_DUPLICADO',
    );
  }

  const instancia = await prisma.$transaction(async (tx) => {
    const inst = await tx.paquetePaciente.create({
      data: {
        pacienteId: req.params.pacienteId,
        paqueteId: data.paqueteId,
        fechaCompra: new Date(data.fechaCompra),
        sesionesTotal: paquete.totalSesiones,
        sesionesUsadas: 0,
        notas: data.notas,
        sedeId: data.sedeId ?? null,
        servicioNuevoId: paquete.servicioId,
        tipo: paquete.tipo,
        // Genexis: nace GENEXIS_APERTURA sin anclar; recepción adjudica la sesión al agendar.
        origen: data.origenGenexis ? 'GENEXIS_APERTURA' : 'AGENDA',
        estado: 'ACTIVO',
      },
      include: { paquete: { include: { servicio: true } } },
    });

    if (data.origenGenexis) {
      // Descartar la(s) conciliación(es) PENDIENTE del paciente para familias que
      // mapean a este servicio → recepción ya adjudicó; el aviso no debe seguir
      // marcándolas pendientes (honra "las rojas no las concilies por admin").
      const familias = await tx.familiaPaqueteGenexis.findMany({
        where: { deletedAt: null },
        select: { id: true, mapeoServicio: true },
      });
      const familiaIds = familias
        .filter((f) => {
          const m = f.mapeoServicio as { default?: string; porSede?: Record<string, string> } | null;
          return m?.default === paquete.servicioId || Object.values(m?.porSede ?? {}).includes(paquete.servicioId);
        })
        .map((f) => f.id);
      if (familiaIds.length > 0) {
        await tx.conciliacionApertura.updateMany({
          where: { pacienteId: req.params.pacienteId, familiaId: { in: familiaIds }, estado: 'PENDIENTE', deletedAt: null },
          data: { estado: 'DESCARTADA', notas: 'Adjudicado por recepción al agendar (visor Genexis)', decididoEn: new Date(), paquetePacienteId: inst.id },
        });
      }
      await tx.auditLog.create({
        data: {
          usuarioId: req.user?.userId,
          accion: 'crear_paquete_genexis_recepcion',
          entidad: 'paquete_paciente',
          entidadId: inst.id,
          despues: { pacienteId: req.params.pacienteId, servicioId: paquete.servicioId, sedeId: data.sedeId } as never,
        },
      });
    }
    return inst;
  });

  res.status(201).json(instancia);
});

const plantillaSchema = z.object({
  nombre: z.string().min(3),
  servicioId: z.string().uuid(),
  totalSesiones: z.number().int().positive(),
  consumeNoShow: z.boolean().default(false),
  precio: z.number().positive().optional(),
});

router.post('/', requireAuth, requireRol('admin'), async (req, res) => {
  const data = plantillaSchema.parse(req.body);
  const paquete = await prisma.paquete.create({
    data: { ...data, precio: data.precio as never },
    include: { servicio: { select: { id: true, nombre: true, color: true } } },
  });
  res.status(201).json(paquete);
});

router.patch('/:id', requireAuth, requireRol('admin'), async (req, res) => {
  const paquete = await prisma.paquete.findUnique({ where: { id: req.params.id, deletedAt: null } });
  if (!paquete) throw new AppError('Paquete no encontrado', 404);

  const data = plantillaSchema.partial().parse(req.body);
  const updated = await prisma.paquete.update({
    where: { id: req.params.id },
    data: { ...data, precio: data.precio as never },
    include: { servicio: { select: { id: true, nombre: true, color: true } } },
  });
  res.json(updated);
});

router.delete('/:id', requireAuth, requireRol('admin'), async (req, res) => {
  const paquete = await prisma.paquete.findUnique({ where: { id: req.params.id, deletedAt: null } });
  if (!paquete) throw new AppError('Paquete no encontrado', 404);

  await prisma.paquete.update({
    where: { id: req.params.id },
    data: { deletedAt: new Date() },
  });
  res.json({ ok: true });
});

export default router;
