import { Router } from 'express';
import { z } from 'zod';
import bcrypt from 'bcryptjs';
import { prisma } from '../db';
import { signToken, requireAuth, getPermisosRol } from '../middleware/auth';
import { AppError } from '../middleware/errorHandler';

const router = Router();

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(6),
});

router.post('/login', async (req, res) => {
  const { email, password } = loginSchema.parse(req.body);

  const usuario = await prisma.usuario.findUnique({
    where: { email, deletedAt: null },
    include: { sedes: { include: { sede: { select: { id: true, nombre: true } } } } },
  });

  if (!usuario || !usuario.activo) {
    throw new AppError('Credenciales inválidas', 401, 'INVALID_CREDENTIALS');
  }

  const passwordOk = await bcrypt.compare(password, usuario.passwordHash);
  if (!passwordOk) {
    throw new AppError('Credenciales inválidas', 401, 'INVALID_CREDENTIALS');
  }

  const sedeIds = usuario.sedes.map((us: { sedeId: string }) => us.sedeId);
  const permisos = await getPermisosRol(usuario.rol);
  const token = signToken({ userId: usuario.id, rol: usuario.rol, sedes: sedeIds, permisos });

  res.json({
    token,
    usuario: {
      id: usuario.id,
      nombre: usuario.nombre,
      email: usuario.email,
      rol: usuario.rol,
      permisos,
      sedes: usuario.sedes.map((us: { sedeId: string; sede: { nombre: string } }) => ({ id: us.sedeId, nombre: us.sede.nombre })),
    },
  });
});

router.get('/me', requireAuth, async (req, res) => {
  const usuario = await prisma.usuario.findUnique({
    where: { id: req.user!.userId },
    include: { sedes: { include: { sede: { select: { id: true, nombre: true, color: true } } } } },
  });
  if (!usuario) throw new AppError('Usuario no encontrado', 404);

  const permisos = await getPermisosRol(usuario.rol);

  res.json({
    id: usuario.id,
    nombre: usuario.nombre,
    email: usuario.email,
    rol: usuario.rol,
    permisos,
    sedes: usuario.sedes.map((us: { sedeId: string; sede: { nombre: string; color: string } }) => ({
      id: us.sedeId,
      nombre: us.sede.nombre,
      color: us.sede.color,
    })),
  });
});

export default router;
