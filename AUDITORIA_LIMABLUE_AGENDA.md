# Auditoría — Limablue Agenda

**Rol:** QA Lead + Arquitecto senior · **Fecha:** 2026-06-17 · **Método:** revisión de código (archivo:línea) + pruebas ejecutadas contra una **DB de prueba aislada** (`limablue_agenda_test`), nunca la real.

---

## 1. Resumen ejecutivo (semáforo)

| Módulo | Estado | Nota |
|---|---|---|
| Autenticación / roles | 🟢 | Login y control por rol OK; sesión revocada al instante al borrar/desactivar usuario (H2 corregido). |
| Citas / agendamiento | 🟢 | Anti-doble-booking (índice parcial) sólido: 200/200 bloqueó la 2ª reserva. |
| Confirmación por Mail | 🟢 | Tokens, idempotencia, concurrencia, cancelar→no-confirmar: 200/200 cada uno. |
| Permisos / Almuerzos | 🟢 | Bloqueo de reserva server-side verificado (sesión previa). |
| Horarios entrada/sábado | 🟢 | Reglas por sede correctas; el sistema rechaza slots fuera de jornada. |
| Pacientes / historial | 🟢 | Historial = consulta viva; totales exactos (groupBy). |
| Seed / portabilidad | 🟢 | **Seed estaba roto (regresión); corregido en esta auditoría.** |
| Movimientos (rotación) | 🟢 | Bugs M1/M2 (eliminar movimiento no cancelaba + dejaba huérfana) **CORREGIDOS y reprobados**. |

**Veredicto global: 🟢 con 1 pendiente de severidad MEDIA** (sesión tras borrado de usuario). 2000/2000 casos de prueba masiva pasaron.

---

## 2. Inventario de módulos auditados

- **Backend** (Express + Prisma): 22 routers / ~100 endpoints (`auth, users, roles, citas, disponibilidad, pacientes, profesionales, sedes, servicios, competencias, asignaciones, paquetes, audit, webhooks, horarios, analytics, exportar, movimientos, notificaciones, almuerzos, herramientas, permisos`). 7 servicios (`agregacion, almuerzoService, asignacionService, audit, disponibilidad, mailService, webhooks`). 3 middlewares (`auth, errorHandler, uploadComprobante`).
- **Prisma**: 27 modelos, 11 enums.
- **Frontend** (React+Vite): 14 páginas, 3 stores Zustand (`authStore, agendaStore, notificacionesStore`), 9 módulos API.
- **Entorno**: API real en :3002, web en :5180, ambos corriendo; `ts-node-dev --respawn` ⇒ código ejecutado = fuente actual. No es repo git.

---

## 3. Hallazgos por severidad

### 🟠 ALTO — H1. Seed roto por el índice parcial (REGRESIÓN) — **CORREGIDO**
- **Archivo:** `apps/api/prisma/seed.ts:32` (`crearCita`).
- **Descripción:** Al migrar el anti-doble-booking de `@@unique` a un índice único **parcial**, se quitó la clave compuesta `unique_slot_profesional` del schema, pero el seed seguía usándola en `findUnique({ where: { unique_slot_profesional: {...} } })`.
- **Reproducir:** `npm run db:seed` → `Unknown argument 'unique_slot_profesional'`. (Reproducido en esta auditoría al seedear la DB de prueba.)
- **Impacto:** No se podía reseedear ni levantar un entorno nuevo → bloquea onboarding/portabilidad y `db:reset`.
- **Fix aplicado:** reemplazo por `findFirst({ where: { profesionalId, fecha, horaInicio, deletedAt: null } })`. **Verificado:** el seed corre y crea 468 citas + personal real.

### 🟡 MEDIO — H2. La sesión JWT sobrevivía al borrado/desactivación del usuario — **CORREGIDO**
- **Archivo:** `apps/api/src/middleware/auth.ts` (`requireAuth`).
- **Descripción:** `requireAuth` validaba firma/expiración del JWT pero **no revalidaba** que el usuario siguiera `activo` y no eliminado. Un token vigente (exp 30 días) seguía autorizado tras desactivar la cuenta.
- **Fix aplicado:** en `requireAuth` (rama Bearer), tras `verifyToken`, se carga el usuario y se rechaza con `401 SESION_REVOCADA` si `deletedAt!=null || !activo`. Es una lectura por PK por request (costo bajo para el volumen del sistema), aprobada por el usuario.
- **Re-prueba (ejecutada):** usuario temporal → login (token OK, `/auth/me`=200) → desactivado en DB → **mismo token = 401 al instante** → usuario eliminado. La sesión muere de inmediato. ✅

