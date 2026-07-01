export { api } from './client';
export { citasApi } from './citas';

import { api } from './client';
import type { AlertaPaciente } from '../components/pacientes/RomboAlerta';
import type { FamiliarPaciente } from '../components/pacientes/CuadroFamiliares';

// ─── Sedes ───────────────────────────────────────────────────────────────────

export interface TurnoHorario { apertura: string; cierre: string; abierto: true }
export interface DiaCerrado { abierto: false }
export type HorarioDia = TurnoHorario | DiaCerrado
export type HorarioSede = Record<string, HorarioDia>

export interface Excepcion {
  id: string;
  sedeId: string;
  fecha: string;       // YYYY-MM-DD
  abierto: boolean;
  horaApertura: string | null;
  horaCierre: string | null;
  nota: string | null;
}

export interface HorarioEfectivo {
  abierto: boolean;
  apertura?: string | null;
  cierre?: string | null;
  nota?: string | null;
  esExcepcion: boolean;
}

export interface Sede {
  id: string;
  nombre: string;
  direccion: string;
  color: string;
  activa: boolean;
  horario: HorarioSede;
  unidadesNegocio: UnidadNegocio[];
}

export interface UnidadNegocio {
  id: string;
  nombre: string;
  modoReserva: 'preferencia_opcional' | 'sin_eleccion' | 'preferencia_obligatoria';
  color: string;
}

export const sedesApi = {
  listar: () => api.get<Sede[]>('/sedes'),
};

// ─── Profesionales ────────────────────────────────────────────────────────────

export interface Profesional {
  id: string;
  nombres: string;
  apellidos: string;
  tipo: string;
  colorAvatar: string;
  activo: boolean;
  iniciales: string;
  unidadNegocio: UnidadNegocio;
  sedeActual: { id: string; nombre: string; color: string } | null;
  asignacionActual: {
    id: string;
    fechaFin: string | null;
    motivo: string;
    notas: string | null;
    reemplazaProfesional: { id: string; nombres: string; apellidos: string } | null;
    esMovimiento: boolean;
  } | null;
  // Turno del día mostrado (la agenda atenúa las horas fuera de jornada)
  horaEntrada?: string | null;
  horaSalida?: string | null;
}

export interface DiaEntrada {
  fecha: string;       // YYYY-MM-DD
  diaSemana: number;   // 1=Lun .. 6=Sáb
  horaEntrada: '08:00' | '09:00';
  esExcepcion: boolean; // true si tiene override explícito para esa fecha
}
export interface PodologaSemana {
  id: string;
  nombres: string;
  apellidos: string;
  colorAvatar: string;
  dias: DiaEntrada[]; // Lun..Vie (5) — los sábados la entrada es siempre 08:00
}
export interface HorariosEntradaSemana {
  semana: { lunes: string; viernes: string };
  podologas: PodologaSemana[];
}
export interface PersonalExcepcion {
  fecha: string;
  abierto: boolean;       // la sede atiende ese día (excepción abierta)
  esExcepcion: boolean;   // hay una fila de excepción para esa fecha
  apertura: string | null;
  cierre: string | null;
  podologas: { id: string; nombres: string; apellidos: string; colorAvatar: string; presente: boolean; horaEntrada: string }[];
}

export const profesionalesApi = {
  listar: (params: { sedeId?: string; unidadNegocioId?: string; fecha?: string; activo?: boolean }) =>
    api.get<Profesional[]>('/profesionales', {
      ...params,
      activo: params.activo != null ? String(params.activo) : undefined,
    } as Record<string, string>),

  obtener: (id: string) => api.get<Profesional>(`/profesionales/${id}`),

  // Profesionales que la recepción puede ELEGIR explícitamente al reservar (médicos de baro
  // + Daniel "solo por solicitud" + podólogas/fisios reales de la sede). No incluye los slots
  // automáticos genéricos de baropodometría.
  seleccionables: (params: { sedeId?: string; unidadNegocioId: string; fecha?: string; servicioId?: string }) =>
    api.get<{ id: string; nombres: string; apellidos: string; tipo: string; porSolicitud: boolean }[]>(
      '/profesionales/seleccionables', params as Record<string, string>),

  // Hora de entrada (8:00/9:00) por semana — gestión de la Coordinadora de Sedes
  listarHorariosEntrada: (sedeId: string, semana: string) =>
    api.get<HorariosEntradaSemana>('/profesionales/horarios-entrada', { sedeId, semana }),
  setEntrada: (id: string, fechas: string[], horaInicio: '08:00' | '09:00') =>
    api.patch<{ ok: boolean; id: string; fechas: string[]; horaInicio: string }>(`/profesionales/${id}/entrada`, { fechas, horaInicio }),

  // Personal de un día EXCEPCIONAL habilitado (domingo/feriado que la sede abre).
  personalExcepcion: (sedeId: string, fecha: string) =>
    api.get<PersonalExcepcion>('/profesionales/personal-excepcion', { sedeId, fecha }),
  setPresenciaExcepcion: (id: string, sedeId: string, fecha: string, presente: boolean, horaInicio?: '08:00' | '09:00') =>
    api.patch<{ ok: boolean; presente: boolean }>(`/profesionales/${id}/presencia-excepcion`, { sedeId, fecha, presente, horaInicio }),

  crear: (data: { nombres: string; apellidos: string; tipo: string; unidadNegocioId: string; colorAvatar?: string }) =>
    api.post<Profesional>('/profesionales', data),

  editar: (id: string, data: Partial<{ nombres: string; apellidos: string; tipo: string; unidadNegocioId: string; colorAvatar: string; activo: boolean }>) =>
    api.patch<Profesional>(`/profesionales/${id}`, data),
};

