// ─── AGENTE A (2ª pasada) — FLUJO REAL DE ENFERMEDAD + 3.3 bloqueo vs agendamiento ──
// Descubrimiento: el sistema RECHAZA bloquear a un profesional con citas en el rango
// (409 CITAS_EN_RANGO) → NUNCA hay citas huérfanas. El flujo real es: gestionar las
// citas del día PRIMERO (cancelar/reprogramar), LUEGO marcar la enfermedad. Aquí se
// ejercita ese flujo completo + una carrera 3.3 (bloquear mientras 5 operadores agendan).
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { req, evento, DIR, uuid, pick, crearRng } from './lib.mjs';

const rng = crearRng(24680);
const estado = JSON.parse(fs.readFileSync(path.join(DIR, 'out', 'estado-sim.json')));
const admin = estado.adminToken;
const ops = estado.operadores.map(o => ({ ...o, token: estado.tokens[o.email] }));
const psql = (q) => execSync(`docker exec limablue_postgres psql -U limablue -d limablue_agenda_simulacion -tAc "${q.replace(/"/g, '\\"')}"`).toString().trim();

async function main() {
  const resultado = { enfermedades: [], bloqueoVsAgendamiento: null };
  const enfermas = JSON.parse(fs.readFileSync(path.join(DIR, 'out', 'profesionales-con-citas.json'))).slice(0, 3);

  for (const e of enfermas) {
    const dia = e.fechas[0];
    // 1) Todas las citas activas de esa profesional ese día
    const citas = (await req('GET', `/citas?sedeId=${e.sedeId}&fecha=${dia}`, { token: admin, plantilla: '/citas [lista]' })).data ?? [];
    const activas = citas.filter(c => c.profesionalId === e.id && !['cancelada', 'no_show', 'reprogramada', 'completada'].includes(c.estado));
    const reg = { profesional: e.nombre, dia, citasActivas: activas.length, gestionadas: 0, bloqueoAntes: null, bloqueoDespues: null, agendarTrasBloqueo: null };

    // 2) Intentar bloquear ANTES de gestionar → debe fallar 409 CITAS_EN_RANGO
    const antes = await req('POST', '/permisos', { token: admin, plantilla: '/permisos [crear]', body: { profesionalId: e.id, sedeId: e.sedeId, fecha: dia, horaInicio: '08:00', horaFin: '20:00', motivo: 'Descanso médico (enfermedad)' } });
    reg.bloqueoAntes = { status: antes.status, error: antes.data?.error };

    // 3) Gestionar (cancelar) cada cita del día — flujo real de reprogramación
    for (const c of activas) {
      const g = await req('PATCH', `/citas/${c.id}/gestionar-movimiento`, { token: admin, plantilla: '/citas/:id/gestionar-movimiento', body: { estado: 'cancelada', motivo: 'Enfermedad de la podóloga (simulación)' } });
      if (g.status === 200) reg.gestionadas++;
      else evento('gestion_cita_enfermedad_fallida', { citaId: c.id, status: g.status });
    }

    // 4) Ahora SÍ bloquear → debe funcionar
    const despues = await req('POST', '/permisos', { token: admin, plantilla: '/permisos [crear]', body: { profesionalId: e.id, sedeId: e.sedeId, fecha: dia, horaInicio: '08:00', horaFin: '20:00', motivo: 'Descanso médico (enfermedad)' } });
    reg.bloqueoDespues = { status: despues.status, error: despues.data?.error };

    // 5) Intentar agendar en ese rango tras el bloqueo → debe rechazarse
    const svc = (await req('GET', '/servicios?activo=true', { token: admin, plantilla: '/servicios' })).data.find(s => s.duracionMinutos === 30);
    const uni = svc.unidadNegocioId;
    const intento = await req('POST', '/citas', { token: ops[0].token, plantilla: '/citas [crear]', headers: { 'Idempotency-Key': uuid() },
      body: { pacienteId: estado.pacientes[20].id, profesionalId: e.id, sedeId: e.sedeId, unidadNegocioId: uni, servicioId: svc.id, fecha: dia, horaInicio: '10:00', canal: 'recepcion', ...(svc.subcategorias?.length ? { subcategoriaId: svc.subcategorias[0].id } : {}) } });
    reg.agendarTrasBloqueo = { status: intento.status, error: intento.data?.error };

    resultado.enfermedades.push(reg);
    evento('enfermedad_flujo_real', reg);
  }

  // ── 3.3 BLOQUEO vs AGENDAMIENTO: admin bloquea mientras 5 operadores agendan ──
  // Elegir una profesional con un día limpio (sin citas) para poder bloquearla
  const limpia = psql(`
    SELECT p.id, a."sedeId", '2026-08-05'
    FROM profesionales p JOIN asignaciones_sede a ON a."profesionalId"=p.id AND a."fechaFin" IS NULL
    WHERE p.tipo='podologa' AND p.activo AND NOT EXISTS (
      SELECT 1 FROM citas c WHERE c."profesionalId"=p.id AND c.fecha='2026-08-05' AND c."deletedAt" IS NULL AND c.estado NOT IN ('cancelada','no_show','reprogramada'))
    LIMIT 1;`).split('|');
  if (limpia[0]) {
    const [pid, sedeId, dia] = limpia;
    const svc = (await req('GET', '/servicios?activo=true', { token: admin, plantilla: '/servicios' })).data.find(s => s.duracionMinutos === 30);
    const bloquear = req('POST', '/permisos', { token: admin, plantilla: '/permisos [crear]', body: { profesionalId: pid, sedeId, fecha: dia, horaInicio: '08:00', horaFin: '20:00', motivo: 'Emergencia (carrera bloqueo-vs-agenda)' } });
    const agendar = [0, 1, 2, 3, 4].map(k => req('POST', '/citas', { token: ops[k].token, plantilla: '/citas [crear]', quien: ops[k].email, headers: { 'Idempotency-Key': uuid() },
      body: { pacienteId: estado.pacientes[30 + k].id, profesionalId: pid, sedeId, unidadNegocioId: svc.unidadNegocioId, servicioId: svc.id, fecha: dia, horaInicio: `${9 + k}:00`, canal: 'recepcion', ...(svc.subcategorias?.length ? { subcategoriaId: svc.subcategorias[0].id } : {}) } }).catch(() => ({ status: -1 })));
    const [rb, ...ra] = await Promise.all([bloquear, ...agendar]);
    // ORÁCULO: 0 citas vivas dentro del bloqueo tras la carrera
    const dentro = parseInt(psql(`SELECT count(*) FROM citas WHERE "profesionalId"='${pid}' AND fecha='${dia}' AND "deletedAt" IS NULL AND estado NOT IN ('cancelada','no_show','reprogramada')`));
    resultado.bloqueoVsAgendamiento = { bloqueoStatus: rb.status, agendamientos: ra.map(r => r.status), citasVivasEnBloqueo: dentro };
    if (dentro > 0) evento('info_bloqueo_vs_agenda', { nota: 'quedaron citas que ganaron la carrera antes del bloqueo (válido si el bloqueo llegó después)', dentro });
  }

  console.log('AGENTE A (enfermedad flujo real):', JSON.stringify(resultado, null, 1));
  fs.writeFileSync(path.join(DIR, 'out', 'agenteA-enfermedad.json'), JSON.stringify(resultado, null, 1));
}

main().catch(e => { console.error('FALLÓ:', e); process.exit(1); });
