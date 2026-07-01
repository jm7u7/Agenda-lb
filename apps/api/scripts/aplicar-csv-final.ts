/**
 * Aplica la "Lista Final de Especialistas con Servicios" (CSV) a la BD:
 *  - Sede de cada podóloga (columna SEDE) → asignación activa en esa sede.
 *  - Competencias (matriz de 19 procedimientos → servicios POD-01..POD-19).
 * Reutilizable desde el seed (idempotente) y como CLI:
 *   CSV_PATH=... [DRY_RUN=1] npx ts-node --transpile-only scripts/aplicar-csv-final.ts
 */
import * as fs from 'fs';
import * as path from 'path';
import { prisma } from '../src/db';

const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ').trim();

export async function aplicarListaFinal(csvPath: string, opts: { dry?: boolean; log?: boolean } = {}) {
  const dry = !!opts.dry; const log = opts.log ?? true;
  // Convención del sistema: rangos de asignación NO se solapan. Al mover, la nueva
  // empieza HOY y la anterior se cierra AYER (si se cerrara hoy, ambas cubrirían hoy
  // y la podóloga aparecería en dos sedes a la vez en la agenda).
  const hoy = new Date(); hoy.setHours(0, 0, 0, 0);
  const ayer = new Date(hoy); ayer.setDate(ayer.getDate() - 1);
  const raw = fs.readFileSync(csvPath, 'latin1');
  const lines = raw.split(/\r?\n/);

  interface Row { name: string; sede: string; comp: boolean[] }
  const rows: Row[] = [];
  for (let i = 2; i < lines.length; i++) {
    const c = lines[i].split(',');
    const name = (c[0] || '').trim(); const cargo = (c[1] || '').trim(); const sede = (c[2] || '').trim();
    if (!name || !/pod[oó]log/i.test(cargo) || !sede) continue;
    const comp = Array.from({ length: 19 }, (_, k) => (c[3 + k] || '').trim().toUpperCase() === 'VERDADERO');
    rows.push({ name, sede, comp });
  }

  const sedes = await prisma.sede.findMany({ select: { id: true, nombre: true } });
  const sedeByNorm = new Map(sedes.map(s => [norm(s.nombre), s] as const));
  const profs = await prisma.profesional.findMany({
    where: { deletedAt: null, tipo: 'podologa' },
    select: { id: true, nombres: true, apellidos: true, asignaciones: { where: { activa: true }, select: { id: true, sedeId: true }, orderBy: { fechaInicio: 'desc' } } },
  });
  const profByName = new Map<string, typeof profs[number]>();
  for (const p of profs) { profByName.set(norm(`${p.apellidos} ${p.nombres}`), p); profByName.set(norm(`${p.nombres} ${p.apellidos}`), p); }

  const servs = await prisma.servicio.findMany({ where: { codigo: { startsWith: 'POD-' } }, select: { id: true, codigo: true } });
  const servByCode = new Map(servs.map(s => [s.codigo, s.id] as const));

  let matched = 0, sedeCambios = 0, compCambios = 0; const noMatch: string[] = [];
  for (const r of rows) {
    const p = profByName.get(norm(r.name)); const sedeDest = sedeByNorm.get(norm(r.sede.replace(/\s+/g, ' ')));
    if (!p || !sedeDest) { noMatch.push(`${!p ? 'profesional' : 'sede'}: "${r.name}" / "${r.sede}"`); continue; }
    matched++;
    const activa = p.asignaciones[0];
    const cambiaSede = !activa || activa.sedeId !== sedeDest.id;
    if (cambiaSede) sedeCambios++;
    if (!dry) {
      if (cambiaSede) {
        if (activa && p.asignaciones.length === 1) {
          // Una sola asignación activa → corregir en sitio (limpio).
          await prisma.asignacionSede.update({ where: { id: activa.id }, data: { sedeId: sedeDest.id, fechaFin: null } });
        } else {
          // Historial/múltiples → cerrar las activas y crear una nueva.
          await prisma.$transaction(async (tx) => {
            await tx.asignacionSede.updateMany({ where: { profesionalId: p.id, activa: true }, data: { activa: false, fechaFin: ayer } });
            await tx.asignacionSede.create({ data: { profesionalId: p.id, sedeId: sedeDest.id, fechaInicio: hoy, fechaFin: null, activa: true, motivo: 'OTRO' } });
          });
        }
      }
      for (let k = 0; k < 19; k++) {
        const servId = servByCode.get(`POD-${String(k + 1).padStart(2, '0')}`); if (!servId) continue;
        const debe = r.comp[k];
        const ex = await prisma.competenciaProfesional.findUnique({ where: { profesionalId_servicioId: { profesionalId: p.id, servicioId: servId } } });
        if (ex) { if (ex.activa !== debe) { await prisma.competenciaProfesional.update({ where: { id: ex.id }, data: { activa: debe } }); compCambios++; } }
        else if (debe) { await prisma.competenciaProfesional.create({ data: { profesionalId: p.id, servicioId: servId, habilitadoDesde: new Date(), activa: true } }); compCambios++; }
      }
    }
    if (log) console.log(`${cambiaSede ? '↻' : '='} ${r.name} → ${sedeDest.nombre} · ${r.comp.filter(Boolean).length}/19`);
  }
  if (log) console.log(`\nResumen: ${matched}/${rows.length} emparejadas · sedes ${dry ? '(potenciales) ' : ''}${sedeCambios}${dry ? '' : ` · competencias ${compCambios}`}`);
  if (log && noMatch.length) { console.log('⚠️ Sin emparejar:'); noMatch.forEach(n => console.log('  ' + n)); }
  return { matched, total: rows.length, sedeCambios, compCambios, noMatch };
}

// CLI
if (require.main === module) {
  const csv = process.env.CSV_PATH || path.join(__dirname, '..', 'prisma', 'data', 'lista-final-especialistas.csv');
  aplicarListaFinal(csv, { dry: process.env.DRY_RUN === '1' })
    .then(() => prisma.$disconnect())
    .catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
}
