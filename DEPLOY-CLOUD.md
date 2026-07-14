# Despliegue en la nube — Limablue Agenda (handoff a TI)

Guía para publicar la Agenda en la nube detrás de un **link HTTPS público**. Está escrita para
que un Jefe de TI la ejecute de principio a fin. El **runbook local** (Mac con pm2) es `DEPLOY.md`;
este documento es el de **nube pública**.

> **Resumen:** el código está listo y probado (agendamiento, concurrencia, analytics, suite E2E).
> Lo que falta es infraestructura de nube: dominio + TLS, BD/Redis gestionados (o en contenedor),
> migración cifrada de los datos reales, y cargar los secretos. Nada de eso vive en el repo.

---

## 0. Arquitectura objetivo (same-origin + TLS)

Un solo dominio; un reverse proxy (Caddy) termina TLS y enruta todo al servidor web, que sirve el
frontend y proxya internamente a la API. **El frontend usa rutas relativas → el mismo build sirve
en cualquier dominio, sin recompilar.**

```
Internet ──HTTPS──> Caddy (TLS Let's Encrypt) ──> web (serve-prod.cjs :5180)
                                                     ├─ estático (frontend)
                                                     ├─ /api        ─┐
                                                     └─ /socket.io  ─┴─> api (:3002) ─> Postgres + Redis (INTERNOS)
```

Postgres y Redis **nunca** se exponen a internet.

---

## 1. Prerrequisitos

- **Dominio** (ej. `agenda.limablue.pe`) con acceso al DNS.
- **Servidor**: un VPS Linux (2 vCPU / 4 GB mínimo) con Docker + Docker Compose, **o** una PaaS.
- **De Daniel (por canal seguro, NO por chat/email):** los secretos — ver §3.
- **Puertos 80 y 443** abiertos hacia el servidor.
- Decisión **legal/PII** tomada — ver §7.

---

## 2. Dos caminos

- **Camino A — VPS con Docker Compose (incluido, listo para usar).** Los archivos `Dockerfile`,
  `docker-compose.cloud.yml` y `Caddyfile` ya están en el repo. Levanta todo (app + Postgres +
  Redis + TLS) en un servidor. Es el más autocontenido. **El resto de esta guía usa este camino.**
- **Camino B — PaaS (Render/Railway/Fly/Azure App Service…).** Mismos principios: build de la
  imagen, BD y Redis gestionados del proveedor, variables de entorno = `.env.production.example`,
  y TLS del proveedor. Notas en §8.

---

## 3. Secretos y configuración (§ CRÍTICO)

1. Copia la plantilla y llénala:
   ```bash
   cp apps/api/.env.production.example apps/api/.env
   ```
   Ábrela y reemplaza cada `<...>`. **Genera secretos NUEVOS** (no reuses los de desarrollo):
   ```bash
   openssl rand -base64 48   # JWT_SECRET
   openssl rand -base64 32   # CONFIRM_TOKEN_SECRET
   ```
2. Pon el **dominio real** en `CORS_ORIGIN`, `APP_BASE_URL` y **`API_BASE_URL`** (los 3 al mismo
   `https://agenda.limablue.pe`). ⚠️ `API_BASE_URL` es el que arma los links de confirmar/reprogramar
   de los **correos a pacientes**: si queda en localhost, esos links no abren desde el celular.
3. Crea un `.env` en la raíz (lo lee Docker Compose), con las variables de infra:
   ```env
   DOMAIN=agenda.limablue.pe
   POSTGRES_PASSWORD=<password-fuerte-para-la-BD>
   ```
4. `RESEND_API_KEY` válida y con el dominio `limablue.pe` **verificado en Resend** (si no, los correos rebotan).
5. Integraciones opcionales (Outlook/Azure, Gmail/Google, RENIEC): si no se usan, **déjalas vacías**
   — se desactivan solas sin romper nada.

`apps/api/.env` y el `.env` raíz **nunca** se comitean (ya están en `.gitignore`/`.dockerignore`).

---

## 4. Migración de los datos reales (55k pacientes) — CIFRADA

Los datos actuales viven en la BD local. **Nunca** transferir el dump con PII en claro (Ley 29733).

**En la máquina actual (origen):**
```bash
# Dump completo (esquema + datos + estado de migraciones)
docker exec limablue_postgres pg_dump -U limablue -Fc limablue_agenda > limablue_dump.pgc
# Cifrar antes de mover
gpg --symmetric --cipher-algo AES256 limablue_dump.pgc      # pide passphrase → compártela aparte
scp limablue_dump.pgc.gpg  usuario@servidor:/ruta/segura/
rm limablue_dump.pgc                                         # no dejar el claro
```

**En el servidor (destino), tras levantar Postgres (§5 paso 2):**
```bash
gpg --decrypt limablue_dump.pgc.gpg > limablue_dump.pgc && rm limablue_dump.pgc.gpg
# Restaurar dentro del contenedor de Postgres
cat limablue_dump.pgc | docker compose -f docker-compose.cloud.yml exec -T postgres \
  pg_restore -U limablue -d limablue_agenda --clean --if-exists --no-owner
rm limablue_dump.pgc
```
El dump incluye la tabla `_prisma_migrations`, así que `prisma migrate deploy` (que corre solo en
el arranque) quedará **al día** y no reaplica nada. Si en cambio arrancas con BD **vacía**, corre el
seed (`npm run db:seed`) para el catálogo — pero para producción real es la migración de datos.

