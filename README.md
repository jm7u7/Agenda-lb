# Limablue Agenda

Sistema de agendamiento de citas de clase mundial para **Limablue** — Clínica de Salud del Pie, Lima, Perú.

Reemplaza un ERP de escritorio de 14 años. Diseñado para **velocidad de operación**: agendar, reprogramar o redistribuir una cita en segundos con el mínimo de clics.

---

## Arquitectura

```
limablue-agenda/
├── apps/
│   ├── api/          → Node.js + Express + Prisma + Redis + Socket.io
│   └── web/          → React 18 + Vite + TailwindCSS + TanStack Query + dnd-kit
├── packages/
│   └── shared/       → Tipos TypeScript compartidos (DTOs, enums, utilidades)
└── package.json      → Monorepo npm workspaces
```

### Stack tecnológico

| Capa | Tecnología |
|------|------------|
| Frontend | React 18, Vite, TailwindCSS, TanStack Query, @dnd-kit |
| Backend | Node.js, Express, TypeScript |
| Base de datos | PostgreSQL + Prisma ORM |
| Cache / Locks | Redis (ioredis) |
| Tiempo real | Socket.io |
| Fechas | date-fns + locale `es` |
| Autenticación | JWT (usuarios) + API Keys con scopes (integraciones) |
| Documentación API | Swagger/OpenAPI en `/api/docs` |

---

## Instalación

### Prerequisitos

- Node.js ≥ 20
- PostgreSQL ≥ 14 (con extensión `pg_trgm`)
- Redis ≥ 6

### 1. Clonar e instalar dependencias

```bash
git clone <repo>
cd "limablue-agenda"
npm install
```

### 2. Configurar variables de entorno

```bash
cp apps/api/.env.example apps/api/.env
# Editar apps/api/.env con tus credenciales:
# DATABASE_URL="postgresql://postgres:postgres@localhost:5432/limablue_agenda"
# REDIS_URL="redis://localhost:6379"
# JWT_SECRET="tu-secreto-muy-seguro"
```

### 3. Crear la base de datos y ejecutar migraciones

```bash
# Crear la DB en PostgreSQL
createdb limablue_agenda

# Activar extensiones (como superusuario)
psql limablue_agenda -c "CREATE EXTENSION IF NOT EXISTS pg_trgm;"
psql limablue_agenda -c "CREATE EXTENSION IF NOT EXISTS pgcrypto;"

# Ejecutar migraciones
npm run db:migrate
```

### 4. Cargar datos de seed (demo)

```bash
npm run db:seed
```

Esto crea:
- 5 sedes (San Isidro, Los Olivos, Paz Soldán, Miraflores, San Borja)
- 3 unidades de negocio (Podología, Baropodometría, Fisioterapia)
- 46 profesionales (40 podólogas, 4 médicos, 2 fisioterapeutas)
- 20 servicios clasificados por unidad
- Matriz de competencias variada
- 200 pacientes
- ~400 citas para el día de hoy con estados variados
- 10 paquetes de láser en distintas sesiones de avance

**Credenciales de acceso:**
| Rol | Email | Contraseña |
|-----|-------|------------|
| Admin | admin@limablue.pe | Limablue2025! |
| Coordinadora | coordinadora@limablue.pe | Limablue2025! |
| Recepción | recepcion.sanisidro@limablue.pe | Recepcion2025! |

### 5. Iniciar el servidor de desarrollo

```bash
npm run dev
```

- **Frontend:** http://localhost:5173
- **API:** http://localhost:3001
- **Swagger:** http://localhost:3001/api/docs

---

## Replicar en otro entorno (con datos)

Este repo trae **código**, **migraciones** (estructura de la BD) y el **respaldo de la BD cifrado**
(`limablue_dump.sql.gz.enc`). Los **secretos NO están en el repo** (`.env`, clave de descifrado):
por seguridad se copian aparte. Para levantar una réplica idéntica con datos:

