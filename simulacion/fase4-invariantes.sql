-- ═══ FASE 4 — ORÁCULO DE INTEGRIDAD (invariantes I1–I10) ═══
-- Cada bloque reporta: nombre | esperado | real. Cualquier real != esperado es un bug.
\pset footer off

\echo '═══ I1 · 0 solapamientos de citas activas del mismo profesional ═══'
SELECT 'I1_solapamientos' AS invariante, 0 AS esperado, count(*) AS real
FROM citas a JOIN citas b
  ON a."profesionalId" = b."profesionalId" AND a.fecha = b.fecha AND a.id < b.id
  AND a."deletedAt" IS NULL AND b."deletedAt" IS NULL
  AND a.estado NOT IN ('cancelada','no_show','reprogramada')
  AND b.estado NOT IN ('cancelada','no_show','reprogramada')
  AND a."slotGrupoId" IS DISTINCT FROM b."slotGrupoId"  -- las 2 mitades de un bloque comparten hora legítimamente
  AND (a."horaInicio", (a."horaInicio"::time + (a."duracionMinutos"||' min')::interval))
      OVERLAPS
      (b."horaInicio", (b."horaInicio"::time + (b."duracionMinutos"||' min')::interval))
WHERE a."profesionalId" IS NOT NULL;

\echo '═══ I2 · 0 citas activas dentro de un bloqueo (permiso) del mismo profesional/día/rango ═══'
SELECT 'I2_citas_en_bloqueo' AS invariante, 0 AS esperado, count(*) AS real
FROM citas c
JOIN bloqueos_agenda b
  ON b."profesionalId" = c."profesionalId" AND b."deletedAt" IS NULL AND b.tipo = 'PERMISO'
  AND c.fecha >= date_trunc('day', b."fechaInicio") AND c.fecha <= date_trunc('day', b."fechaFin")
  AND b."horaInicio" IS NOT NULL AND b."horaFin" IS NOT NULL
  AND c."horaInicio" >= b."horaInicio" AND c."horaInicio" < b."horaFin"
WHERE c."deletedAt" IS NULL AND c.estado NOT IN ('cancelada','no_show','reprogramada');
-- NOTA: las citas que quedaron ENCIMA de una enfermedad ANTES del bloqueo se cuentan aquí
-- a propósito (documentar: el sistema NO reprograma automáticamente citas huérfanas).

\echo '═══ I3 · Bloques combinados: cada slotGrupoId con estado coherente (mismo estado o ambas canceladas) ═══'
SELECT 'I3_bloques_incoherentes' AS invariante, 0 AS esperado, count(*) AS real FROM (
  SELECT "slotGrupoId"
  FROM citas WHERE "slotGrupoId" IS NOT NULL AND "deletedAt" IS NULL
  GROUP BY "slotGrupoId"
  HAVING count(*) <> 2  -- todo grupo debe tener exactamente 2 citas
     OR count(DISTINCT (estado IN ('cancelada','no_show','reprogramada'))) > 1  -- o ambas vivas o ambas muertas
) x;

\echo '═══ I3b · Distribución de tamaños de grupo (debe ser todo =2) ═══'
SELECT count(*) AS citas_en_grupo, count(*) AS tam FROM citas WHERE "slotGrupoId" IS NOT NULL AND "deletedAt" IS NULL GROUP BY "slotGrupoId" HAVING count(*) <> 2;

\echo '═══ I4 · Paquetes: consumidas ≤ compradas, saldo derivado sin negativos ═══'
SELECT 'I4_saldos_negativos' AS invariante, 0 AS esperado, count(*) AS real FROM (
  SELECT pp.id, pp."sesionesTotal",
    (SELECT count(*) FROM consumos_sesion cs WHERE cs."paqueteId" = pp.id AND cs."deletedAt" IS NULL) AS consumidas
  FROM paquetes_paciente pp
) s WHERE consumidas > "sesionesTotal";

