import { prisma } from '../db';
import { redis } from '../redis';
import { fechaDb } from '../utils/fechaLima';
import { timeToMinutes, minutesToTime, generarSlotsDelDia, horaInicioValidaParaDuracion } from '@limablue/shared';

export interface TurnoDia { horaInicio: string; horaFin: string }

/**
 * Turno efectivo de cada profesional en una fecha+sede. REGLA ÚNICA reutilizada por
 * disponibilidad, auto-asignación, validación al crear y columnas de la agenda:
 *  - DÍA NORMAL: el `HorarioProfesional` de ese día de semana (comportamiento intacto).
 *  - DÍA EXCEPCIONAL: si la sede tiene una `ExcepcionHorario` ABIERTA esa fecha Y el
 *    profesional tiene una `EntradaPodologa` esa fecha → atiende ese día con
 *    [entrada elegida, cierre de la excepción]. Así un domingo SOLO se habilita si la
 *    coordinadora abrió la sede Y marcó a esa podóloga (los demás días no cambian).
 * Devuelve un Map profId → turno; los que no atienden ese día NO están en el Map.
 */
export async function turnosDelDia(sedeId: string, fecha: string, profIds: string[]): Promise<Map<string, TurnoDia>> {
  const out = new Map<string, TurnoDia>();
  if (profIds.length === 0) return out;
  const fechaPunto = fechaDb(fecha);
  const diaSemana = fechaPunto.getUTCDay();

  const horarios = await prisma.horarioProfesional.findMany({
    where: { profesionalId: { in: profIds }, diaSemana, activo: true },
    select: { profesionalId: true, horaInicio: true, horaFin: true },
  });
  const baseMap = new Map(horarios.map((h) => [h.profesionalId, h]));

  // Excepción de sede ABIERTA con horas válidas para esa fecha.
  const exc = await prisma.excepcionHorario.findUnique({
    where: { sedeId_fecha: { sedeId, fecha: fechaPunto } },
  });
  const excAbierta = exc && exc.abierto && exc.horaApertura && exc.horaCierre ? exc : null;

  // ── Ventana de apertura de la SEDE ese día ──────────────────────────────────
  // El turno de la profesional debe RECORTARSE al horario en que la sede está abierta:
  // nunca se ofrece/acepta un slot antes de la apertura ni después del cierre. (Bug: el
  // turno base de la podóloga decía 08:00 pero Los Olivos abre 09:00 → se agendó a las 8.)
  // Una excepción abierta manda sobre el horario regular de la sede.
  const sede = await prisma.sede.findUnique({ where: { id: sedeId }, select: { horario: true } });
  const dia = (sede?.horario as Record<string, { apertura?: string; cierre?: string; abierto?: boolean }> | null | undefined)?.[String(diaSemana)];
  // Cierre NORMAL de la sede ese día (antes de aplicar la excepción). Sirve para saber si una
  // excepción EXTIENDE el cierre (cierreExcepcion > cierreNormal) y a quién extender.
  const cierreNormal = (dia && dia.abierto && dia.cierre) ? dia.cierre : null;
  // `null` = sin horario configurado (no recortar, compat). `'CERRADA'` = sede cerrada ese día.
  let ventana: { apertura: string; cierre: string } | 'CERRADA' | null;
  if (excAbierta) ventana = { apertura: excAbierta.horaApertura!, cierre: excAbierta.horaCierre! };
  else if (!dia) ventana = null;
  else if (!dia.abierto) ventana = 'CERRADA';
  else if (dia.apertura && dia.cierre) ventana = { apertura: dia.apertura, cierre: dia.cierre };
  else ventana = null;

  // Turno ∩ ventana de la sede. Normalmente el fin = mín(turno, cierre) — solo puede RECORTAR.
  // PERO una EXCEPCIÓN ABIERTA que EXTIENDE el cierre normal (p.ej. viernes hasta las 19:00 en
  // vez de 18:00) empuja el fin de turno de quienes trabajan HASTA (o más allá de) el cierre
  // normal hasta el cierre extendido. Los de medio turno (terminan antes del cierre) no cambian.
  const recortar = (ini: string, fin: string): TurnoDia | null => {
    if (ventana === 'CERRADA') return null;
    if (!ventana) return { horaInicio: ini, horaFin: fin };
    const horaInicio = ini > ventana.apertura ? ini : ventana.apertura; // máx(turno, apertura)
    const extiende = !!excAbierta && !!cierreNormal && ventana.cierre > cierreNormal && fin >= cierreNormal;
    const horaFin = extiende ? ventana.cierre : (fin < ventana.cierre ? fin : ventana.cierre);
    return horaInicio < horaFin ? { horaInicio, horaFin } : null;       // ventana vacía → sin turno
  };

  // CAPA 2 — override de turno POR FECHA (EntradaPodologa). Aplica SIEMPRE, no solo
  // en excepciones: si la coordinadora fijó entrada 09:00 ese día, la agenda Y las
  // reservas parten de las 09:00 (una sola verdad). En días de excepción abierta la
  // fila además marca PRESENCIA: sin fila (y sin base) no se atiende ese día.
  const overrides = await prisma.entradaPodologa.findMany({
    where: { profesionalId: { in: profIds }, fecha: fechaPunto },
    select: { profesionalId: true, horaInicio: true, horaFin: true },
  });
  const ovMap = new Map(overrides.map((o) => [o.profesionalId, o]));

  for (const id of profIds) {
    const base = baseMap.get(id);
    const ov = ovMap.get(id);
    let turno: TurnoDia | null = null;
    if (base) {
      // Turno del día = base ajustada por el override. La entrada del override solo
      // RETRASA (máx con la base): el toggle 8/9 nunca abre a alguien ANTES de su
      // horario real (una part-timer de 11:00 no se abre a las 8:00 por un toggle masivo).
      const ini = ov && ov.horaInicio > base.horaInicio ? ov.horaInicio : base.horaInicio;
      turno = recortar(ini, ov?.horaFin ?? base.horaFin);
    } else if (ov && excAbierta) {
      // Sin horario base ese día de la semana: el override SOLO habilita el día cuando es
      // una EXCEPCIÓN de sede abierta (domingo/feriado — la fila marca presencia). En un
      // día normal, una fila suelta de 8/9 NO convierte un día libre en día laborable.
      turno = recortar(ov.horaInicio, ov.horaFin ?? excAbierta.horaCierre!);
    }
    if (turno) out.set(id, turno);
  }
  return out;
}

