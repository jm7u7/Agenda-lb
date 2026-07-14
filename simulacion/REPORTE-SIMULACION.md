# REPORTE — Simulación "Agenda Viva"

**Fecha:** 2026-07-10 · **Entorno:** `limablue_agenda_simulacion` (aislado, Gate 0) · **Seed determinista:** 2026
**Producción:** intacta durante toda la corrida (55,274 pacientes / 579 citas, sin cambios).

---

## 1. Resumen ejecutivo

Se sometió el sistema a **4 semanas simuladas** de operación con **500 pacientes ficticios** operados por **20 usuarios concurrentes** (12 recepcionistas + 8 contact center), con eventos de oferta reales (feriado, 3 enfermedades, 2 bloqueos parciales, 1 cambio de horario permanente) y 3 escenarios quirúrgicos de carrera ×50.

**Veredicto: el sistema sobrevivió sin corrupción de datos.**

| Métrica clave | Resultado |
|---|---|
| Requests totales | **7,840** |
| Respuestas 5xx (error no controlado) | **0** |
| Doble-booking (I1) | **0** |
| Saldos de paquete negativos (I4) | **0** |
| Bloques combinados incoherentes (I3) | **0** |
| Fechas corridas por timezone (I8) | **0** |
| Citas sin auditoría de creación (I5) | **0** |
| Hard-deletes (I6) | **0** |
| Bugs CRÍTICOS / ALTOS | **0 / 0** |
| Bugs MEDIOS / BAJOS | **1 / 2** |

Los 21 fixes de la auditoría previa (resolvedor único de turnos, cascada de bloques, consumo idempotente, guards de movimientos, anti-doble-booking en 2 niveles) **se validan bajo carga concurrente real**.

---

## 2. Volumen generado

| Entidad | Cantidad |
|---|---|
| Pacientes ZZTEST | 500 |
| Citas totales | 1,006 |
| — completadas | 705 |
| — agendadas (futuras) | 129 |
| — no-show | 76 |
| — canceladas | 64 |
| — en curso (llegó) | 32 |
| Bloques combinados (grupos) | 19 |
| Citas con promoción | 134 |
| Paquetes/membresías vendidos | 140 |
| Consumos de sesión | 165 |
| Recordatorios programados | 1,997 |
| Correos reales enviados a sandbox Resend | 195 |
| Registros de AuditLog | 5,166 |

Distribución de distrito (UBIGEO): Lima Metro 339 (68%), provincias 132 (26%), No precisa 19 (4%), Extranjero 10 (2%) — coincide con la ponderación pedida.

---

## 3. Invariantes post-simulación (el oráculo)

| # | Invariante | Esperado | Real | Resultado |
|---|-----------|:---:|:---:|:---:|
| I1 | Sin solapamiento de citas activas del mismo profesional | 0 | **0** | ✅ |
| I2 | 0 citas **pendientes** dentro de un bloqueo | 0 | **0** | ✅ * |
| I3 | Todo `slotGrupoId` con exactamente 2 citas y estado coherente | 0 incoherentes | **0** | ✅ |
| I4 | Consumidas ≤ compradas; saldo derivado sin negativos | saldo_min ≥ 0 | **min=0, negativos=0** | ✅ |
| I5 | Toda cita con su evento de creación en AuditLog | 0 sin audit | **0** | ✅ |
| I6 | 0 hard-deletes (cancelación = estado, no DELETE) | 0 | **0** (1,006 filas persisten; 64 canceladas por estado) | ✅ |
| I7 | Cada correo con estado final de Resend | — | **195/195 con `resendEmailId`** | ✅ ** |
| I8 | 0 fechas corridas por timezone | 0 | **0** (columna `date` pura, sin componente horario) | ✅ |
| I9 | 100% de pacientes con marca ZZTEST | 0 sin marca | **0** (500/500) | ✅ |
| I10 | 0 errores 500 no controlados | 0 | **0 propagados al cliente** (3 deadlocks resueltos, ver §5) | ✅ *** |

**\* I2 — hallazgo de comportamiento:** una primera medición dio 7 "citas en bloqueo", pero al refinar resultaron **7 citas ya `completada`** (atendidas antes de que la profesional se enfermara). El sistema **impide bloquear a un profesional con citas *pendientes* en el rango** (`409 CITAS_EN_RANGO`), por lo que las citas huérfanas **son imposibles por diseño**. Ver §4.

**\*\* I7:** la API key de Resend es *sending-only* → el `GET /emails/:id` devuelve 401 (no se puede leer el estado por API). El estado final se **deriva del patrón sandbox** de la dirección: `delivered+…` (85%), `bounced+…` (10%), `complained+…` (5%). La distribución muestreada coincide (50/7/3 de 60).

**\*\*\* I10:** ver bug MEDIO §5.

---

## 4. Comportamiento ante eventos de oferta

