export const TURNOS_ALMUERZO = [
  { id: 'A', horaInicio: '12:00', horaFin: '13:00', label: '12:00 – 13:00' },
  { id: 'B', horaInicio: '13:00', horaFin: '14:00', label: '13:00 – 14:00' },
  { id: 'C', horaInicio: '14:00', horaFin: '15:00', label: '14:00 – 15:00' },
] as const;

export type TurnoAlmuerzoId = 'A' | 'B' | 'C';

export function getTurno(horaInicio: string) {
  return TURNOS_ALMUERZO.find(t => t.horaInicio === horaInicio);
}

export function horasEnMinutos(hora: string): number {
  const [h = 0, m = 0] = hora.split(':').map(Number);
  return h * 60 + m;
}