```bash
# 1) Clonar y dependencias
git clone git@github.com:jm7u7/Agenda-lb.git && cd Agenda-lb
npm install

# 2) Config: copia el .env real a apps/api/.env (o parte de la plantilla)
cp apps/api/.env.example apps/api/.env   # y completa los valores (o copia tu .env real)

# 3) Levantar Postgres + Redis (Docker) con el contenedor esperado
docker run -d --name limablue_postgres -e POSTGRES_USER=limablue -e POSTGRES_PASSWORD=<pass> \
  -e POSTGRES_DB=limablue_agenda -p 5432:5432 postgres:16
docker run -d --name limablue_redis -p 6379:6379 redis:7

# 4) Restaurar los DATOS desde el respaldo cifrado (necesitas la CLAVE, que copiaste aparte):
./restaurar-bd.sh /ruta/a/limablue-backup-key.txt

# 5) Arrancar
npm run dev
```

> **Dos archivos secretos** que debes llevar al nuevo entorno por un canal privado (NO por git):
> `apps/api/.env` (config: DB, JWT, Resend, etc.) y `~/limablue-backup-key.txt` (clave para
> descifrar el respaldo). Sin la clave, el respaldo cifrado es irrecuperable.
>
> Si prefieres empezar **sin datos** (BD vacía): omite el paso 4 y corre
> `npm run db:migrate:prod && npm run db:seed` (estructura + datos base).

---

## Unidades de negocio y lógica de agendamiento

El campo `modoReserva` en `UnidadNegocio` controla el comportamiento de toda la UI y la API:

| Unidad | modoReserva | Comportamiento |
|--------|-------------|----------------|
| Podología | `preferencia_opcional` | Paciente puede elegir podóloga o dejar que el sistema asigne (balanceo de carga) |
| Baropodometría | `sin_eleccion` | Sistema siempre asigna médico; columnas son "Baropodometría 1/2..." |
| Fisioterapia | `preferencia_obligatoria` | Paciente DEBE elegir una de las 2 fisioterapeutas; solo en Paz Soldán |

### Anti doble-booking

Dos capas de protección:
1. **Lock en Redis** (`lock:slot:{sedeId}:{profesionalId}:{fecha}:{hora}`, TTL 30s) al iniciar la creación/movimiento
2. **Constraint de unicidad en PostgreSQL** (`UNIQUE(profesionalId, fecha, horaInicio)`) como última defensa

---

## API REST — Endpoints principales

### Autenticación

```http
POST /api/v1/auth/login
Content-Type: application/json

{ "email": "admin@limablue.pe", "password": "Limablue2025!" }
```

Responde con `{ token, usuario }`. Usar `Authorization: Bearer <token>` en el resto de requests.

### Disponibilidad

```http
GET /api/v1/disponibilidad?sede={id}&unidadNegocio={id}&servicio={id}&fecha=2026-06-15
GET /api/v1/disponibilidad?...&profesional={id}   # Con profesional específico
```

Retorna slots libres. Para Baropodometría y "Sin preferencia" devuelve disponibilidad **agregada** (libre si al menos un profesional tiene el slot).

### Crear cita (idempotente)

```http
POST /api/v1/citas
Authorization: Bearer <token>
Idempotency-Key: <uuid-único-por-intento>
Content-Type: application/json

{
  "pacienteId": "...",
  "profesionalId": null,        # null = asignación automática
  "sedeId": "...",
  "unidadNegocioId": "...",
  "servicioId": "...",
  "fecha": "2026-06-15",
  "horaInicio": "10:00",
  "canal": "recepcion"
}
```

### Mover cita

```http
PATCH /api/v1/citas/{id}/mover
{ "profesionalId": "...", "fecha": "2026-06-15", "horaInicio": "11:00" }
```

### Cambiar estado

```http
PATCH /api/v1/citas/{id}/estado
{ "estado": "llego" }
# Estados: agendada → confirmada → llego → en_atencion → completada | no_show | cancelada
```

### Todos los endpoints documentados en Swagger

```
http://localhost:3001/api/docs
```

---

