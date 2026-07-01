# Fixes aplicados — Auditoría Limablue Agenda (2026-06-17)

Solo se aplicaron **fixes seguros** (localizados, reversibles, sin cambio de esquema destructivo ni de contrato de API). Los riesgosos quedan **pendientes de aprobación** (sección final).

---

## ✅ FIX-1 (H1, ALTO) — Seed roto por el índice único parcial

- **Archivo:** `apps/api/prisma/seed.ts` · función `crearCita`.
- **Por qué:** al cambiar el anti-doble-booking de `@@unique([profesionalId,fecha,horaInicio])` a un índice único **parcial** (creado por SQL), se quitó la clave compuesta del schema, pero el seed seguía usándola → `db:seed`/`db:reset` lanzaba `Unknown argument 'unique_slot_profesional'`.
- **Antes:**
  ```ts
  const existente = await prisma.cita.findUnique({
    where: { unique_slot_profesional: { profesionalId, fecha, horaInicio } },
  });
  ```
- **Después:**
  ```ts
  const existente = await prisma.cita.findFirst({
    where: { profesionalId, fecha, horaInicio, deletedAt: null },
  });
  ```
- **Seguro porque:** solo afecta al script de seed (no API, no esquema, no datos en runtime); `findFirst` es funcionalmente equivalente al chequeo anterior.
- **Re-prueba:** `DATABASE_URL=…_test npx ts-node prisma/seed.ts` → **OK**, crea 468 citas + personal real (antes fallaba). No se ejecutó contra la DB real (regla: no reseedear producción).

---

## 🧪 Instrumentación de pruebas añadida (no es un fix, es soporte de auditoría)

- **`apps/api/scripts/audit-runner.ts`** — runner masivo (200 casos × 10 escenarios) contra DB aislada, con reset al inicio. Reutilizable.
- **DB de prueba aislada `limablue_agenda_test`** + 2ª instancia API en `:3099`. La DB real (`limablue_agenda`, :3002) **no se tocó**.

---

## ✅ FIX-2 (H2, MEDIO) — Sesión revocada al instante al borrar/desactivar usuario — **APLICADO (aprobado por el usuario)**
- **Archivo:** `apps/api/src/middleware/auth.ts` (`requireAuth`, rama Bearer).
- **Antes:** validaba el JWT pero no revalidaba al usuario → token vivo seguía autorizado tras desactivar la cuenta.
- **Después:** tras `verifyToken`, carga `prisma.usuario.findUnique({id})` y lanza `401 SESION_REVOCADA` si `deletedAt!=null || !activo`.
- **Seguro porque:** cambio localizado en el middleware; una lectura por PK por request (costo bajo); no cambia el contrato de API.
- **Re-prueba (ejecutada):** usuario temporal → token 200 → desactivado → mismo token **401 al instante** → eliminado. ✅

---

## ✅ FIX-3 (M1+M2, ALTO) — Eliminar un movimiento ahora lo cancela de verdad y restaura la sede — **APLICADO (aprobado por el usuario)**
- **Archivo:** `apps/api/src/routes/movimientos.ts` (DELETE `/:id`).
- **Problema:** el DELETE solo ponía `activa=false`, pero la agenda lista por rango de fechas e **ignora `activa`** → el movimiento "eliminado" igual surtía efecto (M1); y la asignación previa cerrada al crear el movimiento **no se reabría** → profesional huérfana (M2).
- **Fix:** el DELETE ahora corre en transacción: (1) **restaura** la asignación previa que el movimiento cerró (la halla por `fechaFin = fechaInicio-1` del movimiento; la reabre `activa=true`, `fechaFin=null`), (2) **elimina la fila** del movimiento (desaparece de la agenda; no hay FK de Cita→AsignacionSede), (3) registra `MOVIMIENTO_ELIMINADO` en `AuditLog`.
- **Seguro porque:** contenido al endpoint DELETE; **no toca** la query de la agenda ni `crearMovimiento` (cero riesgo de regresión en cómo se muestran asignaciones vigentes). Solo afecta movimientos que aún no han comenzado (guard `YA_INICIADO` intacto).
- **Re-prueba (ejecutada):** crear movimiento futuro → eliminar → `{ok:true, predecesorRestaurado:true}`; ya no aparece en la sede destino, la profesional vuelve a su sede origen, y **2000/2000 de la suite masiva siguen pasando** (sin regresión).

## ✅ FIX-4 (afinamiento de FIX-3) — Restauración EXACTA del predecesor — **APLICADO (aprobado por el usuario)**
- **Archivos:** `prisma/schema.prisma` (AsignacionSede: + `cierraAsignacionId String? @db.Uuid`, + `cierraFechaFin DateTime? @db.Date`), `services/asignacionService.ts` (`crearMovimiento` los guarda), `routes/movimientos.ts` (DELETE los usa).
- **Por qué:** FIX-3 restauraba la asignación previa como indefinida; si la previa era temporal (con `fechaFin` propio) se perdía esa fecha.
- **Después:** al crear un movimiento se guarda qué asignación cerró y su `fechaFin` original; al eliminarlo se restaura **exacta** (incluida su fecha de fin). Fallback heurístico para movimientos antiguos sin esos campos.
- **Seguro porque:** campos **nuevos nullable** (cambio de esquema aditivo, no destructivo; aplicado con `db push` en real y prueba); lógica contenida a movimientos.
- **Re-prueba (ejecutada):** movimientos encadenados (M1 temporal hasta +60 → M2 lo cierra → DELETE M2) → **M1 restaurada exacta a +60** (no indefinida). 2000/2000 suite sin regresión.

---

## ⏳ Pendientes de aprobación (NO aplicados)

### H3 (BAJO) — Fallar al arrancar si faltan URLs base en producción
Añadir en el bootstrap: si `NODE_ENV=production` y falta `API_BASE_URL`/`APP_BASE_URL`, abortar con error claro (evita que los enlaces del correo caigan en `localhost`).
**Por qué no lo apliqué solo:** cambia el comportamiento de arranque; conviene confirmar que en tu despliegue esas variables siempre están.

---

## Cómo reproducir la auditoría

```bash
# 1) DB de prueba + seed (idempotente)
cd apps/api
DATABASE_URL="postgresql://limablue:limablue123@localhost:5432/limablue_agenda_test" npx prisma db push --skip-generate
DATABASE_URL="postgresql://limablue:limablue123@localhost:5432/limablue_agenda_test" npx ts-node --transpile-only prisma/seed.ts

# 2) API contra la DB de prueba (puerto aparte)
DATABASE_URL="postgresql://limablue:limablue123@localhost:5432/limablue_agenda_test" PORT=3099 \
  CONFIRM_TOKEN_SECRET="limablue-confirm-secreto-dev-2025" npx ts-node-dev --transpile-only src/index.ts

# 3) Runner (200 casos por escenario)
DATABASE_URL="postgresql://limablue:limablue123@localhost:5432/limablue_agenda_test" \
  API_URL="http://localhost:3099" CONFIRM_TOKEN_SECRET="limablue-confirm-secreto-dev-2025" \
  N=200 npx ts-node --transpile-only scripts/audit-runner.ts
```
