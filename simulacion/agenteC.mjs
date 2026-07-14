// ─── AGENTE C — COMERCIAL: paquetes, membresías, consumos y saldos ────────────
// · ~75 pacientes compran PAQUETE simple (plantilla real) y consumen sesiones al
//   llegar (POST /consumos/cita/:id). Con intentos de sobre-cupo (PAQUETE_SIN_SESIONES)
//   y de doble consumo de la misma cita (debe ser idempotente/rechazado).
// · ~15 pacientes compran MEMBRESÍA (snapshot de composición con subcategoría fija)
//   y agendan/consumen contra ella.
// · Adversarial: consumir con el paquete de OTRO paciente (debe rechazarse).
import fs from 'node:fs';
import path from 'node:path';
import { req, crearRng, pick, evento, DIR, fechasLaborables, uuid, pool } from './lib.mjs';

const rng = crearRng(777);
const estado = JSON.parse(fs.readFileSync(path.join(DIR, 'out', 'estado-sim.json')));
const admin = estado.adminToken;
const FECHAS = fechasLaborables();
const ops = estado.operadores.map(o => ({ ...o, token: estado.tokens[o.email] }));

let SEDES, SERVICIOS, PLANTILLAS, MEMBRESIAS, UNIDADES;

async function reservarConPaquete(op, pacienteId, servicio, paquetePacienteId, sedeId, subcategoriaId) {
  for (let intento = 0; intento < 4; intento++) {
    const fecha = pick(rng, FECHAS);
    const dispo = await req('GET', `/disponibilidad?sede=${sedeId}&unidadNegocio=${servicio.unidadNegocioId}&servicio=${servicio.id}&fecha=${fecha}`, { token: op.token, plantilla: '/disponibilidad', quien: op.email });
    const libres = (dispo.data?.slots ?? []).filter(s => s.disponible);
    if (!libres.length) continue;
    const slot = pick(rng, libres);
    const res = await req('POST', '/citas', {
      token: op.token, plantilla: '/citas [crear c/paquete]', quien: op.email,
      headers: { 'Idempotency-Key': uuid() },
      body: {
        pacienteId, profesionalId: slot.profesionalId ?? null, sedeId,
        unidadNegocioId: servicio.unidadNegocioId, servicioId: servicio.id,
        ...(subcategoriaId ? { subcategoriaId } : {}),
        fecha, horaInicio: slot.horaInicio, canal: 'recepcion', paquetePacienteId,
      },
    });
    if (res.status === 201) return res.data;
    if (res.data?.error === 'PAQUETE_SIN_SESIONES') return { sinSesiones: true, resp: res.data };
    if (res.status === 409) { evento('carrera_slot', { contexto: 'paquete', quien: op.email }); continue; }
    evento('cita_paquete_fallida', { status: res.status, error: JSON.stringify(res.data).slice(0, 250) });
    return null;
  }
  return null;
}

async function consumir(op, citaId, paquetePacienteId, etiqueta) {
  const r = await req('POST', `/consumos/cita/${citaId}`, {
    token: op.token, plantilla: '/consumos/cita/:citaId', quien: op.email,
    body: { paquetePacienteId },
  });
  evento('consumo', { etiqueta, citaId, status: r.status, ...(r.status >= 400 ? { error: JSON.stringify(r.data).slice(0, 200) } : {}) });
  return r;
}

