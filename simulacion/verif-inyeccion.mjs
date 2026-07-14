// PRUEBA DEFINITIVA del retry ante conflicto REAL + F3 (negocio) + F4 (latencia happy path).
// Inyecta un conflicto de serialización: abre una transacción psql que hace FOR UPDATE
// sobre la fila de la PROMOCIÓN y la retiene ~700ms; en paralelo dispara POST /citas con esa
// promoción (tx Serializable). Bajo contención, el endpoint sufre serialization_failure/deadlock
// (40001/40P01→P2034), el helper reintenta, y cuando el hold suelta, la cita se crea. Se
// confirma: 0 respuestas 5xx, la cita SÍ se crea, y (si el hold fuerza el conflicto) el helper
// deja rastro de reintento en el log.
import { execSync, spawn } from 'node:child_process';
const BASE = 'http://localhost:3003/api/v1';
const uuid = () => crypto.randomUUID();
const dormir = (ms) => new Promise(r => setTimeout(r, ms));
async function req(method, path, { token, body, key } = {}) {
  const t0 = Date.now();
  const r = await fetch(BASE + path, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(key ? { 'Idempotency-Key': key } : {}) }, body: body ? JSON.stringify(body) : undefined });
  let d = null; try { d = await r.json(); } catch {}
  return { status: r.status, data: d, ms: Date.now() - t0 };
}
const psql = (q) => execSync(`docker exec limablue_postgres psql -U limablue -d limablue_agenda_simulacion -tAc '${q}'`).toString().trim();
const LOG = '/private/tmp/claude-502/-Users-apple-Limablue-Agenda/5a530e1d-82f7-430a-a8fe-fed6473e1d5d/scratchpad/sim-api-m1.log';
const contarReintentos = () => parseInt(execSync(`grep -c 'reintento' ${LOG} 2>/dev/null || echo 0`).toString().trim());

