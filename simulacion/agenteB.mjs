// ─── AGENTE B — DEMANDA: 20 operadores concurrentes ejecutan la máquina de estados ──
// Cada paciente: 100% ≥1 cita, 40% 2+; por cita: 55% asiste, 12% no-show, 15% reprograma
// (1-3 veces), 10% cancela (½ >24h vía estado, ½ último minuto vía DELETE), 5% llega
// tarde, 3% walk-in hoy. 10% combinadas, 20% con promoción. Popover-first SIEMPRE:
// solo se reserva lo que GET /disponibilidad mostró libre; un 409 tras verlo libre se
// registra como evento de carrera (el bug sería el duplicado exitoso, no el rechazo).
import fs from 'node:fs';
import path from 'node:path';
import { req, crearRng, pick, evento, DIR, fechasLaborables, uuid, pool } from './lib.mjs';

const rng = crearRng(555);
const estado = JSON.parse(fs.readFileSync(path.join(DIR, 'out', 'estado-sim.json')));
const admin = estado.adminToken;
const FASE = process.argv[2] ?? '1'; // '1' = primeras citas (60%), '2' = resto + transiciones
const FECHAS = fechasLaborables();

// catálogos (una vez)
let SEDES, UNIDADES, SERVICIOS, PROMOS, CANALES, COMBI;
async function cargarCatalogos() {
  SEDES = (await req('GET', '/sedes', { token: admin, plantilla: '/sedes' })).data;
  UNIDADES = (await req('GET', '/analytics/unidades', { token: admin, plantilla: '/analytics/unidades' })).data;
  const svc = (await req('GET', '/servicios?activo=true', { token: admin, plantilla: '/servicios' })).data;
  SERVICIOS = svc;
  PROMOS = (await req('GET', '/promociones', { token: admin, plantilla: '/promociones' })).data ?? [];
  CANALES = ((await req('GET', '/canales', { token: admin, plantilla: '/canales' })).data ?? []).map(c => c.valor);
  COMBI = (await req('GET', '/combinaciones/config', { token: admin, plantilla: '/combinaciones/config' })).data;
}

const unidadPorNombre = (nom) => UNIDADES.find(u => u.nombre.toLowerCase().includes(nom));

function elegirServicio(rngL, unidadId) {
  const deUnidad = SERVICIOS.filter(s => s.unidadNegocioId === unidadId && s.activo !== false);
  return pick(rngL, deUnidad);
}

async function reservar(op, paciente, fecha, opciones = {}) {
  // 85% podología, 10% baro, 5% fisio (fisio solo Paz Soldán)
  const r = rng();
  const uni = r < 0.85 ? unidadPorNombre('podolog') : r < 0.95 ? unidadPorNombre('barop') : unidadPorNombre('fisio');
  let sede = op.sedeId ? SEDES.find(s => s.id === op.sedeId) : pick(rng, SEDES);
  if (uni.nombre.toLowerCase().includes('fisio')) sede = SEDES.find(s => s.nombre === 'Paz Soldán') ?? sede;
  const servicio = opciones.servicio ?? elegirServicio(rng, uni.id);
  if (!servicio) return { ok: false, motivo: 'sin-servicio' };

  // POPOVER-FIRST: la misma consulta que hace la UI
  const dispo = await req('GET', `/disponibilidad?sede=${sede.id}&unidadNegocio=${uni.id}&servicio=${servicio.id}&fecha=${fecha}`, { token: op.token, plantilla: '/disponibilidad', quien: op.email });
  const libres = (dispo.data?.slots ?? []).filter(s => s.disponible);
  if (libres.length === 0) return { ok: false, motivo: 'sin-slots' };

  const conPreferencia = uni.nombre.toLowerCase().includes('podolog') ? rng() < 0.3 : uni.nombre.toLowerCase().includes('fisio');
  const slot = pick(rng, libres);
  const subcat = servicio.subcategorias?.length ? pick(rng, servicio.subcategorias.filter(x => x.activo !== false)) : null;
  const promo = rng() < 0.2 && PROMOS.length ? pick(rng, PROMOS) : null;
  const canal = op.tipo === 'contact_center' ? pick(rng, CANALES.filter(c => c !== 'recepcion')) ?? 'central_telefonica' : 'recepcion';

  const body = {
    pacienteId: paciente.id,
    profesionalId: conPreferencia && slot.profesionalId ? slot.profesionalId : null,
    sedeId: sede.id, unidadNegocioId: uni.id, servicioId: servicio.id,
    ...(subcat ? { subcategoriaId: subcat.id } : {}),
    fecha, horaInicio: slot.horaInicio, canal,
    ...(promo ? { promocionId: promo.id } : {}),
  };
  const res = await req('POST', '/citas', {
    token: op.token, body, plantilla: '/citas [crear]', quien: op.email,
    headers: { 'Idempotency-Key': uuid() },
  });
  if (res.status === 201) return { ok: true, cita: res.data, sede, uni, servicio };
  if (res.status === 409 || res.data?.error === 'SLOT_OCUPADO' || res.data?.error === 'SLOT_LOCKED') {
    evento('carrera_slot', { quien: op.email, fecha, hora: slot.horaInicio, error: res.data?.error });
    return { ok: false, motivo: 'carrera', status: res.status };
  }
  evento('reserva_fallida', { quien: op.email, status: res.status, error: JSON.stringify(res.data).slice(0, 250), fecha, servicio: servicio.nombre });
  return { ok: false, motivo: 'error', status: res.status };
}

