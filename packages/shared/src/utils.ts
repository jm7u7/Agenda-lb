import { format, addMinutes, parse } from 'date-fns';

export function timeToMinutes(time: string): number {
  const [h, m] = time.split(':').map(Number);
  return h * 60 + m;
}

export function minutesToTime(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

export function calcularIniciales(nombres: string, apellidos: string): string {
  const n = nombres.trim().split(' ')[0]?.[0] ?? '';
  const a = apellidos.trim().split(' ')[0]?.[0] ?? '';
  return `${n}${a}`.toUpperCase();
}

export function generarColorAvatar(id: string): string {
  const colores = [
    '#3B82F6', '#8B5CF6', '#EC4899', '#F59E0B', '#10B981',
    '#6366F1', '#EF4444', '#14B8A6', '#F97316', '#84CC16',
  ];
  let hash = 0;
  for (let i = 0; i < id.length; i++) {
    hash = id.charCodeAt(i) + ((hash << 5) - hash);
  }
  return colores[Math.abs(hash) % colores.length]!;
}

export function formatFecha(fecha: string): string {
  const [y, m, d] = fecha.split('-');
  return `${d}/${m}/${y}`;
}

export function generarSlotsDelDia(
  horaInicio: string,
  horaFin: string,
  duracionSlot: number = 30
): string[] {
  const slots: string[] = [];
  let current = timeToMinutes(horaInicio);
  const end = timeToMinutes(horaFin);
  while (current < end) {
    slots.push(minutesToTime(current));
    current += duracionSlot;
  }
  return slots;
}

// ─── Alineación de slots según la duración del servicio ────────────────────────
// REGLA ÚNICA (fuente de verdad): un servicio cuya duración es múltiplo de 60 min
// (60, 120, …) SOLO puede iniciarse en hora entera (08:00, 09:00, …), nunca en
// media hora (08:30). Los servicios de 30 min sí pueden iniciar en cualquier media
// hora. Usar SIEMPRE estos helpers — no duplicar la lógica con comparaciones sueltas.

/** ¿Este servicio (por su duración) solo puede empezar en hora entera? */
export function requiereHoraEntera(duracionMinutos: number): boolean {
  return duracionMinutos > 0 && duracionMinutos % 60 === 0;
}

/** ¿La hora de inicio "HH:mm" es válida para un servicio de esta duración? */
export function horaInicioValidaParaDuracion(horaInicio: string, duracionMinutos: number): boolean {
  if (!requiereHoraEntera(duracionMinutos)) return true;
  return timeToMinutes(horaInicio) % 60 === 0;
}
