# Suite E2E (Playwright) — capa visual de recepción

Prueba los 4 flujos críticos de recepción contra un **entorno AISLADO** (nunca producción):

1. **Grilla** (`tests/01-grilla.spec.ts`) — render de columnas por profesional y slots por hora; una cita sembrada aparece.
2. **Popover** (`tests/02-popover.spec.ts`) — abrir el detalle de una cita, ver datos y ejecutar una acción (marcar "Llegó").
3. **Drawer** (`tests/03-agendar-drawer.spec.ts`) — crear una cita end-to-end (buscar paciente, servicio, hora, agendar).
4. **Drag & drop** (`tests/04-dragdrop.spec.ts`) — reprogramar arrastrando una cita a otra hora; verificado en BD.

## Cómo correrla

```bash
npm run test:e2e            # desde la raíz — Playwright levanta API :3003 + web :5181
# o dentro de e2e/:
npx playwright test
npx playwright test --ui    # modo interactivo
npx playwright show-report  # último reporte HTML
```

## Aislamiento (nunca toca `limablue_agenda` ni :3002/:5180)

- **BD** `limablue_agenda_e2e`, **Redis db 3**, **API :3003**, **web :5181** (vite dev, proxy → :3003).
- Config del backend en `apps/api/.env.e2e` (integraciones neutralizadas, **worker in-process OFF**
  vía `RECORDATORIOS_WORKER_INLINE=false` para que ningún job de fondo mute estado entre specs).
- **Guardas duras** (`fixtures/db.ts`): abortan si `DATABASE_URL` no termina en `_e2e` o si el
  índice de Redis no es 3 (cualquier `FLUSHDB` verifica db=3 antes de ejecutar).
- **Estado por test**: `resetMutables()` en `beforeEach` hace `TRUNCATE` de las tablas volátiles
  (citas, bloqueos y dependientes) + flush de la caché/locks de Redis e2e. El catálogo
  (sedes/profesionales/servicios) queda intacto; cada spec **siembra** lo que necesita vía API.
- **Fechas relativas a hoy**: `fechaConSlot()` escanea días futuros hasta hallar disponibilidad
  real — nunca se hardcodea una fecha que envejezca.

## Convención de `data-testid`

**Regla:** preferir `data-testid` sobre selectores frágiles (texto/clases). Nombres en kebab-case,
con el id de la entidad interpolado cuando aplica. Los componentes NUEVOS deben seguir esta tabla.

| Área | `data-testid` | Dónde |
|---|---|---|
| Grilla (contenedor) | `agenda-grid` | `AgendaPage.tsx` |
| Columna de profesional | `agenda-columna-<profesionalId>` | `ColumnaAgenda.tsx` |
| Slot libre (droppable) | `slot-<profesionalId>-<HH:MM>` | `ColumnaAgenda.tsx` (SlotDroppable) |
| Tarjeta de cita (draggable) | `cita-<citaId>` | `TarjetaCita.tsx` |
| Botón de sede | `sede-btn-<sedeId>` | `HeaderAgenda.tsx` |
| Input de fecha | `agenda-fecha-input` | `HeaderAgenda.tsx` |
| Botón "+ Nueva cita" | `btn-nueva-cita` | `AgendaPage.tsx` |
| Popover de cita (dialog) | `popover-cita` | `PopoverCita.tsx` |
| Popover: nombre del paciente | `popover-cita-nombre` | `PopoverCita.tsx` |
| Popover: acción "Llegó" | `popover-cita-btn-llego` | `PopoverCita.tsx` |
| Drawer: "Paciente existente" | `drawer-paciente-existente` | `DrawerNuevaCita.tsx` |
| Drawer: buscar paciente | `drawer-paciente-buscar` | `DrawerNuevaCita.tsx` |
| Drawer: resultado de búsqueda | `drawer-paciente-result-<pacienteId>` | `DrawerNuevaCita.tsx` |
| Drawer: select de servicio | `drawer-servicio` | `DrawerNuevaCita.tsx` |
| Drawer: select de hora | `drawer-hora` | `DrawerNuevaCita.tsx` |
| Drawer: botón agendar | `drawer-submit` | `DrawerNuevaCita.tsx` |

**Patrón general:** `<área>-<elemento>` o `<entidad>-<id>` (ej. `popover-cita-btn-<acción>`,
`slot-<profesionalId>-<hora>`). El slot usa `-` en vez del `::` interno de dnd-kit.

## Notas técnicas

- **Auth**: el proyecto `setup` (`tests/auth.setup.ts`) inicia sesión una vez vía UI y guarda el
  `storageState` en `e2e/.auth/state.json`; los specs lo reusan (`dependencies: ['setup']`).
- **Drag & drop (dnd-kit)**: el `PointerSensor` (activationConstraint `distance:8`, collision
  `pointerWithin`) no se activa con `page.mouse`; `helpers/agenda.ts#dragCitaASlot` despacha
  `PointerEvent`s reales con huecos de `requestAnimationFrame` (dnd-kit recalcula `over` por frame).
- **Serie**: `workers: 1` y `fullyParallel: false` — la BD es compartida y se resetea por test.
- **Fallos**: `trace`/`video`/`screenshot` `retain-on-failure`; reporte HTML en `playwright-report/`.
