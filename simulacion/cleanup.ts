/**
 * cleanup.ts — LIMPIEZA de todos los datos de la simulación "Agenda Viva".
 *
 * ⚠ NO SE EJECUTA EN ESTA CORRIDA (entregable del prompt, sin ejecutar).
 *
 * Dos modos según el entorno:
 *  A) BD de simulación dedicada (limablue_agenda_simulacion): basta con DROP DATABASE
 *     (la forma más limpia — nada de la simulación toca producción). Recomendado.
 *  B) Si por error se corrió contra otra BD: borra SOLO lo marcado ZZTEST / sim.
 *     Los pacientes ficticios llevan apellidoPaterno ILIKE 'zztest%'; los operadores,
 *     email LIKE 'sim.%@simulacion.local'. Todo el resto (catálogos) queda intacto.
 *
 * Uso:  DATABASE_URL=<sim> npx ts-node simulacion/cleanup.ts [--modo=b]
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const MODO_B = process.argv.includes('--modo=b');

async function limpiezaSelectiva() {
  // Orden respetando FKs: consumos → recordatorios/comentarios/audit de citas → citas
  //   → paquetes → pacientes ZZTEST → usuarios sim. Bloqueos/permisos/excepciones de la
  //   simulación se identifican por su motivo/nota "(simulación...)".
  const pacientes = await prisma.paciente.findMany({
    where: { apellidoPaterno: { startsWith: 'ZZTEST', mode: 'insensitive' } },
    select: { id: true },
  });
  const pacIds = pacientes.map((p) => p.id);
  console.log(`Pacientes ZZTEST a eliminar: ${pacIds.length}`);

  const citas = await prisma.cita.findMany({ where: { pacienteId: { in: pacIds } }, select: { id: true } });
  const citaIds = citas.map((c) => c.id);

  await prisma.$transaction([
    prisma.consumoSesion.deleteMany({ where: { cita: { pacienteId: { in: pacIds } } } }),
    prisma.recordatorioCita.deleteMany({ where: { citaId: { in: citaIds } } }),
    prisma.comentarioCita.deleteMany({ where: { citaId: { in: citaIds } } }),
    prisma.auditLog.deleteMany({ where: { entidadId: { in: [...citaIds, ...pacIds] } } }),
    prisma.cita.deleteMany({ where: { id: { in: citaIds } } }),
    prisma.paquetePaciente.deleteMany({ where: { pacienteId: { in: pacIds } } }),
    prisma.paciente.deleteMany({ where: { id: { in: pacIds } } }),
  ]);

  // Bloqueos y excepciones creados por la simulación (marcados en el motivo/nota)
  await prisma.bloqueoAgenda.deleteMany({ where: { motivo: { contains: 'simulación', mode: 'insensitive' } } });
  await prisma.excepcionHorario.deleteMany({ where: { nota: { contains: 'simulación', mode: 'insensitive' } } });

  // Operadores de la simulación
  await prisma.usuario.deleteMany({ where: { email: { endsWith: '@simulacion.local' } } });

  console.log('Limpieza selectiva completa. Catálogos intactos.');
}

async function main() {
  const url = process.env.DATABASE_URL ?? '';
  if (!/simulacion|test|staging/i.test(url) && !MODO_B) {
    throw new Error(
      `SEGURIDAD: DATABASE_URL no parece de simulación (${url.replace(/:[^:@]+@/, ':****@')}). ` +
      `Si es la BD de simulación dedicada, elimínala con "DROP DATABASE limablue_agenda_simulacion". ` +
      `Para forzar limpieza selectiva pasa --modo=b.`,
    );
  }
  await limpiezaSelectiva();
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
