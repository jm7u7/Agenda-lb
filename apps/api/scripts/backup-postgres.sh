#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# Backup de PostgreSQL — Limablue Agenda  ·  retención escalonada + copia off-site
#
# Estrategia (clase mundial, sin un único archivo que se sobreescribe):
#   • 1 dump por corrida (cron diario). Formato custom (-Fc) → restauración selectiva.
#   • Retención escalonada con ROTACIÓN automática:
#       - diarios : 7   (uno por día)
#       - semanales: 4  (el primer backup de cada semana ISO se promueve)
#       - mensuales: 3  (el primer backup de cada mes se promueve)
#   • Verificación de integridad de cada dump (pg_restore -l).
#   • Copia OFF-SITE configurable (S3 / Google Drive / otro volumen) — ver BACKUP_OFFSITE_CMD.
#
# Uso:
#   ./scripts/backup-postgres.sh
#   BACKUP_DIR=/ruta BACKUP_OFFSITE_CMD='aws s3 cp {} s3://bucket/limablue/' ./scripts/backup-postgres.sh
#
# Postgres en Docker (este proyecto): detecta $PG_CONTAINER (def. "limablue_postgres")
# y corre pg_dump DENTRO de él. Si pg_dump está en el host, lo usa. Forzar host: PG_CONTAINER="".
#
# Cron sugerido (ver scripts/limablue-backup.cron): diario 02:30.
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

# ── DATABASE_URL (del entorno o del .env, sin comillas) ──────────────────────
if [[ -z "${DATABASE_URL:-}" && -f "$(dirname "$0")/../.env" ]]; then
  DATABASE_URL="$(grep -E '^DATABASE_URL=' "$(dirname "$0")/../.env" | head -1 | cut -d= -f2- | sed -E 's/^["'\'']//; s/["'\'']$//')"
  export DATABASE_URL
fi
[[ -z "${DATABASE_URL:-}" ]] && { echo "❌ DATABASE_URL no definido." >&2; exit 1; }

# ── Resolver pg_dump/pg_restore: contenedor Docker o host ─────────────────────
PG_CONTAINER="${PG_CONTAINER-limablue_postgres}"
if [[ -n "$PG_CONTAINER" ]] && command -v docker >/dev/null 2>&1 && docker ps --format '{{.Names}}' | grep -qx "$PG_CONTAINER"; then
  PGDUMP=(docker exec -i "$PG_CONTAINER" pg_dump)
  PGRESTORE=(docker exec -i "$PG_CONTAINER" pg_restore)
  echo "🐳 pg_dump vía contenedor $PG_CONTAINER"
elif command -v pg_dump >/dev/null 2>&1; then
  PGDUMP=(pg_dump); PGRESTORE=(pg_restore)
else
  echo "❌ No hay pg_dump (ni contenedor $PG_CONTAINER ni binario en host)." >&2; exit 1
fi

BACKUP_DIR="${BACKUP_DIR:-$(dirname "$0")/../backups/postgres}"
KEEP_DIARIOS="${KEEP_DIARIOS:-7}"
KEEP_SEMANALES="${KEEP_SEMANALES:-4}"
KEEP_MENSUALES="${KEEP_MENSUALES:-3}"
mkdir -p "$BACKUP_DIR/diarios" "$BACKUP_DIR/semanales" "$BACKUP_DIR/mensuales"

TS="$(date +%Y%m%d-%H%M%S)"
SEMANA="$(date +%G-W%V)"   # año-semana ISO (ej. 2026-W25)
MES="$(date +%Y-%m)"
ARCH="$BACKUP_DIR/diarios/limablue-$TS.dump"

# ── Dump (pg_dump escribe a stdout; el host guarda el archivo) ───────────────
echo "🗄  Backup $TS → $ARCH"
"${PGDUMP[@]}" -Fc --no-owner --no-privileges "$DATABASE_URL" > "$ARCH"

# ── Verificación de integridad ───────────────────────────────────────────────
if ! "${PGRESTORE[@]}" -l < "$ARCH" > /dev/null 2>&1; then
  echo "❌ Backup corrupto ($ARCH): pg_restore -l falló." >&2; exit 2
fi
echo "✅ Verificado ($(du -h "$ARCH" | cut -f1))"

# ── Promoción a semanal / mensual (idempotente: una por periodo) ─────────────
SEM="$BACKUP_DIR/semanales/limablue-$SEMANA.dump"
MEN="$BACKUP_DIR/mensuales/limablue-$MES.dump"
[[ -f "$SEM" ]] || { cp "$ARCH" "$SEM"; echo "📆 Semanal → $SEM"; }
[[ -f "$MEN" ]] || { cp "$ARCH" "$MEN"; echo "📅 Mensual → $MEN"; }

# ── Rotación por cantidad (conserva los N más recientes) ─────────────────────
rotar() { ls -1t "$1"/*.dump 2>/dev/null | tail -n +"$(( $2 + 1 ))" | xargs -r rm -f; }
rotar "$BACKUP_DIR/diarios"   "$KEEP_DIARIOS"
rotar "$BACKUP_DIR/semanales" "$KEEP_SEMANALES"
rotar "$BACKUP_DIR/mensuales" "$KEEP_MENSUALES"
echo "🧹 Rotación OK (diarios≤$KEEP_DIARIOS, semanales≤$KEEP_SEMANALES, mensuales≤$KEEP_MENSUALES)"

# ── Copia OFF-SITE (configurable) ────────────────────────────────────────────
# Define BACKUP_OFFSITE_CMD con {} como placeholder de la ruta del dump. Ejemplos:
#   AWS S3:        BACKUP_OFFSITE_CMD='aws s3 cp {} s3://mi-bucket/limablue/'
#   Google Drive:  BACKUP_OFFSITE_CMD='rclone copy {} gdrive:limablue-backups'
#   Otro volumen:  BACKUP_OFFSITE_CMD='cp {} /mnt/backup-externo/limablue/'
if [[ -n "${BACKUP_OFFSITE_CMD:-}" ]]; then
  CMD="${BACKUP_OFFSITE_CMD//\{\}/$ARCH}"
  echo "☁️  Off-site: $CMD"
  if eval "$CMD"; then echo "✅ Copia off-site OK"; else echo "⚠️  Copia off-site FALLÓ (revisa BACKUP_OFFSITE_CMD)" >&2; fi
else
  echo "ℹ️  Sin off-site (define BACKUP_OFFSITE_CMD para activarlo)."
fi
