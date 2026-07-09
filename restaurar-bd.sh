#!/usr/bin/env bash
# Restaura la BD de Limablue en OTRO ENTORNO desde el respaldo CIFRADO del repo
# (limablue_dump.sql.gz.enc). Requiere: openssl, el contenedor Docker `limablue_postgres`
# corriendo, y la CLAVE de descifrado (que NO está en el repo — la copias aparte).
#
# ⚠ SOBREESCRIBE por completo la BD `limablue_agenda` del contenedor con los datos del respaldo.
#
#   ./restaurar-bd.sh [ruta-a-la-clave]      # por defecto: ~/limablue-backup-key.txt
set -euo pipefail

KEY="${1:-$HOME/limablue-backup-key.txt}"
DIR="$(cd "$(dirname "$0")" && pwd)"
ENC="$DIR/limablue_dump.sql.gz.enc"

[ -f "$ENC" ] || { echo "✗ No encuentro el respaldo cifrado: $ENC"; exit 1; }
[ -f "$KEY" ] || { echo "✗ No encuentro la clave de descifrado: $KEY"
                   echo "  Cópiala desde tu Mac (la guardaste en tu gestor de contraseñas) a esa ruta."; exit 1; }
docker ps --format '{{.Names}}' 2>/dev/null | grep -q '^limablue_postgres$' \
  || { echo "✗ El contenedor limablue_postgres no está corriendo (docker start limablue_postgres)"; exit 1; }

echo "⚠ Esto SOBREESCRIBIRÁ la BD limablue_agenda con los datos del respaldo cifrado."
read -r -p "¿Continuar? (escribe SI en mayúsculas): " ok
[ "$ok" = "SI" ] || { echo "Cancelado."; exit 1; }

echo "→ Reiniciando el esquema public…"
docker exec -i limablue_postgres psql -U limablue -d limablue_agenda \
  -c "DROP SCHEMA public CASCADE; CREATE SCHEMA public;" >/dev/null

echo "→ Descifrando y restaurando (puede tardar)…"
openssl enc -d -aes-256-cbc -md sha512 -pbkdf2 -iter 200000 -in "$ENC" -pass file:"$KEY" \
  | gunzip \
  | docker exec -i limablue_postgres psql -U limablue -d limablue_agenda >/dev/null

echo "✓ BD restaurada desde el respaldo cifrado."