---

## 5. Despliegue (Camino A — VPS)

```bash
# 1) En el servidor, con el repo + apps/api/.env + .env raíz + Caddyfile presentes:
docker compose -f docker-compose.cloud.yml build

# 2) Levanta SOLO la base para poder restaurar los datos:
docker compose -f docker-compose.cloud.yml up -d postgres redis
#    → ahora corre la restauración cifrada del §4.

# 3) Levanta todo (migrate deploy corre solo antes de la API; Caddy saca el cert TLS):
docker compose -f docker-compose.cloud.yml up -d

# 4) Verifica:
docker compose -f docker-compose.cloud.yml ps        # todos "healthy"/"running"
docker compose -f docker-compose.cloud.yml logs -f api | grep -i "corriendo"
```

**DNS:** apunta un registro **A** de `agenda.limablue.pe` a la IP del servidor **antes** del paso 3
(Caddy necesita resolver el dominio para emitir el certificado TLS).

---

## 6. Smoke test post-deploy

Contra el dominio público (reemplaza el host):
```bash
D=https://agenda.limablue.pe
# 1) Login
curl -s -o /dev/null -w "login %{http_code}\n" -X POST $D/api/v1/auth/login \
  -H 'Content-Type: application/json' -d '{"email":"admin@limablue.pe","password":"<pass-admin>"}'
# 2) TLS válido (sin -k)
curl -sI $D/ | head -1
# 3) Realtime (handshake socket.io)
curl -s -o /dev/null -w "socket %{http_code}\n" "$D/socket.io/?EIO=4&transport=polling"
```
En el navegador: entra al dominio, verifica que **la grilla carga**, **crea y cancela una cita de
prueba**, y que **el candado se ve** (HTTPS). El worker debe registrar en logs
`🔔 Worker de recordatorios iniciado` y **NO** debe aparecer `MAIL_DRY_RUN` (apagado en prod).

---

## 7. Seguridad y PII (Ley 29733) — no saltarse

- **Datos de salud de pacientes.** Define con legal: región de hosting, **cifrado en reposo** de la
  BD (la mayoría de Postgres gestionados lo dan), y un **acuerdo de tratamiento de datos (DPA)** con
  el proveedor de nube.
- **TLS obligatorio** (Caddy lo da). Nunca servir PII por HTTP.
- **Postgres/Redis nunca públicos** (en el compose quedan en la red interna; si usas gestionados,
  restringe por firewall/VPC a la app).
- **Secretos** solo por secret manager / variables de entorno; nunca en el repo ni en imágenes.
- Rotar `JWT_SECRET`/`CONFIRM_TOKEN_SECRET` respecto a desarrollo (ya indicado en la plantilla).

---

## 8. Notas Camino B (PaaS) y operación

- **PaaS:** build de la imagen del `Dockerfile`; corre 2 servicios con el mismo image (comando de
  `api` y de `web`), o pon un reverse proxy same-origin del proveedor. BD y Redis gestionados del
  PaaS; setea sus `DATABASE_URL`/`REDIS_URL`. TLS del PaaS. Las variables = `.env.production.example`.
- **Backups:** programa `pg_dump` diario del Postgres gestionado (o del volumen `pgdata`), **cifrado**,
  a almacenamiento aparte. El respaldo local actual (launchd + git) NO aplica en la nube.
- **Logs:** `docker compose logs` / el panel del proveedor. Considera rotación/retención.
- **Monitoreo:** healthchecks ya definidos en el compose; añade alertas (uptime + errores 5xx).
- **Fragilidad conocida:** la API es un solo proceso Node (una query pesada puede degradarla). Para
  más tráfico: separar el worker (`RECORDATORIOS_WORKER_INLINE=false` + servicio `worker` con
  `node dist/apps/api/src/worker.js`) y/o escalar réplicas de `api` detrás del proxy.

---

## 9. Actualizaciones y rollback

**Actualizar** (nuevo build de código):
```bash
git pull   # o copiar la carpeta nueva
docker compose -f docker-compose.cloud.yml up -d --build   # migrate deploy corre solo
```
**Rollback:** re-desplegar la imagen/commit anterior. Las migraciones son **aditivas** (no
destructivas) por disciplina del proyecto, así que un rollback de código es seguro sin tocar datos.
Nunca `migrate reset`/`db push` en producción.

---

## 10. Checklist de entrega

- [ ] Dominio + DNS (registro A) apuntando al servidor.
- [ ] `apps/api/.env` lleno (dominio en CORS/APP/API_BASE_URL; secretos NUEVOS; Resend con dominio verificado).
- [ ] `.env` raíz con `DOMAIN` y `POSTGRES_PASSWORD`.
- [ ] Datos migrados y cifrados en tránsito (§4).
- [ ] Decisión PII/legal tomada (§7): región, cifrado en reposo, DPA.
- [ ] `docker compose up -d` → todos healthy; TLS válido; smoke test OK.
- [ ] Backups cifrados programados.