async function reservarCombinada(op, paciente, fecha) {
  if (!COMBI?.servicioAnclaId || !(COMBI?.combinables ?? []).length) return { ok: false, motivo: 'sin-config-combi' };
  const extras = COMBI.combinables.filter(x => x.servicio?.activo !== false);
  const ancla = SERVICIOS.find(s => s.id === COMBI.servicioAnclaId);
  if (!ancla) return { ok: false, motivo: 'ancla-no-encontrada' };
  const uni = unidadPorNombre('podolog');
  const sede = op.sedeId ? SEDES.find(s => s.id === op.sedeId) : pick(rng, SEDES);
  const dispo = await req('GET', `/disponibilidad?sede=${sede.id}&unidadNegocio=${uni.id}&servicio=${ancla.id}&fecha=${fecha}`, { token: op.token, plantilla: '/disponibilidad', quien: op.email });
  const libres = (dispo.data?.slots ?? []).filter(s => s.disponible && s.profesionalId);
  if (!libres.length) return { ok: false, motivo: 'sin-slots' };
  const slot = pick(rng, libres);
  const extra = pick(rng, extras);
  const subcat = ancla.subcategorias?.length ? pick(rng, ancla.subcategorias) : null;
  const res = await req('POST', '/citas/combinada', {
    token: op.token, plantilla: '/citas/combinada', quien: op.email,
    headers: { 'Idempotency-Key': uuid() },
    body: {
      pacienteId: paciente.id, profesionalId: slot.profesionalId, sedeId: sede.id,
      unidadNegocioId: uni.id, servicioId: ancla.id, ...(subcat ? { subcategoriaId: subcat.id } : {}),
      fecha, horaInicio: slot.horaInicio, canal: 'recepcion',
      extra: { servicioId: extra.servicioExtraId },
    },
  });
  if (res.status === 201) return { ok: true, combinada: res.data };
  evento('combinada_fallida', { status: res.status, error: JSON.stringify(res.data).slice(0, 250) });
  return { ok: false, motivo: 'error', status: res.status };
}

async function transicionar(op, citaId, estados, comentario) {
  for (const e of estados) {
    const r = await req('PATCH', `/citas/${citaId}/estado`, {
      token: op.token, plantilla: '/citas/:id/estado', quien: op.email,
      body: { estado: e, ...(comentario && e === estados[estados.length - 1] ? { comentario } : {}) },
    });
    if (r.status !== 200) { evento('transicion_fallida', { citaId, estado: e, status: r.status, error: JSON.stringify(r.data).slice(0, 200) }); return false; }
  }
  return true;
}

