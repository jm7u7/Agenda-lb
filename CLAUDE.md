# Limablue Agenda — Contexto del proyecto

## Qué es esto
Sistema de agendamiento de citas para Limablue, clínica de salud del pie en Lima, Perú.
Reemplaza un ERP de escritorio de 14 años. 5 sedes, ~400 citas diarias, 40 podólogos.

## Stack
- **Frontend**: React 18 + Vite (puerto 5180) + TailwindCSS + @dnd-kit/core + TanStack Query + date-fns
- **Backend**: Node.js + Express + TypeScript estricto (puerto 3002)
- **DB**: PostgreSQL + Prisma ORM (`apps/api/prisma/schema.prisma`)
- **Cache/locks**: Redis
- **Realtime**: Socket.io
- **Monorepo**: apps/web, apps/api, packages/shared

## Convenciones
- Idioma UI: español (Perú). Zona horaria: America/Lima
- API prefix: `/api/v1/`
- Frontend proxía `/api` → `http://localhost:3002` (ver `apps/web/vite.config.ts`)
- TypeScript estricto en todo el proyecto
- Errores API: `{ error: string, code?: string }` via `AppError` en `middleware/errorHandler.ts`
- Fechas: UTC en DB, convertir a America/Lima en frontend

## Autenticación
- JWT, expiración 30d (dev), guardado via Zustand `persist` en localStorage como `limablue-auth`
- El token se incluye automáticamente en todas las peticiones desde `apps/web/src/api/client.ts`
- **Usuario admin**: `admin@limablue.pe` / `Admin1234!` (rol: `admin`)
- Roles en DB: `admin`, `coordinadora_sedes`, `recepcionista` (enum `RolUsuario`)
- Middleware: `requireAuth`, `requireRol(...roles)`, `requireScope(scope)` en `middleware/auth.ts`

## Migraciones de base de datos (Prisma Migrate — NO `db push`)
- **Flujo correcto:** en local `prisma migrate dev` genera migraciones versionadas en
  `apps/api/prisma/migrations/`; en producción `npm run db:migrate:prod` (= `prisma migrate deploy`)
  las aplica. **NUNCA `db push` en producción.**
- **Estructura va en migraciones, NO en `seed.ts`.** El seed es SOLO datos (sedes, roles,
  profesionales). Los índices/constraints viven en las migraciones.
- **Índices únicos PARCIALES** (con `WHERE`): Prisma no los representa en el schema, así que
  viven como SQL crudo dentro de las migraciones. Son 9 (verificados contra `pg_indexes`):
  - En la baseline (`00000000000000_baseline/migration.sql`): `recordatorios_cita_unico`,
    `asignaciones_sede_una_abierta`, `pacientes_documento_unico`, `citas_idempotency_unico`.
  - En `20260624120000_bloques_combinados`: `citas_slot_primario_unique` y
    `citas_slot_secundario_unique` (reemplazan al antiguo `citas_slot_activo_unique` de la
    baseline, que ya NO existe en la BD), más `combinaciones_servicio_unico`.
  - En `20260625230000_promociones`: `promociones_nombre_unico`.
  - En `20260705193100_modulo_sesiones`: `consumos_cita_unico` (máx 1 consumo vivo por cita).

  Como NO están en `schema.prisma`, al correr `migrate dev` Prisma intentará "dropearlos" en la
  migración generada → **revisa el SQL generado y borra cualquier `DROP INDEX` de esos 8** (o
  genera la migración con
  `prisma migrate diff --from-schema-datamodel <viejo> --to-schema-datamodel <nuevo> --script`,
  que no los toca). `prisma migrate status` debe quedar siempre "up to date".

## Modelos Prisma principales
- `Usuario` (id, nombre, email, passwordHash, rol, activo, deletedAt, sedes[])
- `Sede`, `UnidadNegocio`, `Profesional`, `Paciente`, `Cita`, `Servicio`, `Paquete`
- `UsuarioSede` (tabla de unión usuario ↔ sede)
- `ApiKey`, `AuditLog`, `WebhookSubscription`
- `ComentarioCita` — hilo **append-only** de comentarios de una cita (id, citaId, autorId?,
  autorEtiqueta, texto, creadoEn, deletedAt). Cada comentario es una ENTRADA inmutable; el
  endpoint `PATCH /citas/:id/comentario` AGREGA (no reemplaza). La cita ya NO tiene columnas
  `comentarioRecepcion`/`comentarioProfesional` (eliminadas). `getCitaCompleta` y `GET /citas`
  incluyen `comentarios` (orden cronológico, con `autor`).

## Estructura
```
apps/
  api/src/
    index.ts         ← servidor Express principal
    db.ts            ← instancia PrismaClient
    middleware/auth.ts, errorHandler.ts
    routes/          ← auth, citas, pacientes, profesionales, sedes, etc.
  web/src/
    App.tsx          ← router principal
    api/             ← client.ts + módulos por entidad
    stores/authStore.ts
    components/layout/  ← Layout, Sidebar
    pages/           ← LoginPage, AgendaPage, AdminPage, etc.
packages/shared/     ← tipos TypeScript compartidos
```

## Reglas críticas
- Anti-doble-booking: índices únicos parciales en DB `citas_slot_primario_unique` + `citas_slot_secundario_unique` (profesionalId, fecha, horaInicio) — máx 1 primario + 1 secundario por slot (bloques combinados)
- Soft delete en todos los modelos (`deletedAt`, `activo`)
- Un SUPER_ADMIN/admin no puede desactivarse a sí mismo
- Drag & drop para reprogramar citas entre especialistas
