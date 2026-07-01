import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { prisma } from '../db';
import { AppError } from './errorHandler';

export interface AuthPayload {
  userId: string;
  rol: string;
  sedes: string[];
  permisos: string[];
}

declare global {
  namespace Express {
    interface Request {
      user?: AuthPayload;
      apiKey?: { id: string; scopes: string[] };
    }
  }
}

const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('JWT_SECRET environment variable is required in production');
  }
  console.warn('⚠️  JWT_SECRET no definido — usando secreto de desarrollo. NO usar en producción.');
}
const JWT_SECRET_VALUE = JWT_SECRET || 'limablue-dev-secret-only';

export function signToken(payload: AuthPayload): string {
  return jwt.sign(payload as object, JWT_SECRET_VALUE, {
    expiresIn: (process.env.JWT_EXPIRES_IN || '8h') as import('jsonwebtoken').SignOptions['expiresIn'],
  });
}

export function verifyToken(token: string): AuthPayload {
  return jwt.verify(token, JWT_SECRET_VALUE) as AuthPayload;
}

export async function getPermisosRol(rolNombre: string): Promise<string[]> {
  const rol = await prisma.rol.findUnique({ where: { nombre: rolNombre } });
  return rol?.permisos ?? [];
}

export async function requireAuth(req: Request, _res: Response, next: NextFunction): Promise<void> {
  const authHeader = req.headers.authorization;

  if (!authHeader) {
    throw new AppError('Token de autorización requerido', 401, 'UNAUTHORIZED');
  }

  // JWT Bearer
  if (authHeader.startsWith('Bearer ')) {
    const token = authHeader.slice(7);
    const payload = verifyToken(token);
    // Revalidar el usuario en cada request: si fue eliminado o desactivado, su sesión
    // muere al instante aunque el token siga vigente (no esperar a que caduque).
    const usuario = await prisma.usuario.findUnique({
      where: { id: payload.userId },
      select: { activo: true, deletedAt: true },
    });
    if (!usuario || usuario.deletedAt || !usuario.activo) {
      throw new AppError('Sesión revocada: usuario inactivo o eliminado', 401, 'SESION_REVOCADA');
    }
    // Permisos SIEMPRE frescos desde la BD (según el rol): si el admin cambia los permisos
    // de un rol, aplican al instante sin necesidad de cerrar y abrir sesión.
    payload.permisos = await getPermisosRol(payload.rol);
    req.user = payload;
    return next();
  }

  // API Key
  if (authHeader.startsWith('ApiKey ')) {
    const rawKey = authHeader.slice(7);
    const apiKeys = await prisma.apiKey.findMany({ where: { activa: true } });
    for (const ak of apiKeys) {
      if (await bcrypt.compare(rawKey, ak.keyHash)) {
        req.apiKey = { id: ak.id, scopes: ak.scopes };
        await prisma.apiKey.update({ where: { id: ak.id }, data: { ultimoUso: new Date() } });
        return next();
      }
    }
    throw new AppError('API Key inválida', 401, 'INVALID_API_KEY');
  }

  throw new AppError('Formato de autorización inválido', 401, 'UNAUTHORIZED');
}

export function requireScope(scope: string) {
  return async (req: Request, _res: Response, next: NextFunction) => {
    if (req.user) return next();
    if (req.apiKey?.scopes.includes(scope)) return next();
    throw new AppError(`Scope requerido: ${scope}`, 403, 'FORBIDDEN');
  };
}

export function requireRol(...roles: string[]) {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.user) throw new AppError('No autenticado', 401, 'UNAUTHORIZED');
    if (!roles.includes(req.user.rol)) {
      throw new AppError('Sin permisos para esta acción', 403, 'FORBIDDEN');
    }
    next();
  };
}

export function requirePermiso(permiso: string) {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.user) throw new AppError('No autenticado', 401, 'UNAUTHORIZED');
    if (!req.user.permisos?.includes(permiso)) {
      throw new AppError('Sin permisos para esta acción', 403, 'FORBIDDEN');
    }
    next();
  };
}
