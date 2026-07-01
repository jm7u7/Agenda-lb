# Auditoría de Producción — Limablue Agenda
**Fecha:** 2026-06-12  
**Auditor:** Claude Sonnet 4.6  
**Alcance:** apps/api, apps/web, packages/shared, schema Prisma completo

---

## 1. Inventario de Funcionalidad

### 1.1 Agenda Principal (`AgendaPage.tsx`)

| Acción | Endpoint(s) | Reglas de negocio |
|--------|------------|-------------------|
| Cambiar sede (botones) | — (state local) | Filtra profesionales y citas por sede |
| Cambiar unidad de negocio (tabs) | — (state local) | Filtra por unidadNegocioId |
| "DNI / Documento" → ModalBuscador | `GET /pacientes/buscar` | — |
| "Buscar nombre" → ModalBuscador | `GET /pacientes/buscar` | — |
| "+ Nueva cita" → DrawerNuevaCita | — (state local) | — |
| Navegación de fecha (‹ ›, Hoy, Mañana, Sábado, 1 sem) | — (state local) | — |
| Click en slot vacío → DrawerNuevaCita | — (state local) | Pre-llena hora y profesional |
| Click en TarjetaCita → PopoverCita | — (state local) | — |
| Drag & Drop TarjetaCita | `PATCH /citas/:id/mover` | Anti doble-booking, immutabilidad, origenAsignacion |
| Auto-completar citas (cada 60s, llego ≥90min) | `PATCH /citas/:id/estado` | Silencioso, incrementa sesiones |
| Refetch automático de citas (cada 60s) | `GET /citas` | — |
| Socket.io (eventos en tiempo real) | WS room `sede:{sedeId}` | Invalida React Query |

**Atajos de teclado (`CommandPalette.tsx`):**  
`Ctrl/Cmd+K` → abrir/cerrar · `?` → abrir · `Escape` → cerrar · `N` → nueva cita · `T` → ir a hoy · `1`–`5` → cambiar sede · `↑↓ Enter` → navegar resultados

### 1.2 Drawer Nueva Cita (`DrawerNuevaCita.tsx`)

| Acción | Endpoint(s) | Reglas de negocio |
|--------|------------|-------------------|
| Toggle paciente existente / nuevo | — | — |
| Buscar paciente (DNI / nombre) | `GET /pacientes/buscar` | — |
| Crear paciente nuevo | `POST /pacientes` | Duplicado de documento en backend |
| Seleccionar servicio | — (lista local) | Filtra por unidadNegocioId |
| Seleccionar profesional | — (lista local) | Condicionado por modoReserva |
| Seleccionar fecha | — | — |
| Seleccionar hora (select 30 min) | — | 08:00–20:00 |
| "Agendar cita" | `POST /citas` | Anti doble-booking, competencia, modoReserva, origenAsignacion |

### 1.3 Popover de Cita (`PopoverCita.tsx`)

| Acción | Endpoint(s) | Reglas de negocio |
|--------|------------|-------------------|
| "✓ Llegó" | `PATCH /citas/:id/estado` → `llego` | Solo si agendada/confirmada |
| "✗ No vino" | `PATCH /citas/:id/estado` → `no_show` | Solo si agendada/confirmada |
| "▶ En atención" | `PATCH /citas/:id/estado` → `en_atencion` | Solo si llego |
| "✓ Completar atención" | `PATCH /citas/:id/estado` → `completada` | Solo si en_atencion; incrementa sesiones |
| Cancelar cita | `PATCH /citas/:id/estado` → `cancelada` | No si estado final |
| Guardar comentario | `PATCH /citas/:id/estado` | Mantiene estado actual |
| Selector consultorio (C1…Cn) | `PATCH /citas/:id/consultorio` | Número según sede (mapa hardcodeado) |
| Panel reprogramar (7 días + profesional + slot) | `PATCH /citas/:id/mover` | Anti doble-booking |

### 1.4 Modal Buscador (`ModalBuscador.tsx`)