## Integración futura con GoHighLevel (WhatsApp)

El agente de IA de WhatsApp de GoHighLevel se conectará a esta misma API usando **API Keys con scopes**.

### Pasos para la integración

**1. Crear una API Key para el bot**

```http
POST /api/v1/auth/apikeys
Authorization: Bearer <token-admin>
{ "nombre": "Bot WhatsApp GHL", "scopes": ["availability:read", "appointments:write", "patients:read"] }
```

Guardar la `apiKey` devuelta en la configuración del agente de GHL.

**2. Autenticación del bot**

```http
Authorization: ApiKey <tu_api_key>
```

**3. Flujo de agendamiento del bot**

```
1. Identificar paciente:
   GET /api/v1/pacientes/buscar?q=<dni-o-nombre>

2. Consultar sedes y servicios disponibles:
   GET /api/v1/sedes
   GET /api/v1/servicios?unidadNegocioId=<id>

3. Consultar disponibilidad:
   GET /api/v1/disponibilidad?sede=<id>&unidadNegocio=<id>&servicio=<id>&fecha=2026-06-20

4. Crear la cita (con Idempotency-Key para evitar duplicados):
   POST /api/v1/citas
   Idempotency-Key: <uuid-único>
   { "pacienteId": "...", "sedeId": "...", ... }

5. Recibir eventos vía webhooks (configurar en /api/v1/webhooks):
   appointment.created → confirmar al paciente
   appointment.cancelled → notificar cancelación
```

**4. Webhooks salientes**

El sistema puede notificar a GHL de eventos en tiempo real:

```http
POST /api/v1/webhooks
{ 
  "nombre": "GHL Bot WhatsApp",
  "url": "https://tu-webhook-ghl.com/endpoint",
  "secret": "secreto-para-verificar-firma",
  "eventos": ["appointment.created", "appointment.cancelled", "appointment.rescheduled"]
}
```

Cada evento incluye `X-Limablue-Signature: sha256=<hmac>` para verificar autenticidad.

---

## Decisiones de diseño

| Decisión | Opción elegida | Alternativa | Razón |
|----------|---------------|-------------|-------|
| Reprogramación | `PATCH /citas/{id}/mover` + AuditLog completo | Crear cita nueva marcando original como `reprogramada` | Más simple; el historial está en AuditLog |
| Asignación automática | Se resuelve dentro del lock Redis al crear la cita | Pre-calcular antes del lock | Garantiza consistencia con 400 citas/día concurrentes |
| Baropodometría en UI | Columnas "Baropodometría 1/2" (recurso genérico) | Nombre del médico | Alineado con el modelo mental del negocio |
| Fisioterapia | Solo visible en sede Paz Soldán (filtro en SedeUnidadNegocio) | Deshabilitar en UI | Forzado a nivel de datos, no solo presentación |
| Soft-delete | Campo `deletedAt` en todas las entidades | Flag booleano | Estándar; permite consultar históricos fácilmente |

---

## Comandos útiles

```bash
npm run dev              # Desarrollo (API + Web)
npm run dev:api          # Solo API
npm run dev:web          # Solo frontend
npm run db:migrate       # Crear/actualizar schema en DB
npm run db:seed          # Cargar datos de demo
npm run db:reset         # Reset completo + seed
npm run test             # Tests de reglas de negocio
npm run build            # Build de producción
```

---

## Variables de entorno (API)

| Variable | Default | Descripción |
|----------|---------|-------------|
| `DATABASE_URL` | — | PostgreSQL connection string |
| `REDIS_URL` | `redis://localhost:6379` | Redis connection string |
| `JWT_SECRET` | — | Secreto para firmar JWTs (min 32 chars en producción) |
| `JWT_EXPIRES_IN` | `8h` | Expiración del token |
| `PORT` | `3001` | Puerto del servidor |
| `CORS_ORIGIN` | `http://localhost:5173` | Origen permitido por CORS |

---

## Licencia

Propiedad de Limablue. Uso interno únicamente.
