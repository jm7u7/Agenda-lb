import { prisma } from '../db';

/**
 * Punto ÚNICO de verdad para el consumo de sesiones de paquete.
 *
 * Regla canónica: una cita consume 1 sesión del paquete **única y exclusivamente**
 * mientras está en estado `completada`. Cualquier otro estado (no_show, cancelada,
 * agendada/confirmada/llego/en_atencion) consume 0.
 *
 * Es IDEMPOTENTE y reconcilia en ambos sentidos usando la bandera
 * `cita.sesionConsumida`:
 *  - Si la cita está completada y aún no consumió → descuenta 1 (y marca la bandera).
 *  - Si la cita ya NO está completada pero sí había consumido → reembolsa 1.
 * El flip atómico de la bandera (`updateMany` condicional) evita doble descuento
 * aunque se llame varias veces o haya carrera.
 *
 * Debe llamarse después de CUALQUIER cambio de estado de una cita con paquete.
 */
export async function sincronizarSesionPaquete(citaId: string): Promise<'consumida' | 'reembolsada' | 'sin_cambio'> {
  const cita = await prisma.cita.findUnique({
    where: { id: citaId },
    select: { paquetePacienteId: true, estado: true, sesionConsumida: true },
  });
  if (!cita?.paquetePacienteId) return 'sin_cambio';

  const debeConsumir = cita.estado === 'completada';

  // ── Consumir: completada y aún no descontada ──
  if (debeConsumir && !cita.sesionConsumida) {
    const flip = await prisma.cita.updateMany({
      where: { id: citaId, sesionConsumida: false },
      data: { sesionConsumida: true },
    });
    if (flip.count === 1) {
      await prisma.paquetePaciente.update({
        where: { id: cita.paquetePacienteId },
        data: { sesionesUsadas: { increment: 1 } },
      });
      return 'consumida';
    }
    return 'sin_cambio';
  }

  // ── Reembolsar: ya no está completada pero sí había descontado ──
  if (!debeConsumir && cita.sesionConsumida) {
    const flip = await prisma.cita.updateMany({
      where: { id: citaId, sesionConsumida: true },
      data: { sesionConsumida: false },
    });
    if (flip.count === 1) {
      // Nunca por debajo de 0.
      const pp = await prisma.paquetePaciente.findUnique({
        where: { id: cita.paquetePacienteId },
        select: { sesionesUsadas: true },
      });
      if (pp && pp.sesionesUsadas > 0) {
        await prisma.paquetePaciente.update({
          where: { id: cita.paquetePacienteId },
          data: { sesionesUsadas: { decrement: 1 } },
        });
      }
      return 'reembolsada';
    }
    return 'sin_cambio';
  }

  return 'sin_cambio';
}