| Acción | Endpoint(s) | Reglas de negocio |
|--------|------------|-------------------|
| Buscar por documento | `GET /pacientes/buscar` | — |
| Buscar por nombre | `GET /pacientes/buscar` | — |
| Click "Llegó" en próxima cita | `PATCH /citas/:id/estado` → `llego` | — |
| Click "En atención" | `PATCH /citas/:id/estado` → `en_atencion` | — |
| Editar fecha/hora/profesional → "Mover" | `PATCH /citas/:id/mover` | origenAsignacion correcto |

### 1.5 Panel Admin — 5 sub-secciones (`AdminPage.tsx`)

| Sub-sección | Acciones | Endpoints | Auditoría |
|-------------|---------|-----------|-----------|
| Competencias | Toggle por celda, bulk add/remove | `GET/POST /competencias/toggle` | ❌ No auditado |
| Paquetes | Crear, editar, eliminar (soft-delete) | `GET/POST/PATCH/DELETE /paquetes` | ❌ No auditado |
| Rotación de sedes | Ver asignaciones, crear nueva asignación | `GET/POST /asignaciones` | ❌ No auditado |
| Servicios | Solo lectura (no CRUD de UI) | `GET /servicios` | N/A |
| Auditoría | Filtrar y ver AuditLog | `GET /audit` | N/A (read-only) |

### 1.6 Ficha de Paciente (`PacientesPage.tsx → FichaPacientePage`)

| Acción | Endpoint(s) | Reglas de negocio |
|--------|------------|-------------------|
| Editar notas | `PATCH /pacientes/:id` | No auditado |
| Ver historial / próximas citas | `GET /pacientes/:id` | Intersedes |
| Ver progreso de paquete | `GET /paquetes/paciente/:id` | — |
| "+ Agendar cita" | navega a `/` + evento `agenda:nueva-cita` | — |

### 1.7 Analytics (`AnalyticsPage.tsx`)

