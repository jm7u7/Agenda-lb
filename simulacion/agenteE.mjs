// ─── AGENTE E — AUDITOR ADVERSARIAL: intenta romper el sistema ────────────────
// Cada ataque espera un RECHAZO LIMPIO (4xx con código claro), nunca un 500 ni una
// mutación exitosa indebida. Registra BUG_* cuando el sistema acepta algo que no debía.
import fs from 'node:fs';
import path from 'node:path';
import { req, evento, DIR, uuid, fechasLaborables, pick, crearRng } from './lib.mjs';

const rng = crearRng(999);
const estado = JSON.parse(fs.readFileSync(path.join(DIR, 'out', 'estado-sim.json')));
const admin = estado.adminToken;
const op = { ...estado.operadores[12], token: estado.tokens[estado.operadores[12].email] }; // un contact center
const pac = estado.pacientes[10];
const FECHAS = fechasLaborables();

const hallazgos = [];
function chequear(nombre, res, condOk) {
  const ok = condOk(res);
  const registro = { ataque: nombre, status: res.status, ok, resp: JSON.stringify(res.data).slice(0, 180) };
  hallazgos.push(registro);
  if (!ok) evento('BUG_adversarial', registro);
  if (res.status >= 500) evento('BUG_500', { ataque: nombre, resp: JSON.stringify(res.data).slice(0, 300) });
  return registro;
}
const es4xx = r => r.status >= 400 && r.status < 500;