interface DisponibilidadParams {
  sedeId: string;
  unidadNegocioId: string;
  servicioId: string;
  fecha: string; // YYYY-MM-DD
  profesionalId?: string | null;
}

interface SlotResult {
  horaInicio: string;
  horaFin: string;
  profesionalId: string | null;
  profesionalNombre: string | null;
  disponible: boolean;
}

export async function calcularDisponibilidad(params: DisponibilidadParams): Promise<SlotResult[]> {
  const { sedeId, unidadNegocioId, servicioId, fecha, profesionalId } = params;

  // Obtener el servicio para saber la duración
  const servicio = await prisma.servicio.findUnique({
    where: { id: servicioId },
    include: { unidadNegocio: true },
  });
  if (!servicio) return [];

  const duracion = servicio.duracionMinutos;
  const fechaObj = new Date(fecha + 'T12:00:00');
  const diaSemana = fechaObj.getDay(); // 0=Dom, 1=Lun...

  // Obtener unidad de negocio para saber el modo de reserva
  const unidad = await prisma.unidadNegocio.findUnique({ where: { id: unidadNegocioId } });
  if (!unidad) return [];

  // Obtener profesionales elegibles según modo
  let profesionalesElegibles: { id: string; nombres: string; apellidos: string }[] = [];

  if (profesionalId && unidad.modoReserva !== 'sin_eleccion') {
    // Profesional específico solicitado
    const prof = await prisma.profesional.findUnique({
      where: { id: profesionalId },
      select: { id: true, nombres: true, apellidos: true },
    });
    if (prof) profesionalesElegibles = [prof];
  } else {
    // Buscar todos los profesionales de esa unidad asignados a la sede en esa fecha
    const fechaDate = new Date(fecha + 'T12:00:00');
    const asignaciones = await prisma.asignacionSede.findMany({
      where: {
        sedeId,
        fechaInicio: { lte: fechaDate },
        OR: [
          { fechaFin: null },
          { fechaFin: { gte: fechaDate } },
        ],
        profesional: {
          unidadNegocioId,
          activo: true,
          deletedAt: null,
          // Solo competencias "normales" entran al automático (excluye médicos / baro de Daniel).
          competencias: { some: { servicioId, activa: true, soloPorSolicitud: false } },
        },
      },
      include: { profesional: { select: { id: true, nombres: true, apellidos: true } } },
    });
    profesionalesElegibles = asignaciones.map((a: { profesional: { id: string; nombres: string; apellidos: string } }) => a.profesional);
  }

  if (profesionalesElegibles.length === 0) return [];

  // Turno efectivo de cada profesional ese día (normal o excepcional — ver turnosDelDia).
  const turnos = await turnosDelDia(sedeId, fecha, profesionalesElegibles.map((p) => p.id));

  // Para cada profesional, calcular sus slots libres
  const resultados: SlotResult[] = [];

  for (const prof of profesionalesElegibles) {
    // Verificar competencia para el servicio
    const tieneCompetencia = await prisma.competenciaProfesional.findFirst({
      where: { profesionalId: prof.id, servicioId, activa: true },
    });
    if (!tieneCompetencia) continue;

    // Turno del día (si no atiende ese día — ni normal ni excepción habilitada — se salta).
    const horario = turnos.get(prof.id);
    if (!horario) continue;

    // Verificar bloqueos puntuales (no recurrentes) — usan fechaInicio/fechaFin como horarios exactos
    const fechaInicio = new Date(`${fecha}T${horario.horaInicio}:00`);
    const fechaFin = new Date(`${fecha}T${horario.horaFin}:00`);
    const bloqueos = await prisma.bloqueoAgenda.findMany({
      where: {
        profesionalId: prof.id,
        deletedAt: null,
        esRecurrente: false,
        fechaInicio: { lt: fechaFin },
        fechaFin: { gt: fechaInicio },
      },
    });

    // Bloqueos de almuerzo recurrentes — vigentes en la fecha consultada
    const fechaConsultada = new Date(fecha + 'T12:00:00Z');
    const bloqueosAlmuerzo = await prisma.bloqueoAgenda.findMany({
      where: {
        profesionalId: prof.id,
        deletedAt: null,
        esRecurrente: true,
        tipo: 'ALMUERZO',
        fechaInicio: { lte: fechaConsultada },
        fechaFin: { gte: fechaConsultada },
      },
    });

    // Citas que OCUPAN al profesional ese día. CLAVE: incluye tanto las suyas como
    // columna (profesionalId) COMO aquellas donde fue pedido "Solo X" en otra unidad
    // (solicitadoProfesionalId) — p.ej. Daniel Doy en Baropodometría. Es la misma
    // persona: si está en baro a las 8, su slot de podología a las 8 NO está libre.
    const citasExistentes = await prisma.cita.findMany({
      where: {
        OR: [{ profesionalId: prof.id }, { solicitadoProfesionalId: prof.id }],
        fecha: new Date(fecha + 'T12:00:00'),
        deletedAt: null,
        estado: { notIn: ['cancelada', 'no_show'] },
      },
      select: { horaInicio: true, duracionMinutos: true },
    });

    // Construir conjuntos de minutos ocupados
    const ocupados = new Set<number>();

    for (const cita of citasExistentes) {
      const start = timeToMinutes(cita.horaInicio);
      for (let m = start; m < start + cita.duracionMinutos; m += 30) {
        ocupados.add(m);
      }
    }

    for (const bloqueo of bloqueos) {
      // Hora civil desde los strings `horaInicio`/`horaFin` (TZ-safe); fallback a la hora
      // LOCAL del DateTime para filas legacy sin string.
      const bStart = bloqueo.horaInicio ? timeToMinutes(bloqueo.horaInicio)
        : timeToMinutes(`${bloqueo.fechaInicio.getHours().toString().padStart(2, '0')}:${bloqueo.fechaInicio.getMinutes().toString().padStart(2, '0')}`);
      const bEnd = bloqueo.horaFin ? timeToMinutes(bloqueo.horaFin)
        : timeToMinutes(`${bloqueo.fechaFin.getHours().toString().padStart(2, '0')}:${bloqueo.fechaFin.getMinutes().toString().padStart(2, '0')}`);
      for (let m = bStart; m < bEnd; m += 30) {
        ocupados.add(m);
      }
    }

    // Almuerzos recurrentes: marcar sub-slots usando horaInicio/horaFin strings
    for (const b of bloqueosAlmuerzo) {
      if (!b.horaInicio || !b.horaFin) continue;
      const bStart = timeToMinutes(b.horaInicio);
      const bEnd = timeToMinutes(b.horaFin);
      for (let m = bStart; m < bEnd; m += 30) {
        ocupados.add(m);
      }
    }

    // Generar slots disponibles
    const todosLosSlots = generarSlotsDelDia(horario.horaInicio, horario.horaFin, 30);

    for (const slot of todosLosSlots) {
      // Servicios de 1 hora (múltiplos de 60 min) solo se ofrecen en hora entera.
      if (!horaInicioValidaParaDuracion(slot, duracion)) continue;

      const slotMinutos = timeToMinutes(slot);
      const finMinutos = slotMinutos + duracion;
      const horaFinHorario = timeToMinutes(horario.horaFin);

      // El slot completo debe caber dentro del horario
      if (finMinutos > horaFinHorario) continue;

      // Verificar que todos los sub-slots estén libres
      let libre = true;
      for (let m = slotMinutos; m < finMinutos; m += 30) {
        if (ocupados.has(m)) { libre = false; break; }
      }

      resultados.push({
        horaInicio: slot,
        horaFin: minutesToTime(finMinutos),
        profesionalId: prof.id,
        profesionalNombre: `${prof.nombres} ${prof.apellidos}`,
        disponible: libre,
      });
    }
  }

  // Si modo sin_eleccion o preferencia_opcional (sin profesional específico):
  // colapsar por slot, disponible si al menos un profesional lo tiene libre
  if (!profesionalId || unidad.modoReserva === 'sin_eleccion') {
    const slotsAgregados = new Map<string, SlotResult>();
    for (const r of resultados) {
      const key = r.horaInicio;
      if (!slotsAgregados.has(key)) {
        slotsAgregados.set(key, { ...r });
      } else if (r.disponible) {
        slotsAgregados.get(key)!.disponible = true;
      }
    }
    return Array.from(slotsAgregados.values()).sort((a, b) =>
      timeToMinutes(a.horaInicio) - timeToMinutes(b.horaInicio)
    );
  }

  return resultados.sort((a, b) => timeToMinutes(a.horaInicio) - timeToMinutes(b.horaInicio));
}

