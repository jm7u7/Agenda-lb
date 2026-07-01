import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../db';
import { requireAuth, requirePermiso } from '../middleware/auth';
import { AppError } from '../middleware/errorHandler';

const router = Router();

const PERMISOS_VALIDOS = [
  'agenda.ver', 'agenda.editar',
  'pacientes.ver', 'pacientes.editar',
  'herramientas.operativas', 'herramientas.estrategicas',
  'movimientos.ver', 'movimientos.editar',
  'admin.ver', 'analytics.ver',
  'notificaciones.ver',
  'usuarios.ver', 'usuarios.editar',
  'roles.editar',
];

const rolSchema = z.object({
  label: z.string().min(2),
  descripcion: z.string().optional(),
  permisos: z.array(z.enum(PERMISOS_VALIDOS as [string, ...string[]])),
});

const crearSchema = rolSchema.extend({
  nombre: z.string().min(2).regex(/^[a-z0-9_]+$/, 'Solo minúsculas, números y guiones bajos'),
});

// GET /api/v1/roles — lista todos los roles (cualquier usuario autenticado puede verlos para el formulario)
router.get('/', requireAuth, async (_req, res) => {
  const roles = await prisma.rol.findMany({ orderBy: { creadoEn: 'asc' } });
  res.json(roles);
});

// GET /api/v1/roles/permisos — lista de permisos disponibles
router.get('/permisos', requireAuth, async (_req, res) => {
  const grupos: Record<string, { id: string; label: string }[]> = {
    'Agenda': [
      { id: 'agenda.ver', label: 'Ver agenda' },
      { id: 'agenda.editar', label: 'Crear / editar / cancelar citas' },
    ],
    'Pacientes': [
      { id: 'pacientes.ver', label: 'Ver pacientes' },
      { id: 'pacientes.editar', label: 'Crear / editar pacientes' },
    ],
    'Herramientas': [
      { id: 'herramientas.operativas', label: 'Operativas: Lista de citas, Reactivación de Pacientes, Historial de Atenciones' },
      { id: 'herramientas.estrategicas', label: 'Estratégicas: TODAS (almuerzos, horarios, permisos, canales, confirmación…) + las operativas' },
    ],
    'Movimientos': [
      { id: 'movimientos.ver', label: 'Ver movimientos de personal' },
      { id: 'movimientos.editar', label: 'Crear / editar / eliminar movimientos' },
    ],
    'Administración': [
      { id: 'admin.ver', label: 'Ver panel de administración' },
      { id: 'analytics.ver', label: 'Ver analytics y reportes' },
      { id: 'notificaciones.ver', label: 'Ver / gestionar notificaciones' },
    ],
    'Usuarios y Roles': [
      { id: 'usuarios.ver', label: 'Ver usuarios del sistema' },
      { id: 'usuarios.editar', label: 'Crear / editar / desactivar usuarios' },
      { id: 'roles.editar', label: 'Crear / editar / eliminar roles' },
    ],
  };
  res.json(grupos);
});

// POST /api/v1/roles
router.post('/', requireAuth, requirePermiso('roles.editar'), async (req, res) => {
  const data = crearSchema.parse(req.body);
  const existe = await prisma.rol.findUnique({ where: { nombre: data.nombre } });
  if (existe) throw new AppError('Ya existe un rol con ese nombre interno', 409);
  const rol = await prisma.rol.create({ data: { ...data, esSistema: false } });
  res.status(201).json(rol);
});

// PUT /api/v1/roles/:id
router.put('/:id', requireAuth, requirePermiso('roles.editar'), async (req, res) => {
  const data = rolSchema.parse(req.body);
  const rol = await prisma.rol.findUnique({ where: { id: req.params.id } });
  if (!rol) throw new AppError('Rol no encontrado', 404);
  const actualizado = await prisma.rol.update({ where: { id: req.params.id }, data });
  res.json(actualizado);
});

// DELETE /api/v1/roles/:id
router.delete('/:id', requireAuth, requirePermiso('roles.editar'), async (req, res) => {
  const rol = await prisma.rol.findUnique({ where: { id: req.params.id } });
  if (!rol) throw new AppError('Rol no encontrado', 404);
  if (rol.esSistema) throw new AppError('No se pueden eliminar roles del sistema', 400);
  const enUso = await prisma.usuario.count({ where: { rol: rol.nombre, deletedAt: null } });
  if (enUso > 0) throw new AppError(`Este rol está asignado a ${enUso} usuario(s). Reasígnalos primero.`, 400);
  await prisma.rol.delete({ where: { id: req.params.id } });
  res.json({ success: true });
});

export default router;