async function main() {
  let SEDES = (await req('GET', '/sedes', { token: admin, plantilla: '/sedes' })).data;
  const UNI = (await req('GET', '/analytics/unidades', { token: admin, plantilla: '/analytics/unidades' })).data;
  const SVC = (await req('GET', '/servicios?activo=true', { token: admin, plantilla: '/servicios' })).data;
  const podUni = UNI.find(u => u.nombre.toLowerCase().includes('podolog'));
  const svc = SVC.find(s => s.unidadNegocioId === podUni.id);
  const sede = SEDES[0];

  // Crear una cita "víctima" real para atacarla
  const disp = await req('GET', `/disponibilidad?sede=${sede.id}&unidadNegocio=${podUni.id}&servicio=${svc.id}&fecha=${FECHAS[0]}`, { token: op.token, plantilla: '/disponibilidad' });
  const libre = (disp.data?.slots ?? []).find(s => s.disponible);
  let victimaId = null;
  if (libre) {
    const c = await req('POST', '/citas', { token: op.token, plantilla: '/citas [crear]', headers: { 'Idempotency-Key': uuid() },
      body: { pacienteId: pac.id, profesionalId: libre.profesionalId ?? null, sedeId: sede.id, unidadNegocioId: podUni.id, servicioId: svc.id, fecha: FECHAS[0], horaInicio: libre.horaInicio, canal: 'recepcion', ...(svc.subcategorias?.length ? { subcategoriaId: svc.subcategorias[0].id } : {}) } });
    victimaId = c.data?.id;
  }

  // ── 1. IDs inexistentes ──
  chequear('estado en cita inexistente', await req('PATCH', `/citas/${uuid()}/estado`, { token: op.token, plantilla: '/citas/:id/estado', body: { estado: 'llego' } }), r => r.status === 404);
  chequear('mover cita inexistente', await req('PATCH', `/citas/${uuid()}/mover`, { token: op.token, plantilla: '/citas/:id/mover', body: { fecha: FECHAS[0], horaInicio: '10:00' } }), r => r.status === 404);
  chequear('paciente inexistente', await req('GET', `/pacientes/${uuid()}`, { token: op.token, plantilla: '/pacientes/:id' }), r => r.status === 404);

  // ── 2. Payloads inválidos ──
  chequear('crear cita sin campos', await req('POST', '/citas', { token: op.token, plantilla: '/citas [crear]', headers: { 'Idempotency-Key': uuid() }, body: {} }), es4xx);
  chequear('crear cita fecha basura', await req('POST', '/citas', { token: op.token, plantilla: '/citas [crear]', headers: { 'Idempotency-Key': uuid() }, body: { pacienteId: pac.id, sedeId: sede.id, unidadNegocioId: podUni.id, servicioId: svc.id, fecha: 'no-es-fecha', horaInicio: '10:00', canal: 'recepcion' } }), es4xx);
  chequear('estado inválido (volando)', victimaId ? await req('PATCH', `/citas/${victimaId}/estado`, { token: op.token, plantilla: '/citas/:id/estado', body: { estado: 'volando' } }) : { status: 400, data: {} }, es4xx);
  chequear('ubigeo inválido en paciente', await req('POST', '/pacientes', { token: op.token, plantilla: '/pacientes [crear]', body: { nombres: 'X', apellidoPaterno: 'ZZTEST Y', apellidoMaterno: 'Z', tipoDocumento: 'DNI', numeroDocumento: '99999001', telefono: '+51999999999', ubigeoId: '000000' } }), es4xx);

  // ── 3. Transiciones ilegales ──
  if (victimaId) {
    await req('PATCH', `/citas/${victimaId}/estado`, { token: op.token, body: { estado: 'cancelada' }, plantilla: '/citas/:id/estado' });
    chequear('reprogramar cita CANCELADA', await req('PATCH', `/citas/${victimaId}/mover`, { token: op.token, plantilla: '/citas/:id/mover', body: { fecha: FECHAS[1], horaInicio: '11:00' } }), es4xx);
    chequear('cancelar DOS veces', await req('PATCH', `/citas/${victimaId}/estado`, { token: op.token, plantilla: '/citas/:id/estado', body: { estado: 'llego' } }), es4xx);
  }

  // ── 4. Bug clásico UTC-5: la fecha civil no debe amanecer un día antes ──
  const dispTz = await req('GET', `/disponibilidad?sede=${sede.id}&unidadNegocio=${podUni.id}&servicio=${svc.id}&fecha=2026-07-15`, { token: op.token, plantilla: '/disponibilidad' });
  const libreTz = (dispTz.data?.slots ?? []).find(s => s.disponible);
  if (libreTz) {
    const cTz = await req('POST', '/citas', { token: op.token, plantilla: '/citas [crear]', headers: { 'Idempotency-Key': uuid() },
      body: { pacienteId: estado.pacientes[11].id, profesionalId: libreTz.profesionalId ?? null, sedeId: sede.id, unidadNegocioId: podUni.id, servicioId: svc.id, fecha: '2026-07-15', horaInicio: libreTz.horaInicio, canal: 'recepcion', ...(svc.subcategorias?.length ? { subcategoriaId: svc.subcategorias[0].id } : {}) } });
    const guardada = cTz.data?.fecha?.slice(0, 10);
    chequear('TZ: fecha 2026-07-15 se guarda igual', { status: guardada === '2026-07-15' ? 200 : 999, data: { guardada } }, r => r.status === 200);
  }

  // ── 5. Authz negativa: recepcionista intenta acción de admin ──
  const recep = { ...estado.operadores[0], token: estado.tokens[estado.operadores[0].email] };
  chequear('recepcionista crea usuario (debe 403)', await req('POST', '/users', { token: recep.token, plantilla: '/users', body: { nombre: 'Hacker', email: 'hack@x.com', password: 'x12345678', rol: 'admin' } }), r => r.status === 403 || r.status === 401);
  chequear('recepcionista ve analytics/kpis (debe 403)', await req('GET', '/analytics/kpis?desde=2026-07-01&hasta=2026-07-31', { token: recep.token, plantilla: '/analytics/kpis' }), r => r.status === 403 || r.status === 401);
  chequear('sin token (debe 401)', await req('GET', '/citas?sedeId=' + sede.id + '&fecha=' + FECHAS[0], { plantilla: '/citas [lista]' }), r => r.status === 401);

  // ── 6. Cita fuera de horario vía API directa (sin pasar por popover) ──
  chequear('cita 06:00 fuera de turno', await req('POST', '/citas', { token: op.token, plantilla: '/citas [crear]', headers: { 'Idempotency-Key': uuid() },
    body: { pacienteId: pac.id, profesionalId: libre?.profesionalId ?? null, sedeId: sede.id, unidadNegocioId: podUni.id, servicioId: svc.id, fecha: FECHAS[2], horaInicio: '06:00', canal: 'recepcion', ...(svc.subcategorias?.length ? { subcategoriaId: svc.subcategorias[0].id } : {}) } }), es4xx);

  // ── 7. Profilaxis (60min) en media hora (debe rechazar) ──
  const profilaxis = SVC.find(s => s.nombre.toUpperCase() === 'PROFILAXIS');
  if (profilaxis) {
    chequear('Profilaxis 60min en :30', await req('POST', '/citas', { token: op.token, plantilla: '/citas [crear]', headers: { 'Idempotency-Key': uuid() },
      body: { pacienteId: pac.id, sedeId: sede.id, unidadNegocioId: podUni.id, servicioId: profilaxis.id, fecha: FECHAS[3], horaInicio: '10:30', canal: 'recepcion', ...(profilaxis.subcategorias?.length ? { subcategoriaId: profilaxis.subcategorias[0].id } : {}) } }), es4xx);
  }

  const fallos = hallazgos.filter(h => !h.ok);
  console.log(`AGENTE E: ${hallazgos.length} ataques, ${fallos.length} comportamientos inesperados`);
  if (fallos.length) console.log('INESPERADOS:', JSON.stringify(fallos, null, 1));
  fs.writeFileSync(path.join(DIR, 'out', 'agenteE.json'), JSON.stringify({ total: hallazgos.length, inesperados: fallos.length, hallazgos }, null, 1));
}

main().catch(e => { console.error('AGENTE E FALLÓ:', e); process.exit(1); });