export async function seleccionarProfesionalOptimo(
  sedeId: string,
  unidadNegocioId: string,
  servicioId: string,
  fecha: string,
  horaInicio: string
): Promise<string | null> {
  const fechaDate = new Date(fecha + 'T12:00:00');
  const diaSemana = fechaDate.getDay();

  // Obtener candidatos válidos. NO se exige `horarios` del día de semana en el filtro:
  // un día EXCEPCIONAL habilitado (excepción de sede abierta + EntradaPodologa) también
  // es válido. El turno real lo resuelve `turnosDelDia` (los que no atienden se descartan).
  const asignaciones = await prisma.asignacionSede.findMany({
    where: {
      sedeId,
      fechaInicio: { lte: fechaDate },
      OR: [{ fechaFin: null }, { fechaFin: { gte: fechaDate } }],
      profesional: {
        // Elegibilidad por COMPETENCIA al servicio (no por unidad "de casa"): así un
        // profesional puede atender en otra unidad si tiene la competencia (p.ej. Daniel
        // Doy, podólogo, también hace Baropodometría). La competencia ya delimita la unidad.
        activo: true,
        deletedAt: null,
        // La competencia debe ser "normal" (no solo-por-solicitud): médicos y la baro de Daniel
        // no entran al automático, pero sí su podología (competencia normal).
        competencias: { some: { servicioId, activa: true, soloPorSolicitud: false } },
      },
    },
    include: {
      profesional: {
        include: {
          bloqueos: {
            where: {
              deletedAt: null,
              esRecurrente: false,
              fechaInicio: { lt: new Date(`${fecha}T23:59:59`) },
              fechaFin: { gt: new Date(`${fecha}T00:00:00`) },
            },
          },
        },
      },
    },
  });

  const servicio = await prisma.servicio.findUnique({ where: { id: servicioId } });
  if (!servicio) return null;
  const duracion = servicio.duracionMinutos;
  const slotStart = timeToMinutes(horaInicio);
  const slotEnd = slotStart + duracion;

  // Turno efectivo (normal o excepcional) de cada candidato.
  const turnos = await turnosDelDia(sedeId, fecha, asignaciones.map((a) => a.profesionalId));

  const candidatos: { profesionalId: string; citasHoy: number }[] = [];

  for (const asig of asignaciones) {
    const prof = asig.profesional;
    const horario = turnos.get(prof.id);
    if (!horario) continue;

    const horaInicioHorario = timeToMinutes(horario.horaInicio);
    const horaFinHorario = timeToMinutes(horario.horaFin);

    // Verificar que el slot cabe en el horario
    if (slotStart < horaInicioHorario || slotEnd > horaFinHorario) continue;

    // Verificar bloqueos puntuales. Hora tomada de los campos STRING `horaInicio`/`horaFin`
    // (hora civil, TZ-safe); fallback a la hora LOCAL del DateTime para filas legacy sin string.
    let bloqueado = false;
    for (const bloqueo of prof.bloqueos) {
      const bStart = bloqueo.horaInicio ? timeToMinutes(bloqueo.horaInicio) : bloqueo.fechaInicio.getHours() * 60 + bloqueo.fechaInicio.getMinutes();
      const bEnd = bloqueo.horaFin ? timeToMinutes(bloqueo.horaFin) : bloqueo.fechaFin.getHours() * 60 + bloqueo.fechaFin.getMinutes();
      if (slotStart < bEnd && slotEnd > bStart) { bloqueado = true; break; }
    }
    if (bloqueado) continue;

    // Verificar bloqueos de almuerzo recurrentes
    const fechaDate2 = new Date(fecha + 'T12:00:00Z');
    const almuerzosProf = await prisma.bloqueoAgenda.findMany({
      where: {
        profesionalId: prof.id,
        deletedAt: null,
        esRecurrente: true,
        tipo: 'ALMUERZO',
        fechaInicio: { lte: fechaDate2 },
        fechaFin: { gte: fechaDate2 },
      },
      select: { horaInicio: true, horaFin: true },
    });
    for (const a of almuerzosProf) {
      if (!a.horaInicio || !a.horaFin) continue;
      const aStart = timeToMinutes(a.horaInicio);
      const aEnd = timeToMinutes(a.horaFin);
      if (slotStart < aEnd && slotEnd > aStart) { bloqueado = true; break; }
    }
    if (bloqueado) continue;

    // Verificar que el slot no esté ocupado — checar overlap real de duraciones.
    // Incluye citas donde el profesional fue PEDIDO en otra unidad (solicitadoProfesionalId,
    // p.ej. baro "Solo Daniel"): es la misma persona, no puede estar en dos lados a la vez.
    const citasDia = await prisma.cita.findMany({
      where: {
        OR: [{ profesionalId: prof.id }, { solicitadoProfesionalId: prof.id }],
        fecha: fechaDate,
        deletedAt: null,
        estado: { notIn: ['cancelada', 'no_show'] },
      },
      select: { horaInicio: true, duracionMinutos: true },
    });

    const hayConflicto = citasDia.some(c => {
      const existStart = timeToMinutes(c.horaInicio);
      const existEnd = existStart + c.duracionMinutos;
      return existStart < slotEnd && existEnd > slotStart;
    });
    if (hayConflicto) continue;

    // Contar citas del día para balanceo
    const citasHoy = await prisma.cita.count({
      where: {
        profesionalId: prof.id,
        fecha: fechaDate,
        deletedAt: null,
        estado: { notIn: ['cancelada', 'no_show'] },
      },
    });

    candidatos.push({ profesionalId: prof.id, citasHoy });
  }

  if (candidatos.length === 0) return null;

  // Elegir el profesional con menos citas hoy (balanceo de carga)
  candidatos.sort((a, b) => a.citasHoy - b.citasHoy);
  return candidatos[0]!.profesionalId;
}
