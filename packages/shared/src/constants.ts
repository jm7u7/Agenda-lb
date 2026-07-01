export const TIMEZONE = 'America/Lima';

export const BUSINESS_HOURS = {
  start: '08:00',
  end: '20:00',
} as const;

export const SLOT_DURATION_MINUTES = 30;

export const SEDES = [
  'San Isidro',
  'Los Olivos',
  'Paz Soldán',
  'Miraflores',
  'San Borja',
] as const;

export type SedeNombre = typeof SEDES[number];

export const COLORES_ESTADO = {
  agendada: '#6B7F9E',
  confirmada: '#3B82F6',
  llego: '#22C55E',
  en_atencion: '#F59E0B',
  completada: '#15803D',
  no_show: '#FCA5A5',
  cancelada: '#9CA3AF',
  reprogramada: '#8B5CF6',
} as const;

export const DURACIONES_SERVICIO = {
  REGULAR: 30,
  EXTENDIDA: 60,
} as const;

export const LOCK_TTL_SECONDS = 30;

export const UNDO_TIMEOUT_MS = 8000;
