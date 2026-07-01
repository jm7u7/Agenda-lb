import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../db';
import { requireAuth, requireRol } from '../middleware/auth';
import { AppError } from '../middleware/errorHandler';

const router = Router();

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
    },
    orderBy: { creadoEn: 'desc' },
  });
  res.json(paquetes);
});

// Asignar paquete a paciente
router.post('/paciente/:pacienteId', requireAuth, async (req, res) => {
  const data = z.object({
    paqueteId: z.string().uuid(),
    fechaCompra: z.string(),
    notas: z.string().optional(),
  }).parse(req.body);

  const paquete = await prisma.paquete.findUnique({ where: { id: data.paqueteId, deletedAt: null } });
  if (!paquete) throw new AppError('Plantilla de paquete no encontrada', 404);

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

  const instancia = await prisma.paquetePaciente.create({
    data: {
      pacienteId: req.params.pacienteId,
      paqueteId: data.paqueteId,
      fechaCompra: new Date(data.fechaCompra),
      sesionesTotal: paquete.totalSesiones,
      sesionesUsadas: 0,
      notas: data.notas,
    },
    include: { paquete: { include: { servicio: true } } },
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
