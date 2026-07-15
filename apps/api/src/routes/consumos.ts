/**
 * Módulo Sesiones — endpoints de CONSUMO operativo.
 * El saldo jamás se edita: consumir/devolver/anular son las únicas mutaciones,
 * todas trazables (ConsumoSesion + AuditLog).
 */
import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../db';
import { requireAuth, requireRol } from '../middleware/auth';
import { consumirDeCita, consumoManual, anularConsumo, exonerarSesion, revertirExoneracion } from '../services/consumoService';

const router = Router();

async function nombreUsuario(userId: string | undefined): Promise<string> {
  if (!userId) return 'recepción';
  const u = await prisma.usuario.findUnique({ where: { id: userId }, select: { nombre: true } });
  return u?.nombre ?? 'recepción';
}

// ─── POST /consumos/cita/:citaId — consumo confirmado desde el diálogo de llegada ──
router.post('/cita/:citaId', requireAuth, async (req, res) => {
  const { paquetePacienteId } = z.object({ paquetePacienteId: z.string().uuid() }).parse(req.body);
  const r = await consumirDeCita({
    citaId: req.params.citaId,
    paquetePacienteId,
    usuarioId: req.user?.userId,
    usuarioNombre: await nombreUsuario(req.user?.userId),
  });
  res.status(201).json(r);
});

// ─── POST /consumos/manual — válvula de escape (recepción), auditada ─────────
router.post('/manual', requireAuth, async (req, res) => {
  const body = z
    .object({
      paquetePacienteId: z.string().uuid(),
      citaId: z.string().uuid().optional(),
      motivo: z.string().trim().max(500).optional(),
    })
    .parse(req.body);
  const r = await consumoManual({
    ...body,
    esAdmin: req.user?.rol === 'admin',
    usuarioId: req.user?.userId,
    usuarioNombre: await nombreUsuario(req.user?.userId),
  });
  res.status(201).json(r);
});

// ─── POST /consumos/cita/:citaId/exonerar — "no aplicar / no descontar" (recepción + admin) ──
// exonerar=true marca la cita como sesión no aplicada (ej. láser no aplicado) y DEVUELVE la
// sesión si ya se descontó; exonerar=false quita la marca. Auditado. En un combo se aplica
// solo a la cita del láser (la profilaxis descuenta normal).
router.post('/cita/:citaId/exonerar', requireAuth, async (req, res) => {
  const { exonerar, motivo } = z.object({
    exonerar: z.boolean(),
    motivo: z.string().trim().max(500).optional(),
  }).parse(req.body);
  const nombre = await nombreUsuario(req.user?.userId);
  const r = exonerar
    ? await exonerarSesion(req.params.citaId, motivo, req.user?.userId, nombre)
    : await revertirExoneracion(req.params.citaId, req.user?.userId, nombre);
  res.json(r);
});

// ─── POST /consumos/:id/anular — reversa (solo admin, motivo obligatorio) ────
router.post('/:id/anular', requireAuth, requireRol('admin'), async (req, res) => {
  const { motivo } = z.object({ motivo: z.string().trim().min(3).max(500) }).parse(req.body);
  const r = await anularConsumo(req.params.id, motivo, req.user?.userId, await nombreUsuario(req.user?.userId));
  res.json(r);
});

export default router;