### 🔴 ALTO — M1. Eliminar un movimiento futuro NO lo cancelaba (seguía surtiendo efecto en la agenda) — **CORREGIDO**
- **Archivos:** `routes/movimientos.ts:236-239` (DELETE pone `activa:false`) vs `routes/profesionales.ts` GET (la lista de la agenda filtra asignaciones **solo por rango de fechas**, sin `activa`).
- **Descripción:** El DELETE de un movimiento solo marca `activa=false`. Pero la agenda lista profesionales por `fechaInicio<=fecha AND (fechaFin null OR >=fecha)`, **ignorando `activa`**. Resultado: un movimiento "eliminado" con fechas futuras **igual mueve a la profesional** en la agenda cuando llega la fecha.
- **Reproducir (ejecutado):** crear movimiento futuro (Nelly Noteno → Los Olivos, +30d a +60d) → DELETE → consultar agenda de Los Olivos en +45d → **la podóloga aparece igual** (`activa=false` ignorado). Evidencia: test T4 de esta auditoría.
- **Impacto:** ALTO. Una coordinadora cancela una rotación y el sistema igual la ejecuta → profesional en la sede equivocada.

### 🟠 ALTO — M2. Eliminar un movimiento dejaba la asignación anterior HUÉRFANA — **CORREGIDO**
- **Archivos:** `services/asignacionService.ts:86-93` (al crear, cierra la asignación previa con `activa:false`) + `routes/movimientos.ts:236-239` (al eliminar, no la restaura).
- **Descripción:** Crear un movimiento cierra la asignación previa (`activa=false`, `fechaFin=inicio-1`). Eliminar el movimiento **no la reabre** → la profesional queda **sin asignación activa** tras la fecha del movimiento.
- **Reproducir (ejecutado):** test T3 — tras DELETE, la asignación previa quedó `activa=false` (huérfana).
- **Impacto:** ALTO/MEDIO. Inconsistencia de datos; la profesional "desaparece" de su sede en las herramientas que sí filtran `activa` (horarios de entrada, almuerzos, permisos).
- **Raíz común M1+M2:** el sistema usa **dos definiciones de "asignación activa"** (bandera `activa` vs rango de fechas).
- **Fix aplicado (contenido al DELETE, sin tocar agenda ni `crearMovimiento` → mínimo riesgo):** en `routes/movimientos.ts` el DELETE ahora, en una transacción: (1) **restaura la asignación previa** que el movimiento cerró (la reabre `activa=true`, `fechaFin=null`), (2) **elimina la fila del movimiento** (así desaparece de la agenda, que usa rango de fechas; no hay FK de Cita→AsignacionSede), y (3) registra `MOVIMIENTO_ELIMINADO` en `AuditLog`.
- **Re-prueba (ejecutada):** crear movimiento futuro → eliminar → respuesta `{ok:true, predecesorRestaurado:true}`; el movimiento ya **no aparece** en la sede destino y la profesional **vuelve** a su sede origen. Además 2000/2000 de la suite masiva siguen pasando (sin regresión).
- **Afinado (exactitud total):** el movimiento ahora guarda `cierraAsignacionId` + `cierraFechaFin` (campos nuevos en `AsignacionSede`), así el DELETE **restaura la asignación previa a su estado EXACTO** (incluida su fecha de fin original, no asumida indefinida). Verificado con movimientos encadenados: predecesor temporal (fin +60) restaurado exacto a +60. Movimientos antiguos sin esos campos usan el fallback heurístico (restaura indefinida).

### 🔵 BAJO — H3. Fallbacks a `localhost` si faltan variables de entorno
- **Archivos:** `apps/api/src/services/mailService.ts` (`API_BASE_URL || 'http://localhost:3002'`), `apps/api/src/routes/herramientas.ts` (`APP_BASE_URL || 'http://localhost:5180'`).
- **Descripción:** El código **lee primero el entorno** (correcto y portable), pero si en producción faltara la variable, los enlaces del correo apuntarían a `localhost`.
- **Impacto:** bajo (mitigado por `.env.example` documentado).
- **Fix propuesto:** check de arranque que falle si `NODE_ENV=production` y faltan `API_BASE_URL`/`APP_BASE_URL`. No aplicado (opcional).

### ✅ Verificaciones que PASARON (sin hallazgo)
- **refreshToken nunca se expone:** `routes/herramientas.ts` `configPublica()` devuelve solo `{fromEmail, fromName, provider, isActive, connected, actualizadoEn}`. El refresh token no viaja al frontend.
- **Anti-doble-booking:** índice único parcial `citas_slot_activo_unique` + lock Redis. 200/200 bloquearon la 2ª reserva del mismo slot.
- **Cita cancelada no se puede confirmar** (`citas.ts:255`): página "Esta cita fue cancelada", sin cambio de estado.
- **Tokens** inválidos/expirados/manipulados/de otra cita/firma distinta: 200/200 rechazados, **cero confirmaciones indebidas**.
- **Idempotencia y concurrencia:** confirmar 2× y 5 confirmaciones simultáneas → 200/200 sin corrupción ni 500.
- **Filtro anti-rebote de correos** (`mailService.ts esEmailEnviable`): 200/200 clasificación correcta (omite acentos, dominios de prueba, formato inválido).
- **Control de acceso:** recepcionista → `GET/PUT /herramientas/mail-config` → **403** en 200/200.
- **Gmail no conectado:** la cita se crea igual (envío es fire-and-forget) → 200/200.

