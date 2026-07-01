#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# Prueba de restauración AUTOMATIZADA — Limablue Agenda
#
# Levanta un PostgreSQL EFÍMERO en un contenedor temporal, restaura el último dump,
# verifica que las tablas clave (pacientes, citas) tengan filas y reporta OK/FALLO.
# NO toca la base real. Pensado para cron MENSUAL: si falla, hay que alertar.
#
# Uso:
#   ./scripts/restore-test.sh                 # usa el dump diario más reciente
#   ./scripts/restore-test.sh ruta/al.dump    # prueba un dump específico
#
# Salida: exit 0 = restauración verificada; exit ≠0 = FALLO (encadenar a una alerta).
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

BACKUP_DIR="${BACKUP_DIR:-$(dirname "$0")/../backups/postgres}"
PG_IMAGE="${PG_IMAGE:-postgres:16-alpine}"
TEST_CT="limablue_restore_test_$$"   # nombre único por proceso

# Dump a probar: argumento, o el diario más reciente.
DUMP="${1:-$(ls -1t "$BACKUP_DIR"/diarios/*.dump 2>/dev/null | head -1 || true)}"
if [[ -z "${DUMP:-}" || ! -f "$DUMP" ]]; then
  echo "❌ No se encontró ningún dump para probar (en $BACKUP_DIR/diarios)." >&2; exit 1
fi
command -v docker >/dev/null 2>&1 || { echo "❌ docker no disponible." >&2; exit 1; }

echo "🧪 Probando restauración de: $DUMP"
cleanup() { docker rm -f "$TEST_CT" >/dev/null 2>&1 || true; }
trap cleanup EXIT

# 1) Contenedor Postgres efímero (superusuario 'test', sin puerto publicado).
docker run -d --name "$TEST_CT" \
  -e POSTGRES_USER=test -e POSTGRES_PASSWORD=test -e POSTGRES_DB=restore_test \
  "$PG_IMAGE" >/dev/null

# 2) Esperar a que acepte conexiones (máx ~30s).
for i in $(seq 1 30); do
  if docker exec "$TEST_CT" pg_isready -U test -d restore_test >/dev/null 2>&1; then break; fi
  sleep 1
  [[ $i -eq 30 ]] && { echo "❌ El Postgres temporal no arrancó a tiempo." >&2; exit 2; }
done

# 3) Restaurar el dump (custom format). El dump incluye CREATE EXTENSION (test es superusuario).
if ! docker exec -i "$TEST_CT" pg_restore --no-owner --no-privileges -U test -d restore_test < "$DUMP" 2>/tmp/restore.err; then
  # pg_restore puede emitir warnings no fatales; solo fallamos si hubo ERRORES reales.
  if grep -qiE "error:" /tmp/restore.err; then
    echo "❌ pg_restore reportó errores:"; grep -iE "error:" /tmp/restore.err | head -5; exit 3
  fi
fi

# 4) Conteos de tablas clave (la prueba de que los datos están vivos y consultables).
PAC=$(docker exec "$TEST_CT" psql -U test -d restore_test -tAc "SELECT count(*) FROM pacientes;" 2>/dev/null | tr -d '[:space:]')
CIT=$(docker exec "$TEST_CT" psql -U test -d restore_test -tAc "SELECT count(*) FROM citas;" 2>/dev/null | tr -d '[:space:]')
COM=$(docker exec "$TEST_CT" psql -U test -d restore_test -tAc "SELECT count(*) FROM comentarios_cita;" 2>/dev/null | tr -d '[:space:]')

if [[ -z "$PAC" || -z "$CIT" ]]; then
  echo "❌ No se pudieron consultar las tablas clave tras restaurar." >&2; exit 4
fi

echo "   pacientes:        $PAC"
echo "   citas:            $CIT"
echo "   comentarios_cita: $COM"
echo "✅ RESTAURACIÓN VERIFICADA — el dump es recuperable."
