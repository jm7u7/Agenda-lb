// ─── FASE 3 — CONCURRENCIA DIRIGIDA ("busca el error") ────────────────────────
// 5 escenarios de carrera, cada uno repetido 50 veces, con Promise.all para máxima
// simultaneidad. El oráculo NO es la respuesta HTTP sino el estado en BD (0 duplicados,
// 0 saldos negativos, 0 mitades pisadas). Ese lo verifica Fase 4; aquí medimos éxitos.
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { req, evento, DIR, uuid, fechasLaborables, pick, crearRng } from './lib.mjs';

const rng = crearRng(31416);
const estado = JSON.parse(fs.readFileSync(path.join(DIR, 'out', 'estado-sim.json')));
const admin = estado.adminToken;
const ops = estado.operadores.map(o => ({ ...o, token: estado.tokens[o.email] }));
const FECHAS = fechasLaborables();
const REP = 50;
const psql = (q) => execSync(`docker exec limablue_postgres psql -U limablue -d limablue_agenda_simulacion -tAc "${q.replace(/"/g, '\\"')}"`).toString().trim();

let SEDES, UNI, SVC, podUni, profSvc;
const resultados = {};

// Buscar un slot LIBRE real y devolver los parámetros para reservarlo
async function slotLibre(sede, servicio, fecha) {
  const d = await req('GET', `/disponibilidad?sede=${sede.id}&unidadNegocio=${servicio.unidadNegocioId}&servicio=${servicio.id}&fecha=${fecha}`, { token: admin, plantilla: '/disponibilidad' });
  return (d.data?.slots ?? []).filter(s => s.disponible && s.profesionalId);
}
const cuerpoCita = (sede, servicio, prof, fecha, hora) => ({
  pacienteId: pick(rng, estado.pacientes).id, profesionalId: prof, sedeId: sede.id,
  unidadNegocioId: servicio.unidadNegocioId, servicioId: servicio.id, fecha, horaInicio: hora, canal: 'recepcion',
  ...(servicio.subcategorias?.length ? { subcategoriaId: servicio.subcategorias[0].id } : {}),
});