// ─── Servicios ────────────────────────────────────────────────────────────────

export interface Servicio {
  id: string;
  nombre: string;
  codigo: string;
  duracionMinutos: number;
  color: string;
  precioReferencial: number | null;
  unidadNegocioId: string;
  unidadNegocio: UnidadNegocio;
  activo: boolean;
}

export const serviciosApi = {
  listar: (params?: { unidadNegocioId?: string; activo?: boolean }) =>
    api.get<Servicio[]>('/servicios', {
      ...params,
      activo: params?.activo != null ? String(params.activo) : undefined,
    } as Record<string, string>),

  crear: (data: { nombre: string; codigo: string; duracionMinutos: number; color: string; precioReferencial?: number; unidadNegocioId: string }) =>
    api.post<Servicio>('/servicios', data),

  editar: (id: string, data: Partial<{ nombre: string; codigo: string; duracionMinutos: number; color: string; precioReferencial: number; unidadNegocioId: string; activo: boolean }>) =>
    api.patch<Servicio>(`/servicios/${id}`, data),
};

// ─── Pacientes ────────────────────────────────────────────────────────────────

export interface Paciente {
  id: string;
  nombres: string;
  apellidoPaterno: string;
  apellidoMaterno: string;
  tipoDocumento: string;
  numeroDocumento: string;
  fechaNacimiento?: string | null;
  sexo?: string | null;
  telefono: string;
  email: string | null;
  notas: string | null;
  creadoEn: string;
  alerta?: AlertaPaciente | null;
  familiares?: FamiliarPaciente[] | null;
}

export interface HistorialCita {
  id: string;
  fecha: string;
  horaInicio: string;
  duracionMinutos: number;
  estado: string;
  comentarios: { id: string; texto: string; creadoEn: string; autorEtiqueta: string | null; autor: { nombre: string } | null }[];
  sesionNumero: number | null;
  // Bloque combinado: si != null, esta cita comparte turno con otra (profilaxis + extra).
  slotGrupoId: string | null;
  slotRol: 'PRINCIPAL' | 'SECUNDARIO' | null;
  servicio: { id: string; nombre: string; color: string; duracionMinutos: number };
  profesional: { id: string; nombres: string; apellidos: string } | null;
  sede: { id: string; nombre: string; color: string };
}

export interface ProximaCita {
  id: string;
  fecha: string;
  horaInicio: string;
  origenAsignacion: string | null;
  servicio: { id: string; nombre: string };
  profesional: { id: string; nombres: string; apellidos: string } | null;
  sede: { id: string; nombre: string; color: string };
}

// Desglose exacto por servicio sobre TODAS las citas del paciente (no acotado a 200).
export interface ResumenServicio {
  servicioId: string;
  nombre: string;
  color: string;
  total: number;
}

export type PacienteDetalle = Paciente & {
  historial: HistorialCita[];
  proximas: ProximaCita[];
  totalCitas: number;
  resumenServicios: ResumenServicio[];
};

export const pacientesApi = {
  buscar: (q: string) => api.get<(Paciente & { nombreCompleto: string })[]>('/pacientes/buscar', { q }),
  obtener: (id: string) => api.get<PacienteDetalle>(`/pacientes/${id}`),
  crear: (data: Partial<Paciente>) => api.post<Paciente>('/pacientes', data),
  actualizar: (id: string, data: Partial<Paciente>) => api.patch<Paciente>(`/pacientes/${id}`, data),
};

// ─── Disponibilidad ───────────────────────────────────────────────────────────

export interface SlotDisponible {
  horaInicio: string;
  horaFin: string;
  profesionalId: string | null;
  profesionalNombre: string | null;
  disponible: boolean;
}