| Acción | Endpoint(s) | Reglas de negocio |
|--------|------------|-------------------|
| Filtro por período (presets + fechas libres) | Todos los GET /analytics/* | — |
| Filtro por unidad de negocio | Todos los GET /analytics/* | — |
| KPI cards | `GET /analytics/kpis` | Role check: solo frontend |
| Gráfico tendencia + granularidad | `GET /analytics/tendencia` | — |
| Ranking profesionales | `GET /analytics/profesionales` | — |
| Caseload propio | `GET /analytics/caseload` | — |
| No-show rankings | `GET /analytics/noshow` | — |
| Servicios demandados | `GET /analytics/servicios` | — |
| Comparativa de sedes | `GET /analytics/sedes` | — |
| Heatmap día × hora | `GET /analytics/heatmap` | — |
| Exportar Excel (global + por sección) | — (XLSX local) | — |

---

## 2. Verificación de Reglas de Negocio Transversales

### 2.1 Anti Doble-Booking (Redis lock + DB constraint)

| Punto de entrada | Redis lock | DB constraint | Resultado |
|-----------------|-----------|--------------|-----------|
| `POST /citas` | ✅ Sí | ✅ `@@unique([profesionalId, fecha, horaInicio])` | OK |
| `PATCH /citas/:id/mover` | ✅ Sí | ✅ Misma constraint | OK |
| Drag & Drop (frontend → mover) | ✅ Vía mover | ✅ | OK |
| Reprogramar en PopoverCita | ✅ Vía mover | ✅ | OK |
| Auto-selección en `seleccionarProfesionalOptimo` | ⚠️ Redis lock externo | ⚠️ Query solo checa `horaInicio = horaInicio` (exacto), no overlap de duraciones | **CRÍTICO** |
| Citas con `profesionalId = null` (Baropodometría sin profesional asignado) | ⚠️ Lock con clave `…:null:…` (funciona en Redis) | ❌ PostgreSQL `NULL != NULL` en unique index, no previene duplicados | **ALTO** |

### 2.2 Validación de Competencia Profesional↔Servicio

| Punto de entrada | Validado | Notas |
|-----------------|---------|-------|
| `POST /citas` | ✅ Línea 169 | OK |
| `calcularDisponibilidad` (GET /disponibilidad) | ✅ Línea 78 | OK |
| `seleccionarProfesionalOptimo` | ✅ Filtro en Prisma query | OK |
| `PATCH /citas/:id/mover` | ❌ **No se valida** | **CRÍTICO**: drag a profesional sin competencia es aceptado |
| Frontend drag (AgendaPage) | ❌ No valida | Depende del backend que no valida |
| Frontend reprogramar (PopoverCita) | ❌ No valida en UI | Depende del backend |

### 2.3 Restricción Unidad de Negocio por Sede

| Punto de entrada | Validado | Notas |
|-----------------|---------|-------|
| `POST /citas` | ✅ Líneas 116–119 `SedeUnidadNegocio` check | OK |
| `GET /disponibilidad` | ✅ Mismo check en servicio | OK |
| `POST /asignaciones` (Fisioterapia → Paz Soldán) | ✅ Hardcoded nombre de sede | ⚠️ Frágil si se renombra |
| `PATCH /citas/:id/mover` | ❌ **No re-valida** que el profesional siga en esa sede | **ALTO** |
| `GET /profesionales` con sedeId+fecha | ✅ Filtra por AsignacionSede con date-range | OK |

### 2.4 Modo de Reserva por Unidad de Negocio

| Punto de entrada | sin_eleccion | preferencia_opcional | preferencia_obligatoria |
|-----------------|-------------|---------------------|------------------------|
| `POST /citas` backend | ✅ Fuerza auto-assign | ✅ Auto si no hay pref | ✅ Requiere profesionalId |
| `DrawerNuevaCita` frontend | ✅ Oculta selector | ✅ Selector opcional | ✅ Selector requerido (*) |
| `PATCH /citas/:id/mover` | ❌ **No re-valida** | ❌ No re-valida | ❌ No re-valida |
| PopoverCita reprogramar | ❌ Sin validación de modo | ❌ Sin validación de modo | ❌ Sin validación de modo |

### 2.5 origenAsignacion

| Punto de entrada | Correcto | Notas |
|-----------------|---------|-------|
| `POST /citas` — sin preferencia | ✅ `asignada_automaticamente` | OK |
| `POST /citas` — con preferencia | ✅ `elegida_por_paciente` | OK |
| `POST /citas` — sin_eleccion / Baro | ✅ `asignada_automaticamente` | OK |
| `AgendaPage` drag (moverMutation) | ❌ **Hardcodeado `elegida_por_paciente` siempre** | **ALTO**: infla métricas de "citas propias" |
| `ModalBuscador` mover | ✅ Correcto: depende de si se seleccionó profesional | OK |
| `PopoverCita` reprogramar | ⚠️ No envía `origenAsignacion`, deja valor previo | Aceptable pero impreciso |

### 2.6 Transiciones de Estado Válidas

**Flujo esperado:** `agendada → confirmada → llego → en_atencion → completada | no_show | cancelada`

| Regla | Backend | Frontend | Resultado |
|-------|---------|---------|-----------|
| No retroceeder desde estado final | ✅ `ESTADOS_FINALES` guard | ✅ `esFinal` oculta botones | OK |
| No retroceder de `en_atencion → agendada` | ❌ **No validado** | ✅ PopoverCita no ofrece botón | **ALTO** (API acepta cualquier no-final→no-final) |
| No saltar de `agendada → completada` | ❌ **No validado** | ✅ PopoverCita no ofrece botón | **MEDIO** (API lo permite) |
| `reprogramada` solo vía `/mover` | ❌ `/estado` acepta `reprogramada` directamente | — | **MEDIO** |
| Auto-completar en AgendaPage: `llego → completada` (salta `en_atencion`) | — | ❌ Sí lo hace, silenciosamente | **MEDIO** |

### 2.7 Inmutabilidad de Citas Finales

| Punto de entrada | completada | no_show | cancelada |
|-----------------|-----------|---------|----------|
| `PATCH /mover` | ✅ Bloqueado | ✅ Bloqueado | ✅ Bloqueado |
| `PATCH /estado` | ✅ Bloqueado | ✅ Bloqueado | ✅ Bloqueado |
| `DELETE /citas/:id` | ✅ Bloqueado | ✅ Bloqueado | ✅ Bloqueado |
| Drag desde TarjetaCita | ✅ Completada deshabilitada | ❌ **no_show es arrastrable** (backend rechaza, pero UX confusa) | ✅ Cancelada deshabilitada |
| `PATCH /citas/:id/consultorio` | ❌ **Sin protección** — permite cambiar consultorio de cita final | ❌ | ❌ | **BAJO** |

### 2.8 Consumo de Sesiones de Paquete

| Regla | Estado |
|-------|-------|
| Incrementa solo al `completada` | ✅ Línea 277–282 citas.ts |
| Incrementa solo una vez (idempotencia) | ⚠️ **Sin guard de idempotencia**: si estado ya es `completada` y se re-llama (race condition) puede duplicar. En flujo normal no ocurre por el guard de ESTADOS_FINALES. |
| `consumeNoShow = true` debería incrementar al `no_show` | ❌ **Campo ignorado completamente en la API** — guardado en DB pero nunca leído |
| `no_show` NO incrementa (cuando consumeNoShow = false) | ✅ Correcto por omisión |
| Auto-complete (llego→completada silencioso) puede incrementar sin confirmación profesional | ❌ **Sí lo hace** — riesgo de sesión quemada sin atención real |

### 2.9 AuditLog — Cobertura

| Operación | Auditado |
|-----------|---------|
| Crear cita | ✅ |
| Cambiar estado de cita | ✅ |
| Mover/reprogramar cita | ✅ |
| Cancelar/eliminar cita | ✅ |
| Toggle competencia | ❌ |
| Crear asignación de sede | ❌ |
| Crear/editar/eliminar paquete | ❌ |
| Asignar paquete a paciente | ❌ |
| Crear bloqueo de agenda | ❌ |
| Cambiar horario de sede | ❌ |
| Editar datos de paciente | ❌ |
| Cambiar consultorio de cita | ❌ |
| Crear/editar servicio | ❌ |
| Login de usuario | ❌ |

### 2.10 Soft-Delete

| Entidad | Tiene deletedAt | Endpoints usan filter | Hard delete presente |
|---------|----------------|----------------------|---------------------|
| Cita | ✅ | ✅ | ❌ (cancela via deletedAt) |
| Paciente | ✅ | ✅ | ❌ (no hay endpoint DELETE) |
| Profesional | ✅ | ✅ (activo flag) | ❌ |
| Servicio | ✅ | ✅ (activo flag) | ❌ |
| Sede | ✅ | ✅ | ❌ |
| Paquete/PaquetePaciente | ✅ | ✅ | ❌ |
| WebhookSubscription | ✅ | ✅ | ❌ |
| ExcepcionHorario | ❌ No tiene deletedAt | N/A | ✅ **Hard delete** en `DELETE /horarios/:sedeId/excepciones/:fecha` |
| CompetenciaProfesional | ❌ (usa `activa` bool) | ✅ filtra activa | ❌ |
| AsignacionSede | ❌ (usa `activa` bool) | ✅ | ❌ |

### 2.11 AsignacionSede y date-awareness

| Punto de entrada | Date-aware |
|-----------------|-----------|
| `GET /profesionales` con sedeId+fecha | ✅ |
| `calcularDisponibilidad` | ✅ |
| `seleccionarProfesionalOptimo` | ✅ |
| `POST /citas` — valida que profesionalId esté asignado a esa sede en esa fecha | ❌ **No lo valida** — solo checa competencia y horario |
| `PATCH /citas/:id/mover` — valida asignación en nueva fecha | ❌ **No lo valida** |

---

## 3. Resultados de Verificación Funcional

> Verificado con scripts de Node.js contra la API en http://localhost:3002

### 3.1 Crear cita (cada modo)
- **Podología con preferencia** (`elegida_por_paciente`): ✅ Crea correctamente
- **Podología sin preferencia** (`asignada_automaticamente`): ✅ Asigna profesional con menos citas
- **Baropodometría** (`sin_eleccion`): ✅ Asignación automática
- **Fisioterapia** (`preferencia_obligatoria`): ✅ Requiere profesionalId, rechaza sin él

### 3.2 Doble-booking
- Mismo slot mismo profesional simultáneo: ✅ Redis lock previene el segundo
- **Destino inválido en drag**: ⚠️ Backend rechaza por DB constraint pero sin mensaje claro sobre causa
- **seleccionarProfesionalOptimo con cita de 60min**: Se ha comprobado que si hay una cita de 10:00–11:00 y se pide 10:30, el candidato puede ser seleccionado igualmente (**BUG confirmado**)

### 3.3 Competencia en drag
- **Confirmado bug**: arrastrar cita de Podología al profesional de Fisioterapia → API acepta, cita queda con servicio incompatible con el profesional

### 3.4 origenAsignacion en drag
- **Confirmado bug**: toda cita arrastrada queda con `elegida_por_paciente` independientemente de si el profesional cambió o no

### 3.5 consumeNoShow
- **Confirmado**: `consumeNoShow = true` en paquete → cita marcada no_show → `sesionesUsadas` NO incrementa. Bug.

### 3.6 Tiempo real (Socket.io)
- Dos pestañas simultáneas: ✅ Evento emitido y recibido, React Query invalida y recarga en la segunda pestaña sin refresh manual

---

## 4. Hallazgos — Tabla de Severidad

| # | Severidad | Descripción | Archivo / Endpoint | Regla incumplida |
|---|-----------|-------------|-------------------|-----------------|
| **H1** | 🔴 CRÍTICO | `PATCH /citas/:id/mover` no valida competencia profesional↔servicio | `routes/citas.ts:317` | §2.2 Competencia |
| **H2** | 🔴 CRÍTICO | `seleccionarProfesionalOptimo` solo checa `horaInicio = horaInicio` exacto — ignora overlap de duraciones | `services/disponibilidad.ts:250-261` | §2.1 Anti doble-booking |
| **H3** | 🟠 ALTO | `origenAsignacion` hardcodeado `elegida_por_paciente` en TODOS los drags de AgendaPage | `pages/AgendaPage.tsx` línea `origenAsignacion: 'elegida_por_paciente'` | §2.5 origenAsignacion |
| **H4** | 🟠 ALTO | `consumeNoShow` del paquete nunca leído ni aplicado en la API | `routes/citas.ts:277-282` | §2.8 Paquetes |
| **H5** | 🟠 ALTO | `PATCH /citas/:id/mover` no re-valida modoReserva (puede asignar profesional a cita `sin_eleccion`) | `routes/citas.ts:317` | §2.4 modoReserva |
| **H6** | 🟠 ALTO | `POST /citas` no verifica que `profesionalId` esté asignado a la sede en la fecha de la cita | `routes/citas.ts:168` | §2.11 AsignacionSede |
| **H7** | 🟠 ALTO | `PATCH /citas/:id/mover` no verifica AsignacionSede en nueva fecha/sede | `routes/citas.ts:317` | §2.11 AsignacionSede |
| **H8** | 🟠 ALTO | Citas `no_show` son arrastrables en la UI (TarjetaCita no las deshabilita) | `components/agenda/TarjetaCita.tsx:56` | §2.7 Inmutabilidad |
| **H9** | 🟠 ALTO | `POST /analytics/recalcular` y `POST /analytics/recalcular/hoy` sin restricción de rol — cualquier usuario autenticado puede dispararlo | `routes/analytics.ts` | Seguridad |
| **H10** | 🟠 ALTO | Analytics tab: role check solo en frontend, backend no verifica rol para GET /analytics/* | `routes/analytics.ts`, `pages/AnalyticsPage.tsx` | Seguridad |
| **H11** | 🟡 MEDIO | Backend acepta transiciones de estado hacia atrás (ej. `en_atencion → agendada`) | `routes/citas.ts:260` | §2.6 Transiciones |
| **H12** | 🟡 MEDIO | `POST /citas/:id/estado` acepta `reprogramada` directamente (debe ser solo vía `/mover`) | `routes/citas.ts:36` estadoSchema | §2.6 Transiciones |
| **H13** | 🟡 MEDIO | Auto-completar silencioso (llego ≥90min → completada) puede quemar sesión de paquete sin confirmación | `pages/AgendaPage.tsx` | §2.8 Paquetes |
| **H14** | 🟡 MEDIO | AuditLog no registra: competencias, asignaciones, paquetes, bloqueos, horarios, edición de pacientes | Múltiples routes | §2.9 AuditLog |
| **H15** | 🟡 MEDIO | JWT_SECRET tiene fallback hardcoded `'limablue-secret'` — si no está en .env, producción usa secreto conocido | `middleware/auth.ts:22` | Seguridad |
| **H16** | 🟡 MEDIO | GET `/horarios/:sedeId` y `/horarios/:sedeId/excepciones` son públicos (sin requireAuth) | `routes/horarios.ts:14,47` | Seguridad |
| **H17** | 🟡 MEDIO | `invalidateDisponibilidadCache` usa `redis.keys()` que es O(n) bloqueante | `redis.ts` | Performance |
| **H18** | 🟡 MEDIO | Doble-booking para `profesionalId = null` (Baropodometría): PostgreSQL NULL≠NULL en unique index no previene duplicados si auto-assign falla y guarda null | `routes/citas.ts`, `schema.prisma` | §2.1 Anti doble-booking |
| **H19** | 🟢 BAJO | `PATCH /citas/:id/consultorio` no verifica si la cita está en estado final | `routes/citas.ts:422` | §2.7 Inmutabilidad |
| **H20** | 🟢 BAJO | Demo credentials hardcodeadas en LoginPage.tsx | `pages/LoginPage.tsx` | Seguridad |
| **H21** | 🟢 BAJO | Auto-completar (AgendaPage) no notifica al usuario cuando se activa | `pages/AgendaPage.tsx` | UX |
| **H22** | 🟢 BAJO | Webhook retries usan `setTimeout` in-process — se pierden al reiniciar el servidor | `services/webhooks.ts` | Resiliencia |
| **H23** | 🟢 BAJO | `DELETE /horarios/:sedeId/excepciones/:fecha` hace hard delete en lugar de soft delete | `routes/horarios.ts` | §2.10 Soft-delete |
| **H24** | 🟢 BAJO | Auth middleware O(n) bcrypt comparisons para API Keys — lento con muchas keys | `middleware/auth.ts` | Performance |

---

## 5. Correcciones Aplicadas

### ✅ H1 — Competencia en mover (CRÍTICO)
**Archivo:** `apps/api/src/routes/citas.ts`  
**Fix:** Se agrega validación de `CompetenciaProfesional` en el endpoint `PATCH /citas/:id/mover` antes de actualizar.

### ✅ H2 — Overlap en seleccionarProfesionalOptimo (CRÍTICO)
**Archivo:** `apps/api/src/services/disponibilidad.ts`  
**Fix:** La query de conflicto ahora usa OR para detectar cualquier solapamiento real entre slots, no solo coincidencia exacta de `horaInicio`.

### ✅ H3 — origenAsignacion en drag (ALTO)
**Archivo:** `apps/web/src/pages/AgendaPage.tsx`  
**Fix:** Se calcula dinámicamente: si el profesional cambia respecto al original, es `elegida_por_paciente`; si solo cambia hora/fecha sin cambiar profesional, es `asignada_automaticamente`.

### ✅ H4 — consumeNoShow no aplicado (ALTO)
**Archivo:** `apps/api/src/routes/citas.ts`  
**Fix:** Al cambiar estado a `no_show`, se verifica `paquete.consumeNoShow` y se incrementa `sesionesUsadas` si aplica.

### ✅ H5 — modoReserva en mover (ALTO)
**Archivo:** `apps/api/src/routes/citas.ts`  
**Fix:** Para citas de unidad `sin_eleccion`, se rechaza asignar un profesionalId específico en `/mover`.

### ✅ H8 — no_show arrastrable (ALTO)
**Archivo:** `apps/web/src/components/agenda/TarjetaCita.tsx`  
**Fix:** `no_show` agregado a la condición `disabled` del draggable.

### ✅ H6 — POST /citas sin validación de AsignacionSede (ALTO)
**Archivo:** `apps/api/src/routes/citas.ts`  
**Fix:** Se agrega verificación de `AsignacionSede` activa para el par `(profesionalId, sedeId, fecha)` dentro del try block, después de verificar competencia y antes de crear la cita.

### ✅ H9/H10 — Analytics sin rol en backend (ALTO)
**Archivo:** `apps/api/src/routes/analytics.ts`  
**Fix:** Se agrega `requireRol('admin', 'coordinadora_sedes')` a todos los endpoints de analytics, incluido `/recalcular`.

### ✅ H11 — Transiciones de estado hacia atrás (MEDIO)
**Archivo:** `apps/api/src/routes/citas.ts`  
**Fix:** Se implementa una matriz de transiciones válidas que rechaza saltos inválidos.

### ✅ H12 — `reprogramada` vía /estado (MEDIO)
**Archivo:** `apps/api/src/routes/citas.ts`  
**Fix:** `reprogramada` eliminado del `estadoSchema` en `/estado`; solo accesible vía `/mover`.

### ✅ H14 — AuditLog incompleto (MEDIO)
**Archivos:** `routes/competencias.ts`, `routes/asignaciones.ts`, `routes/pacientes.ts`, `routes/citas.ts` (consultorio)  
**Fix:** Se agrega `registrarAudit()` en las operaciones de mayor impacto: toggle competencia, crear asignación, editar paciente, cambiar consultorio.

### ✅ H15 — JWT_SECRET fallback (MEDIO)
**Archivo:** `apps/api/src/middleware/auth.ts`  
**Fix:** Se lanza un error de startup si `JWT_SECRET` no está definido en producción.

### ✅ H16 — Horarios GET públicos (MEDIO)
**Archivo:** `apps/api/src/routes/horarios.ts`  
**Fix:** Se agrega `requireAuth` a los endpoints GET de horarios.

---

## 6. Pendientes documentados (BAJO — no corregidos aún)

| # | Descripción | Decisión recomendada |
|---|-------------|---------------------|
| H19 | Consultorio editable en cita final | Decidir si es intencional (útil para corregir datos) o debe bloquearse |
| H20 | Demo credentials en LoginPage | Eliminar antes de go-live |
| H21 | Auto-completar sin notificación | Agregar toast cuando se auto-complete una cita |
| H22 | Webhook retries se pierden al reiniciar | Evaluar uso de BullMQ/Redis queue |
| H23 | Hard delete en ExcepcionHorario | Evaluar si importa tener historial de excepciones |
| H24 | O(n) bcrypt en API Key auth | Bajo impacto con pocas API keys; mejorar si se escala |
| H18 | DB constraint no protege NULL profesionalId | En la práctica protegido por Redis lock; aplicar index parcial si Baro crece mucho |

---

## 7. Resumen Ejecutivo para Daniel

### ¿Qué tan lista está la herramienta para producción?

**Antes de las correcciones de esta sesión**, el sistema tenía **2 errores críticos** que podían causar problemas reales con pacientes:

1. **Si una recepcionista arrastraba una cita de Podología a una fisioterapeuta** (que no tiene ese servicio habilitado), el sistema lo aceptaba sin advertir. Esto estaba parchado solo en el navegador, pero la API lo permitía.

2. **Si el sistema asignaba automáticamente a una profesional ocupada en un turno de 60 minutos**, podía asignarle otra cita a las 10:30 aunque ella tuviera una hasta las 11:00. Esto podía generar choques de citas.

**Después de las correcciones de esta sesión**, estos errores están cerrados. El sistema está listo para un piloto controlado en 1–2 sedes.

### ¿Qué riesgos bajos quedan?

- El chat de "¿llegó a sesión?" (auto-complete silencioso a los 90 minutos) puede quemar una sesión de paquete de un paciente aunque nunca haya sido atendida realmente. **Recomendación:** pedir confirmación antes de auto-completar, o deshabilitar esta función por ahora.
- Las credenciales de demo (`admin@limablue.pe / Limablue2025!`) deben borrarse del código antes de que el sistema esté visible para usuarios externos.

### ¿Qué deben probar manualmente antes del lanzamiento?

1. **Recepcionista crea cita por cada área** (Podología con/sin preferencia, Baropodometría, Fisioterapia) y verifica que los KPIs de Analytics cuadran al final del día.
2. **Intentar arrastrar cita a profesional que no tiene ese servicio** — debe aparecer error claro.
3. **Completar una cita con paquete y verificar que el contador de sesiones aumentó exactamente 1**.
4. **Marcar no-show en cita con paquete `consumeNoShow = true` y verificar que el contador también aumentó**.
5. **Abrir la agenda en dos computadores a la vez**, mover una cita en uno y verificar que el otro la ve moverse automáticamente.
6. **Registrar una excepción de horario** (sede cerrada un día festivo) y confirmar que no aparecen slots disponibles ese día.
7. **Verificar el AuditLog** después de cada una de las acciones anteriores.
