import { prisma } from '../db';

interface GroupKey {
  fecha: string; // 'YYYY-MM-DD'
  sedeId: string;
  unidadNegocioId: string;
  profesionalId: string | null;
  servicioId: string;
}

interface Conteos {
  totalCitas: number;
  completadas: number;
  noShow: number;
  canceladas: number;
  llegaron: number;
  agendadas: number;
  confirmadas: number;
  enAtencion: number;
  minutosAtendidos: number;
  citasElegidasPorPaciente: number;
  citasAsignadasAuto: number;
}

type GrupoMap = Map<string, Conteos>;

function keyStr(k: GroupKey) {
  return `${k.fecha}|${k.sedeId}|${k.unidadNegocioId}|${k.profesionalId ?? 'null'}|${k.servicioId}`;
}

function agrupar(citas: {
  fecha: Date;
  sedeId: string;
  unidadNegocioId: string;
  profesionalId: string | null;
  servicioId: string;
  estado: string;
  duracionMinutos: number;
  origenAsignacion: string | null;
}[]): { key: GroupKey; conteos: Conteos }[] {
  const mapa: GrupoMap = new Map();
  const claves = new Map<string, GroupKey>();

  for (const c of citas) {
    const k: GroupKey = {
      fecha: c.fecha.toISOString().slice(0, 10),
      sedeId: c.sedeId,
      unidadNegocioId: c.unidadNegocioId,
      profesionalId: c.profesionalId,
      servicioId: c.servicioId,
    };
    const ks = keyStr(k);
    if (!mapa.has(ks)) {
      mapa.set(ks, {
        totalCitas: 0, completadas: 0, noShow: 0, canceladas: 0,
        llegaron: 0, agendadas: 0, confirmadas: 0, enAtencion: 0,
        minutosAtendidos: 0, citasElegidasPorPaciente: 0, citasAsignadasAuto: 0,
      });
      claves.set(ks, k);
    }
    const g = mapa.get(ks)!;
    g.totalCitas++;
    if (c.estado === 'completada')   { g.completadas++; g.minutosAtendidos += c.duracionMinutos; }
    if (c.estado === 'no_show')      g.noShow++;
    if (c.estado === 'cancelada' || c.estado === 'reprogramada') g.canceladas++;
    if (c.estado === 'llego')        g.llegaron++;
    if (c.estado === 'agendada')     g.agendadas++;
    if (c.estado === 'confirmada')   g.confirmadas++;
    if (c.estado === 'en_atencion')  g.enAtencion++;
    if (c.origenAsignacion === 'elegida_por_paciente') g.citasElegidasPorPaciente++;
    else g.citasAsignadasAuto++;
  }

  return Array.from(mapa.entries()).map(([ks, conteos]) => ({ key: claves.get(ks)!, conteos }));
}

async function upsertGrupos(grupos: { key: GroupKey; conteos: Conteos }[]) {
  if (grupos.length === 0) return;

  // Group by fecha to do batched deletes per date
  const porFecha = new Map<string, typeof grupos>();
  for (const g of grupos) {
    const arr = porFecha.get(g.key.fecha) ?? [];
    arr.push(g);
    porFecha.set(g.key.fecha, arr);
  }

  for (const [fecha, gs] of porFecha) {
    const fechaDate = new Date(fecha + 'T12:00:00');

    // Collect all unique (sedeId, unidadNegocioId, profesionalId, servicioId) combos for this date
    const conditions = gs.map(g => ({
      fecha: fechaDate,
      sedeId: g.key.sedeId,
      unidadNegocioId: g.key.unidadNegocioId,
      profesionalId: g.key.profesionalId,
      servicioId: g.key.servicioId,
    }));

    await prisma.$transaction(async (tx) => {
      // Delete existing records for these combos
      for (const cond of conditions) {
        await tx.agregadoDiario.deleteMany({
          where: {
            fecha: cond.fecha,
            sedeId: cond.sedeId,
            unidadNegocioId: cond.unidadNegocioId,
            profesionalId: cond.profesionalId,
            servicioId: cond.servicioId,
          },
        });
      }
      // Insert fresh
      await tx.agregadoDiario.createMany({
        data: gs.map(g => ({
          fecha: new Date(g.key.fecha + 'T12:00:00'),
          sedeId: g.key.sedeId,
          unidadNegocioId: g.key.unidadNegocioId,
          profesionalId: g.key.profesionalId,
          servicioId: g.key.servicioId,
          ...g.conteos,
          sucio: false,
        })),
      });
    });
  }
}

/** Recalcula agregados para un rango de fechas (batch). */
export async function agregarRango(desde: Date, hasta: Date) {
  const citas = await prisma.cita.findMany({
    where: {
      fecha: { gte: desde, lte: hasta },
      deletedAt: null,
    },
    select: {
      fecha: true,
      sedeId: true,
      unidadNegocioId: true,
      profesionalId: true,
      servicioId: true,
      estado: true,
      duracionMinutos: true,
      origenAsignacion: true,
    },
  });

  const grupos = agrupar(citas);
  await upsertGrupos(grupos);
  return grupos.length;
}

/** Recalcula solo el día de hoy (incremental). */
export async function agregarHoy() {
  const hoy = new Date();
  const fechaStr = hoy.toISOString().slice(0, 10);
  const desde = new Date(fechaStr + 'T00:00:00');
  const hasta = new Date(fechaStr + 'T23:59:59');
  return agregarRango(desde, hasta);
}
