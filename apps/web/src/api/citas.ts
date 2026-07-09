import { api } from './client';
import type { AlertaPaciente } from '../components/pacientes/RomboAlerta';
import type { FamiliarPaciente } from '../components/pacientes/CuadroFamiliares';

// Entrada del hilo append-only de comentarios de una cita.
export interface ComentarioCita {
  id: string;
  texto: string;
  creadoEn: string;
  autorEtiqueta: string | null;
  autor: { id: string; nombre: string } | null;
}

export interface CitaResumen {
  id: string;
  pacienteId: string;
  paciente: {
    id: string; nombres: string; apellidoPaterno: string; apellidoMaterno: string;
    tipoDocumento?: string; numeroDocumento?: string; telefono: string;
    email?: string | null; fechaNacimiento?: string | null;
    // Bandera "actualizar datos" calculada server-side (toggle del popover).
    requiereActualizacionDatos?: boolean;
    alerta?: AlertaPaciente | null; familiares?: FamiliarPaciente[] | null;
  };
  profesionalId: string | null;
  profesional: { id: string; nombres: string; apellidos: string; colorAvatar: string } | null;
  solicitadoProfesional?: { id: string; nombres: string; apellidos: string; tipo: string } | null;
  sedeId: string;
  sede: { id: string; nombre: string; color: string };
  unidadNegocioId: string;
  unidadNegocio: { id: string; nombre: string; color: string };
  servicioId: string;
  servicio: { id: string; nombre: string; duracionMinutos: number; color: string };
  // Subcategoría elegida (ej. Profilaxis → Regular/Premium/…). null si el servicio no tiene.
  subcategoriaId?: string | null;
  subcategoria?: { id: string; nombre: string } | null;
  fecha: string;
  horaInicio: string;
  duracionMinutos: number;
  estado: string;
  canal: string;
  origenAsignacion: string | null;
  // Bloque combinado: null = cita individual; si != null pertenece a un bloque de 2
  // citas (profilaxis ancla + extra) que comparten slot. `slotRol` distingue cuál es.
  slotGrupoId: string | null;
  slotRol: 'PRINCIPAL' | 'SECUNDARIO' | null;
  comentarios: ComentarioCita[];
  paquetePaciente: { id: string; sesionesTotal: number; sesionesUsadas: number; paquete: { nombre: string } } | null;
  // Promoción de la cita. En un bloque combinado vive solo en la PRINCIPAL (profilaxis); la
  // SECUNDARIO la recibe como `promocionHeredada` (solo lectura).
  promocion: { id: string; nombre: string; tipo: 'PRECIO_FIJO' | 'PORCENTAJE' | 'OTRO'; valor: number | null } | null;
  promocionHeredada?: { id: string; nombre: string; tipo: 'PRECIO_FIJO' | 'PORCENTAJE' | 'OTRO'; valor: number | null } | null;
  sesionNumero: number | null;
  consultorioNumero: number | null;
  comprobanteUrl: string | null;
  comprobanteNombre: string | null;
  comprobanteMimeType: string | null;
  comprobanteSubidoEn: string | null;
  estadoConfirmacion: 'pendiente' | 'confirmada' | 'cancelada';
  confirmacionEnviadaEn: string | null;
  confirmadaEn: string | null;
  creadoPorUsuario: { id: string; nombre: string } | null;
  creadoEn: string;
  actualizadoEn: string;
}

export interface CrearCitaInput {
  pacienteId: string;
  profesionalId?: string | null;
  sedeId: string;
  unidadNegocioId: string;
  servicioId: string;
  subcategoriaId?: string | null; // obligatoria si el servicio tiene subcategorías
  fecha: string;
  horaInicio: string;
  canal?: string;
  comentarioRecepcion?: string;
  paquetePacienteId?: string;
  // Adjudicación manual de sesión (solo paquetes de origen Genexis)
  sesionNumeroManual?: number;
  promocionId?: string | null;
  comprobanteUrl?: string;
  comprobanteNombre?: string;
  comprobanteMimeType?: string;
}

