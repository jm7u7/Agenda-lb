#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# restore-seguro.sh — Restaura un dump SIN perder el token de correo.
#
# Por qué existe: el 21-jun un restore normal sobrescribió `mail_config.refreshToken`
# (el token OAuth de Gmail) con un token viejo/revocado del backup → los correos
# fallaron con `invalid_grant`. Este wrapper evita exactamente eso:
#   1. Captura el token VÁLIDO actual EN MEMORIA (nunca lo escribe a disco).
#   2. Restaura el dump (esquema + datos).
#   3. Re-aplica las migraciones (el dump puede ser de un esquema anterior).
#   4. RE-APLICA el token válido encima → el token viejo del dump queda descartado.
#
# Uso:
#   ./scripts/restore-seguro.sh backups/postgres/diarios/limablue-YYYYMMDD-HHMMSS.dump
#
# Variables opcionales: PG_CONTAINER (def. limablue_postgres), PGDATABASE
# (def. limablue_agenda), PGUSER (def. limablue).
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

DUMP="${1:?Uso: restore-seguro.sh <archivo.dump>}"
[ -f "$DUMP" ] || { echo "❌ No existe el dump: $DUMP"; exit 1; }

CONTAINER="${PG_CONTAINER:-limablue_postgres}"
DB="${PGDATABASE:-limablue_agenda}"
DBUSER="${PGUSER:-limablue}"
PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"

psql_db()  { docker exec -i "$CONTAINER" psql -U "$DBUSER" -d "$DB" "$@"; }

echo "⚠️  Restore SEGURO sobre la base VIVA '$DB'. Ctrl-C para abortar (5 s)…"
sleep 5

# 1) Capturar el token válido actual EN MEMORIA (no toca disco).
TOKEN_SQL="$(docker exec "$CONTAINER" psql -U "$DBUSER" -d "$DB" -t -A -c \
  "SELECT format('UPDATE mail_config SET \"refreshToken\"=%L, \"fromEmail\"=%L, \"fromName\"=%L, \"isActive\"=true, \"actualizadoEn\"=now() WHERE id=%L;', \"refreshToken\", \"fromEmail\", \"fromName\", id) FROM mail_config WHERE \"isActive\"=true AND \"refreshToken\" IS NOT NULL ORDER BY \"actualizadoEn\" DESC LIMIT 1;")"
if [ -n "$TOKEN_SQL" ]; then echo "🔐 Token de correo válido capturado en memoria."; else echo "ℹ️  No hay token activo que preservar (se omitirá el paso 4)."; fi

# 2) Restaurar desde cero (esquema limpio + datos del dump).
echo "♻️  Restaurando $DUMP …"
docker cp "$DUMP" "$CONTAINER:/tmp/_restore_seguro.dump"
psql_db -v ON_ERROR_STOP=1 -c "DROP SCHEMA public CASCADE; CREATE SCHEMA public;"
docker exec "$CONTAINER" pg_restore -U "$DBUSER" -d "$DB" --no-owner /tmp/_restore_seguro.dump || true
docker exec "$CONTAINER" rm -f /tmp/_restore_seguro.dump

# 3) Re-aplicar migraciones (el dump puede ser anterior a migraciones recientes).
echo "🛠  Re-aplicando migraciones (prisma migrate deploy)…"
( cd "$PROJECT_DIR" && npx prisma migrate deploy )

# 4) RE-APLICAR el token válido encima del que vino en el dump (lo crítico).
if [ -n "$TOKEN_SQL" ]; then
  printf '%s\n' "$TOKEN_SQL" | psql_db -v ON_ERROR_STOP=1
  echo "✅ Token de correo válido re-aplicado (el del dump quedó descartado)."
fi

echo "🎉 Restore seguro completado."
echo "   Verifica: Herramientas → Confirmación de correo debe decir 'conectada'."
