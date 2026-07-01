import { prisma } from '../db';
import { TURNOS_ALMUERZO } from '@limablue/shared';

export async function tieneAlmuerzoEnSede(
  profesionalId: string,
  sedeId: string,
): Promise<boolean> {
  const existente = await prisma.bloqueoAgenda.findFirst({
    where: { profesionalId, sedeId, tipo: 'ALMUERZO', esRecurrente: true, deletedAt: null },
  });
  return !!existente;
}

export async function crearAlmuerzo(data: {
  profesionalId: string;
  sedeId: string;
  horaInicio: string;
  creadoPor: string;
}): Promise<void> {
  const turno = TURNOS_ALMUERZO.find(t => t.horaInicio === data.horaInicio);
  if (!turno) throw new Error('Turno inválido. Debe ser 12:00, 13:00 o 14:00.');

  const yaExiste = await tieneAlmuerzoEnSede(data.profesionalId, data.sedeId);
  if (yaExiste) {
    throw new Error(
      'Esta profesional ya tiene un horario de almuerzo en esta sede. ' +
        'Elimínalo primero si necesitas cambiarlo.',
    );
  }

  const asignacion = await prisma.asignacionSede.findFirst({
    where: {
      profesionalId: data.profesionalId,
      sedeId: data.sedeId,
      activa: true,
      fechaInicio: { lte: new Date() },
      OR: [{ fechaFin: null }, { fechaFin: { gte: new Date() } }],
    },
    orderBy: { fechaInicio: 'desc' },
  });

  if (!asignacion) {
    throw new Error(
      'La profesional no tiene asignación activa en esta sede. ' +
        'Verifica el módulo de Movimientos antes de registrar el almuerzo.',
    );
  }

  await prisma.bloqueoAgenda.create({
    data: {
      profesionalId: data.profesionalId,
      sedeId: data.sedeId,
      tipo: 'ALMUERZO',
      esRecurrente: true,
      horaInicio: turno.horaInicio,
      horaFin: turno.horaFin,
      duracionMin: 60,
      motivo: `Almuerzo ${turno.label}`,
      fechaInicio: asignacion.fechaInicio,
      fechaFin: asignacion.fechaFin ?? new Date('2099-12-31'),
      creadoPor: data.creadoPor,
    },
  });
}