async function flujoPaquete(pac, i) {
  const op = ops[i % ops.length];
  const sedeId = op.sedeId ?? pick(rng, SEDES).id;
  const plantilla = pick(rng, PLANTILLAS);
  const venta = await req('POST', `/paquetes/paciente/${pac.id}`, {
    token: op.token, plantilla: '/paquetes/paciente/:id [vender]', quien: op.email,
    body: { paqueteId: plantilla.id, fechaCompra: '2026-07-10', sedeId },
  });
  if (venta.status !== 201 && venta.status !== 200) {
    evento('venta_paquete_fallida', { status: venta.status, error: JSON.stringify(venta.data).slice(0, 250) });
    return 'venta-fallida';
  }
  const pp = venta.data;
  const servicio = SERVICIOS.find(s => s.id === (plantilla.servicioId ?? plantilla.servicio?.id));
  if (!servicio) return 'sin-servicio';
  const subcat = servicio.subcategorias?.length ? pick(rng, servicio.subcategorias).id : null;

  // Agendar y CONSUMIR 2-3 sesiones (llegó → consumo → completada)
  const nSesiones = Math.min(2 + Math.floor(rng() * 2), plantilla.totalSesiones ?? 4);
  let consumidas = 0;
  const citasCreadas = [];
  for (let s = 0; s < nSesiones; s++) {
    const cita = await reservarConPaquete(op, pac.id, servicio, pp.id, sedeId, subcat);
    if (!cita || cita.sinSesiones) break;
    citasCreadas.push(cita);
    await req('PATCH', `/citas/${cita.id}/estado`, { token: op.token, body: { estado: 'confirmada' }, plantilla: '/citas/:id/estado', quien: op.email });
    await req('PATCH', `/citas/${cita.id}/estado`, { token: op.token, body: { estado: 'llego' }, plantilla: '/citas/:id/estado', quien: op.email });
    const c = await consumir(op, cita.id, pp.id, 'consumo-normal');
    if (c.status < 300) consumidas++;
    await req('PATCH', `/citas/${cita.id}/estado`, { token: op.token, body: { estado: 'en_atencion' }, plantilla: '/citas/:id/estado', quien: op.email });
    await req('PATCH', `/citas/${cita.id}/estado`, { token: op.token, body: { estado: 'completada' }, plantilla: '/citas/:id/estado', quien: op.email });
  }

  // DOBLE CONSUMO de la misma cita (debe rechazarse/ser idempotente)
  if (citasCreadas.length) {
    const doble = await consumir(op, citasCreadas[0].id, pp.id, 'doble-consumo-misma-cita');
    if (doble.status < 300) evento('BUG_doble_consumo_acepto', { citaId: citasCreadas[0].id, paquete: pp.id });
  }

  // SOBRE-CUPO: intentar agendar más citas que el total del paquete
  if ((plantilla.totalSesiones ?? 0) <= 4 && rng() < 0.6) {
    let extra = 0, rechazo = null;
    for (let s = 0; s < (plantilla.totalSesiones ?? 4) + 1; s++) {
      const cita = await reservarConPaquete(op, pac.id, servicio, pp.id, sedeId, subcat);
      if (cita?.sinSesiones) { rechazo = cita.resp?.error; break; }
      if (cita) extra++;
    }
    evento('sobrecupo_paquete', { paquete: pp.id, total: plantilla.totalSesiones, extraAgendadas: extra, rechazo });
  }
  return `paquete-ok(${consumidas})`;
}

async function flujoMembresia(pac, i) {
  const op = ops[i % ops.length];
  const sedeId = op.sedeId ?? pick(rng, SEDES).id;
  const memb = MEMBRESIAS.find(m => !m.sedesHabilitadas?.length || m.sedesHabilitadas.includes(sedeId)) ?? MEMBRESIAS[0];
  if (!memb) return 'sin-membresias';
  // subcategorías fijas por ítem cuyo servicio tenga subcats activas
  const composicion = memb.composicion ?? memb.items ?? [];
  const subcats = [];
  for (const item of composicion) {
    const svc = SERVICIOS.find(s => s.id === (item.servicioId ?? item.servicio?.id));
    if (svc?.subcategorias?.length) subcats.push({ servicioId: svc.id, subcategoriaId: pick(rng, svc.subcategorias).id });
  }
  const venta = await req('POST', `/membresias/${memb.id}/vender`, {
    token: op.token, plantilla: '/membresias/:id/vender', quien: op.email,
    body: { pacienteId: pac.id, sedeId, fechaVenta: '2026-07-13', fechaFin: '2027-01-13', ...(subcats.length ? { subcategorias: subcats } : {}) },
  });
  if (venta.status >= 300) {
    evento('venta_membresia_fallida', { membresia: memb.nombre, status: venta.status, error: JSON.stringify(venta.data).slice(0, 250) });
    return 'membresia-venta-fallida';
  }
  const pp = venta.data;
  // agendar y consumir 1 sesión de un ítem de la composición
  const item = composicion.find(it => {
    const svc = SERVICIOS.find(s => s.id === (it.servicioId ?? it.servicio?.id));
    return svc && svc.unidadNegocioId; // servicio existente
  });
  if (!item) return 'membresia-sin-items';
  const svc = SERVICIOS.find(s => s.id === (item.servicioId ?? item.servicio?.id));
  const sub = subcats.find(x => x.servicioId === svc.id)?.subcategoriaId ?? null;
  const cita = await reservarConPaquete(op, pac.id, svc, pp.id, sedeId, sub);
  if (cita && !cita.sinSesiones) {
    await req('PATCH', `/citas/${cita.id}/estado`, { token: op.token, body: { estado: 'llego' }, plantilla: '/citas/:id/estado', quien: op.email });
    await consumir(op, cita.id, pp.id, 'consumo-membresia');
    await req('PATCH', `/citas/${cita.id}/estado`, { token: op.token, body: { estado: 'en_atencion' }, plantilla: '/citas/:id/estado', quien: op.email });
    await req('PATCH', `/citas/${cita.id}/estado`, { token: op.token, body: { estado: 'completada' }, plantilla: '/citas/:id/estado', quien: op.email });
  }
  return 'membresia-ok';
}

