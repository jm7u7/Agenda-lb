// Reproduce la CONTENCIÓN FK que causó los 3 deadlocks originales: muchos INSERT de
// citas CONCURRENTES en slots DISTINTOS (no chocan en el lock Redis) pero que comparten
// filas padre por FK — misma PROMOCIÓN + mismo paciente/sede populares. Bajo Serializable
// esto genera serialization_failure/deadlock (40001/40P01→P2034), que el retry debe absorber.
import { execSync } from 'node:child_process';
const BASE = 'http://localhost:3003/api/v1';
const uuid = () => crypto.randomUUID();
async function req(method, path, { token, body, key } = {}) {
  const r = await fetch(BASE + path, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(key ? { 'Idempotency-Key': key } : {}) }, body: body ? JSON.stringify(body) : undefined });
  let d = null; try { d = await r.json(); } catch {}
  return { status: r.status, data: d };
}

async function main() {
  const admin = (await req('POST', '/auth/login', { body: { email: 'admin@limablue.pe', password: 'Admin1234!' } })).data.token;
  const ops = [];
  for (let i = 0; i < 20; i++) { const email = `fk.op${i}@sim.local`; await req('POST', '/users', { token: admin, body: { nombre: `FK ${i}`, email, password: 'Simulacion2026!', rol: 'recepcionista' } }); ops.push((await req('POST', '/auth/login', { body: { email, password: 'Simulacion2026!' } })).data.token); }
  // pacientes ZZTEST compartidos (para que varias citas referencien el MISMO paciente por FK)
  const pacs = [];
  for (let i = 0; i < 6; i++) { const r = await req('POST', '/pacientes', { token: admin, key: uuid(), body: { nombres: 'FK', apellidoPaterno: `ZZTEST FK${i}`, apellidoMaterno: 'T', tipoDocumento: 'DNI', numeroDocumento: String(92000000 + i), telefono: '+51988000' + String(i).padStart(3, '0'), ubigeoId: '150131' } }); if (r.data?.id) pacs.push(r.data.id); }
  const sedes = (await req('GET', '/sedes', { token: admin })).data;
  const uni = (await req('GET', '/analytics/unidades', { token: admin })).data.find(u => u.nombre.toLowerCase().includes('podolog'));
  const svc = (await req('GET', '/servicios?activo=true', { token: admin })).data.find(s => s.unidadNegocioId === uni.id && s.duracionMinutos === 30);
  const sub = svc.subcategorias?.[0]?.id ?? null;
  const promo = (await req('GET', '/promociones', { token: admin })).data?.[0]; // MISMA promoción → FK compartido
  const FECHAS = Array.from({ length: 20 }, (_, i) => { const d = new Date('2026-08-01T12:00:00Z'); d.setUTCDate(d.getUTCDate() + i); return d.toISOString().slice(0, 10); }).filter(f => new Date(f + 'T12:00:00Z').getUTCDay() !== 0);

  let creadas = 0, err500 = 0, otros = 0, err4xx = 0;
  for (let ronda = 0; ronda < 80; ronda++) {
    const sede = sedes[ronda % sedes.length];
    const fecha = FECHAS[ronda % FECHAS.length];
    const disp = await req('GET', `/disponibilidad?sede=${sede.id}&unidadNegocio=${uni.id}&servicio=${svc.id}&fecha=${fecha}`, { token: admin });
    const libres = (disp.data?.slots ?? []).filter(s => s.disponible && s.profesionalId).slice(0, 20);
    if (libres.length < 2) continue;
    // 20 ops → cada uno a un slot DISTINTO (sin colisión de lock Redis), TODOS con la misma
    // promoción + un paciente del pool pequeño → contención FK sobre promoción/paciente.
    const reqs = ops.map((t, k) => {
      const slot = libres[k % libres.length];
      return req('POST', '/citas', { token: t, key: uuid(), body: { pacienteId: pacs[k % pacs.length], profesionalId: slot.profesionalId, sedeId: sede.id, unidadNegocioId: uni.id, servicioId: svc.id, ...(sub ? { subcategoriaId: sub } : {}), fecha, horaInicio: slot.horaInicio, canal: 'recepcion', ...(promo ? { promocionId: promo.id } : {}) } }).catch(() => ({ status: -1 }));
    });
    const rr = await Promise.all(reqs);
    creadas += rr.filter(r => r.status === 201).length;
    err500 += rr.filter(r => r.status >= 500).length;
    err4xx += rr.filter(r => r.status >= 400 && r.status < 500).length;
    otros += rr.filter(r => r.status < 0).length;
  }

  const LOG = '/private/tmp/claude-502/-Users-apple-Limablue-Agenda/5a530e1d-82f7-430a-a8fe-fed6473e1d5d/scratchpad/sim-api-m1.log';
  const deadlocks = parseInt(execSync(`grep -c '40P01' ${LOG} 2>/dev/null || echo 0`).toString().trim());
  const serial = parseInt(execSync(`grep -c 'could not serialize\\|40001' ${LOG} 2>/dev/null || echo 0`).toString().trim());
  const reintentos = parseInt(execSync(`grep -c 'deadlock al crear cita — reintento' ${LOG} 2>/dev/null || echo 0`).toString().trim());
  const psql = (q) => execSync(`docker exec limablue_postgres psql -U limablue -d limablue_agenda_simulacion -tAc "${q}"`).toString().trim();
  const dobles = parseInt(psql(`SELECT count(*) FROM (SELECT "profesionalId",fecha,"horaInicio" FROM citas WHERE "deletedAt" IS NULL AND estado NOT IN ('cancelada','no_show','reprogramada') AND "slotGrupoId" IS NULL GROUP BY 1,2,3 HAVING count(*)>1) x`));

  console.log(JSON.stringify({
    rondas: 80, citas_creadas: creadas, err_5xx: err500, err_4xx: err4xx, red: otros,
    deadlocks_40P01_en_log: deadlocks, serialization_failures_en_log: serial,
    reintentos_disparados_por_helper: reintentos,
    doble_booking_en_BD: dobles,
  }, null, 1));
}
main().catch(e => { console.error('FALLÓ:', e); process.exit(1); });
