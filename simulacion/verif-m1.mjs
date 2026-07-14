// ─── Verificación del FIX M-1 (deadlock retry en POST /citas) — F1..F5 ────────
// Corre contra la API de simulación (:3003, BD aislada). Recrea el escenario 3.1
// (slot dorado, 20 operadores ×N rondas) + F2/F3/F5, y mide latencia.
import { execSync } from 'node:child_process';

const BASE = 'http://localhost:3003/api/v1';
const psql = (q) => execSync(`docker exec limablue_postgres psql -U limablue -d limablue_agenda_simulacion -tAc "${q.replace(/"/g, '\\"')}"`).toString().trim();
const uuid = () => crypto.randomUUID();
const pctl = (a, p) => { a = [...a].sort((x, y) => x - y); return a[Math.min(a.length - 1, Math.floor(a.length * p / 100))]; };

async function req(method, path, { token, body, key } = {}) {
  const t0 = Date.now();
  const r = await fetch(BASE + path, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(key ? { 'Idempotency-Key': key } : {}) }, body: body ? JSON.stringify(body) : undefined });
  let data = null; try { data = await r.json(); } catch {}
  return { status: r.status, data, ms: Date.now() - t0 };
}

const RONDAS = Number(process.argv[2] ?? 50);

async function main() {
  const admin = (await req('POST', '/auth/login', { body: { email: 'admin@limablue.pe', password: 'Admin1234!' } })).data.token;

  // 20 operadores (crear + login)
  const ops = [];
  for (let i = 0; i < 20; i++) {
    const email = `m1.op${i}@sim.local`;
    await req('POST', '/users', { token: admin, body: { nombre: `M1 Op ${i}`, email, password: 'Simulacion2026!', rol: 'recepcionista' } });
    ops.push((await req('POST', '/auth/login', { body: { email, password: 'Simulacion2026!' } })).data.token);
  }

  // 60 pacientes ZZTEST para tener víctimas de cita
  const pacIds = [];
  for (let i = 0; i < 60; i++) {
    const r = await req('POST', '/pacientes', { token: admin, key: uuid(), body: { nombres: 'M1', apellidoPaterno: `ZZTEST P${i}`, apellidoMaterno: 'Test', tipoDocumento: 'DNI', numeroDocumento: String(91000000 + i), telefono: '+51999000' + String(i).padStart(3, '0'), ubigeoId: '150131' } });
    if (r.data?.id) pacIds.push(r.data.id);
  }

  const sedes = (await req('GET', '/sedes', { token: admin })).data;
  const uni = (await req('GET', '/analytics/unidades', { token: admin })).data.find(u => u.nombre.toLowerCase().includes('podolog'));
  const svc = (await req('GET', '/servicios?activo=true', { token: admin })).data.find(s => s.unidadNegocioId === uni.id && s.duracionMinutos === 30);
  const sub = svc.subcategorias?.[0]?.id ?? null;
  const FECHAS = Array.from({ length: 20 }, (_, i) => { const d = new Date('2026-07-13T12:00:00Z'); d.setUTCDate(d.getUTCDate() + i); return d.toISOString().slice(0, 10); }).filter(f => new Date(f + 'T12:00:00Z').getUTCDay() !== 0);

  let pIdx = 0;
  const cuerpo = (sede, prof, fecha, hora) => ({ pacienteId: pacIds[(pIdx++) % pacIds.length], profesionalId: prof, sedeId: sede.id, unidadNegocioId: uni.id, servicioId: svc.id, ...(sub ? { subcategoriaId: sub } : {}), fecha, horaInicio: hora, canal: 'recepcion' });

  // ── F1 · SLOT DORADO: 20 ops al mismo slot, RONDAS veces ──
  const dorado = { rondas: 0, exitos: 0, rechazos: 0, quinientos: 0, duplicados: 0, latencias: [] };
  for (let k = 0; k < RONDAS; k++) {
    const sede = sedes[k % sedes.length];
    const fecha = FECHAS[3 + (k % 15)];
    const disp = await req('GET', `/disponibilidad?sede=${sede.id}&unidadNegocio=${uni.id}&servicio=${svc.id}&fecha=${fecha}`, { token: admin });
    const libre = (disp.data?.slots ?? []).find(s => s.disponible && s.profesionalId);
    if (!libre) continue;
    dorado.rondas++;
    const body = cuerpo(sede, libre.profesionalId, fecha, libre.horaInicio);
    const rr = await Promise.all(ops.map(t => req('POST', '/citas', { token: t, key: uuid(), body }).catch(() => ({ status: -1, ms: 0 }))));
    dorado.exitos += rr.filter(r => r.status === 201).length;
    dorado.rechazos += rr.filter(r => r.status >= 400 && r.status < 500).length;
    dorado.quinientos += rr.filter(r => r.status >= 500).length;
    dorado.latencias.push(...rr.map(r => r.ms).filter(Boolean));
    const vivas = parseInt(psql(`SELECT count(*) FROM citas WHERE "profesionalId"='${libre.profesionalId}' AND fecha='${fecha}' AND "horaInicio"='${libre.horaInicio}' AND "deletedAt" IS NULL AND estado NOT IN ('cancelada','no_show','reprogramada')`));
    if (vivas > 1) dorado.duplicados++;
  }

  // ── F3 · negocio genuino: slot realmente ocupado → 409 en el PRIMER intento, sin retry ──
  let f3 = { status: null, ms: null };
  const sedeF3 = sedes[0], fechaF3 = FECHAS[18];
  const dispF3 = await req('GET', `/disponibilidad?sede=${sedeF3.id}&unidadNegocio=${uni.id}&servicio=${svc.id}&fecha=${fechaF3}`, { token: admin });
  const slotF3 = (dispF3.data?.slots ?? []).find(s => s.disponible && s.profesionalId);
  if (slotF3) {
    await req('POST', '/citas', { token: admin, key: uuid(), body: cuerpo(sedeF3, slotF3.profesionalId, fechaF3, slotF3.horaInicio) }); // ocupa
    const dup = await req('POST', '/citas', { token: ops[0], key: uuid(), body: cuerpo(sedeF3, slotF3.profesionalId, fechaF3, slotF3.horaInicio) }); // choca
    f3 = { status: dup.status, error: dup.data?.error, ms: dup.ms };
  }

  // ── F5 · lock Redis no queda huérfano tras la ráfaga ──
  const locksResiduales = parseInt(execSync(`docker exec limablue_redis redis-cli -n 1 --scan --pattern 'lock:slot:*' | wc -l`).toString().trim());

  // ── Deadlocks en el log del servidor (F1) + reintentos disparados ──
  const LOG = '/private/tmp/claude-502/-Users-apple-Limablue-Agenda/5a530e1d-82f7-430a-a8fe-fed6473e1d5d/scratchpad/sim-api-m1.log';
  let deadlocksLog = 0, reintentosLog = 0;
  try { deadlocksLog = parseInt(execSync(`grep -c '40P01' ${LOG} 2>/dev/null || echo 0`).toString().trim()); } catch {}
  try { reintentosLog = parseInt(execSync(`grep -c 'deadlock al crear cita — reintento' ${LOG} 2>/dev/null || echo 0`).toString().trim()); } catch {}

  const salida = {
    F1_slotDorado: { rondas: dorado.rondas, exitos: dorado.exitos, rechazos: dorado.rechazos, quinientos: dorado.quinientos, duplicadosBD: dorado.duplicados,
      unGanadorPorRonda: dorado.exitos === dorado.rondas },
    F2_duplicados_en_BD: dorado.duplicados,   // debe 0 (índice único = última defensa)
    F3_negocio_ocupado: f3,                   // debe 409 SLOT_OCUPADO al primer intento
    F5_locks_redis_residuales: locksResiduales, // debe 0
    deadlocks_en_log: deadlocksLog,
    reintentos_disparados: reintentosLog,
    latencia_POST_citas: { p50: pctl(dorado.latencias, 50), p95: pctl(dorado.latencias, 95), p99: pctl(dorado.latencias, 99), n: dorado.latencias.length },
  };
  console.log(JSON.stringify(salida, null, 1));
}
main().catch(e => { console.error('VERIF FALLÓ:', e); process.exit(1); });
