/**
 * CORRECCIÓN DE TAMAÑO de paquetes Genexis (2026-07-06).
 *
 * Problema: el nombre de servicio a veces dice "P12" pero la obs dice "de paquete
 * de 4 sesiones" → el paciente compró un paquete de 4, no de 12. La obs manda.
 *
 * Este script (idempotente) detecta el tamaño real "paquete de N" en la obs (misma
 * lógica que el motor) y corrige, para PAQUETE (no membresías):
 *   - la conciliación: `sesionesTotalReal = N` (aunque esté APROBADA — el motor no la toca).
 *   - el PaquetePaciente ya creado: `sesionesTotal = N`, cap de consumos, recálculo de estado.
 *
 * Uso: npx ts-node --transpile-only scripts/corregir-tamano-paquetes.ts [--apply]
 *   Sin --apply = DRY-RUN (solo reporta). Con --apply = escribe.
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const APPLY = process.argv.includes('--apply');

function norm(s: string | null | undefined): string {
  return (s ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim();
}
const RE_TAMANO = /paquete\s+de\s+(\d{1,2})|pack\s+de\s+(\d{1,2})/g;
function tamanoEnObs(o: string): number | null {
  RE_TAMANO.lastIndex = 0;
  let m: RegExpExecArray | null;
  let n: number | null = null;
  while ((m = RE_TAMANO.exec(o)) !== null) {
    const v = parseInt(m[1] ?? m[2], 10);
    if (v >= 1 && v <= 12) n = v;
  }
  return n;
}

async function main(): Promise<void> {
  console.log(`Modo: ${APPLY ? 'APPLY (escribe)' : 'DRY-RUN (solo reporta)'}\n`);

  const familias = (await prisma.familiaPaqueteGenexis.findMany({ where: { activa: true, deletedAt: null } }))
    .filter((f) => f.tipo === 'PAQUETE' && f.sesionesTotales)
    .map((f) => ({ id: f.id, nombre: f.nombreFamilia, total: f.sesionesTotales!, regexes: (f.patronesServicio as string[]).map((p) => new RegExp(p)) }));

  // Detección: por paciente×familia, moda de "paquete de N" en las obs de las filas
  // que matchean el servicio de la familia.
  const tam = new Map<string, Map<number, number>>(); // `${pid}|${famId}` → N → freq
  let cursor: string | undefined;
  for (;;) {
    const filas = await prisma.historialGenexis.findMany({
      where: { deletedAt: null, pacienteId: { not: null } },
      select: { id: true, pacienteId: true, servicio: true, obsPaciente: true, obsPodologo: true },
      orderBy: { id: 'asc' }, take: 20000, ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
    });
    if (filas.length === 0) break;
    cursor = filas[filas.length - 1].id;
    for (const r of filas) {
      const n = tamanoEnObs(norm(`${r.obsPaciente ?? ''} / ${r.obsPodologo ?? ''}`));
      if (n === null) continue;
      const sn = norm(r.servicio);
      for (const f of familias) {
        if (f.regexes.some((rx) => rx.test(sn))) {
          const key = `${r.pacienteId}|${f.id}`;
          let m = tam.get(key);
          if (!m) tam.set(key, (m = new Map()));
          m.set(n, (m.get(n) ?? 0) + 1);
          break;
        }
      }
    }
  }

  const familiaPorId = new Map(familias.map((f) => [f.id, f]));
  let conciliacionesFix = 0;
  let paquetesFix = 0;

  for (const [key, freq] of tam) {
    const [pacienteId, familiaId] = key.split('|');
    const fam = familiaPorId.get(familiaId);
    if (!fam) continue;
    const nReal = [...freq.entries()].sort((a, b) => b[1] - a[1])[0][0];
    if (nReal === fam.total) continue; // coincide con el default → nada que corregir

    const c = await prisma.conciliacionApertura.findFirst({
      where: { pacienteId, familiaId, deletedAt: null },
      include: { paquetePaciente: { include: { consumos: { where: { deletedAt: null }, orderBy: { creadoEn: 'asc' } } } } },
    });
    if (!c) continue;
    if (c.sesionesTotalReal === nReal && (!c.paquetePaciente || c.paquetePaciente.sesionesTotal === nReal)) continue; // ya corregido

    const pac = await prisma.paciente.findUnique({ where: { id: pacienteId }, select: { nombres: true, apellidoPaterno: true, numeroDocumento: true } });
    const etiqueta = `${pac?.nombres} ${pac?.apellidoPaterno} (${pac?.numeroDocumento}) · ${fam.nombre}`;
    console.log(`${etiqueta}: ${fam.total} → ${nReal}${c.estado === 'APROBADA' || c.estado === 'EDITADA' ? ' (paquete ya creado)' : ` [${c.estado}]`}`);

    if (!APPLY) { conciliacionesFix++; if (c.paquetePaciente) paquetesFix++; continue; }

    await prisma.$transaction(async (tx) => {
      await tx.conciliacionApertura.update({ where: { id: c.id }, data: { sesionesTotalReal: nReal } });
      conciliacionesFix++;

      const pp = c.paquetePaciente;
      if (pp) {
        // Cap de consumos vivos al tamaño real (si hubiera más que N, sobran).
        const vivos = pp.consumos;
        if (vivos.length > nReal) {
          const sobran = vivos.slice(nReal).map((k) => k.id);
          await tx.consumoSesion.updateMany({ where: { id: { in: sobran } }, data: { deletedAt: new Date(), anuladoMotivo: `Corrección tamaño real ${nReal} (obs "paquete de ${nReal}")` } });
        }
        const usadas = Math.min(vivos.length, nReal);
        const estado = pp.vigenciaFin && pp.vigenciaFin < new Date().toISOString().slice(0, 10) ? 'VENCIDO' : usadas >= nReal ? 'AGOTADO' : 'ACTIVO';
        await tx.paquetePaciente.update({ where: { id: pp.id }, data: { sesionesTotal: nReal, sesionesUsadas: usadas, estado, activo: estado === 'ACTIVO' } });
        paquetesFix++;
        await tx.auditLog.create({
          data: { accion: 'corregir_tamano_paquete', entidad: 'paquete_paciente', entidadId: pp.id, antes: { sesionesTotal: pp.sesionesTotal } as never, despues: { sesionesTotal: nReal, motivo: `obs "paquete de ${nReal}"` } as never },
        });
      }
    });
  }

  console.log(`\n${APPLY ? '✔ Corregidas' : 'A corregir'}: ${conciliacionesFix} conciliaciones, ${paquetesFix} paquetes ya creados`);
  if (!APPLY) console.log('\n(DRY-RUN — corre con --apply para escribir)');
}

main().then(() => prisma.$disconnect()).catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
