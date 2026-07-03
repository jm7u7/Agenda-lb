/**
 * Backfill de Cita.creadoPorUsuarioId desde el AuditLog (Desempeño de Agentes).
 *
 * Fuente: audit_logs con accion='crear', entidad='cita' y usuarioId NO nulo.
 * Solo puebla citas donde creadoPorUsuarioId es NULL (nunca sobreescribe ni toca
 * estado/fecha/autor real). Lo que no tiene audit queda como "sin atribución".
 *
 * ⚠️ NO ejecutar con --apply en producción hasta validar la cobertura real con
 *    scripts/auditoria-desempeno-readonly.ts y aprobar los porcentajes.
 *
 * Uso:
 *   npx ts-node --transpile-only scripts/backfill-creado-por.ts          # DRY-RUN (default)
 *   npx ts-node --transpile-only scripts/backfill-creado-por.ts --apply  # escribe
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const APPLY = process.argv.includes('--apply');

async function main() {
  console.log(`Modo: ${APPLY ? 'APPLY (escribe)' : 'DRY-RUN (solo reporta)'}\n`);

  // Panorama general (incluye soft-deleted en el total para transparencia).
  const [panorama] = await prisma.$queryRaw<{ total: number; con_creador: number; sin_creador: number }[]>`
    SELECT COUNT(*)::int AS total,
           COUNT("creadoPorUsuarioId")::int AS con_creador,
           COUNT(*) FILTER (WHERE "creadoPorUsuarioId" IS NULL)::int AS sin_creador
    FROM citas WHERE "deletedAt" IS NULL`;

  // Rescatables: primer audit 'crear' con usuario, por cita sin creador.
  const rescatables = await prisma.$queryRaw<{ cita_id: string; usuario_id: string }[]>`
    SELECT DISTINCT ON (a."citaId") a."citaId" AS cita_id, a."usuarioId" AS usuario_id
    FROM audit_logs a
    JOIN citas c ON c.id = a."citaId"
    WHERE a.accion = 'crear' AND a.entidad = 'cita' AND a."usuarioId" IS NOT NULL
      AND c."deletedAt" IS NULL AND c."creadoPorUsuarioId" IS NULL
    ORDER BY a."citaId", a."creadoEn" ASC`;

  console.log(`Citas activas:                         ${panorama!.total}`);
  console.log(`Ya con creadoPorUsuarioId (no se toca): ${panorama!.con_creador}`);
  console.log(`Sin creador:                           ${panorama!.sin_creador}`);
  console.log(`→ Rescatables desde AuditLog:          ${rescatables.length}`);
  console.log(`→ Quedarían SIN ATRIBUCIÓN:            ${panorama!.sin_creador - rescatables.length} (histórico sin audit; no se inventa)`);

  if (!APPLY) {
    console.log('\nDRY-RUN: no se escribió nada. Ejecuta con --apply para aplicar.');
    return;
  }

  let n = 0;
  for (const r of rescatables) {
    // Doble guardia: solo si sigue en null.
    const res = await prisma.cita.updateMany({
      where: { id: r.cita_id, creadoPorUsuarioId: null },
      data: { creadoPorUsuarioId: r.usuario_id },
    });
    n += res.count;
  }
  console.log(`\nAPLICADO: creadoPorUsuarioId poblado en ${n} cita(s).`);
}

main().finally(() => prisma.$disconnect());