---

## 4. Resultados de pruebas masivas (200 casos × escenario)

DB aislada `limablue_agenda_test`, API en :3099. Gmail mockeado por diseño (sin cuenta conectada → no envía). Runner: `apps/api/scripts/audit-runner.ts`.

| # | Escenario | Ejecutados | Pasados | Fallidos | % |
|---|---|---|---|---|---|
| S1 | Agendamiento feliz (crear cita) | 200 | 200 | 0 | 100% |
| S2 | Confirmación por token (enlace paciente) | 200 | 200 | 0 | 100% |
| S3 | Cancelación por token | 200 | 200 | 0 | 100% |
| S4 | Doble reserva mismo slot (debe bloquear) | 200 | 200 | 0 | 100% |
| S5 | Tokens inválidos/expirados/manipulados | 200 | 200 | 0 | 100% |
| S6 | Idempotencia (confirmar 2×, cancelar tras confirmar) | 200 | 200 | 0 | 100% |
| S7 | Filtro de email enviable (datos sucios) | 200 | 200 | 0 | 100% |
| S8 | Control de acceso (recepcionista ✗ MailConfig) | 200 | 200 | 0 | 100% |
| S9 | Concurrencia (5 confirmaciones simultáneas) | 200 | 200 | 0 | 100% |
| S10 | Gmail no conectado → cita igual se crea | 200 | 200 | 0 | 100% |
| | **TOTAL** | **2000** | **2000** | **0** | **100%** |

> Nota honesta: en una corrida intermedia S4 dio 90% por un **artefacto del test** (eligió slots de sábado fuera de jornada → `SLOT_FUERA_HORARIO`, que es el comportamiento **correcto** del sistema). Tras corregir el harness (solo Lun-Vie, horas dentro de jornada), S4 = 200/200. No era un defecto del sistema.

---

## 5. Trazabilidad y secuencia de hechos

- **Ciclo verificado:** crear (`creadoEn`, `estadoConfirmacion=pendiente`) → confirmar por enlace (`confirmadaEn`, `estadoConfirmacion=confirmada`, `estado=confirmada`). En S2 se validó `confirmadaEn >= creadoEn` en 200/200 (ningún timestamp fuera de orden).
- **No se puede:** confirmar una cita cancelada (queda cancelada), cancelar/confirmar con token inválido (sin cambio de estado), reservar sobre permiso/almuerzo (`SLOT_BLOQUEADO`, sesión previa).
- **Auditoría:** crear/mover/cancelar citas escriben en `AuditLog` (`services/audit.ts`); el borrado de permisos/almuerzos también. Origen del cambio distinguible (automático vs manual vs enlace público vía `cambiadoPor`).

---

## 6. Riesgos de portabilidad a producción

1. **Variables de entorno** (mitigado): `API_BASE_URL, APP_BASE_URL, GOOGLE_REDIRECT_URI, DATABASE_URL, JWT_SECRET, CONFIRM_TOKEN_SECRET` se leen de `.env`; enlaces del correo derivados de env. Riesgo solo si faltan (ver H3).
- 2. **Índice parcial fuera del schema:** `citas_slot_activo_unique` se crea por SQL crudo (idempotente en `seed.ts`). En producción debe garantizarse vía migración/seed (no lo recrea `prisma migrate` automáticamente).
3. **OAuth en modo producción** (ya hecho): la app de Google se publicó; el refresh token no caduca a 7 días.
4. **db push vs migrate:** el proyecto usa `db push` en dev; para producción documentar `migrate deploy` + creación del índice parcial.

---

## 7. Verificación final — qué se probó y qué NO (zonas ciegas)

**Probado (con evidencia ejecutada, 200×):** agendamiento, confirmación/cancelación por token, doble-booking, tokens inválidos, idempotencia, concurrencia, filtro de correos, control de acceso a MailConfig, degradación sin Gmail.

**Probado manualmente en trabajo previo (no en esta corrida masiva):** reprogramación (`mover`), bloqueo por permiso/almuerzo (`SLOT_BLOQUEADO`), regla servicios 1h en hora entera, salida de sábado por sede, Daniel Doy cross-unidad sin doble-booking.

**Analizado en profundidad (esta auditoría):** módulo **Movimientos / rotación** — flujo de creación, bloqueo por citas pendientes (T1 ✓), cierre de asignación previa (T2 ✓), y **eliminación (T3/T4 → 2 bugs ALTOS: M1, M2)**. Pruebas T1-T4 ejecutadas contra DB de prueba.

**NO cubierto (zonas ciegas declaradas):**
- **Cambio de remitente en caliente** (Gmail prueba → @limablue) a mitad de lote.
- **IDOR por sede** exhaustivo (¿recepcionista de sede A modifica datos de sede B?). Solo se probó el gate de rol a MailConfig.
- **Zonas horarias/bordes** (medianoche, fin de mes) de forma sistemática.
- **Analytics/Exportar/Webhooks** y **carga de comprobantes**.
- Frontend: no se probó UI automatizada (solo verificación visual previa).
