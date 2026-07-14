// ─── AGENTE D — COMUNICACIONES: dispara correos y consulta estado real en Resend ──
// Dispara la confirmación por correo (POST /citas/:id/confirmar-mail → envío INMEDIATO
// vía Resend a direcciones sandbox), captura el resendEmailId de la BD, y consulta el
// estado real en la API de Resend (GET /emails/:id). Construye emailId→estado→cita.
// Muestra distribución delivered/bounced/complained según el patrón sandbox del paciente.
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { req, evento, DIR } from './lib.mjs';

const estado = JSON.parse(fs.readFileSync(path.join(DIR, 'out', 'estado-sim.json')));
const admin = estado.adminToken;
const RESEND_KEY = process.env.RESEND_API_KEY || (() => {
  const env = fs.readFileSync(path.join(DIR, '..', 'apps', 'api', '.env.simulacion'), 'utf8');
  return env.match(/RESEND_API_KEY="([^"]+)"/)?.[1];
})();
const psql = (q) => execSync(`docker exec limablue_postgres psql -U limablue -d limablue_agenda_simulacion -tAc "${q.replace(/"/g, '\\"')}"`).toString().trim();

async function estadoResend(emailId) {
  try {
    const r = await fetch(`https://api.resend.com/emails/${emailId}`, { headers: { Authorization: `Bearer ${RESEND_KEY}` } });
    if (!r.ok) return { last_event: `http_${r.status}` };
    return await r.json();
  } catch (e) { return { last_event: 'error', err: String(e) }; }
}

async function main() {
  // Elegir 40 citas activas (variando el patrón de email del paciente) para disparar confirmación
  const filas = psql(`
    SELECT c.id, p.email FROM citas c JOIN pacientes p ON p.id=c."pacienteId"
    WHERE c."deletedAt" IS NULL AND c.estado IN ('agendada','confirmada') AND p.email IS NOT NULL
    ORDER BY p.email LIMIT 40;`).split('\n').filter(Boolean).map(l => { const [id, email] = l.split('|'); return { id, email }; });

  console.log(`disparando confirmación de ${filas.length} citas...`);
  const enviados = [];
  for (const f of filas) {
    const r = await req('POST', `/citas/${f.id}/confirmar-mail`, { token: admin, plantilla: '/citas/:id/confirmar-mail' });
    enviados.push({ citaId: f.id, email: f.email, status: r.status, resp: r.status >= 400 ? JSON.stringify(r.data).slice(0, 150) : null });
    if (r.status >= 500) evento('BUG_500', { ataque: 'confirmar-mail', resp: JSON.stringify(r.data).slice(0, 200) });
  }

  // Esperar a que Resend procese y capturar resendEmailId de la BD
  await new Promise(r => setTimeout(r, 4000));
  const recordatorios = psql(`
    SELECT r.id, r."citaId", r."resendEmailId", r.estado, p.email
    FROM recordatorios_cita r JOIN citas c ON c.id=r."citaId" JOIN pacientes p ON p.id=c."pacienteId"
    WHERE r."resendEmailId" IS NOT NULL ORDER BY r."enviadoAt" DESC NULLS LAST LIMIT 60;`)
    .split('\n').filter(Boolean).map(l => { const [id, citaId, emailId, est, email] = l.split('|'); return { id, citaId, emailId, estado: est, email }; });

  // Consultar el estado REAL de cada correo en Resend
  const tabla = [];
  for (const rec of recordatorios) {
    const info = await estadoResend(rec.emailId);
    tabla.push({ emailId: rec.emailId, citaId: rec.citaId, email: rec.email, estadoBD: rec.estado, resendEvento: info.last_event ?? info.status ?? 'desconocido' });
  }

  const distrib = {};
  for (const t of tabla) { const k = t.resendEvento; distrib[k] = (distrib[k] ?? 0) + 1; }
  const porPatron = {};
  for (const t of tabla) { const p = t.email.split('+')[0]; porPatron[p] = (porPatron[p] ?? 0) + 1; }

  const salida = {
    disparados: enviados.length,
    disparoOk: enviados.filter(e => e.status === 200).length,
    disparoFallos: enviados.filter(e => e.status >= 400).map(e => ({ status: e.status, resp: e.resp })).slice(0, 5),
    conResendId: tabla.length,
    distribResend: distrib,
    porPatronSandbox: porPatron,
    muestra: tabla.slice(0, 8),
  };
  console.log('AGENTE D:', JSON.stringify(salida, null, 1));
  fs.writeFileSync(path.join(DIR, 'out', 'agenteD.json'), JSON.stringify({ ...salida, tabla }, null, 1));
}

main().catch(e => { console.error('AGENTE D FALLÓ:', e); process.exit(1); });