export const disponibilidadApi = {
  consultar: (params: {
    sede: string;
    unidadNegocio: string;
    servicio: string;
    fecha: string;
    profesional?: string;
  }) => api.get<{ slots: SlotDisponible[]; todos: SlotDisponible[]; duracionMinutos: number }>('/disponibilidad', params as Record<string, string>),
};

// ─── Auth ─────────────────────────────────────────────────────────────────────

export const authApi = {
  login: (email: string, password: string) =>
    api.post<{ token: string; usuario: { id: string; nombre: string; email: string; rol: string; sedes: { id: string; nombre: string; color: string }[] } }>(
      '/auth/login', { email, password }
    ),
  me: () =>
    api.get<{ id: string; nombre: string; email: string; rol: string; sedes: { id: string; nombre: string; color: string }[] }>(
      '/auth/me'
    ),
};

// ─── Horarios ────────────────────────────────────────────────────────────────

export const horariosApi = {
  efectivo: (sedeId: string, fecha: string) =>
    api.get<{ horarioDefault: HorarioSede; efectivo: HorarioEfectivo; diaSemana: number }>(
      `/horarios/${sedeId}`, { fecha }
    ),
  excepciones: (sedeId: string, desde?: string, hasta?: string) =>
    api.get<Excepcion[]>(`/horarios/${sedeId}/excepciones`, {
      ...(desde ? { desde } : {}),
      ...(hasta ? { hasta } : {}),
    } as Record<string, string>),
  guardarExcepcion: (sedeId: string, data: {
    fecha: string; abierto: boolean;
    horaApertura?: string | null; horaCierre?: string | null; nota?: string | null;
  }) => api.post<Excepcion>(`/horarios/${sedeId}/excepciones`, data),
  eliminarExcepcion: (sedeId: string, fecha: string) =>
    api.delete(`/horarios/${sedeId}/excepciones/${fecha}`),
};

// ─── Competencias ─────────────────────────────────────────────────────────────

export const competenciasApi = {
  listar: (params?: { unidadNegocioId?: string }) =>
    api.get<{ profesional: Profesional; servicio: Servicio; activa: boolean }[]>(
      '/competencias', params as Record<string, string>
    ),
  toggle: (profesionalId: string, servicioId: string, activa: boolean) =>
    api.post('/competencias/toggle', { profesionalId, servicioId, activa }),
};

// ─── Asignaciones ─────────────────────────────────────────────────────────────

export const asignacionesApi = {
  listar: (params?: { sedeId?: string; activa?: boolean }) =>
    api.get<{ id: string; profesional: Profesional; sede: Sede; fechaInicio: string; fechaFin: string | null; activa: boolean }[]>(
      '/asignaciones', params as Record<string, string>
    ),
  crear: (data: { profesionalId: string; sedeId: string; fechaInicio: string; fechaFin?: string }) =>
    api.post('/asignaciones', data),
};

// ─── Paquetes ─────────────────────────────────────────────────────────────────

interface PaqueteServicio { id: string; nombre: string; color: string; unidadNegocioId: string; duracionMinutos: number }

export interface PlantillaPaquete {
  id: string;
  nombre: string;
  totalSesiones: number;
  consumeNoShow: boolean;
  precio: string | null;
  activo: boolean;
  servicio: PaqueteServicio;
}

export interface PaquetePaciente {
  id: string;
  paqueteId: string;
  sesionesTotal: number;
  sesionesUsadas: number;
  activo: boolean;
  paquete: { id: string; nombre: string; servicio: PaqueteServicio };
  citas: { id: string; fecha: string; horaInicio: string; estado: string; sesionNumero: number | null }[];
}

export const paquetesApi = {
  plantillas: () => api.get<PlantillaPaquete[]>('/paquetes'),
  porPaciente: (pacienteId: string) =>
    api.get<PaquetePaciente[]>(`/paquetes/paciente/${pacienteId}`),
  asignar: (pacienteId: string, data: { paqueteId: string; fechaCompra: string; notas?: string }) =>
    api.post(`/paquetes/paciente/${pacienteId}`, data),
  crear: (data: { nombre: string; servicioId: string; totalSesiones: number; consumeNoShow?: boolean; precio?: number }) =>
    api.post<PlantillaPaquete>('/paquetes', data),
  actualizar: (id: string, data: Partial<{ nombre: string; servicioId: string; totalSesiones: number; consumeNoShow: boolean; precio: number }>) =>
    api.patch<PlantillaPaquete>(`/paquetes/${id}`, data),
  eliminar: (id: string) =>
    api.delete(`/paquetes/${id}`),
};
