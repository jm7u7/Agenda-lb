/**
 * Desempeño de Agentes (Contact Center / Recepción) — servicio de cálculo de KPIs.
 *
 * Principios (ver PASO 0/1 aprobados):
 *  - Todo se deriva de eventos: campos denormalizados (Cita.creadoPorUsuarioId) + AuditLog
 *    (inmutable, solo lectura). El histórico sin atribución queda FUERA (no se inventa).
 *  - Fechas SIEMPRE civiles de Lima (UTC-5 fijo, sin DST): un timestamp se convierte a día
 *    civil restando 5 h; una columna @db.Date se serializa con getters UTC (fechaAStr).
 *    PROHIBIDO parseISO/new Date(str) ingenuo sobre @db.Date.
 *  - Bloque combinado (slotGrupoId compartido) = 1 AGENDAMIENTO (unidad de trabajo);
 *    las citas individuales se reportan como métrica secundaria.
 *  - Soft-delete respetado en toda query (deletedAt: null).
 *  - "Reprogramación" = mover con CAMBIO DE DÍA civil; "reacomodo" = mover dentro del mismo
 *    día civil. Se reportan por separado; solo la reprogramación pondera en el score.
 *  - valorAsistido / brecha económica: NO disponibles (Servicio.precioReferencial sin poblar);
 *    se marca `disponible: false`, jamás se estima.
 */
import { AreaAgente, Prisma } from '@prisma/client';
import { prisma } from '../db';
import { fechaAStr, LIMA_OFFSET_H } from '../utils/fechaLima';

// ─── Configuración del score compuesto (punto ÚNICO de pesos/umbrales) ─────────
export const SCORE_CONFIG = {
  pesos: {
    CONTACT_CENTER: { volumen: 0.4, showRate: 0.4, comercial: 0.2 }, // comercial = (combinados + promos) / 2
    RECEPCION: { volumen: 0.3, showRate: 0.35, recitacion: 0.35 },
    OTRO: { volumen: 0.5, showRate: 0.5 },
  },
  // Bajo este show rate (%) la métrica se pinta en alerta en la UI.
  umbralShowRateCritico: 60,
} as const;

// ─── Fechas civiles de Lima ────────────────────────────────────────────────────
const MS_H = 3_600_000;

/** Día civil de Lima ("YYYY-MM-DD") de un timestamp UTC. */
export function diaLima(d: Date): string {
  return new Date(d.getTime() - LIMA_OFFSET_H * MS_H).toISOString().slice(0, 10);
}

export function hoyLima(): string {
  return diaLima(new Date());
}

/** Rango UTC [inicio, fin) que cubre los días civiles de Lima [desde, hasta]. */
function rangoUtc(desde: string, hasta: string): { gte: Date; lt: Date } {
  return {
    gte: new Date(new Date(`${desde}T00:00:00.000Z`).getTime() + LIMA_OFFSET_H * MS_H),
    lt: new Date(new Date(`${hasta}T00:00:00.000Z`).getTime() + (24 + LIMA_OFFSET_H) * MS_H),
  };
}