async function reprogramar(op, cita, veces) {
  let actual = cita;
  for (let i = 0; i < veces; i++) {
    const nuevaFecha = pick(rng, FECHAS);
    const dispo = await req('GET', `/disponibilidad?sede=${actual.sedeId}&unidadNegocio=${actual.unidadNegocioId}&servicio=${actual.servicioId}&fecha=${nuevaFecha}`, { token: op.token, plantilla: '/disponibilidad', quien: op.email });
    const libres = (dispo.data?.slots ?? []).filter(s => s.disponible);
    if (!libres.length) continue;
    const slot = pick(rng, libres);
    const r = await req('PATCH', `/citas/${actual.id}/mover`, {
      token: op.token, plantilla: '/citas/:id/mover', quien: op.email,
      body: { fecha: nuevaFecha, horaInicio: slot.horaInicio, ...(slot.profesionalId ? { profesionalId: slot.profesionalId } : {}) },
    });
    if (r.status === 200) { actual = { ...actual, fecha: nuevaFecha }; evento('reprogramada', { citaId: actual.id, intento: i + 1 }); }
    else if (r.status === 409) evento('carrera_slot', { contexto: 'mover', citaId: actual.id });
    else evento('mover_fallido', { citaId: actual.id, status: r.status, error: JSON.stringify(r.data).slice(0, 200) });
  }
  return actual;
}

async function vidaDeCita(op, paciente, esPrimera) {
  const destino = rng();
  const HOY = '2026-07-10';
  // 3% walk-in: cita HOY + llegó de una
  if (destino > 0.97) {
    const r = await reservar(op, paciente, HOY);
    if (r.ok) await transicionar(op, r.cita.id, ['llego'], 'Walk-in sin cita previa (simulación)');
    return r.ok ? 'walkin' : 'walkin-fallido';
  }
  // 10% combinada
  const fecha = pick(rng, FECHAS);
  if (rng() < 0.10) {
    const rc = await reservarCombinada(op, paciente, fecha);
    if (rc.ok) {
      const anclaId = rc.combinada.anclaId ?? rc.combinada.ancla?.id ?? rc.combinada.id;
      if (destino < 0.55 && anclaId) await transicionar(op, anclaId, ['confirmada', 'llego', 'en_atencion', 'completada']);
      return rc.ok ? 'combinada' : 'combinada-fallida';
    }
  }
  const r = await reservar(op, paciente, fecha);
  if (!r.ok) return 'reserva-fallida:' + r.motivo;
  const cita = r.cita;

  if (destino < 0.55) { await transicionar(op, cita.id, ['confirmada', 'llego', 'en_atencion', 'completada']); return 'asistio'; }
  if (destino < 0.67) { await transicionar(op, cita.id, ['no_show']); return 'noshow'; }
  if (destino < 0.82) {
    const movida = await reprogramar(op, cita, 1 + Math.floor(rng() * 3));
    if (rng() < 0.7) await transicionar(op, movida.id, ['confirmada', 'llego', 'en_atencion', 'completada']);
    return 'reprogramo';
  }
  if (destino < 0.92) {
    if (rng() < 0.5) { await transicionar(op, cita.id, ['cancelada']); return 'cancelo-24h'; }
    const rd = await req('DELETE', `/citas/${cita.id}`, { token: op.token, plantilla: '/citas/:id [DELETE]', quien: op.email });
    if (rd.status !== 200) evento('delete_fallido', { citaId: cita.id, status: rd.status });
    return 'cancelo-ultimo-minuto';
  }
  // 5% llega tarde
  await transicionar(op, cita.id, ['confirmada', 'llego'], 'Paciente llegó 25 min tarde (simulación)');
  await transicionar(op, cita.id, ['en_atencion', 'completada']);
  return 'tarde';
}

async function main() {
  await cargarCatalogos();
  const ops = estado.operadores.map(o => ({ ...o, token: estado.tokens[o.email] }));
  const pacientes = estado.pacientes;
  const mitad = Math.floor(pacientes.length * 0.6);
  const lote = FASE === '1' ? pacientes.slice(0, mitad) : pacientes.slice(mitad);

  const resumen = {};
  await pool(lote, 20, async (pac, i) => {
    const op = ops[i % ops.length];
    const nCitas = 1 + (rng() < 0.4 ? (rng() < 0.3 ? 2 : 1) : 0);
    for (let c = 0; c < nCitas; c++) {
      const resultado = await vidaDeCita(op, pac, c === 0);
      resumen[resultado] = (resumen[resultado] ?? 0) + 1;
    }
  });

  console.log(`AGENTE B fase ${FASE}:`, JSON.stringify(resumen, null, 1));
  fs.writeFileSync(path.join(DIR, 'out', `agenteB-fase${FASE}.json`), JSON.stringify(resumen, null, 1));
}

main().catch(e => { console.error('AGENTE B FALLÓ:', e); process.exit(1); });
