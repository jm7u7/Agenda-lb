import { Prisma } from '@prisma/client';
import { prisma } from '../db';

/**
 * Alerta de comportamiento del paciente, visible para recepción y contact
 * center en todo punto de contacto. Marca a quienes faltan seguido (no-show) o
 * reprograman seguido, para que el agente lo sepa de primera impresión.
 */
export interface AlertaPaciente {
  noShows: number;
  reprogramaciones: number;
  /** Citas en que el paciente SÍ llegó (llego/en_atencion/completada). Solo Limablue. */
  asistidas: number;
  /** Citas con desenlace de asistencia (asistidas + no-show). Base del %. */
  totalResueltas: number;
  /** % de asistencia histórica en Limablue (asistidas / totalResueltas). null si aún no hay citas resueltas. */
  porcentajeAsistencia: number | null;
  frecuenteInasistente: boolean;
  frecuenteReprogramador: boolean;
  /** true si debe mostrarse el rombo amarillo de alerta. */
  alerta: boolean;
}

// "Más de 2 inasistencias" → se activa a partir de la tercera (> 2).
const UMBRAL = 2;

// Estados en que el paciente físicamente ASISTIÓ (llegó al local).
const ESTADOS_ASISTIO = ['llego', 'en_atencion', 'completada'] as const;

export function evaluarAlerta(noShows: number, reprogramaciones: number, asistidas = 0): AlertaPaciente {
  const frecuenteInasistente = noShows > UMBRAL;
  const frecuenteReprogramador = reprogramaciones > UMBRAL;
  const totalResueltas = asistidas + noShows;
  return {
    noShows,
    reprogramaciones,
    asistidas,
    totalResueltas,
    // % solo si hay al menos una cita resuelta; si no, null ("sin historial aún").
    porcentajeAsistencia: totalResueltas > 0 ? Math.round((asistidas / totalResueltas) * 1000) / 10 : null,
    frecuenteInasistente,
    frecuenteReprogramador,
    alerta: frecuenteInasistente || frecuenteReprogramador,
  };
}

/**
 * Calcula la alerta para varios pacientes de una vez (2 consultas, sin N+1).
 * Pensado para el listado de la agenda donde aparecen muchos pacientes.
 */
export async function alertasDePacientes(pacienteIds: (string | null | undefined)[]): Promise<Map<string, AlertaPaciente>> {
  const map = new Map<string, AlertaPaciente>();
  const ids = [...new Set(pacienteIds.filter((x): x is string => !!x))];
  if (ids.length === 0) return map;

  // 1) Desenlace de asistencia por paciente (SOLO citas de Limablue): un groupBy por
  //    estado captura no-shows y asistencias (llegó/en atención/completada) de una vez.
  const desenlace = await prisma.cita.groupBy({
    by: ['pacienteId', 'estado'],
    where: { pacienteId: { in: ids }, estado: { in: ['no_show', ...ESTADOS_ASISTIO] as never }, deletedAt: null },
    _count: { _all: true },
  });
  const nsMap = new Map<string, number>();
  const asisMap = new Map<string, number>();
  for (const r of desenlace) {
    if (r.estado === 'no_show') nsMap.set(r.pacienteId, (nsMap.get(r.pacienteId) ?? 0) + r._count._all);
    else asisMap.set(r.pacienteId, (asisMap.get(r.pacienteId) ?? 0) + r._count._all);
  }

  // 2) Reprogramaciones (movimiento con cambio de DÍA) por paciente, vía auditoría.
  //    Se compara solo la parte de fecha (YYYY-MM-DD) porque "antes" guarda un
  //    timestamp ISO y "despues" guarda "YYYY-MM-DD". Un cambio solo de profesional
  //    el mismo día NO cuenta como reprogramación.
  const rep = await prisma.$queryRaw<{ pacienteId: string; n: bigint }[]>`
    SELECT c."pacienteId" AS "pacienteId", COUNT(*) AS n
    FROM audit_logs a
    JOIN citas c ON c.id = a."citaId"
    WHERE a.accion = 'mover'
      AND c."pacienteId"::text IN (${Prisma.join(ids)})
      AND LEFT(a.antes->>'fecha', 10) IS DISTINCT FROM LEFT(a.despues->>'fecha', 10)
    GROUP BY c."pacienteId"
  `;
  const repMap = new Map(rep.map((r) => [r.pacienteId, Number(r.n)]));

  for (const id of ids) {
    map.set(id, evaluarAlerta(nsMap.get(id) ?? 0, repMap.get(id) ?? 0, asisMap.get(id) ?? 0));
  }
  return map;
}

/** Alerta de un solo paciente. */
export async function alertaDePaciente(pacienteId: string): Promise<AlertaPaciente> {
  return (await alertasDePacientes([pacienteId])).get(pacienteId) ?? evaluarAlerta(0, 0);
}
