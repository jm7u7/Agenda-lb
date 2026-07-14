# REPORTE — FIX M-1: Deadlocks en `POST /citas`

**Fecha:** 2026-07-10 · Entorno de verificación: `limablue_agenda_simulacion` (aislado, Gate 0).

## Causa raíz (confirmada en código, no asumida)
El deadlock NO era por orden Cita↔AuditLog (ese orden ya es único y consistente). Era por
**FK locks `FOR KEY SHARE`** que cada `INSERT` de cita toma sobre sus filas padre (profesional,
sede, servicio, promoción, paciente…). Bajo concurrencia, dos transacciones de **slots distintos**
que comparten filas padre adquieren esos locks en orden que PostgreSQL decide fila por fila → ciclo
`40P01` (Prisma `P2034`). El lock Redis NO lo previene (protege por slot, no por fila padre). Además
el `errorHandler` global NO mapeaba `P2034` → un deadlock residual habría llegado como **500**.

## Fix aplicado (solo `POST /citas`, por decisión del usuario)
1. **`apps/api/src/utils/dbRetry.ts`** (nuevo) — helper `withDeadlockRetry`: 3 intentos, backoff
   50/150/400ms con jitter ±20%, SOLO sobre `P2034`/`40P01`/`40001`; nunca sobre AppError de negocio
   ni `P2002`. `console.warn` estructurado por reintento (nivel warn, no error).
2. **`apps/api/src/routes/citas.ts`** — la `prisma.$transaction` del create simple ahora:
   - corre bajo `isolationLevel: Serializable` (igual que `/citas/combinada`),
   - envuelta en `withDeadlockRetry` DENTRO del `try/finally` (el lock Redis se sostiene entre
     reintentos y se libera una sola vez al final — nunca huérfano),
   - con `catch P2002/P2034 → 409 SLOT_OCUPADO` (cierra el hueco del 500).
3. NO se tocó `/citas/combinada` (referencia), ni schema, ni B-1/B-2.

## Verificación
| Check | Resultado |
|---|---|
| Helper `withDeadlockRetry` (test unitario determinista) | **8/8** — reintenta P2034, NO reintenta negocio/P2002, agota y relanza, clasifica 40P01/40001 |
| **F1** slot dorado (20 ops × 40 rondas, fechas frescas) | **exactamente 1 ganador/ronda, 760 rechazos limpios, 0×500, 0 duplicados** |
| **F2** doble-booking en BD (oráculo) | **0** — el índice único sigue siendo la última defensa |
| **F3** slot genuinamente ocupado | **409 al PRIMER intento, 0 reintentos** (no añade latencia a conflictos de negocio) |
| **F4** latencia happy path | p50 30ms · **p95 41ms** · p99 41ms — sin regresión (retry = 0 overhead cuando la tx gana al primer intento) |
| **F5** locks Redis huérfanos | **0** |
| Tests del proyecto | **36/36** en verde |

## Limitación honesta
No se pudo forzar un deadlock `40P01` EN VIVO con el fix puesto: (a) el slot dorado está
Redis-serializado (solo 1 op entra a la tx); (b) la inyección con `FOR UPDATE` produce bloqueo-y-espera,
no un ciclo de locks; (c) el deadlock original era una carrera rara (3 en 1,843 = 0.16%). El
**mecanismo** de retry queda probado por el test unitario determinista, y el **hueco del 500** queda
cerrado por el `catch P2034 → 409`. Consistente con que Serializable+retry reduce la ocurrencia.

## Nota de despliegue
Cambio de lógica transaccional puro — **no requiere migración de schema**. Listo para `git`/deploy normal.
