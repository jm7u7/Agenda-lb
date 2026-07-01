// ─── Enums ────────────────────────────────────────────────────────────────────

export type ModoReserva =
  | 'preferencia_opcional'   // Podología
  | 'sin_eleccion'           // Baropodometría
  | 'preferencia_obligatoria'; // Fisioterapia

export type EstadoCita =
  | 'agendada'
  | 'confirmada'
  | 'llego'
  | 'en_atencion'
  | 'completada'
  | 'no_show'
  | 'cancelada'
  | 'reprogramada';

export type CanalReserva = 'recepcion' | 'whatsapp' | 'web';

export type OrigenAsignacion = 'elegida_por_paciente' | 'asignada_automaticamente';

export type RolUsuario = 'admin' | 'coordinadora_sedes' | 'recepcionista';

export type TipoProfesional = 'podologa' | 'medico' | 'fisioterapeuta';

export type TurnoHorario = 'manana' | 'tarde' | 'completo';

// ─── DTOs de respuesta ────────────────────────────────────────────────────────

export interface SedeDTO {
  id: string;
  nombre: string;
  direccion: string;
  color: string;
  activa: boolean;
  unidadesNegocio: string[];
}

export interface UnidadNegocioDTO {
  id: string;
  nombre: string;
  modoReserva: ModoReserva;
  color: string;
}

export interface ProfesionalDTO {
  id: string;
  nombres: string;
  apellidos: string;
  tipo: TipoProfesional;
  unidadNegocioId: string;
  unidadNegocioNombre: string;
  sedeActualId: string | null;
  sedeActualNombre: string | null;
  activo: boolean;
  iniciales: string;
  colorAvatar: string;
}

export interface ServicioDTO {
  id: string;
  nombre: string;
  codigo: string;
  duracionMinutos: number;
  color: string;
  precioReferencial: number | null;
  unidadNegocioId: string;
  unidadNegocioNombre: string;
  activo: boolean;
}

export interface PacienteDTO {
  id: string;
  nombres: string;
  apellidoPaterno: string;
  apellidoMaterno: string;
  nombreCompleto: string;
  tipoDocumento: string;
  numeroDocumento: string;
  fechaNacimiento: string | null;
  sexo: string | null;
  telefono: string;
  email: string | null;
  notas: string | null;
  creadoEn: string;
}

export interface ComentarioCitaDTO {
  id: string;
  texto: string;
  creadoEn: string;
  autorEtiqueta: string | null;
  autor: { id: string; nombre: string } | null;
}

export interface CitaDTO {
  id: string;
  pacienteId: string;
  paciente: PacienteDTO;
  profesionalId: string | null;
  profesional: ProfesionalDTO | null;
  sedeId: string;
  sede: SedeDTO;
  unidadNegocioId: string;
  unidadNegocio: UnidadNegocioDTO;
  servicioId: string;
  servicio: ServicioDTO;
  fecha: string;         // YYYY-MM-DD
  horaInicio: string;    // HH:mm
  duracionMinutos: number;
  estado: EstadoCita;
  canal: CanalReserva;
  origenAsignacion: OrigenAsignacion | null;
  comentarios: ComentarioCitaDTO[];
  paquetePacienteId: string | null;
  sesionNumero: number | null;
  sesionTotal: number | null;
  citaOriginalId: string | null;  // si fue reprogramada
  creadoEn: string;
  actualizadoEn: string;
}

export interface SlotDisponible {
  horaInicio: string;  // HH:mm
  horaFin: string;
  profesionalId: string | null;
  profesionalNombre: string | null;
  disponible: boolean;
}

export interface DisponibilidadResponse {
  fecha: string;
  sedeId: string;
  unidadNegocioId: string;
  servicioId: string;
  profesionalId: string | null;
  duracionMinutos: number;
  slots: SlotDisponible[];
}

// ─── DTOs de creación/edición ─────────────────────────────────────────────────

export interface CrearCitaDTO {
  pacienteId: string;
  profesionalId?: string | null;
  sedeId: string;
  unidadNegocioId: string;
  servicioId: string;
  fecha: string;
  horaInicio: string;
  canal?: CanalReserva;
  comentarioRecepcion?: string;
  paquetePacienteId?: string;
}

export interface ActualizarEstadoCitaDTO {
  estado: EstadoCita;
  comentario?: string;
  motivoCancelacion?: string;
}

export interface MoverCitaDTO {
  profesionalId?: string | null;
  fecha: string;
  horaInicio: string;
}

export interface CrearPacienteDTO {
  nombres: string;
  apellidoPaterno: string;
  apellidoMaterno: string;
  tipoDocumento: string;
  numeroDocumento: string;
  telefono: string;
  email?: string;
  fechaNacimiento?: string;
  sexo?: string;
  notas?: string;
}

// ─── Eventos WebSocket ────────────────────────────────────────────────────────

export type WSEventType =
  | 'cita:creada'
  | 'cita:actualizada'
  | 'cita:movida'
  | 'cita:cancelada'
  | 'cita:estadoCambiado';

export interface WSEvent {
  tipo: WSEventType;
  sedeId: string;
  fecha: string;
  cita: CitaDTO;
  cambiadoPor: string;
}

// ─── Webhooks salientes ───────────────────────────────────────────────────────

export type WebhookEvent =
  | 'appointment.created'
  | 'appointment.rescheduled'
  | 'appointment.cancelled'
  | 'appointment.completed';

export interface WebhookPayload {
  event: WebhookEvent;
  timestamp: string;
  data: CitaDTO;
}

// ─── Paginación ───────────────────────────────────────────────────────────────

export interface PaginatedResponse<T> {
  data: T[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

// ─── API Error ────────────────────────────────────────────────────────────────

export interface ApiError {
  error: string;
  message: string;
  statusCode: number;
  details?: unknown;
}
