#!/bin/bash
# Respaldo nocturno de Limablue Agenda
# 1. Actualiza el dump comprimido de la BD (queda LOCAL, git lo ignora — datos de pacientes)
# 2. Sincroniza el código fuente desde la carpeta de trabajo hacia este repo
# 3. Commit + push (el push solo si hay remoto configurado)
# Programado via launchd: ~/Library/LaunchAgents/com.limablue.agenda-backup.plist (21:00 diario)

set -uo pipefail
export PATH="/usr/local/bin:/opt/homebrew/bin:$PATH"

SRC="/Users/apple/Limablue Agenda/"
REPO="$HOME/Documents/Git-Agenda"
LOG="$REPO/sync-nightly.log"

{
  echo "=== $(date '+%Y-%m-%d %H:%M:%S') — inicio respaldo nocturno ==="

  # ── 1. Dump comprimido de la BD (solo respaldo local, .gitignore lo excluye) ──
  if docker ps --format '{{.Names}}' 2>/dev/null | grep -q '^limablue_postgres$'; then
    if docker exec limablue_postgres pg_dump -U limablue limablue_agenda | gzip -9 > "$REPO/limablue_dump.sql.gz.tmp"; then
      mv "$REPO/limablue_dump.sql.gz.tmp" "$REPO/limablue_dump.sql.gz"
      echo "Dump BD actualizado ($(du -h "$REPO/limablue_dump.sql.gz" | cut -f1 | tr -d ' '))"
    else
      rm -f "$REPO/limablue_dump.sql.gz.tmp"
      echo "ERROR: pg_dump falló; se conserva el dump anterior"
    fi
  else
    echo "AVISO: contenedor limablue_postgres apagado; dump omitido"
  fi

  # ── 2. Sincronizar código fuente → repo ──
  # Los --exclude protegen tanto archivos que no deben copiarse como los que
  # existen solo en el repo (rsync --delete no borra lo excluido).
  rsync -a --delete \
    --exclude='.git/' \
    --exclude='.gitignore' \
    --exclude='node_modules/' \
    --exclude='dist/' \
    --exclude='build/' \
    --include='.env.example' \
    --exclude='.env' \
    --exclude='.env.*' \
    --exclude='.DS_Store' \
    --exclude='.claude/' \
    --exclude='.agents/' \
    --exclude='skills-lock.json' \
    --exclude='DEPLOY.txt' \
    --exclude='limablue_dump.sql' \
    --exclude='limablue_dump.sql.gz' \
    --exclude='sync-nightly.sh' \
    --exclude='sync-nightly.log' \
    "$SRC" "$REPO/"
  echo "Código sincronizado desde: $SRC"

  # ── 3. Commit + push ──
  cd "$REPO" || exit 1
  git add -A
  if git diff --cached --quiet; then
    echo "Sin cambios nuevos que commitear"
  else
    git commit -m "Respaldo nocturno $(date '+%Y-%m-%d %H:%M')"
    echo "Commit creado: $(git log --oneline -1)"
  fi

  if git remote get-url origin >/dev/null 2>&1; then
    if git push origin main 2>&1; then
      echo "Push a origin/main: OK"
    else
      echo "ERROR: push falló (¿credenciales/red?)"
    fi
  else
    echo "AVISO: aún sin remoto 'origin' — el respaldo quedó en commits locales"
  fi

  echo "=== fin ==="
  echo ""
} >> "$LOG" 2>&1
