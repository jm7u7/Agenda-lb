# Runbook de despliegue — Limablue Agenda

Runbook oficial de producción. La app corre en **este servidor** (macOS) como **build de
producción** bajo **pm2** (antes corría en modo dev con `npm run dev` + `vite`; migrado el
2026-07-11).

## Topología

| Proceso pm2 | Qué es | Puerto | Comando |
|---|---|---|---|
| `limablue-api` | API compilada (`dist`), **worker de recordatorios in-process** (`RECORDATORIOS_WORKER_INLINE="true"`) | **3002** | `node dist/apps/api/src/index.js` (cwd `apps/api`) |
| `limablue-web` | Frontend **build estático** servido + **proxy** `/api` y `/socket.io` → `:3002` | **5180** | `node serve-prod.cjs` (cwd `apps/web`) |

- **Postgres** y **Redis** corren en Docker (`limablue_postgres`, `limablue_redis`) — no los
  gestiona pm2. Deben estar arriba antes de la API.
- La clínica accede por **http://localhost:5180** (misma URL de siempre). El frontend usa rutas
  relativas (`/api/v1`, `/socket.io`); `serve-prod.cjs` las proxya a la API, así que **no hay
  cambios de frontend ni de URL** al migrar de dev a prod.
- `NODE_ENV=production` (en `ecosystem.config.cjs`): activa **CORS estricto** (solo
  `CORS_ORIGIN=http://localhost:5180`) y **exige** `JWT_SECRET` y `CONFIRM_TOKEN_SECRET`
  (presentes en `apps/api/.env`). La API carga `apps/api/.env` vía `dotenv` (por eso pm2 corre
  con `cwd: apps/api`).

## Config

- **`ecosystem.config.cjs`** (raíz) — define los 2 procesos, logs, autorestart.
- **`apps/web/serve-prod.cjs`** — servidor estático + proxy (express + http-proxy-middleware).
- Logs persistentes en **`logs/`**: `api-out.log`, `api-error.log`, `web-out.log`, `web-error.log`
  (con timestamp por línea).

## Deploy de un cambio (procedimiento estándar)

```bash
cd "/Users/apple/Limablue Agenda"

# 1. Traer el código nuevo (si aplica) y compilar TODO en orden (shared → api → web)
npm run build
#    Si tocaste el schema de Prisma: npx --workspace apps/api prisma generate
#    y migración de PRODUCCIÓN (nunca migrate dev):  npm run db:migrate:prod  -w apps/api

# 2. Recargar los procesos (0-downtime en lo posible)
pm2 reload ecosystem.config.cjs        # o: pm2 reload limablue-api / limablue-web

# 3. Persistir el estado para el arranque en boot
pm2 save
```

> **Migraciones:** SIEMPRE `prisma migrate deploy` (`npm run db:migrate:prod`). **NUNCA**
> `migrate dev` / `migrate reset` en producción (hay 54K+ pacientes reales).

## Verificación post-deploy (checklist)

```bash
# procesos arriba, 0 restarts recientes
pm2 status

# API viva y sirviendo
curl -s -o /dev/null -w "%{http_code}\n" -X POST http://localhost:3002/api/v1/auth/login \
  -H 'Content-Type: application/json' -d '{"email":"admin@limablue.pe","password":"Admin1234!"}'   # 200

# Web + proxy + assets
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:5180/                       # 200 (index)
curl -s -o /dev/null -w "%{http_code}\n" "http://localhost:5180/socket.io/?EIO=4&transport=polling"  # 200 (realtime)

# Marca de versión del worker (confirma que el proceso vivo tiene el código nuevo)
grep "Worker de recordatorios iniciado" logs/api-out.log | tail -1
```

## Primera vez / tras reinstalar pm2 — arranque automático en boot (requiere sudo)

`pm2 save` ya persiste la lista de procesos, pero para que **resuciten al reiniciar el
servidor** hay que instalar el hook de launchd **una sola vez** (pide contraseña de macOS):

```bash
sudo env PATH=$PATH:/Users/apple/.nvm/versions/node/v20.20.2/bin \
  /Users/apple/.nvm/versions/node/v20.20.2/lib/node_modules/pm2/bin/pm2 startup launchd -u apple --hp /Users/apple
pm2 save
```

> ⚠️ **Pendiente de ejecutar por el usuario**: mientras no se corra ese `sudo`, pm2 mantiene los
> procesos arriba y los reinicia si crashean, pero **no** arrancan solos tras un **reboot** del
> equipo. Autorestart-en-crash sí funciona ya.

## Rollback

```bash
# Volver al modo dev anterior (si el build de prod diera problemas):
pm2 delete limablue-api limablue-web
cd "/Users/apple/Limablue Agenda" && npm run dev        # ts-node-dev :3002 + vite :5180
```
(El código fuente en `src/` no se toca en el build; `npm run dev` sirve directamente de fuente.)

## Notas

- **BullMQ repeatables:** al reiniciar, `programarBarridoVideos()` elimina el repeatable previo
  y re-registra (hash determinista) → **no se duplica** (verificado: 1 repeatable `barrido-videos`
  cada 5 min; 0 en `recordatorios-cita`). Los recordatorios por cita son jobs one-off con
  `jobId` fijo por cita (idempotentes).
- **Worker in-process:** el worker de recordatorios/videos corre dentro de `limablue-api`.
  Reiniciar la API reinicia el worker. Para separarlo: `RECORDATORIOS_WORKER_INLINE="false"` en
  `apps/api/.env` y correr `apps/api` `worker:prod` como tercer proceso pm2.
- **Logs:** `pm2 logs limablue-api` (en vivo) o `logs/api-out.log`. Considerar
  `pm2 install pm2-logrotate` para rotación automática si crecen mucho.
- **Secrets:** `apps/api/.env` NUNCA va al remoto (git). Dumps con PII de pacientes NUNCA en claro
  al remoto (Ley 29733). Ver respaldo nocturno (launchd `com.limablue.agenda-backup`).
