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
    esPrestamo?: boolean;        // cobertura de un día traída de otra sede
    sedeOrigen?: string | null;  // sede desde la que se prestó
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
  trabaja: boolean;     // false = ese día de la semana no tiene horario base (el toggle no aplica)
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

export interface PodologaDiaEspecial {
  id: string; nombres: string; apellidos: string; colorAvatar: string;
  sedeBase: string | null;
  esDeLaSede: boolean;
  esCobertura: boolean; // traída de otra sede como cobertura
  viene: boolean;
  horaEntrada: string;
}
export interface DiaEspecial {
  fecha: string;
  abierto: boolean;
  esExcepcion: boolean;
  apertura: string | null;
  cierre: string | null;
  nota: string | null;
  propias: PodologaDiaEspecial[]; // podólogas de la sede
  otras: PodologaDiaEspecial[];   // traíbles de otras sedes
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
    api.get<{
      id: string; nombres: string; apellidos: string; tipo: string; porSolicitud: boolean;
      // Bloqueos del día (permisos + almuerzos): el selector desactiva a quien esté
      // bloqueado a la hora elegida y muestra el rango en la etiqueta.
      bloqueos: { horaInicio: string; horaFin: string; motivo: string; tipo: string }[];
    }[]>(
      '/profesionales/seleccionables', params as Record<string, string>),

  // Hora de entrada (8:00/9:00) por semana — gestión de la Coordinadora de Sedes
  listarHorariosEntrada: (sedeId: string, semana: string) =>
    api.get<HorariosEntradaSemana>('/profesionales/horarios-entrada', { sedeId, semana }),
  setEntrada: (id: string, fechas: string[], horaInicio: '08:00' | '09:00', forzar?: boolean) =>
    api.patch<{ ok: boolean; id: string; fechas: string[]; horaInicio: string }>(`/profesionales/${id}/entrada`, { fechas, horaInicio, forzar }),

  // Personal de un día EXCEPCIONAL habilitado (domingo/feriado que la sede abre).
  personalExcepcion: (sedeId: string, fecha: string) =>
    api.get<PersonalExcepcion>('/profesionales/personal-excepcion', { sedeId, fecha }),
  setPresenciaExcepcion: (id: string, sedeId: string, fecha: string, presente: boolean, horaInicio?: '08:00' | '09:00') =>
    api.patch<{ ok: boolean; presente: boolean }>(`/profesionales/${id}/presencia-excepcion`, { sedeId, fecha, presente, horaInicio }),

  // Horario semanal PERMANENTE (días + rango horario) de un trabajador — vigente hasta editarlo.
  horarioSemanal: (id: string) =>
    api.get<{ horarios: { id: string; diaSemana: number; horaInicio: string; horaFin: string; turno: string; activo: boolean }[] }>(`/profesionales/${id}/horario`),
  setHorarioSemanal: (id: string, dias: { diaSemana: number; horaInicio: string; horaFin: string; turno?: string }[], forzar?: boolean) =>
    api.put<{ ok: boolean; horarios: { diaSemana: number; horaInicio: string; horaFin: string }[] }>(`/profesionales/${id}/horario`, { dias, forzar }),

  // Días especiales / excepciones — herramienta unificada (quién trabaja + traer de otra sede).
  diaEspecial: (sedeId: string, fecha: string) =>
    api.get<DiaEspecial>('/profesionales/dia-especial', { sedeId, fecha }),
  setDiaEspecial: (data: { profesionalId: string; sedeId: string; fechas: string[]; viene: boolean; horaInicio?: '08:00' | '09:00' }) =>
    api.post<{ resultados: { fecha: string; accion: string }[]; errores: { fecha: string; error: string }[] }>('/profesionales/dia-especial/set', data),

  crear: (data: { nombres: string; apellidos: string; tipo: string; unidadNegocioId: string; colorAvatar?: string }) =>
    api.post<Profesional>('/profesionales', data),

  editar: (id: string, data: Partial<{ nombres: string; apellidos: string; tipo: string; unidadNegocioId: string; colorAvatar: string; activo: boolean }>) =>
    api.patch<Profesional>(`/profesionales/${id}`, data),
};

// ─── Servicios ────────────────────────────────────────────────────────────────

// Subcategoría de un servicio (ej. Profilaxis → Regular/Premium/Infantil/Adulto mayor).
export interface SubcategoriaServicio {
  id: string;
  servicioId?: string;
  nombre: string;
  precioReferencial: number | null;
  orden: number;
  activo?: boolean;
}

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
  // Subcategorías ACTIVAS (solo las trae GET /servicios). Si tiene >0, elegir una
  // es obligatorio al agendar y se fija al vender membresías.
  subcategorias?: SubcategoriaServicio[];
}