| Evento | Comportamiento observado | ¿Correcto? |
|---|---|:---:|
| **Feriado (28/07)** | Excepción cerrada en las 5 sedes; 0 slots ese día | ✅ |
| **Enfermedad con citas encima** | Bloqueo **rechazado** con `409 CITAS_EN_RANGO` hasta gestionar las citas | ✅ (diseño defensivo) |
| **Enfermedad — flujo real** | Gestionar (cancelar) citas → bloquear (201) → agendar en el rango → `409 SLOT_BLOQUEADO` | ✅ |
| **Cambio de horario permanente** | 14 citas quedarían fuera → `409 HORARIO_CONFLICTO_CITAS`; con `forzar:true` → 200 | ✅ (guard implementado en auditoría previa) |
| **Bloqueo vs 5 agendamientos (carrera 3.3)** | Bloqueo 201; agendamientos rechazados; **0 citas pendientes dentro del bloqueo** | ✅ |

**Respuesta explícita a la pregunta del spec ("qué hace el sistema con las citas huérfanas de un bloqueo"):** el concepto de "cita huérfana" **no existe** en este sistema. Es imposible bloquear a alguien con citas pendientes; la recepción debe reprogramar/cancelar primero. Esto es una fortaleza, no una carencia.

---

## 5. Tabla de bugs

### CRÍTICOS: 0 · ALTOS: 0

Ningún caso de corrupción de datos, doble-booking, saldo negativo, mitad de bloque pisada, consumo de paquete ajeno, ni error 500 propagado al cliente — pese a 7,840 requests con 20 operadores concurrentes y 3 escenarios de carrera ×50.

### MEDIO

**M-1 · Deadlocks de PostgreSQL bajo alta concurrencia (3 ocurrencias)**
- **Evidencia:** log del servidor, 3× `PostgresError code 40P01 "deadlock detected" transient:false` (líneas 2091, 2615, 3141 de `sim-api.log`), durante las ráfagas de Fase 3 (20 operadores al mismo slot).
- **Impacto real medido:** **ninguno visible al cliente** — los 3 se resolvieron como respuestas 409 (de las 1,242 respuestas 409 de carreras). No hubo 500 al cliente ni corrupción.
- **Escenario de reproducción:** 20 transacciones `POST /citas` compitiendo por el mismo slot; dos adquieren locks (índice único parcial `citas_slot_primario_unique` + inserción en `audit_logs`) en orden inverso → deadlock; PostgreSQL aborta una y Prisma la traduce.
- **Riesgo:** bajo la carga de esta simulación es inocuo, pero con más concurrencia la tasa de deadlocks crecería y algunos *podrían* escapar como error si no hay reintento.
- **Archivo/línea sospechosa:** `apps/api/src/routes/citas.ts` — el bloque `prisma.$transaction` del `POST /citas` (creación + `auditEnTx` + posible consumo). El lock Redis (`acquireSlotLock`) serializa la mayoría, pero el deadlock ocurre en la ventana entre lock e índice.
- **Propuesta de fix (NO implementada):** envolver la transacción de creación en un **retry con backoff** ante `P2034`/`40P01` (2-3 intentos), y/o unificar el orden de adquisición de locks (siempre tocar `citas` antes que `audit_logs`). Alternativa: subir el `isolationLevel` de la transacción de creación a `Serializable` con retry (ya se hace en `/citas/combinada`, no en el `POST /citas` simple).

### BAJO

**B-1 · Cuota diaria de correos frena el envío manual de confirmación**
- **Evidencia:** los 40 `POST /citas/:id/confirmar-mail` del Agente D devolvieron `429 CUOTA_DIARIA` ("Se alcanzó el límite diario de correos. El recordatorio quedó en cola para el día siguiente"), tras haberse enviado ya 195 correos automáticos ese "día".
- **Impacto:** el envío manual de confirmación queda diferido cuando la cuota diaria se agota. Es una **protección deliberada** (evita quemar el límite de Resend), pero en un pico de operación real podría bloquear confirmaciones urgentes.
- **Propuesta:** exponer la cuota restante en la UI, y/o permitir una sub-cuota reservada para envíos manuales. Sin cambio de código urgente.

**B-2 · Flujo de enfermedad requiere dos pasos manuales**
- **Observación (no defecto):** marcar una enfermedad exige (1) reprogramar/cancelar las citas una por una y (2) crear el bloqueo. No hay un botón "reportar enfermedad y liberar el día" que haga ambas cosas.
- **Propuesta:** un endpoint/acción compuesta que, dado un profesional+día, ofrezca gestionar en lote sus citas y crear el bloqueo en una transacción. Mejora de UX, no de integridad.

### Falsos positivos descartados (documentados por transparencia)

- **3× `BUG_combinada_vs_simple`** (`vivas:0, grupos:0, ambos 409`): ambos intentos rechazados = resultado correcto (el slot se ocupó/bloqueó entre el check y la ráfaga). El oráculo local no contemplaba "ambos pierden"; el invariante global I3 confirma 0 incoherencias.
- **`SIN_COMPETENCIA` en 10 combinadas**: rechazo correcto (el profesional del slot no domina el servicio extra elegido al azar). La validación funciona.

---

## 6. Métricas de rendimiento (20 operadores concurrentes)

**Latencia global:** p50 **91 ms** · p95 **350 ms** · p99 **486 ms** (7,840 requests).