// Agendamiento de un bloque combinado: ancla (profilaxis) + un servicio extra.
export interface CrearCitaCombinadaInput {
  pacienteId: string;
  profesionalId?: string; // opcional: si no viene, el backend asigna automáticamente
  sedeId: string;
  unidadNegocioId: string;
  servicioId: string; // el ancla configurada (profilaxis)
  subcategoriaId?: string | null; // subcategoría del ancla (profilaxis)
  fecha: string;
  horaInicio: string;
  canal?: string;
  comentarioRecepcion?: string;
  paquetePacienteId?: string;
  promocionId?: string | null; // promo del BLOQUE (la guarda el backend en la PRINCIPAL)
  extra: {
    servicioId: string;
    profesionalId?: string; // default: misma profesional del ancla
    paquetePacienteId?: string;
    comentarioRecepcion?: string;
  };
}

export interface RespuestaCombinada {
  slotGrupoId: string;
  ancla: CitaResumen;
  extra: CitaResumen;
}

export const citasApi = {
  listar: (params: { sedeId?: string; fecha?: string; unidadNegocioId?: string; profesionalId?: string }) =>
    api.get<CitaResumen[]>('/citas', params as Record<string, string>),

  obtener: (id: string) =>
    api.get<CitaResumen>(`/citas/${id}`),

  crear: (data: CrearCitaInput, idempotencyKey?: string) =>
    api.post<CitaResumen>('/citas', data, idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : undefined),

  // Bloque combinado (profilaxis + extra). SIN optimistic UI: las 2 citas aparecen
  // o fallan juntas; el caller refresca tras la respuesta del server.
  crearCombinada: (data: CrearCitaCombinadaInput) =>
    api.post<RespuestaCombinada>('/citas/combinada', data),

  cambiarEstado: (id: string, estado: string, comentario?: string, motivoCancelacion?: string) =>
    api.patch<CitaResumen>(`/citas/${id}/estado`, { estado, comentario, motivoCancelacion }),

  mover: (id: string, data: { profesionalId?: string | null; fecha: string; horaInicio: string; origenAsignacion?: string }) =>
    api.patch<CitaResumen>(`/citas/${id}/mover`, data),

  // Mueve un bloque combinado COMPLETO (ambas citas) atómicamente a otro horario/profesional.
  moverGrupo: (slotGrupoId: string, data: { profesionalId?: string | null; fecha: string; horaInicio: string; origenAsignacion?: string }) =>
    api.patch<CitaResumen>(`/citas/grupo/${slotGrupoId}/mover`, data),

  actualizarConsultorio: (id: string, consultorioNumero: number | null) =>
    api.patch<CitaResumen>(`/citas/${id}/consultorio`, { consultorioNumero }),

  // Agregar/editar el comentario de recepción en cualquier estado (antes, durante o después).
  actualizarComentario: (id: string, comentario: string) =>
    api.patch<CitaResumen>(`/citas/${id}/comentario`, { comentario }),

  // Canal de reserva (de dónde viene el cliente).
  actualizarCanal: (id: string, canal: string) =>
    api.patch<CitaResumen>(`/citas/${id}/canal`, { canal }),

  // Promoción de la cita (el backend la escribe en la portadora del bloque si aplica).
  actualizarPromocion: (id: string, promocionId: string | null) =>
    api.patch<CitaResumen>(`/citas/${id}/promocion`, { promocionId }),

  // Envía/reenvía el correo de confirmación de una cita.
  confirmarPorCorreo: (id: string) =>
    api.post<{ ok: boolean; to: string }>(`/citas/${id}/confirmar-mail`),

  stats: (sedeId: string, fecha: string) =>
    api.get<{ total: number; confirmadas: number; llegaron: number; noShows: number; completadas: number; ocupacion: number }>(
      `/citas/sede/${sedeId}/stats`, { fecha }
    ),
};