export const serviciosApi = {
  listar: (params?: { unidadNegocioId?: string; activo?: boolean }) =>
    api.get<Servicio[]>('/servicios', {
      ...params,
      activo: params?.activo != null ? String(params.activo) : undefined,
    } as Record<string, string>),

  crear: (data: { nombre: string; codigo?: string; duracionMinutos: number; color: string; precioReferencial?: number; unidadNegocioId: string }) =>
    api.post<Servicio>('/servicios', data),

  editar: (id: string, data: Partial<{ nombre: string; codigo: string; duracionMinutos: number; color: string; precioReferencial: number; unidadNegocioId: string; activo: boolean }>) =>
    api.patch<Servicio>(`/servicios/${id}`, data),

  // ── Subcategorías (administración) ──
  listarSubcategorias: (servicioId: string) =>
    api.get<SubcategoriaServicio[]>(`/servicios/${servicioId}/subcategorias`),
  crearSubcategoria: (servicioId: string, data: { nombre: string; precioReferencial?: number | null; orden?: number }) =>
    api.post<SubcategoriaServicio>(`/servicios/${servicioId}/subcategorias`, data),
  editarSubcategoria: (subId: string, data: Partial<{ nombre: string; precioReferencial: number | null; orden: number; activo: boolean }>) =>
    api.patch<SubcategoriaServicio>(`/servicios/subcategorias/${subId}`, data),
  eliminarSubcategoria: (subId: string) =>
    api.delete<{ ok: boolean }>(`/servicios/subcategorias/${subId}`),
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
  // Distrito de residencia (código UBIGEO; 999999=Extranjero, 999998=No precisa)
  ubigeoId?: string | null;
  // País ISO-2, solo cuando ubigeoId=999999
  paisResidencia?: string | null;
  creadoEn: string;
  alerta?: AlertaPaciente | null;
  familiares?: FamiliarPaciente[] | null;
  // Bandera "actualizar datos": CALCULADA server-side (falta correo / teléfono
  // válido / fecha de nacimiento). El cliente nunca la setea.
  requiereActualizacionDatos?: boolean;
  // Lista server-side de lo que falta (tooltip del toggle) — la envían GET /:id y PATCH.
  datosFaltantes?: string[];
}

export interface HistorialCita {
  id: string;
  fecha: string;
  horaInicio: string;
  duracionMinutos: number;
  estado: string;
  comentarios: { id: string; texto: string; creadoEn: string; autorEtiqueta: string | null; autor: { nombre: string } | null }[];
  sesionNumero: number | null;
  // Badge "Sesión x/total · paquete" (módulo Sesiones)
  paquetePaciente?: { id: string; sesionesTotal: number; paquete: { nombre: string } } | null;
  // Bloque combinado: si != null, esta cita comparte turno con otra (profilaxis + extra).
  slotGrupoId: string | null;
  slotRol: 'PRINCIPAL' | 'SECUNDARIO' | null;
  servicio: { id: string; nombre: string; color: string; duracionMinutos: number };
  subcategoria?: { id: string; nombre: string } | null;
  profesional: { id: string; nombres: string; apellidos: string } | null;
  sede: { id: string; nombre: string; color: string };
}

