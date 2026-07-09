/**
 * Punto ÚNICO de verdad para el consumo de sesiones de paquete.
 *
 * Desde el módulo Sesiones (2026-07), el saldo se deriva de `ConsumoSesion`
 * (fuente de verdad) y el contador legacy `sesionesUsadas` se mantiene por
 * write-through. Este módulo conserva su contrato histórico (se llama tras
 * CUALQUIER cambio de estado de una cita con paquete) y delega en
 * `sincronizarConsumoCita`:
 *  - Cita completada sin consumo vivo → crea el ConsumoSesion (origen CITA).
 *  - Cita fuera de llegada/atención con consumo vivo → soft-delete (devolución).
 * Es idempotente y está protegido por el índice único parcial
 * `consumos_cita_unico` (máx 1 consumo vivo por cita).
 */
import { sincronizarConsumoCita } from './consumoService';

export async function sincronizarSesionPaquete(citaId: string): Promise<'consumida' | 'reembolsada' | 'sin_cambio'> {
  const r = await sincronizarConsumoCita(citaId);
  return r === 'devuelta' ? 'reembolsada' : r;
}
