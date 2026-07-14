// Global setup: valida las GUARDAS del entorno aislado y asegura el catálogo sembrado.
// Solo toca la BD e2e (Docker), independiente de los webServers que arranca Playwright.
import { execSync } from 'node:child_process';
import path from 'node:path';
import { E2E_DB_NAME, E2E_REDIS_DB, psql } from './fixtures/db';

export default async function globalSetup() {
  // Importar db.ts ya habría lanzado si las guardas fallaran; reconfirmamos en el log.
  console.log(`[e2e] guardas OK → BD=${E2E_DB_NAME} · Redis db=${E2E_REDIS_DB}`);

  // Catálogo determinista: si no hay sedes, sembrar (idempotente entre corridas).
  const nSedes = parseInt(psql('SELECT count(*) FROM sedes WHERE "deletedAt" IS NULL') || '0', 10);
  if (nSedes === 0) {
    console.log('[e2e] catálogo vacío → sembrando (db:seed)…');
    const apiDir = path.resolve(__dirname, '../apps/api');
    const dbUrl = execSync(`grep '^DATABASE_URL=' "${path.join(apiDir, '.env.e2e')}" | sed 's/^DATABASE_URL=//; s/"//g'`).toString().trim();
    execSync('npm run db:seed', { cwd: apiDir, env: { ...process.env, DATABASE_URL: dbUrl }, stdio: 'inherit' });
  } else {
    console.log(`[e2e] catálogo presente (${nSedes} sedes) — no se re-siembra.`);
  }

  // Canales de reserva: el seed no los crea; sin 'recepcion' fallaría crear cita (CANAL_INVALIDO).
  const nCanales = parseInt(psql('SELECT count(*) FROM canales WHERE "deletedAt" IS NULL') || '0', 10);
  if (nCanales === 0) {
    psql(
      `INSERT INTO canales (id, valor, etiqueta, activo, orden, "creadoEn", "actualizadoEn") VALUES ` +
      `(gen_random_uuid(),'recepcion','Recepción',true,0,now(),now()),` +
      `(gen_random_uuid(),'web','Chat WEB',true,1,now(),now()),` +
      `(gen_random_uuid(),'whatsapp','WhatsApp',true,2,now(),now())`,
    );
    console.log('[e2e] canales sembrados (recepcion/web/whatsapp).');
  }
}
