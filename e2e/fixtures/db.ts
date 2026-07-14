// Acceso a la BD/Redis del entorno E2E AISLADO, con GUARDAS DURAS.
// Todo pasa por aquí; si el destino no es el entorno e2e, aborta (nunca toca producción).
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const REPO = path.resolve(__dirname, '../..');
const ENV_E2E = path.join(REPO, 'apps/api/.env.e2e');

function leerEnv(clave: string): string {
  const src = readFileSync(ENV_E2E, 'utf8');
  const m = src.match(new RegExp(`^${clave}="?([^"\\n]*)"?`, 'm'));
  return m ? m[1] : '';
}

// ── DATABASE guard: el nombre de BD DEBE contener "_e2e" ──────────────────────
const DB_URL = new URL(leerEnv('DATABASE_URL'));
export const E2E_DB_NAME = DB_URL.pathname.replace(/^\//, '');
if (!/_e2e$/.test(E2E_DB_NAME)) {
  throw new Error(`GUARD E2E: DATABASE_URL apunta a "${E2E_DB_NAME}", que NO termina en _e2e. Abortado para no tocar otra BD.`);
}

// ── REDIS guard: el db index DEBE ser 3 ──────────────────────────────────────
const REDIS_URL = new URL(leerEnv('REDIS_URL') || 'redis://localhost:6379');
export const E2E_REDIS_DB = REDIS_URL.pathname.replace(/^\//, '') || '0';
if (E2E_REDIS_DB !== '3') {
  throw new Error(`GUARD E2E: REDIS_URL usa db index "${E2E_REDIS_DB}", no 3. Abortado.`);
}

const PG = 'limablue_postgres';
const REDIS = 'limablue_redis';

/** Ejecuta SQL contra la BD e2e y devuelve stdout crudo (psql -tAc). */
export function psql(query: string): string {
  const q = query.replace(/"/g, '\\"');
  return execSync(`docker exec ${PG} psql -U limablue -d ${E2E_DB_NAME} -tAc "${q}"`).toString().trim();
}

/** Filas como arrays de columnas (separador '|'). */
export function psqlRows(query: string): string[][] {
  const out = psql(query);
  return out ? out.split('\n').map((r) => r.split('|')) : [];
}

/** FLUSHDB del Redis e2e — SOLO si el db index es 3 (doble verificación). */
export function flushRedisE2E(): void {
  if (E2E_REDIS_DB !== '3') throw new Error(`GUARD E2E: intento de flush en db "${E2E_REDIS_DB}" ≠ 3. Abortado.`);
  execSync(`docker exec ${REDIS} redis-cli -n 3 FLUSHDB`);
}

/**
 * Estado limpio y determinista antes de cada test: TRUNCATE de las tablas volátiles
 * (citas + bloqueos y, en cascada, sus dependientes: recordatorios, comentarios, consumos,
 * videos…) y flush de la caché/locks de Redis e2e. El catálogo (sedes/profesionales/servicios)
 * queda intacto. Los specs siembran las citas que necesiten (reseed por test).
 */
export function resetMutables(): void {
  psql('TRUNCATE citas, bloqueos_agenda RESTART IDENTITY CASCADE');
  flushRedisE2E();
}