async function main() {
  const admin = (await req('POST', '/auth/login', { body: { email: 'admin@limablue.pe', password: 'Admin1234!' } })).data.token;
  const sedes = (await req('GET', '/sedes', { token: admin })).data;
  const uni = (await req('GET', '/analytics/unidades', { token: admin })).data.find(u => u.nombre.toLowerCase().includes('podolog'));
  const svc = (await req('GET', '/servicios?activo=true', { token: admin })).data.find(s => s.unidadNegocioId === uni.id && s.duracionMinutos === 30);
  const sub = svc.subcategorias?.[0]?.id ?? null;
  const promo = (await req('GET', '/promociones', { token: admin })).data?.[0];
  const _doc = String(94000000 + Math.floor(Math.random() * 900000));
  const pac = (await req('POST', '/pacientes', { token: admin, key: uuid(), body: { nombres: 'Iny', apellidoPaterno: 'ZZTEST Iny', apellidoMaterno: 'Test', tipoDocumento: 'DNI', numeroDocumento: _doc, telefono: '+51977' + _doc.slice(0, 6), ubigeoId: '150131' } })).data.id;
  if (!pac) throw new Error('no se pudo crear el paciente de prueba');
  const cuerpo = (sede, prof, fecha, hora) => ({ pacienteId: pac, profesionalId: prof, sedeId: sede.id, unidadNegocioId: uni.id, servicioId: svc.id, ...(sub ? { subcategoriaId: sub } : {}), fecha, horaInicio: hora, canal: 'recepcion', ...(promo ? { promocionId: promo.id } : {}) });

  // ── INYECCIÓN: hold FOR UPDATE sobre la promoción mientras se crea una cita que la usa ──
  const reintentosAntes = contarReintentos();
  const sede = sedes[0]; const fechaIny = '2026-08-20';
  const disp = await req('GET', `/disponibilidad?sede=${sede.id}&unidadNegocio=${uni.id}&servicio=${svc.id}&fecha=${fechaIny}`, { token: admin });
  const slot = (disp.data?.slots ?? []).find(s => s.disponible && s.profesionalId);
  let inyeccion = { creada: null, status: null, ms: null, err5xx: false };
  if (slot && promo) {
    // Retener la fila de la promoción ~800ms en una tx aparte (bloquea el FK KEY-SHARE del insert)
    const hold = spawn('docker', ['exec', '-i', 'limablue_postgres', 'psql', '-U', 'limablue', '-d', 'limablue_agenda_simulacion',
      '-c', `BEGIN; SELECT * FROM promociones WHERE id='${promo.id}' FOR UPDATE; SELECT pg_sleep(0.8); COMMIT;`]);
    await dormir(120); // asegurar que el hold tomó el lock primero
    const r = await req('POST', '/citas', { token: admin, key: uuid(), body: cuerpo(sede, slot.profesionalId, fechaIny, slot.horaInicio) });
    await new Promise(res => hold.on('close', res));
    inyeccion = { creada: r.data?.id ? true : false, status: r.status, ms: r.ms, err5xx: r.status >= 500 };
  }
  const reintentosDespues = contarReintentos();

  // ── F3: slot GENUINAMENTE ocupado → 409 SLOT_OCUPADO al PRIMER intento (sin reintentos) ──
  const fechaF3 = '2026-08-21';
  const dF3 = await req('GET', `/disponibilidad?sede=${sede.id}&unidadNegocio=${uni.id}&servicio=${svc.id}&fecha=${fechaF3}`, { token: admin });
  const sF3 = (dF3.data?.slots ?? []).find(s => s.disponible && s.profesionalId);
  let f3 = { status: null };
  if (sF3) {
    await req('POST', '/citas', { token: admin, key: uuid(), body: cuerpo(sede, sF3.profesionalId, fechaF3, sF3.horaInicio) }); // ocupa
    const reintPre = contarReintentos();
    const dup = await req('POST', '/citas', { token: admin, key: uuid(), body: cuerpo(sede, sF3.profesionalId, fechaF3, sF3.horaInicio) }); // choca
    f3 = { status: dup.status, error: dup.data?.error, ms: dup.ms, reintentosGenerados: contarReintentos() - reintPre };
  }

  // ── F4: latencia del happy path (sin contención), 60 creaciones secuenciales ──
  const lat = [];
  for (let i = 0; i < 60; i++) {
    const fecha = ['2026-08-24', '2026-08-25', '2026-08-26', '2026-08-27', '2026-08-28'][i % 5];
    const d = await req('GET', `/disponibilidad?sede=${sedes[i % sedes.length].id}&unidadNegocio=${uni.id}&servicio=${svc.id}&fecha=${fecha}`, { token: admin });
    const sl = (d.data?.slots ?? []).find(s => s.disponible && s.profesionalId);
    if (!sl) continue;
    const r = await req('POST', '/citas', { token: admin, key: uuid(), body: cuerpo(sedes[i % sedes.length], sl.profesionalId, fecha, sl.horaInicio) });
    if (r.status === 201) lat.push(r.ms);
  }
  const pctl = (a, p) => { a = [...a].sort((x, y) => x - y); return a.length ? a[Math.min(a.length - 1, Math.floor(a.length * p / 100))] : null; };

  console.log(JSON.stringify({
    inyeccion_conflicto: { ...inyeccion, reintentos_disparados: reintentosDespues - reintentosAntes },
    F3_negocio_ocupado: f3,
    F4_latencia_happy_path: { n: lat.length, p50: pctl(lat, 50), p95: pctl(lat, 95), p99: pctl(lat, 99) },
    err_5xx_en_access_log: parseInt(execSync(`grep -oE '" 5[0-9][0-9] ' ${LOG} 2>/dev/null | wc -l`).toString().trim()),
  }, null, 1));
}
main().catch(e => { console.error('FALLÓ:', e); process.exit(1); });
