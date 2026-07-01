import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { prisma } from '../db';
import { requireAuth, requirePermiso, AuthPayload } from '../middleware/auth';
import { AppError } from '../middleware/errorHandler';

const router = Router();

const soloAdmins = [requireAuth, requirePermiso('usuarios.ver')];
const editarAdmins = [requireAuth, requirePermiso('usuarios.editar')];

const crearSchema = z.object({
  nombre: z.string().min(2),
  email: z.string().email(),
  password: z.string().min(6),
  rol: z.string().min(1),
  activo: z.boolean().optional().default(true),
});

const editarSchema = z.object({
  nombre: z.string().min(2).optional(),
  email: z.string().email().optional(),
  password: z.string().min(6).optional(),
  rol: z.string().min(1).optional(),
  activo: z.boolean().optional(),
});

// GET /api/v1/users — lista todos los usuarios
router.get('/', ...soloAdmins, async (_req, res) => {
  const usuarios = await prisma.usuario.findMany({
    where: { deletedAt: null },
    select: { id: true, nombre: true, email: true, rol: true, activo: true, creadoEn: true },
    orderBy: { creadoEn: 'asc' },
  });
  res.json(usuarios);
});

// GET /api/v1/users/:id
router.get('/:id', ...soloAdmins, async (req, res) => {
  const usuario = await prisma.usuario.findFirst({
    where: { id: req.params.id, deletedAt: null },
    select: { id: true, nombre: true, email: true, rol: true, activo: true, creadoEn: true },
  });
  if (!usuario) throw new AppError('Usuario no encontrado', 404);
  res.json(usuario);
});

// POST /api/v1/users
router.post('/', ...editarAdmins, async (req, res) => {
  const data = crearSchema.parse(req.body);
  const existe = await prisma.usuario.findFirst({ where: { email: data.email.toLowerCase(), deletedAt: null } });
  if (existe) throw new AppError('Ya existe un usuario con ese email', 409);
  const passwordHash = await bcrypt.hash(data.password, 12);
  const usuario = await prisma.usuario.create({
    data: {
      nombre: data.nombre,
      email: data.email.toLowerCase(),
      passwordHash,
      rol: data.rol,
      activo: data.activo,
    },
    select: { id: true, nombre: true, email: true, rol: true, activo: true, creadoEn: true },
  });
  res.status(201).json(usuario);
});

// PUT /api/v1/users/:id
router.put('/:id', ...editarAdmins, async (req, res) => {
  const caller = req.user as AuthPayload;
  const { id } = req.params;
  const data = editarSchema.parse(req.body);

  if (data.activo === false && id === caller.userId) {
    throw new AppError('No puedes desactivarte a ti mismo', 400);
  }

  const update: Record<string, unknown> = {};
  if (data.nombre) update.nombre = data.nombre;
  if (data.email) update.email = data.email.toLowerCase();
  if (data.rol) update.rol = data.rol;
  if (typeof data.activo === 'boolean') update.activo = data.activo;
  if (data.password) update.passwordHash = await bcrypt.hash(data.password, 12);

  const usuario = await prisma.usuario.update({
    where: { id },
    data: update,
    select: { id: true, nombre: true, email: true, rol: true, activo: true, creadoEn: true },
  });
  res.json(usuario);
});

// DELETE /api/v1/users/:id — soft delete
router.delete('/:id', ...editarAdmins, async (req, res) => {
  const caller = req.user as AuthPayload;
  const { id } = req.params;
  if (id === caller.userId) throw new AppError('No puedes desactivarte a ti mismo', 400);
  await prisma.usuario.update({ where: { id }, data: { activo: false, deletedAt: new Date() } });
  res.json({ success: true });
});

export default router;
