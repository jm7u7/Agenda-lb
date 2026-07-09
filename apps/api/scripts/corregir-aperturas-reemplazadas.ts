/**
 * CORRECTOR TRANSVERSAL — aperturas Genexis aprobadas de paquetes REEMPLAZADOS.
 *
 * Caso raíz (Marisol Pinto, DNI 25460444): un paciente con varias GENERACIONES de
 * paquetes de la misma línea de tratamiento (ej. Laserterapia P12 viejo + P6
 * vigente, ambos con evidencia 2026). El motor proponía todas y en conciliación
 * se aprobó la generación ANTERIOR → deuda falsa (paquete de 12 cuando el vigente
 * es de 6).
 *
 * Este script detecta TODAS las aperturas vivas cuya familia NO es la de última
 * actividad dentro de su línea (mismo servicio resuelto) para ese paciente, y:
 *  - Si el paquete NO tiene consumos posteriores a la apertura → lo REVIERTE
 *    (soft-delete de paquete y consumos) y devuelve su conciliación a PENDIENTE,
 *    para que el motor (ya con la regla de generaciones) regenere la propuesta
 *    correcta y un humano la re-firme.
 *  - Si YA tiene consumos de citas nuevas → NO toca nada y lo reporta para
 *    decisión manual (la trazabilidad de esas citas manda).
 *
 * Todo queda en AuditLog. Correr después: npm run proponer:aperturas.
 *
 * Uso: npx ts-node --transpile-only scripts/corregir-aperturas-reemplazadas.ts [--apply]
 *      (sin --apply es DRY-RUN: solo reporta)
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const APPLY = process.argv.includes('--apply');

function norm(s: string | null | undefined): string {
  return (s ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

async function main(): Promise<void> {
  console.log(`Modo: ${APPLY ? 'APPLY (corrige)' : 'DRY-RUN (solo reporta)'}\n`);

  const familias = await prisma.familiaPaqueteGenexis.findMany({ where: { activa: true, deletedAt: null } });
  const regexPorFamilia = new Map(familias.map((f) => [f.id, (f.patronesServicio as string[]).map((p) => new RegExp(p))]));
  const familiaPorId = new Map(familias.map((f) => [f.id, f]));

  // Servicio resuelto de una familia según la sede del paquete (línea de tratamiento).
  const resolver = (familiaId: string, sedeId: string | null): string | null => {
    const f = familiaPorId.get(familiaId);
    const mapeo = f?.mapeoServicio as { default?: string; porSede?: Record<string, string> } | null;
    if (!mapeo) return null;
    if (mapeo.porSede && sedeId) return mapeo.porSede[sedeId] ?? null;
    return mapeo.default ?? null;
  };

  const aperturas = await prisma.paquetePaciente.findMany({
    where: { origen: 'GENEXIS_APERTURA', deletedAt: null },
    include: {
      paciente: { select: { nombres: true, apellidoPaterno: true, numeroDocumento: true } },
      paquete: { select: { nombre: true } },
      consumos: { where: { deletedAt: null }, select: { id: true, origen: true } },
      conciliaciones: { where: { deletedAt: null }, select: { id: true } },
    },
  });
  console.log(`Aperturas Genexis vivas: ${aperturas.length}`);

  let revertidas = 0;
  let manuales = 0;
  let correctas = 0;

  for (const pp of aperturas) {
    if (!pp.familiaId) continue;
    // Última fecha de sesión LLEGADA por familia, para este paciente.
    const historial = await prisma.historialGenexis.findMany({
      where: { pacienteId: pp.pacienteId, llegoPaciente: 'Sí', deletedAt: null },
      select: { servicio: true, fechaCita: true },
    });
    const ultimaPorFamilia = new Map<string, string>();
    for (const h of historial) {
      const sn = norm(h.servicio);
      for (const [fid, regexes] of regexPorFamilia) {
        if (regexes.some((rx) => rx.test(sn))) {
          const prev = ultimaPorFamilia.get(fid);
          if (!prev || h.fechaCita > prev) ultimaPorFamilia.set(fid, h.fechaCita);
          break;
        }
      }
    }

    const miServicio = resolver(pp.familiaId, pp.sedeId);
    const miUltima = ultimaPorFamilia.get(pp.familiaId) ?? '0000';
    // ¿Existe otra familia de la MISMA línea con actividad más reciente?
    let reemplazadaPor: { familia: string; fecha: string } | null = null;
    for (const [fid, fecha] of ultimaPorFamilia) {
      if (fid === pp.familiaId) continue;
      if (resolver(fid, pp.sedeId) === miServicio && fecha > miUltima) {
        if (!reemplazadaPor || fecha > reemplazadaPor.fecha) {
          reemplazadaPor = { familia: familiaPorId.get(fid)!.nombreFamilia, fecha };
        }
      }
    }

    const etiqueta = `${pp.paciente.nombres} ${pp.paciente.apellidoPaterno} (${pp.paciente.numeroDocumento}) · ${pp.paquete.nombre} · ${familiaPorId.get(pp.familiaId)?.nombreFamilia}`;
    if (!reemplazadaPor) {
      correctas += 1;
      continue;
    }

    const consumosNuevos = pp.consumos.filter((c) => c.origen !== 'APERTURA');
    if (consumosNuevos.length > 0) {
      manuales += 1;
      console.log(`⚠ MANUAL  ${etiqueta}\n    Reemplazado por ${reemplazadaPor.familia} (${reemplazadaPor.fecha}) pero YA tiene ${consumosNuevos.length} consumo(s) de citas nuevas — revisar a mano.`);
      continue;
    }

    console.log(`✗ REVERTIR ${etiqueta}\n    Familia anterior reemplazada por ${reemplazadaPor.familia} (última sesión ${reemplazadaPor.fecha}).`);
    revertidas += 1;
    if (!APPLY) continue;

    await prisma.$transaction(async (tx) => {
      await tx.consumoSesion.updateMany({
        where: { paqueteId: pp.id, deletedAt: null },
        data: { deletedAt: new Date(), anuladoMotivo: `Apertura revertida: paquete reemplazado por ${reemplazadaPor!.familia}` },
      });
      await tx.paquetePaciente.update({
        where: { id: pp.id },
        data: { deletedAt: new Date(), activo: false, estado: 'ANULADO', sesionesUsadas: 0 },
      });
      // La conciliación vuelve a PENDIENTE: el motor (regla de generaciones) la
      // regenerará como ROJA con nota, y la generación vigente quedará proponible.
      await tx.conciliacionApertura.updateMany({
        where: { id: { in: pp.conciliaciones.map((c) => c.id) } },
        data: {
          estado: 'PENDIENTE',
          consumoAprobado: null,
          sedeAprobadaId: null,
          paquetePacienteId: null,
          decididoPor: null,
          decididoEn: null,
          valoresOriginales: undefined,
        },
      });
      await tx.auditLog.create({
        data: {
          accion: 'revertir_apertura_reemplazada',
          entidad: 'paquete_paciente',
          entidadId: pp.id,
          antes: { paquete: pp.paquete.nombre, sesionesTotal: pp.sesionesTotal, sesionesUsadas: pp.sesionesUsadas } as never,
          despues: { motivo: `Generación anterior reemplazada por ${reemplazadaPor!.familia} (${reemplazadaPor!.fecha})` } as never,
        },
      });
    });
  }

  console.log(`\nResumen: ${correctas} correctas · ${revertidas} ${APPLY ? 'revertidas' : 'por revertir'} · ${manuales} para revisión manual`);
  if (APPLY && revertidas > 0) console.log('→ Ahora corre: npm run proponer:aperturas (regenera con la regla de generaciones)');
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e instanceof Error ? e.stack : e);
    await prisma.$disconnect();
    process.exit(1);
  });