async function main() {
  SEDES = (await req('GET', '/sedes', { token: admin, plantilla: '/sedes' })).data;
  UNI = (await req('GET', '/analytics/unidades', { token: admin, plantilla: '/analytics/unidades' })).data;
  SVC = (await req('GET', '/servicios?activo=true', { token: admin, plantilla: '/servicios' })).data;
  podUni = UNI.find(u => u.nombre.toLowerCase().includes('podolog'));
  profSvc = SVC.find(s => s.unidadNegocioId === podUni.id && s.duracionMinutos === 30) ?? SVC.find(s => s.unidadNegocioId === podUni.id);

  // ── 3.1 SLOT DORADO: 20 operadores al mismo slot exacto, ×50 ──
  let dorado = { rondas: 0, exitos: 0, rechazos: 0, quinientos: 0, duplicados: 0 };
  for (let k = 0; k < REP; k++) {
    const sede = pick(rng, SEDES);
    const fecha = FECHAS[8 + (k % 12)];
    const libres = await slotLibre(sede, profSvc, fecha);
    if (!libres.length) continue;
    dorado.rondas++;
    const slot = libres[0];
    const body = cuerpoCita(sede, profSvc, slot.profesionalId, fecha, slot.horaInicio);
    const intentos = await Promise.all(ops.map(op =>
      req('POST', '/citas', { token: op.token, plantilla: '/citas [crear]', quien: op.email, headers: { 'Idempotency-Key': uuid() }, body }).catch(e => ({ status: -1, err: String(e) }))));
    const ok = intentos.filter(r => r.status === 201);
    dorado.exitos += ok.length; dorado.rechazos += intentos.filter(r => r.status >= 400 && r.status < 500).length;
    dorado.quinientos += intentos.filter(r => r.status >= 500).length;
    // ORÁCULO en BD: ¿cuántas citas vivas quedaron en ese slot?
    const vivas = parseInt(psql(`SELECT count(*) FROM citas WHERE "profesionalId"='${slot.profesionalId}' AND fecha='${fecha}' AND "horaInicio"='${slot.horaInicio}' AND "deletedAt" IS NULL AND estado NOT IN ('cancelada','no_show','reprogramada')`));
    if (vivas > 1) { dorado.duplicados++; evento('BUG_slot_dorado_duplicado', { sede: sede.nombre, fecha, hora: slot.horaInicio, vivas, exitosHttp: ok.length }); }
    if (ok.length > 1) evento('BUG_slot_dorado_multi_201', { fecha, hora: slot.horaInicio, exitos: ok.length });
  }
  resultados.slotDorado = dorado;

  // ── 3.5 SESIÓN DOBLE: 2 operadores consumen la ÚLTIMA sesión de un paquete, ×50 ──
  let sesion = { rondas: 0, dobleConsumoAceptado: 0, saldoNegativo: 0, quinientos: 0 };
  const plantillas = ((await req('GET', '/paquetes/', { token: admin, plantilla: '/paquetes' })).data ?? []).filter(p => p.activo !== false && p.tipo !== 'MEMBRESIA' && (p.totalSesiones ?? 0) >= 1);
  const svcPaq = SVC.find(s => s.id === (plantillas[0]?.servicioId ?? plantillas[0]?.servicio?.id));
  for (let k = 0; k < REP && svcPaq; k++) {
    const pacX = estado.pacientes[300 + k];
    const sede = ops[0].sedeId ? SEDES.find(s => s.id === ops[0].sedeId) : SEDES[0];
    // paquete de 1 sesión: comprar plantilla y ajustar tamaño a 1 (admin) para forzar "última"
    const plant = plantillas.find(p => (p.totalSesiones ?? 99) === 1) ?? plantillas[0];
    const venta = await req('POST', `/paquetes/paciente/${pacX.id}`, { token: admin, plantilla: '/paquetes/paciente/:id', body: { paqueteId: plant.id, fechaCompra: '2026-07-10', sedeId: sede.id } });
    if (venta.status >= 300) continue;
    const pp = venta.data;
    // agendar 1 cita con ese paquete y marcar llegó
    const libres = await slotLibre(sede, svcPaq, FECHAS[10 + (k % 10)]);
    if (!libres.length) continue;
    const slot = libres[0];
    const c = await req('POST', '/citas', { token: admin, plantilla: '/citas [crear]', headers: { 'Idempotency-Key': uuid() }, body: { ...cuerpoCita(sede, svcPaq, slot.profesionalId, FECHAS[10 + (k % 10)], slot.horaInicio), pacienteId: pacX.id, paquetePacienteId: pp.id } });
    if (c.status !== 201) continue;
    await req('PATCH', `/citas/${c.data.id}/estado`, { token: admin, body: { estado: 'llego' }, plantilla: '/citas/:id/estado' });
    sesion.rondas++;
    // 2 operadores consumen la MISMA cita simultáneamente
    const consumos = await Promise.all([ops[1], ops[2]].map(op =>
      req('POST', `/consumos/cita/${c.data.id}`, { token: op.token, plantilla: '/consumos/cita/:citaId', quien: op.email, body: { paquetePacienteId: pp.id } }).catch(e => ({ status: -1 }))));
    const ok = consumos.filter(r => r.status < 300).length;
    sesion.quinientos += consumos.filter(r => r.status >= 500).length;
    // ORÁCULO: saldo derivado del paquete
    const saldo = psql(`SELECT "sesionesTotal" - COALESCE((SELECT count(*) FROM consumos_sesion WHERE "paqueteId"='${pp.id}' AND "deletedAt" IS NULL),0) FROM paquetes_paciente WHERE id='${pp.id}'`);
    if (parseInt(saldo) < 0) { sesion.saldoNegativo++; evento('BUG_saldo_negativo', { paquete: pp.id, saldo, consumosOk: ok }); }
    if (ok > 1) { sesion.dobleConsumoAceptado++; evento('BUG_doble_consumo_concurrente', { cita: c.data.id, paquete: pp.id, ok }); }
  }
  resultados.sesionDoble = sesion;

  // ── 3.4 COMBINADA vs SIMPLE: un op crea bloque (2 slots) mientras otro toma un slot, ×50 ──
  let combi = { rondas: 0, mitadPisada: 0, quinientos: 0 };
  const combiCfg = (await req('GET', '/combinaciones/config', { token: admin, plantilla: '/combinaciones/config' })).data;
  const ancla = SVC.find(s => s.id === combiCfg?.servicioAnclaId);
  const extra = combiCfg?.combinables?.[0];
  for (let k = 0; k < REP && ancla && extra; k++) {
    const sede = pick(rng, SEDES);
    const fecha = FECHAS[15 + (k % 8)];
    const libres = await slotLibre(sede, ancla, fecha);
    if (!libres.length) continue;
    combi.rondas++;
    const slot = libres[0];
    const bodyCombi = { pacienteId: pick(rng, estado.pacientes).id, profesionalId: slot.profesionalId, sedeId: sede.id, unidadNegocioId: podUni.id, servicioId: ancla.id, fecha, horaInicio: slot.horaInicio, canal: 'recepcion', ...(ancla.subcategorias?.length ? { subcategoriaId: ancla.subcategorias[0].id } : {}), extra: { servicioId: extra.servicioExtraId } };
    const bodySimple = cuerpoCita(sede, ancla, slot.profesionalId, fecha, slot.horaInicio);
    const [rc, rs] = await Promise.all([
      req('POST', '/citas/combinada', { token: ops[3].token, plantilla: '/citas/combinada', quien: ops[3].email, headers: { 'Idempotency-Key': uuid() }, body: bodyCombi }).catch(() => ({ status: -1 })),
      req('POST', '/citas', { token: ops[4].token, plantilla: '/citas [crear]', quien: ops[4].email, headers: { 'Idempotency-Key': uuid() }, body: bodySimple }).catch(() => ({ status: -1 })),
    ]);
    combi.quinientos += [rc, rs].filter(r => r.status >= 500).length;
    // ORÁCULO: si la combinada ganó, deben existir SUS 2 citas (ancla+extra) y ninguna simple pisando; si ganó la simple, la combinada no debe tener mitad huérfana
    const vivas = parseInt(psql(`SELECT count(*) FROM citas WHERE "profesionalId"='${slot.profesionalId}' AND fecha='${fecha}' AND "horaInicio"='${slot.horaInicio}' AND "deletedAt" IS NULL AND estado NOT IN ('cancelada','no_show','reprogramada')`));
    const grupos = parseInt(psql(`SELECT count(DISTINCT "slotGrupoId") FROM citas WHERE "profesionalId"='${slot.profesionalId}' AND fecha='${fecha}' AND "horaInicio"='${slot.horaInicio}' AND "slotGrupoId" IS NOT NULL AND "deletedAt" IS NULL AND estado NOT IN ('cancelada','no_show','reprogramada')`));
    // Correcto: o (combinada ganó → 2 citas, 1 grupo) o (simple ganó → 1 cita, 0 grupos)
    const okCombi = vivas === 2 && grupos === 1;
    const okSimple = vivas === 1 && grupos === 0;
    if (!okCombi && !okSimple) { combi.mitadPisada++; evento('BUG_combinada_vs_simple', { fecha, hora: slot.horaInicio, vivas, grupos, statusCombi: rc.status, statusSimple: rs.status }); }
  }
  resultados.combinadaVsSimple = combi;

  console.log('FASE 3:', JSON.stringify(resultados, null, 1));
  fs.writeFileSync(path.join(DIR, 'out', 'fase3.json'), JSON.stringify(resultados, null, 1));
}

main().catch(e => { console.error('FASE 3 FALLÓ:', e); process.exit(1); });
