/**
 * Auditoría READ-ONLY para el módulo Desempeño de Agentes.
 * 100% SELECTs — no escribe, no bloquea, no modifica nada. Seguro contra producción.
 *
 * Objetivo: medir la cobertura real de atribución (creadoPorUsuarioId + AuditLog)
 * antes de decidir el backfill. Correr en el servidor de prod (usa DATABASE_URL del
 * entorno / .env del API):
 *
 *   cd apps/api && npx ts-node --transpile-only scripts/auditoria-desempeno-readonly.ts
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const out: Record<string, unknown> = {};

  // ── 1. Cobertura de atribución en citas ────────────────────────────────────
  out.atribucion = await prisma.$queryRaw`
    SELECT COUNT(*)::int AS total_citas_activas,
           COUNT("creadoPorUsuarioId")::int AS con_creador,
           COUNT(*) FILTER (WHERE "creadoPorUsuarioId" IS NULL)::int AS sin_creador,
           ROUND(100.0 * COUNT("creadoPorUsuarioId") / NULLIF(COUNT(*), 0), 1)::float AS pct_con_creador,
           MIN(fecha)::text AS primera_fecha, MAX(fecha)::text AS ultima_fecha
    FROM citas WHERE "deletedAt" IS NULL`;

  // Cobertura por MES (para saber desde cuándo los KPIs por agente son confiables).
  out.atribucionPorMes = await prisma.$queryRaw`
    SELECT to_char(fecha, 'YYYY-MM') AS mes,
           COUNT(*)::int AS citas,
           COUNT("creadoPorUsuarioId")::int AS con_creador,
           ROUND(100.0 * COUNT("creadoPorUsuarioId") / NULLIF(COUNT(*), 0), 1)::float AS pct
    FROM citas WHERE "deletedAt" IS NULL
    GROUP BY 1 ORDER BY 1`;

  // ── 2. Rescatables vía backfill desde AuditLog ─────────────────────────────
  out.backfill = await prisma.$queryRaw`
    SELECT COUNT(DISTINCT a."citaId")::int AS rescatables_desde_audit
    FROM audit_logs a
    JOIN citas c ON c.id = a."citaId"
    WHERE a.accion = 'crear' AND a.entidad = 'cita' AND a."usuarioId" IS NOT NULL
      AND c."deletedAt" IS NULL AND c."creadoPorUsuarioId" IS NULL`;

  // ── 3. Ventana temporal del AuditLog de citas ──────────────────────────────
  out.auditVentana = await prisma.$queryRaw`
    SELECT accion, COUNT(*)::int AS n, COUNT("usuarioId")::int AS con_usuario,
           MIN("creadoEn")::date::text AS desde, MAX("creadoEn")::date::text AS hasta
    FROM audit_logs WHERE entidad = 'cita'
      AND accion IN ('crear', 'mover', 'cambiar_estado', 'cancelar', 'auto_completar', 'cancelar_por_paciente')
    GROUP BY accion ORDER BY n DESC`;

  // ── 4. Usuarios por rol (para el backfill de área) ─────────────────────────
  out.usuariosPorRol = await prisma.$queryRaw`
    SELECT rol, COUNT(*)::int AS activos
    FROM usuarios WHERE "deletedAt" IS NULL AND activo = true
    GROUP BY rol ORDER BY activos DESC`;
  out.sedesPorUsuario = await prisma.$queryRaw`
    SELECT n_sedes, COUNT(*)::int AS usuarios FROM (
      SELECT u.id, COUNT(us."sedeId")::int AS n_sedes
      FROM usuarios u LEFT JOIN usuarios_sedes us ON us."usuarioId" = u.id
      WHERE u."deletedAt" IS NULL AND u.activo = true
      GROUP BY u.id
    ) t GROUP BY n_sedes ORDER BY n_sedes`;

  // ── 5. Insumos de KPIs: movimientos, check-in, precios ─────────────────────
  out.movimientos = await prisma.$queryRaw`
    SELECT COUNT(*)::int AS total_mover,
      COUNT(*) FILTER (WHERE LEFT(antes->>'fecha', 10) IS DISTINCT FROM LEFT(despues->>'fecha', 10))::int AS reprogramaciones_cambio_dia,
      COUNT(*) FILTER (WHERE LEFT(antes->>'fecha', 10) = LEFT(despues->>'fecha', 10))::int AS reacomodos_mismo_dia
    FROM audit_logs WHERE accion = 'mover' AND entidad = 'cita'`;
  out.checkin = await prisma.$queryRaw`
    SELECT COUNT(*)::int AS completadas,
      COUNT("llegoEn")::int AS con_llego_en,
      ROUND(100.0 * COUNT("llegoEn") / NULLIF(COUNT(*), 0), 1)::float AS pct_con_llego
    FROM citas WHERE estado = 'completada' AND "deletedAt" IS NULL`;
  out.precios = await prisma.$queryRaw`
    SELECT COUNT(*)::int AS servicios_activos, COUNT("precioReferencial")::int AS con_precio
    FROM servicios WHERE "deletedAt" IS NULL AND activo = true`;

  // ── 6. Volúmenes (dimensionar caché/índices) ───────────────────────────────
  out.volumenes = await prisma.$queryRaw`
    SELECT (SELECT COUNT(*)::int FROM citas) AS citas,
           (SELECT COUNT(*)::int FROM audit_logs) AS audit_logs,
           (SELECT COUNT(*)::int FROM pacientes) AS pacientes,
           (SELECT COUNT(*)::int FROM usuarios WHERE "deletedAt" IS NULL) AS usuarios`;

  console.log(JSON.stringify(out, (_k, v) => (typeof v === 'bigint' ? Number(v) : v), 2));
}

main().finally(() => prisma.$disconnect());
