# Backups de PostgreSQL — Limablue Agenda

Estrategia de respaldo y recuperación lista para producción. **Regla dura: el sistema
NO se va a producción sin el cron de backups activo y una restauración probada con éxito.**

## Qué hay aquí

| Archivo | Qué hace |
|---|---|
| `backup-postgres.sh` | Toma un dump (`pg_dump -Fc`), lo verifica, aplica **retención escalonada** (7 diarios + 4 semanales + 3 mensuales, con rotación automática) y hace una **copia off-site** opcional. |
| `restore-test.sh` | Levanta un PostgreSQL **efímero** en un contenedor temporal, **restaura el último dump**, cuenta las tablas clave (`pacientes`, `citas`, `comentarios_cita`) y reporta **OK/FALLO**. No toca la base real. |
| `limablue-backup.cron` | Líneas de crontab: backup diario 02:30 + prueba de restauración el día 1 de cada mes 03:30. |

Los dumps se guardan en `apps/api/backups/postgres/{diarios,semanales,mensuales}/`.

## 1) Instalar el cron en el servidor

1. Edita `limablue-backup.cron`: pon `RUTA_APP` (ruta real de `apps/api` en el server) y
   descomenta/configura `BACKUP_OFFSITE_CMD` (ver abajo).
2. Instala:
   ```bash
   crontab -l > /tmp/cron.bak 2>/dev/null; cat scripts/limablue-backup.cron >> /tmp/cron.bak; crontab /tmp/cron.bak
   ```
3. Requisito: el usuario del cron debe poder ejecutar `docker` (el Postgres corre en el
   contenedor `limablue_postgres`) o tener `pg_dump`/`pg_restore` en el `PATH`.

## 2) Configurar la copia OFF-SITE (obligatoria para prod)

La copia off-site se define con la variable `BACKUP_OFFSITE_CMD`, donde `{}` se reemplaza
por la ruta del dump. Elige UNO según tu infraestructura:

```bash
# AWS S3
BACKUP_OFFSITE_CMD='aws s3 cp {} s3://mi-bucket/limablue/'
# Google Drive (vía rclone)
BACKUP_OFFSITE_CMD='rclone copy {} gdrive:limablue-backups'
# Otro volumen / disco montado
BACKUP_OFFSITE_CMD='cp {} /mnt/backup-externo/limablue/'
```

Se configura en `limablue-backup.cron` (o como variable de entorno del cron). Si no se
define, el backup local funciona igual pero **avisa que no hay off-site** (no recomendado
para producción: un fallo de disco se llevaría los backups junto con la base).

## 3) Probar la restauración manualmente

```bash
# Prueba el dump diario más reciente:
bash scripts/restore-test.sh
# O un dump específico:
bash scripts/restore-test.sh backups/postgres/mensuales/limablue-2026-06.dump
```
Reporta los conteos de `pacientes`/`citas`/`comentarios_cita` y sale con código 0 si la
restauración fue verificable. Encadena una alerta tras un `||` en el cron si falla.

## 4) Ajustes (variables de entorno)

| Variable | Default | Para qué |
|---|---|---|
| `BACKUP_DIR` | `apps/api/backups/postgres` | Dónde guardar los dumps locales. |
| `KEEP_DIARIOS` / `KEEP_SEMANALES` / `KEEP_MENSUALES` | 7 / 4 / 3 | Cuántos conservar por nivel. |
| `BACKUP_OFFSITE_CMD` | (vacío) | Comando de copia off-site (`{}` = ruta del dump). |
| `PG_CONTAINER` | `limablue_postgres` | Contenedor con `pg_dump`. Vacío = usar host. |

## Checklist antes de producción (regla dura)

- [ ] `crontab` instalado y verificado (`crontab -l`).
- [ ] `BACKUP_OFFSITE_CMD` configurado y una copia off-site confirmada.
- [ ] **Una prueba de restauración ejecutada con éxito** (`restore-test.sh` → OK).
- [ ] Alerta conectada al fallo de `restore-test` (correo/Slack).

## Recomendación FUTURA (no implementado aún): PITR — recuperación al minuto

Los dumps diarios permiten recuperar al estado del **último dump de la noche anterior**. Para
poder recuperar al **minuto exacto** antes de un borrado accidental (Point-In-Time Recovery),
se recomienda a futuro:

- Activar **WAL archiving** en PostgreSQL (`archive_mode = on`, `archive_command` enviando los
  segmentos WAL al mismo off-site) sobre un **base backup** periódico (`pg_basebackup`).
- Con eso, la restauración puede apuntar a un `recovery_target_time` específico y reproducir
  los WAL hasta ese instante (segundos antes del incidente), en vez de perder hasta 24 h.
- Alternativa gestionada: si se migra a un Postgres administrado (RDS, Cloud SQL, Neon,
  Supabase), el PITR suele venir incluido y se activa con un switch.

Esto NO está implementado en esta pasada; los scripts de arriba cubren el respaldo diario
verificado, que es el requisito mínimo para salir a producción.