export interface ProximaCita {
  id: string;
  fecha: string;
  horaInicio: string;
  origenAsignacion: string | null;
  servicio: { id: string; nombre: string };
  subcategoria?: { id: string; nombre: string } | null;
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

// ─── RENIEC (autollenado de DNI) ──────────────────────────────────────────────
export interface DatosReniec {
  numeroDocumento: string;
  nombres: string;
  apellidoPaterno: string;
  apellidoMaterno: string;
  nombreCompleto: string;
}

export const reniecApi = {
  consultarDni: (dni: string) => api.get<DatosReniec>(`/reniec/dni/${dni}`),
};

export const pacientesApi = {
  buscar: (q: string) => api.get<(Paciente & { nombreCompleto: string })[]>('/pacientes/buscar', { q }),
  // Top de distritos frecuentes para los chips del autocomplete (cache 24h server-side).
  distritosFrecuentes: (sedeId?: string) =>
    api.get<{ id: string; distrito: string; provincia: string; departamento: string; total: number }[]>(
      '/pacientes/distritos-frecuentes', sedeId ? { sedeId } : undefined),
  obtener: (id: string) => api.get<PacienteDetalle>(`/pacientes/${id}`),
  crear: (data: Partial<Paciente>) => api.post<Paciente>('/pacientes', data),
  actualizar: (id: string, data: Partial<Paciente>) => api.patch<Paciente>(`/pacientes/${id}`, data),
};

// ─── Historial Genexis (sistema anterior — congelado, SOLO lectura) ───────────
// Los campos sede/servicio/podologo son TEXTO CRUDO del sistema viejo, no FKs.

export interface HistorialGenexisRegistro {
  id: string;
  fechaCita: string; // "YYYY-MM-DD"
  horaCita: string | null; // crudo (ej. "16")
  podologo: string | null;
  sede: string | null;
  servicio: string | null;
  obsPaciente: string | null;
  obsPodologo: string | null;
  consultorio: string | null;
  llegoPaciente: string | null; // "Sí" | "No" | null
  fechaCreacionGx: string | null;
  usuarioCreacionGx: string | null;
}

export interface HistorialGenexisResumen {
  totalAtenciones: number;
  primeraCita: string | null;
  ultimaCita: string | null;
  porcentajeAsistencia: number | null;
  sedes: { sede: string | null; total: number }[];
  anios: string[];
}

export interface HistorialGenexisPagina {
  data: HistorialGenexisRegistro[];
  page: number;
  limit: number;
  total: number;
  resumen: HistorialGenexisResumen;
}

export const historialGenexisApi = {
  existe: (pacienteId: string) =>
    api.get<{ existe: boolean; total: number }>(`/pacientes/${pacienteId}/historial-genexis/existe`),
  listar: (pacienteId: string, params: { sede?: string; anio?: string; page?: number; limit?: number }) =>
    api.get<HistorialGenexisPagina>(`/pacientes/${pacienteId}/historial-genexis`, {
      ...(params.sede ? { sede: params.sede } : {}),
      ...(params.anio ? { anio: params.anio } : {}),
      page: String(params.page ?? 1),
      limit: String(params.limit ?? 50),
    }),
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
  // Las plantillas de MEMBRESÍA (tipo/promocionId) se gestionan en el bloque Membresía del
  // drawer, NO en el selector de paquetes normal. (Viajan en el JSON de GET /paquetes.)
  tipo?: 'PAQUETE' | 'MEMBRESIA' | 'UNITARIA';
  promocionId?: string | null;
  servicio: PaqueteServicio;
}

export interface PaquetePaciente {
  id: string;
  paqueteId: string;
  sesionesTotal: number;
  sesionesUsadas: number;
  activo: boolean;
  // Módulo Sesiones: GENEXIS_APERTURA = la sesión se ADJUDICA a mano (desplegable);
  // AGENDA = numeración automática (flujo original).
  origen?: 'AGENDA' | 'GENEXIS_APERTURA';
  aperturaConsumidas?: number;
  numerosOcupados?: number[]; // sesiones adjudicadas a citas vivas
  anclado?: boolean; // Genexis: ya hubo primera adjudicación → numeración automática
  // Módulo Sesiones (viajan en el JSON; se usan para agendar membresías correctamente):
  tipo?: 'PAQUETE' | 'MEMBRESIA' | 'UNITARIA';
  estado?: 'ACTIVO' | 'AGOTADO' | 'VENCIDO' | 'ANULADO';
  vigenciaInicio?: string | null; // "YYYY-MM-DD" — solo se puede agendar dentro de [inicio, fin]
  vigenciaFin?: string | null;
  sedeId?: string | null;
  // Composición de una MEMBRESÍA: para saber a qué servicios (y subcategoría) aplica.
  composicion?: { servicioId: string; cantidad: number; etiqueta?: string; subcategoriaId?: string | null; subcategoriaEtiqueta?: string }[] | null;
  paquete: { id: string; nombre: string; servicio: PaqueteServicio };
  citas: { id: string; fecha: string; horaInicio: string; estado: string; sesionNumero: number | null }[];
}

export const paquetesApi = {
  plantillas: () => api.get<PlantillaPaquete[]>('/paquetes'),
  porPaciente: (pacienteId: string) =>
    api.get<PaquetePaciente[]>(`/paquetes/paciente/${pacienteId}`),
  asignar: (pacienteId: string, data: { paqueteId: string; fechaCompra: string; notas?: string; sedeId?: string; origenGenexis?: boolean }) =>
    api.post(`/paquetes/paciente/${pacienteId}`, data),
  crear: (data: { nombre: string; servicioId: string; totalSesiones: number; consumeNoShow?: boolean; precio?: number }) =>
    api.post<PlantillaPaquete>('/paquetes', data),
  actualizar: (id: string, data: Partial<{ nombre: string; servicioId: string; totalSesiones: number; consumeNoShow: boolean; precio: number }>) =>
    api.patch<PlantillaPaquete>(`/paquetes/${id}`, data),
  eliminar: (id: string) =>
    api.delete(`/paquetes/${id}`),
};