/** Suma días a un día civil (aritmética a mediodía UTC — nunca cruza de día). */
export function sumarDias(dia: string, n: number): string {
  const d = new Date(`${dia}T12:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** Lunes (ISO) de la semana del día civil dado. */
export function lunesDe(dia: string): string {
  const d = new Date(`${dia}T12:00:00.000Z`);
  return sumarDias(dia, -((d.getUTCDay() + 6) % 7));
}

/** Período anterior de la misma longitud (para deltas). */
export function periodoAnterior(desde: string, hasta: string): { desde: string; hasta: string } {
  const dias = Math.round((new Date(`${hasta}T12:00:00Z`).getTime() - new Date(`${desde}T12:00:00Z`).getTime()) / 86_400_000) + 1;
  return { desde: sumarDias(desde, -dias), hasta: sumarDias(desde, -1) };
}

// ─── Tipos ─────────────────────────────────────────────────────────────────────
export interface FiltrosDesempeno {
  desde: string;
  hasta: string;
  sedeId?: string;
  area?: AreaAgente;
  servicioId?: string;
  canal?: string;
}

/** Métrica de tasa: null = SIN DATOS (denominador 0), distinto de 0%. */
type Tasa = number | null;

export interface AgenteKpis {
  agenteId: string;
  nombre: string;
  area: AreaAgente;
  sede: { id: string; nombre: string; color: string } | null;
  activo: boolean;
  volumen: {
    agendamientos: number;          // bloques (slotGrupoId = 1)
    citasIndividuales: number;
    diasActivos: number;            // días civiles con ≥1 evento del agente en AuditLog
    porDiaActivo: Tasa;             // agendamientos / días activos
  };
  gestion: {
    reprogramaciones: number;       // mover con CAMBIO de día civil
    reacomodos: number;             // mover dentro del mismo día civil
    sobreCitasPropias: number;
    sobreCitasAjenas: number;
    cancelacionesEjecutadas: number;
    confirmacionesGestionadas: number; // cambiar_estado→confirmada + reenvíos manuales
  };
  calidad: {
    vencidas: number;               // citas propias con desenlace exigible (ver esVencida)
    completadas: number;
    showRate: Tasa;                 // % completadas sobre vencidas
    noShows: number;
    noShowRate: Tasa;
    canceladasPropias: number;
    cancelacionPosteriorRate: Tasa;
    retrabajadas: number;           // citas propias con ≥1 'mover' posterior
    retrabajoRate: Tasa;
    calidadDatos: Tasa;             // % citas propias con teléfono y email válidos del paciente
    leadTimeDias: Tasa;             // promedio días civiles entre creación y fecha de la cita
  };
  conversion: {
    bloquesCombinados: number;
    tasaBloquesCombinados: Tasa;
    conPromocion: number;
    tasaUsoPromociones: Tasa;
    pacientesNuevos: number;
    mixPacientesNuevos: Tasa;
    recitaciones: number;           // solo Recepción; atenciones de su sede convertidas por ÉL
    atencionesSedeBase: number;     // denominador de recitación (atenciones en su sede)
    tasaRecitacion: Tasa;
  };
  semanas: { semana: string; agendamientos: number; vencidas: number; completadas: number }[];
  score: number | null;             // 0-100; null = sin datos suficientes
  percentiles: { volumen: number | null; showRate: number | null }; // dentro de su área (equipo)
  sinDatos: boolean;
}

export interface ResumenDesempeno {
  filtros: FiltrosDesempeno;
  agentes: AgenteKpis[];
  totales: {
    agendamientos: number;
    citasIndividuales: number;
    showRate: Tasa;
    reprogramaciones: number;
    reacomodos: number;
    cancelaciones: number;
    recitaciones: number;
    tasaRecitacion: Tasa;
  };
  variaciones: {                    // % vs período anterior (null si prev sin datos)
    agendamientos: number | null;
    showRate: number | null;
    reprogramaciones: number | null;
    cancelaciones: number | null;
    tasaRecitacion: number | null;
  } | null;
  tendenciaSemanal: { semana: string; agendamientos: number; showRate: Tasa }[];
  valorAsistido: { disponible: false; motivo: string };
  prevPeriodo: { desde: string; hasta: string };
}

// ─── Validez de contacto (misma vara para todos) ──────────────────────────────
const TEL_RE = /^[0-9+ ()-]{9,}$/;
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

const pct = (num: number, den: number): Tasa => (den > 0 ? Math.round((num / den) * 1000) / 10 : null);

/**
 * "Vencida" (elegible para show rate): su desenlace ya es exigible.
 * fecha civil < hoy, O fecha == hoy con estado final (completada/no_show/cancelada).
 * Las futuras quedan FUERA del denominador (criterio de aceptación global).
 */
function esVencida(fechaCita: string, estado: string, hoy: string): boolean {
  if (fechaCita < hoy) return true;
  return fechaCita === hoy && ['completada', 'no_show', 'cancelada'].includes(estado);
}

/** Percentil (0-100) de v dentro de valores (rango de equipo). */
function percentil(valores: number[], v: number): number {
  if (valores.length <= 1) return 100;
  const menores = valores.filter((x) => x < v).length;
  const iguales = valores.filter((x) => x === v).length;
  return Math.round(((menores + (iguales - 1) / 2) / (valores.length - 1)) * 100);
}

// ─── Agregados de recitación (empujados a SQL) ─────────────────────────────────
interface AgregadosRecitacion {
  /** Atenciones físicas (completadas, bloque = 1) por sede. */
  atencionesPorSede: Map<string, number>;
  /** Atenciones que tuvieron recita (próxima cita creada el mismo día civil), por sede. */
  atencionesConRecitaPorSede: Map<string, number>;
  /** Recitas acreditadas al agente que las creó. */
  recitacionesPorAgente: Map<string, number>;
}

/**
 * Reproduce EXACTA la lógica de recitación que antes se hacía en Node con un `findMany` de
 * ~210k citas completadas + un doble bucle O(atenciones × recitasCandidatas). Aquí se resuelve
 * como una agregación SQL: por cada atención física (completada, bloque=1) se busca la recita
 * más temprana del MISMO día civil de la atención (creada por un agente, no cancelada/reprogramada,
 * físico) cuya fecha sea POSTERIOR. Se acredita al creador de esa recita; la atención cuenta como
 * "con recita" en su sede. Equivalencia verificada map-a-map contra la implementación JS.
 */
async function agregadosRecitacion(filtros: FiltrosDesempeno): Promise<AgregadosRecitacion> {
  const { gte: creadoGte, lt: creadoLt } = rangoUtc(filtros.desde, filtros.hasta);
  const sedeFiltro = filtros.sedeId ? Prisma.sql`AND "sedeId" = ${filtros.sedeId}::uuid` : Prisma.empty;

  // `(creadoEn - interval '5 hours')::date` = día civil de Lima (UTC-5 fijo, sin DST) = `diaLima`.
  const rows = await prisma.$queryRaw<{ tipo: string; clave: string; n: number }[]>(Prisma.sql`
    WITH atenciones AS (
      SELECT id, "pacienteId", "sedeId", fecha
      FROM citas
      WHERE "deletedAt" IS NULL
        AND estado::text = 'completada'
        AND fecha >= ${filtros.desde}::date AND fecha <= ${filtros.hasta}::date
        AND ("slotRol" IS NULL OR "slotRol"::text <> 'SECUNDARIO')
        ${sedeFiltro}
    ),
    claves AS (SELECT DISTINCT "pacienteId", fecha FROM atenciones),
    emparejadas AS (
      SELECT DISTINCT ON (k."pacienteId", k.fecha) k."pacienteId", k.fecha, r."creadoPorUsuarioId" AS agente
      FROM claves k
      JOIN citas r
        ON r."pacienteId" = k."pacienteId"
       AND r."deletedAt" IS NULL
       AND r."creadoPorUsuarioId" IS NOT NULL
       AND r.estado::text NOT IN ('cancelada', 'reprogramada')
       AND (r."slotRol" IS NULL OR r."slotRol"::text <> 'SECUNDARIO')
       AND r."creadoEn" >= ${creadoGte} AND r."creadoEn" < ${creadoLt}
       AND (r."creadoEn" - interval '5 hours')::date = k.fecha
       AND r.fecha > k.fecha
      ORDER BY k."pacienteId", k.fecha, r."creadoEn" ASC
    ),
    matched AS (
      SELECT a."sedeId", e.agente
      FROM atenciones a
      JOIN emparejadas e ON e."pacienteId" = a."pacienteId" AND e.fecha = a.fecha
    )
    SELECT 'sede'::text AS tipo, "sedeId" AS clave, COUNT(*)::int AS n FROM atenciones GROUP BY "sedeId"
    UNION ALL
    SELECT 'conRecita', "sedeId", COUNT(*)::int FROM matched GROUP BY "sedeId"
    UNION ALL
    SELECT 'agente', agente, COUNT(*)::int FROM matched GROUP BY agente
  `);

  const atencionesPorSede = new Map<string, number>();
  const atencionesConRecitaPorSede = new Map<string, number>();
  const recitacionesPorAgente = new Map<string, number>();
  for (const row of rows) {
    if (row.tipo === 'sede') atencionesPorSede.set(row.clave, row.n);
    else if (row.tipo === 'conRecita') atencionesConRecitaPorSede.set(row.clave, row.n);
    else recitacionesPorAgente.set(row.clave, row.n);
  }
  return { atencionesPorSede, atencionesConRecitaPorSede, recitacionesPorAgente };
}

// ─── Cálculo principal ─────────────────────────────────────────────────────────
export async function resumenDesempeno(filtros: FiltrosDesempeno, conVariaciones = true): Promise<ResumenDesempeno> {
  const agentes = await prisma.usuario.findMany({
    where: {
      deletedAt: null,
      activo: true,
      area: filtros.area ? filtros.area : { not: null },
    },
    select: {
      id: true, nombre: true, area: true,
      sedeAsignada: { select: { id: true, nombre: true, color: true } },
    },
    orderBy: { nombre: 'asc' },
  });
  const agenteIds = agentes.map((a) => a.id);
  const hoy = hoyLima();
  const creadoEnRango = rangoUtc(filtros.desde, filtros.hasta);

  // ── Citas CREADAS por los agentes en el rango (día civil de creación) ───────
  const citas = agenteIds.length === 0 ? [] : await prisma.cita.findMany({
    where: {
      deletedAt: null,
      creadoPorUsuarioId: { in: agenteIds },
      creadoEn: creadoEnRango,
      ...(filtros.sedeId ? { sedeId: filtros.sedeId } : {}),
      ...(filtros.servicioId ? { servicioId: filtros.servicioId } : {}),
      ...(filtros.canal ? { canal: filtros.canal } : {}),
    },
    select: {
      id: true, creadoPorUsuarioId: true, pacienteId: true, fecha: true, estado: true,
      slotGrupoId: true, slotRol: true, promocionId: true, creadoEn: true, sedeId: true,
    },
  });
  const citaIds = citas.map((c) => c.id);
  const pacienteIds = [...new Set(citas.map((c) => c.pacienteId))];

  // ── Insumos auxiliares (en paralelo) ─────────────────────────────────────────
  const [pacientes, primerasCitas, retrabajos, eventos] = await Promise.all([
    // Calidad de datos de contacto (estado ACTUAL del paciente).
    pacienteIds.length === 0 ? [] : prisma.paciente.findMany({
      where: { id: { in: pacienteIds } },
      select: { id: true, telefono: true, email: true },
    }),
    // Primera cita histórica de cada paciente (para mix de pacientes nuevos).
    pacienteIds.length === 0 ? [] : prisma.cita.groupBy({
      by: ['pacienteId'],
      where: { pacienteId: { in: pacienteIds }, deletedAt: null },
      _min: { creadoEn: true },
    }),
    // Retrabajo: 'mover' posteriores sobre las citas propias creadas en el rango.
    citaIds.length === 0 ? [] : prisma.auditLog.findMany({
      where: { citaId: { in: citaIds }, accion: 'mover' },
      select: { citaId: true },
      distinct: ['citaId'],
    }),
    // Eventos EJECUTADOS por los agentes en el rango (gestión).
    agenteIds.length === 0 ? [] : prisma.auditLog.findMany({
      where: {
        usuarioId: { in: agenteIds },
        entidad: 'cita',
        creadoEn: creadoEnRango,
        accion: { in: ['crear', 'mover', 'cancelar', 'cambiar_estado', 'recordatorio_reenvio_manual', 'agregar_comentario'] },
        ...(filtros.sedeId ? { sedeId: filtros.sedeId } : {}),
      },
      select: { usuarioId: true, citaId: true, accion: true, antes: true, despues: true, creadoEn: true },
    }),
  ]);

  const contactoOk = new Map(pacientes.map((p) => [p.id, TEL_RE.test(p.telefono) && !!p.email && EMAIL_RE.test(p.email)]));
  const primeraCita = new Map(primerasCitas.map((g) => [g.pacienteId, g._min.creadoEn!]));
  const citasRetrabajadas = new Set(retrabajos.map((r) => r.citaId!));

  // Autoría de las citas tocadas por 'mover' (para propias vs ajenas).
  const movidasIds = [...new Set(eventos.filter((e) => e.accion === 'mover' && e.citaId).map((e) => e.citaId!))];
  const autoriaMovidas = movidasIds.length === 0 ? [] : await prisma.cita.findMany({
    where: { id: { in: movidasIds } },
    select: { id: true, creadoPorUsuarioId: true },
  });
  const creadorDe = new Map(autoriaMovidas.map((c) => [c.id, c.creadoPorUsuarioId]));

  // ── Recitación (Recepción): atenciones del rango + próxima cita mismo día civil ──
  // Denominador: citas COMPLETADAS con fecha civil dentro del rango (por sede). El emparejamiento
  // atención→recita se resuelve en SQL (ver `agregadosRecitacion`) en vez de traer ~210k filas a
  // Node y correr un doble bucle. Resultado idéntico, verificado map-a-map.
  const { atencionesPorSede, atencionesConRecitaPorSede, recitacionesPorAgente } = await agregadosRecitacion(filtros);

  // ── Agregación por agente ────────────────────────────────────────────────────
  const porAgente = new Map(agenteIds.map((id) => [id, {
    citas: [] as typeof citas,
    diasActivos: new Set<string>(),
    reprogramaciones: 0, reacomodos: 0, sobrePropias: 0, sobreAjenas: 0,
    cancelaciones: 0, confirmaciones: 0,
  }]));

  for (const c of citas) porAgente.get(c.creadoPorUsuarioId!)?.citas.push(c);

  for (const e of eventos) {
    const g = porAgente.get(e.usuarioId!);
    if (!g) continue;
    g.diasActivos.add(diaLima(e.creadoEn));
    if (e.accion === 'mover') {
      const antes = e.antes as { fecha?: string } | null;
      const despues = e.despues as { fecha?: string } | null;
      // Día civil ANTES/DESPUÉS: ambos payloads guardan la fecha con el día en los
      // primeros 10 chars (ISO completo el viejo, YYYY-MM-DD el nuevo).
      const diaAntes = (antes?.fecha ?? '').slice(0, 10);
      const diaDespues = (despues?.fecha ?? '').slice(0, 10);
      if (diaAntes && diaDespues && diaAntes !== diaDespues) g.reprogramaciones++;
      else g.reacomodos++;
      if (e.citaId && creadorDe.get(e.citaId) === e.usuarioId) g.sobrePropias++;
      else g.sobreAjenas++;
    } else if (e.accion === 'cancelar') {
      g.cancelaciones++;
    } else if (e.accion === 'cambiar_estado') {
      const nuevo = (e.despues as { estado?: string } | null)?.estado;
      if (nuevo === 'cancelada') g.cancelaciones++;
      if (nuevo === 'confirmada') g.confirmaciones++;
    } else if (e.accion === 'recordatorio_reenvio_manual') {
      g.confirmaciones++;
    }
  }

  const resultado: AgenteKpis[] = agentes.map((a) => {
    const g = porAgente.get(a.id)!;
    const propias = g.citas;

    // Agendamientos = bloques: un slotGrupoId cuenta 1; sin grupo, la cita misma.
    const bloques = new Set(propias.map((c) => c.slotGrupoId ?? c.id));
    const agendamientos = bloques.size;
    const combinados = new Set(propias.filter((c) => c.slotGrupoId).map((c) => c.slotGrupoId!)).size;

    // Calidad sobre citas propias (individuales; el estado cascadea en bloques).
    const vencidas = propias.filter((c) => esVencida(fechaAStr(c.fecha), c.estado, hoy));
    const completadas = vencidas.filter((c) => c.estado === 'completada').length;
    const noShows = vencidas.filter((c) => c.estado === 'no_show').length;
    const canceladas = propias.filter((c) => c.estado === 'cancelada').length;
    const retrabajadas = propias.filter((c) => citasRetrabajadas.has(c.id)).length;
    const conContactoOk = propias.filter((c) => contactoOk.get(c.pacienteId)).length;
    const leadTimes = propias.map((c) => {
      const creado = diaLima(c.creadoEn);
      const fecha = fechaAStr(c.fecha);
      return Math.round((new Date(`${fecha}T12:00:00Z`).getTime() - new Date(`${creado}T12:00:00Z`).getTime()) / 86_400_000);
    });

    // Conversión: portadoras (PRINCIPAL o individual) para promo/nuevos (sin doble conteo).
    const portadoras = propias.filter((c) => c.slotRol !== 'SECUNDARIO');
    const conPromo = portadoras.filter((c) => c.promocionId !== null).length;
    const nuevos = portadoras.filter((c) => {
      const primera = primeraCita.get(c.pacienteId);
      return primera !== undefined && primera.getTime() >= c.creadoEn.getTime();
    }).length;

    // Recitación: solo tiene denominador si el agente tiene sede base (Recepción).
    const atencionesSedeBase = a.sedeAsignada ? (atencionesPorSede.get(a.sedeAsignada.id) ?? 0) : 0;
    const recitaciones = recitacionesPorAgente.get(a.id) ?? 0;

    // Semanas (serie completa del rango; sparkline = últimas 4 en el frontend).
    const porSemana = new Map<string, { agendamientos: Set<string>; vencidas: number; completadas: number }>();
    for (const c of propias) {
      const sem = lunesDe(diaLima(c.creadoEn));
      const b = porSemana.get(sem) ?? { agendamientos: new Set(), vencidas: 0, completadas: 0 };
      b.agendamientos.add(c.slotGrupoId ?? c.id);
      if (esVencida(fechaAStr(c.fecha), c.estado, hoy)) {
        b.vencidas++;
        if (c.estado === 'completada') b.completadas++;
      }
      porSemana.set(sem, b);
    }

    const diasActivos = g.diasActivos.size;
    return {
      agenteId: a.id,
      nombre: a.nombre,
      area: a.area!,
      sede: a.sedeAsignada,
      activo: true,
      volumen: {
        agendamientos,
        citasIndividuales: propias.length,
        diasActivos,
        porDiaActivo: diasActivos > 0 ? Math.round((agendamientos / diasActivos) * 10) / 10 : null,
      },
      gestion: {
        reprogramaciones: g.reprogramaciones,
        reacomodos: g.reacomodos,
        sobreCitasPropias: g.sobrePropias,
        sobreCitasAjenas: g.sobreAjenas,
        cancelacionesEjecutadas: g.cancelaciones,
        confirmacionesGestionadas: g.confirmaciones,
      },
      calidad: {
        vencidas: vencidas.length,
        completadas,
        showRate: pct(completadas, vencidas.length),
        noShows,
        noShowRate: pct(noShows, vencidas.length),
        canceladasPropias: canceladas,
        cancelacionPosteriorRate: pct(canceladas, propias.length),
        retrabajadas,
        retrabajoRate: pct(retrabajadas, propias.length),
        calidadDatos: pct(conContactoOk, propias.length),
        leadTimeDias: leadTimes.length > 0 ? Math.round((leadTimes.reduce((s, x) => s + x, 0) / leadTimes.length) * 10) / 10 : null,
      },
      conversion: {
        bloquesCombinados: combinados,
        tasaBloquesCombinados: pct(combinados, agendamientos),
        conPromocion: conPromo,
        tasaUsoPromociones: pct(conPromo, agendamientos),
        pacientesNuevos: nuevos,
        mixPacientesNuevos: pct(nuevos, portadoras.length),
        recitaciones,
        atencionesSedeBase,
        tasaRecitacion: pct(recitaciones, atencionesSedeBase),
      },
      semanas: [...porSemana.entries()]
        .map(([semana, b]) => ({ semana, agendamientos: b.agendamientos.size, vencidas: b.vencidas, completadas: b.completadas }))
        .sort((x, y) => x.semana.localeCompare(y.semana)),
      score: null,          // se calcula abajo (necesita percentiles del equipo)
      percentiles: { volumen: null, showRate: null },
      sinDatos: propias.length === 0 && diasActivos === 0,
    };
  });

  // ── Score compuesto (percentiles DENTRO del área/equipo) ─────────────────────
  for (const area of ['CONTACT_CENTER', 'RECEPCION', 'OTRO'] as AreaAgente[]) {
    const equipo = resultado.filter((r) => r.area === area && !r.sinDatos);
    const volumenes = equipo.map((r) => r.volumen.agendamientos);
    for (const r of equipo) {
      const pVol = percentil(volumenes, r.volumen.agendamientos);
      r.percentiles.volumen = pVol;
      r.percentiles.showRate = r.calidad.showRate;
      const show = r.calidad.showRate;
      if (area === 'CONTACT_CENTER') {
        const w = SCORE_CONFIG.pesos.CONTACT_CENTER;
        const comercial = ((r.conversion.tasaBloquesCombinados ?? 0) + (r.conversion.tasaUsoPromociones ?? 0)) / 2;
        r.score = show === null ? null : Math.round(w.volumen * pVol + w.showRate * show + w.comercial * comercial);
      } else if (area === 'RECEPCION') {
        const w = SCORE_CONFIG.pesos.RECEPCION;
        const recita = r.conversion.tasaRecitacion;
        r.score = show === null ? null : Math.round(w.volumen * pVol + w.showRate * show + w.recitacion * (recita ?? 0));
      } else {
        const w = SCORE_CONFIG.pesos.OTRO;
        r.score = show === null ? null : Math.round(w.volumen * pVol + w.showRate * show);
      }
    }
  }

  // ── Totales del área/filtros + tendencia semanal agregada ────────────────────
  const totVencidas = resultado.reduce((s, r) => s + r.calidad.vencidas, 0);
  const totCompletadas = resultado.reduce((s, r) => s + r.calidad.completadas, 0);
  const totAtenciones = [...atencionesPorSede.values()].reduce((s, n) => s + n, 0);
  const totRecitas = [...atencionesConRecitaPorSede.values()].reduce((s, n) => s + n, 0);
  const totales = {
    agendamientos: resultado.reduce((s, r) => s + r.volumen.agendamientos, 0),
    citasIndividuales: resultado.reduce((s, r) => s + r.volumen.citasIndividuales, 0),
    showRate: pct(totCompletadas, totVencidas),
    reprogramaciones: resultado.reduce((s, r) => s + r.gestion.reprogramaciones, 0),
    reacomodos: resultado.reduce((s, r) => s + r.gestion.reacomodos, 0),
    cancelaciones: resultado.reduce((s, r) => s + r.gestion.cancelacionesEjecutadas, 0),
    recitaciones: totRecitas,
    tasaRecitacion: pct(totRecitas, totAtenciones),
  };

  const tendencia = new Map<string, { agendamientos: number; vencidas: number; completadas: number }>();
  for (const r of resultado) {
    for (const s of r.semanas) {
      const b = tendencia.get(s.semana) ?? { agendamientos: 0, vencidas: 0, completadas: 0 };
      b.agendamientos += s.agendamientos;
      b.vencidas += s.vencidas;
      b.completadas += s.completadas;
      tendencia.set(s.semana, b);
    }
  }

  // ── Variaciones vs período anterior ──────────────────────────────────────────
  const prev = periodoAnterior(filtros.desde, filtros.hasta);
  let variaciones: ResumenDesempeno['variaciones'] = null;
  if (conVariaciones) {
    const anterior = await resumenDesempeno({ ...filtros, desde: prev.desde, hasta: prev.hasta }, false);
    const delta = (act: number, ant: number): number | null =>
      ant > 0 ? Math.round(((act - ant) / ant) * 1000) / 10 : null;
    const deltaTasa = (act: Tasa, ant: Tasa): number | null =>
      act !== null && ant !== null && ant > 0 ? Math.round((act - ant) * 10) / 10 : null; // puntos porcentuales
    variaciones = {
      agendamientos: delta(totales.agendamientos, anterior.totales.agendamientos),
      showRate: deltaTasa(totales.showRate, anterior.totales.showRate),
      reprogramaciones: delta(totales.reprogramaciones, anterior.totales.reprogramaciones),
      cancelaciones: delta(totales.cancelaciones, anterior.totales.cancelaciones),
      tasaRecitacion: deltaTasa(totales.tasaRecitacion, anterior.totales.tasaRecitacion),
    };
  }

  return {
    filtros,
    agentes: resultado,
    totales,
    variaciones,
    tendenciaSemanal: [...tendencia.entries()]
      .map(([semana, b]) => ({ semana, agendamientos: b.agendamientos, showRate: pct(b.completadas, b.vencidas) }))
      .sort((x, y) => x.semana.localeCompare(y.semana)),
    valorAsistido: { disponible: false, motivo: 'Servicio.precioReferencial sin poblar — no se estima' },
    prevPeriodo: prev,
  };
}

// ─── Reporte de recitación por sede/recepcionista ──────────────────────────────
export async function reporteRecitacion(filtros: FiltrosDesempeno) {
  const resumen = await resumenDesempeno({ ...filtros, area: 'RECEPCION' }, false);

  // Denominadores por sede ya calculados dentro del resumen por agente; se re-derivan
  // aquí a nivel sede para el reporte (mismas reglas: completadas del rango, bloques = 1).
  // Conteo en SQL (`groupBy`) en vez de traer ~210k filas a Node. `OR: [null, PRINCIPAL]`
  // reproduce "físicas" (`slotRol <> 'SECUNDARIO'` incluyendo los NULL).
  const atencionesPorSedeRows = await prisma.cita.groupBy({
    by: ['sedeId'],
    where: {
      deletedAt: null,
      estado: 'completada',
      fecha: { gte: new Date(`${filtros.desde}T12:00:00Z`), lte: new Date(`${filtros.hasta}T12:00:00Z`) },
      ...(filtros.sedeId ? { sedeId: filtros.sedeId } : {}),
      OR: [{ slotRol: null }, { slotRol: 'PRINCIPAL' }],
    },
    _count: { _all: true },
  });
  const sedes = await prisma.sede.findMany({ where: { deletedAt: null }, select: { id: true, nombre: true, color: true } });
  const sedeMap = new Map(sedes.map((s) => [s.id, s]));

  const porSede = new Map<string, { atenciones: number }>();
  for (const row of atencionesPorSedeRows) {
    porSede.set(row.sedeId, { atenciones: row._count._all });
  }
  const recitasPorSede = new Map<string, number>();
  for (const ag of resumen.agentes) {
    if (ag.sede) recitasPorSede.set(ag.sede.id, (recitasPorSede.get(ag.sede.id) ?? 0) + ag.conversion.recitaciones);
  }

  return {
    filtros,
    porSede: [...porSede.entries()].map(([sedeId, v]) => {
      const recitas = recitasPorSede.get(sedeId) ?? 0;
      return {
        sede: sedeMap.get(sedeId) ?? { id: sedeId, nombre: '—', color: '#6B7F9E' },
        atenciones: v.atenciones,
        conRecita: recitas,
        sinProximaCita: v.atenciones - recitas,
        tasa: pct(recitas, v.atenciones),
      };
    }).sort((a, b) => b.atenciones - a.atenciones),
    porRecepcionista: resumen.agentes
      .map((a) => ({
        agenteId: a.agenteId, nombre: a.nombre, sede: a.sede,
        recitaciones: a.conversion.recitaciones,
        atencionesSede: a.conversion.atencionesSedeBase,
        tasa: a.conversion.tasaRecitacion,
        sinDatos: a.sinDatos,
      }))
      .sort((a, b) => b.recitaciones - a.recitaciones),
    brechaOportunidad: { disponible: false, motivo: 'Sin precios en Servicio.precioReferencial — no se estima ticket promedio' },
  };
}
