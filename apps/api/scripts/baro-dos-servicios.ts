/**
 * Baropodometría: dejar SOLO 2 servicios en la agenda.
 *   1) Evaluación de Baropodometría        [BAR-EVAL]
 *   2) Evaluación de Baropodometría Runner  [BAR-RUN]
 * Migra citas y competencias de los servicios viejos al nuevo base, y soft-deletea los viejos.
 * Idempotente.
 */
import { prisma } from '../src/db';

async function main() {
  const baro = (await prisma.unidadNegocio.findFirst({ where: { nombre: { contains: 'aropodometr' } }, select: { id: true } }))!;
  const color = (await prisma.servicio.findFirst({ where: { unidadNegocioId: baro.id }, select: { color: true } }))?.color ?? '#0D9488';

  // 1) Crear/asegurar los 2 servicios nuevos.
  const upsert = (codigo: string, nombre: string) => prisma.servicio.upsert({
    where: { codigo },
    update: { nombre, unidadNegocioId: baro.id, duracionMinutos: 30, activo: true, deletedAt: null, color },
    create: { codigo, nombre, unidadNegocioId: baro.id, duracionMinutos: 30, activo: true, color },
  });
  const evalSrv = await upsert('BAR-EVAL', 'Evaluación de Baropodometría');
  const runnerSrv = await upsert('BAR-RUN', 'Evaluación de Baropodometría Runner');
  const nuevosIds = new Set([evalSrv.id, runnerSrv.id]);
  console.log(`✓ Servicios destino: ${evalSrv.nombre} [${evalSrv.codigo}] · ${runnerSrv.nombre} [${runnerSrv.codigo}]`);

  // 2) Servicios viejos = los de baro que NO son los nuevos.
  const viejos = await prisma.servicio.findMany({ where: { unidadNegocioId: baro.id, id: { notIn: [...nuevosIds] } }, select: { id: true, nombre: true } });
  const viejosIds = viejos.map(s => s.id);
  if (viejosIds.length === 0) { console.log('No hay servicios viejos que migrar.'); return; }

  // 3) Reasignar citas viejas → Evaluación de Baropodometría (base).
  const citas = await prisma.cita.updateMany({ where: { servicioId: { in: viejosIds } }, data: { servicioId: evalSrv.id } });
  console.log(`✓ Citas reasignadas al servicio base: ${citas.count}`);

  // 4) Competencias: quien podía hacer algún baro viejo, ahora puede los 2 nuevos; desactivar viejas.
  const profsConBaro = await prisma.competenciaProfesional.findMany({ where: { servicioId: { in: viejosIds }, activa: true }, select: { profesionalId: true }, distinct: ['profesionalId'] });
  let compCreadas = 0;
  for (const { profesionalId } of profsConBaro) {
    for (const servicioId of nuevosIds) {
      const ex = await prisma.competenciaProfesional.findUnique({ where: { profesionalId_servicioId: { profesionalId, servicioId } } });
      if (ex) { if (!ex.activa) { await prisma.competenciaProfesional.update({ where: { id: ex.id }, data: { activa: true } }); compCreadas++; } }
      else { await prisma.competenciaProfesional.create({ data: { profesionalId, servicioId, habilitadoDesde: new Date(), activa: true } }); compCreadas++; }
    }
  }
  await prisma.competenciaProfesional.updateMany({ where: { servicioId: { in: viejosIds } }, data: { activa: false } });
  console.log(`✓ Competencias: ${profsConBaro.length} profesionales habilitados a los 2 nuevos (+${compCreadas}); viejas desactivadas`);

  // 5) Soft-delete de los servicios viejos (desaparecen de reserva y agenda).
  await prisma.servicio.updateMany({ where: { id: { in: viejosIds } }, data: { activo: false, deletedAt: new Date() } });
  console.log(`✓ Servicios viejos desactivados: ${viejos.map(s => s.nombre).join(', ')}`);

  const activos = await prisma.servicio.findMany({ where: { unidadNegocioId: baro.id, activo: true, deletedAt: null }, select: { nombre: true } });
  console.log(`\nServicios activos de Baropodometría: ${activos.map(s => s.nombre).join(' · ')}`);
}

main().then(() => prisma.$disconnect()).catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
