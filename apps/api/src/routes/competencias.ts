import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../db';
import { requireAuth, requireRol } from '../middleware/auth';
import { registrarAudit } from '../services/audit';

const router = Router();

// Matriz completa de competencias
router.get('/', requireAuth, async (req, res) => {
  const { unidadNegocioId } = req.query as Record<string, string>;

  const competencias = await prisma.competenciaProfesional.findMany({
    where: {
      activa: true,
      ...(unidadNegocioId && { profesional: { unidadNegocioId } }),
    },
    include: {
      profesional: { select: { id: true, nombres: true, apellidos: true, tipo: true, activo: true } },
      servicio: { select: { id: true, nombre: true, codigo: true, color: true, duracionMinutos: true } },
    },
    orderBy: [{ profesional: { apellidos: 'asc' } }, { servicio: { nombre: 'asc' } }],
  });

  res.json(competencias);
});

// Competencias de un profesional
router.get('/profesional/:profesionalId', requireAuth, async (req, res) => {
  const competencias = await prisma.competenciaProfesional.findMany({
    where: { profesionalId: req.params.profesionalId },
    include: { servicio: true },
  });
  res.json(competencias);
});

// Profesionales que hacen un servicio
router.get('/servicio/:servicioId', requireAuth, async (req, res) => {
  const competencias = await prisma.competenciaProfesional.findMany({
    where: { servicioId: req.params.servicioId, activa: true },
    include: { profesional: { include: { asignaciones: { where: { activa: true }, include: { sede: true }, take: 1 } } } },
  });
  res.json(competencias.map((c: { profesional: unknown }) => c.profesional));
});

const toggleSchema = z.object({
  profesionalId: z.string().uuid(),
  servicioId: z.string().uuid(),
  activa: z.boolean(),
});

// Activar/desactivar competencia
router.post('/toggle', requireAuth, requireRol('admin', 'coordinadora_sedes'), async (req, res) => {
  const { profesionalId, servicioId, activa } = toggleSchema.parse(req.body);

  const existing = await prisma.competenciaProfesional.findUnique({
    where: { profesionalId_servicioId: { profesionalId, servicioId } },
  });

  if (existing) {
    const updated = await prisma.competenciaProfesional.update({
      where: { id: existing.id },
      data: { activa },
    });
    await registrarAudit({
      usuarioId: req.user?.userId,
      accion: activa ? 'habilitar_competencia' : 'deshabilitar_competencia',
      entidad: 'competencia_profesional',
      entidadId: existing.id,
      antes: { activa: existing.activa },
      despues: { activa },
      ip: req.ip,
    });
    res.json(updated);
  } else {
    const created = await prisma.competenciaProfesional.create({
      data: { profesionalId, servicioId, habilitadoDesde: new Date(), activa },
    });
    await registrarAudit({
      usuarioId: req.user?.userId,
      accion: 'crear_competencia',
      entidad: 'competencia_profesional',
      entidadId: created.id,
      antes: null,
      despues: { profesionalId, servicioId, activa },
      ip: req.ip,
    });
    res.status(201).json(created);
  }
});

export default router;