\echo '═══ I4b · Muestra de saldos (total − consumidas), ninguno < 0 ═══'
SELECT min("sesionesTotal" - consumidas) AS saldo_minimo, count(*) FILTER (WHERE "sesionesTotal" - consumidas < 0) AS negativos
FROM (SELECT pp."sesionesTotal", (SELECT count(*) FROM consumos_sesion cs WHERE cs."paqueteId"=pp.id AND cs."deletedAt" IS NULL) AS consumidas FROM paquetes_paciente pp) t;

\echo '═══ I5 · Toda cita tiene al menos su evento de creación en AuditLog ═══'
SELECT 'I5_citas_sin_audit_creacion' AS invariante, 0 AS esperado, count(*) AS real
FROM citas c
WHERE NOT EXISTS (SELECT 1 FROM audit_logs a WHERE a."entidadId"::text = c.id::text AND a.accion IN ('crear','crear_cita'));

\echo '═══ I5b · AuditLog: proporción de acciones (inmutabilidad = solo inserts, sin updated_at) ═══'
SELECT accion, count(*) FROM audit_logs GROUP BY accion ORDER BY 2 DESC LIMIT 15;

\echo '═══ I6 · 0 hard-deletes: pacientes/citas siguen existiendo (cancelación = estado, no DELETE) ═══'
SELECT 'I6_citas_totales_vs_vivas' AS nota, count(*) AS total_citas,
  count(*) FILTER (WHERE "deletedAt" IS NULL) AS no_borradas,
  count(*) FILTER (WHERE estado='cancelada') AS canceladas_por_estado
FROM citas;

\echo '═══ I8 · 0 fechas corridas por timezone: la fecha civil guardada = la fecha string ═══'
-- Todas las fechas @db.Date deben estar a medianoche UTC (sin corrimiento horario)
SELECT 'I8_fechas_no_medianoche_utc' AS invariante, 0 AS esperado,
  count(*) FILTER (WHERE fecha::time <> '00:00:00' AND (fecha AT TIME ZONE 'UTC')::time <> '00:00:00') AS real
FROM citas WHERE "deletedAt" IS NULL;

\echo '═══ I8b · Rango de fechas de citas (debe estar 2026-07-10 .. 2026-08-10, sin días corridos) ═══'
SELECT min(fecha)::date AS primera, max(fecha)::date AS ultima, count(DISTINCT fecha) AS dias_distintos FROM citas WHERE "deletedAt" IS NULL;

\echo '═══ I9 · 100% de pacientes con marca ZZTEST (limpieza inequívoca) ═══'
SELECT 'I9_pacientes_sin_zztest' AS invariante, 0 AS esperado,
  count(*) FILTER (WHERE "apellidoPaterno" NOT ILIKE 'zztest%') AS real, count(*) AS total_pacientes
FROM pacientes;

\echo '═══ Resumen de citas por estado ═══'
SELECT estado, count(*) FROM citas WHERE "deletedAt" IS NULL GROUP BY estado ORDER BY 2 DESC;

\echo '═══ Volumen total generado ═══'
SELECT 'pacientes' AS entidad, count(*) FROM pacientes
UNION ALL SELECT 'citas', count(*) FROM citas
UNION ALL SELECT 'citas_combinadas(grupos)', count(DISTINCT "slotGrupoId") FROM citas WHERE "slotGrupoId" IS NOT NULL
UNION ALL SELECT 'paquetes_vendidos', count(*) FROM paquetes_paciente
UNION ALL SELECT 'consumos', count(*) FROM consumos_sesion WHERE "deletedAt" IS NULL
UNION ALL SELECT 'audit_logs', count(*) FROM audit_logs
UNION ALL SELECT 'recordatorios', count(*) FROM recordatorios_cita
UNION ALL SELECT 'citas_con_promocion', count(*) FROM citas WHERE "promocionId" IS NOT NULL AND "deletedAt" IS NULL;