async function main() {
  SEDES = (await req('GET', '/sedes', { token: admin, plantilla: '/sedes' })).data;
  SERVICIOS = (await req('GET', '/servicios?activo=true', { token: admin, plantilla: '/servicios' })).data;
  UNIDADES = (await req('GET', '/analytics/unidades', { token: admin, plantilla: '/analytics/unidades' })).data;
  const plantillasTodas = (await req('GET', '/paquetes/', { token: admin, plantilla: '/paquetes [plantillas]' })).data ?? [];
  PLANTILLAS = plantillasTodas.filter(p => p.activo !== false && p.tipo !== 'MEMBRESIA' && SERVICIOS.some(s => s.id === (p.servicioId ?? p.servicio?.id)));
  MEMBRESIAS = (await req('GET', '/membresias/vendibles', { token: admin, plantilla: '/membresias/vendibles' })).data ?? [];
  console.log(`plantillas paquete: ${PLANTILLAS.length} | membresías vendibles: ${MEMBRESIAS.length}`);

  const paqueteros = estado.pacientes.slice(400, 475);   // 75 pacientes
  const membresieros = estado.pacientes.slice(475, 490); // 15 pacientes
  const resumen = {};
  const rs1 = await pool(paqueteros, 12, flujoPaquete);
  const rs2 = await pool(membresieros, 6, flujoMembresia);
  for (const r of [...rs1, ...rs2]) { const k = typeof r === 'string' ? r : 'error'; resumen[k] = (resumen[k] ?? 0) + 1; }

  // ADVERSARIAL: consumir con paquete AJENO — cita del paciente A + paquete del paciente B
  const citaDeA = await reservarConPaquete(ops[0], estado.pacientes[0].id,
    SERVICIOS.find(s => s.id === (PLANTILLAS[0].servicioId ?? PLANTILLAS[0].servicio?.id)), undefined, ops[0].sedeId ?? SEDES[0].id,
    null);
  if (citaDeA && !citaDeA.sinSesiones) {
    // buscar un paquete de OTRO paciente
    const ppAjeno = (await req('GET', `/pacientes/${paqueteros[0].id}/paquetes`, { token: admin, plantilla: '/pacientes/:id/paquetes' })).data?.[0];
    if (ppAjeno) {
      await req('PATCH', `/citas/${citaDeA.id}/estado`, { token: ops[0].token, body: { estado: 'llego' }, plantilla: '/citas/:id/estado' });
      const r = await consumir(ops[0], citaDeA.id, ppAjeno.id, 'consumo-paquete-AJENO');
      if (r.status < 300) evento('BUG_consumo_paquete_ajeno_acepto', { citaId: citaDeA.id, paquete: ppAjeno.id });
      resumen['adversarial-ajeno-status-' + r.status] = 1;
    }
  }

  console.log('AGENTE C:', JSON.stringify(resumen, null, 1));
  fs.writeFileSync(path.join(DIR, 'out', 'agenteC.json'), JSON.stringify(resumen, null, 1));
}

main().catch(e => { console.error('AGENTE C FALLÓ:', e); process.exit(1); });