| Endpoint | n | p50 | p95 | p99 | max |
|---|--:|--:|--:|--:|--:|
| `PATCH /citas/:id/estado` | 2,906 | 90 | 166 | 237 | 430 |
| `POST /citas` [crear] | 1,843 | 52 | 441 | 592 | 751 |
| `GET /disponibilidad` | 1,447 | 174 | 372 | 487 | 685 |
| `POST /pacientes` | 501 | 36 | 61 | 150 | 159 |
| `POST /consumos/cita/:id` | 253 | 53 | 98 | 118 | 154 |
| `PATCH /citas/:id/mover` | 252 | 188 | 316 | 386 | 435 |
| `POST /citas/combinada` | 84 | 20 | 388 | 465 | 465 |

**Throughput de agendamiento:** el `POST /citas` sostuvo p95 441 ms bajo 20 concurrentes con el lock Redis + índice único activos (el costo de la serialización anti-doble-booking). `GET /disponibilidad` es el endpoint de lectura más caro (p50 174 ms) — candidato a caché si la carga crece.

**Eventos de carrera:** 48 carreras naturales + 1,242 rechazos 409 en Fase 3. **Duplicados reales en BD: 0.** El "slot dorado" (20 ops al mismo slot ×50): 37 rondas con exactamente 1 ganador, 963 rechazos limpios, **0 duplicados, 0 errores 500**.

**Socket.io (3.6):** cliente suscrito a una sede recibió `agenda:actualizada` **96 ms** tras crear una cita (< 2s ✓).

---

## 7. Divergencias entre sistemas de disponibilidad

El spec anticipaba divergencias entre popover / grilla / API por los dos sistemas de horario. **No se detectaron:** tras la consolidación en el resolvedor único `turnosDelDia` (auditoría previa), el `GET /disponibilidad` (popover), el `GET /profesionales` (grilla) y la validación del `POST /citas` leen la **misma fuente**. La política popover-first del simulador (reservar solo lo que la disponibilidad mostró libre) produjo únicamente rechazos por carrera concurrente, nunca por desacuerdo entre sistemas. **El "bug #1 esperado" no se materializó** — ya estaba corregido.

---

## 8. Cobertura funcional

- **Endpoints ejercitados directamente:** 33 plantillas distintas (≈50 endpoints del inventario), **0 respuestas 5xx**. Ver `matriz-cobertura.md`.
- **Flujos de operación de pacientes:** agendar, reprogramar (1-3×), cancelar (24h y último minuto), no-show, atender (cadena completa de estados), check-in con consumo, walk-in, cita combinada (crear + carrera), promoción, venta de paquete/membresía, consumo, sobre-cupo, alta/edición de paciente con distrito UBIGEO y país extranjero — **todos cubiertos masivamente**.
- **No ejercitados (justificado):** analytics/BI y reportes (lecturas sin riesgo de corrupción), configuración/catálogo (roles, canales, servicios, videos, combinaciones — la simulación consume el catálogo real ya sembrado, no lo reconfigura), RENIEC (integración externa apagada por Gate 0). Ninguna de estas rutas muta datos de operación de pacientes.

---

## 9. Lo que NO se pudo probar y por qué

1. **Estado real de entrega de correos vía API de Resend** — la API key es *sending-only* (401 en lectura). Mitigado: el estado se deriva del patrón sandbox de la dirección, y los 195 envíos quedaron con `resendEmailId`.
2. **Capa visual (UI)** — fuera de alcance por diseño (corrida a nivel API + eventos). Recomendable una corrida Playwright posterior para la grilla/popover/drawer.
3. **Reintento automático de deadlocks** — no se pudo confirmar si Prisma reintentó los 3 deadlocks o si se tradujeron directamente a 409; en cualquier caso, 0 llegaron como 500 al cliente.
4. **Analytics/reportes con volumen** — no se consultaron con la data generada (foco transaccional); quedan como cobertura pendiente de una corrida de lectura.

---

## 10. Recomendación de próximos pasos (sin implementar)

Orden sugerido para la fase de correcciones (prompts separados, con aprobación):
1. **M-1 (deadlocks)** — añadir retry con backoff a la transacción de `POST /citas` simple. Es el único hallazgo con potencial de degradar bajo mayor carga.
2. **B-1 (cuota de correos)** — exponer cuota restante y reservar sub-cuota para envíos manuales.
3. **B-2 (flujo de enfermedad)** — acción compuesta "reportar enfermedad y liberar día".
4. Corrida **Playwright** de la capa visual.

---

### Anexos (en `simulacion/out/`)
`metricas.jsonl` (7,840 requests) · `eventos.jsonl` · `agenteB-fase*.json` · `agenteC.json` · `agenteD.json` · `agenteE.json` · `agenteA-enfermedad.json` · `fase3.json` · `socket36.json` · `cobertura-metricas.json`
**Limpieza:** `simulacion/cleanup.ts` — entregado **sin ejecutar** (la BD `limablue_agenda_simulacion` puede simplemente eliminarse con `DROP DATABASE`).
