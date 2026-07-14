// ─── AGENTE A — OFERTA: feriado, enfermedades, bloqueos parciales, cambio de horario ──
// fase=pre  → feriado 28/07 (excepción cerrada en las 5 sedes) ANTES de la demanda
// fase=mid  → 3 enfermas (permiso 1-3 días CON citas encima), 2 bloqueos parciales,
//             1 cambio de horario permanente. Documenta qué pasa con citas huérfanas.
import fs from 'node:fs';
import path from 'node:path';
import { req, crearRng, pick, pickN, evento, DIR, FERIADO, fechasLaborables } from './lib.mjs';

const rng = crearRng(20260713);
const estado = JSON.parse(fs.readFileSync(path.join(DIR, 'out', 'estado-sim.json')));
const admin = estado.adminToken;
const fase = process.argv[2] ?? 'pre';

async function main() {
  const sedes = (await req('GET', '/sedes', { token: admin, plantilla: '/sedes' })).data;

  if (fase === 'pre') {
    // FERIADO: cerrar las 5 sedes el 28/07 (Fiestas Patrias)
    for (const s of sedes) {
      const r = await req('POST', `/horarios/${s.id}/excepciones`, {
        token: admin, plantilla: '/horarios/:sedeId/excepciones',
        body: { fecha: FERIADO, abierto: false, nota: 'Feriado Fiestas Patrias (simulación)' },
      });
      evento('feriado_creado', { sede: s.nombre, status: r.status });
    }
    console.log('feriado 28/07 aplicado en 5 sedes');
    return;
  }

  // ── fase MID: eventos sobre oferta con demanda YA agendada ──────────────────
  const resultado = { enfermas: [], parciales: [], cambioHorario: null };

  // Podólogas con MÁS citas futuras agendadas (para que la enfermedad pise citas reales)
  const conteo = JSON.parse(fs.readFileSync(path.join(DIR, 'out', 'profesionales-con-citas.json')));
  const candidatas = conteo.slice(0, 8); // top con citas

  // 1) TRES ENFERMAS: permiso de día(s) completo(s) sobre fechas con citas
  const enfermas = candidatas.slice(0, 3);
  for (const e of enfermas) {
    const dias = 1 + Math.floor(rng() * 3);
    const fechasConCitas = e.fechas.slice(0, dias);
    const registro = { profesional: e.nombre, profesionalId: e.id, sedeId: e.sedeId, fechas: fechasConCitas, citasEncima: [], permisos: [] };
    for (const f of fechasConCitas) {
      // citas activas encima ANTES del permiso
      const citas = (await req('GET', `/citas?sedeId=${e.sedeId}&fecha=${f}`, { token: admin, plantilla: '/citas [lista]' })).data ?? [];
      const encima = citas.filter(c => c.profesionalId === e.id && !['cancelada', 'no_show', 'reprogramada', 'completada'].includes(c.estado));
      registro.citasEncima.push({ fecha: f, activas: encima.length, ids: encima.map(c => c.id) });
      const r = await req('POST', '/permisos', {
        token: admin, plantilla: '/permisos [crear]',
        body: { profesionalId: e.id, sedeId: e.sedeId, fecha: f, horaInicio: '08:00', horaFin: '20:00', motivo: `Descanso médico (simulación enfermedad)` },
      });
      registro.permisos.push({ fecha: f, status: r.status, resp: r.status >= 400 ? JSON.stringify(r.data).slice(0, 200) : undefined });
    }
    // ¿Qué hizo el sistema con las citas huérfanas? (medir después: siguen activas dentro del bloqueo)
    resultado.enfermas.push(registro);
    evento('enfermedad', registro);
  }

  // 2) DOS BLOQUEOS PARCIALES (media jornada, capacitación)
  const parciales = candidatas.slice(3, 5);
  for (const p of parciales) {
    const f = p.fechas[Math.floor(rng() * p.fechas.length)];
    const r = await req('POST', '/permisos', {
      token: admin, plantilla: '/permisos [crear]',
      body: { profesionalId: p.id, sedeId: p.sedeId, fecha: f, horaInicio: '14:00', horaFin: '18:00', motivo: 'Capacitación (simulación bloqueo parcial)' },
    });
    resultado.parciales.push({ profesional: p.nombre, fecha: f, status: r.status });
    evento('bloqueo_parcial', { profesional: p.nombre, fecha: f, status: r.status });
  }

  // 3) CAMBIO DE HORARIO PERMANENTE a mitad de simulación (una podóloga pasa a 10:00-16:00)
  const cambio = candidatas[5];
  const rHor = await req('PUT', `/profesionales/${cambio.id}/horario`, {
    token: admin, plantilla: '/profesionales/:id/horario [PUT]',
    body: { dias: [1, 2, 3, 4, 5].map(d => ({ diaSemana: d, horaInicio: '10:00', horaFin: '16:00' })) },
  });
  // si tiene citas fuera del nuevo rango, el sistema debe responder 409 HORARIO_CONFLICTO_CITAS
  let rForzado = null;
  if (rHor.status === 409) {
    rForzado = await req('PUT', `/profesionales/${cambio.id}/horario`, {
      token: admin, plantilla: '/profesionales/:id/horario [PUT forzar]',
      body: { dias: [1, 2, 3, 4, 5].map(d => ({ diaSemana: d, horaInicio: '10:00', horaFin: '16:00' })), forzar: true },
    });
  }
  resultado.cambioHorario = { profesional: cambio.nombre, id: cambio.id, status: rHor.status, detalle409: rHor.status === 409 ? JSON.stringify(rHor.data).slice(0, 300) : null, forzadoStatus: rForzado?.status ?? null };
  evento('cambio_horario_permanente', resultado.cambioHorario);

  fs.writeFileSync(path.join(DIR, 'out', 'agenteA-resultado.json'), JSON.stringify(resultado, null, 1));
  console.log('Agente A (mid) completado:', JSON.stringify({
    enfermas: resultado.enfermas.map(e => `${e.profesional}: ${e.fechas.length}d, ${e.citasEncima.reduce((a, c) => a + c.activas, 0)} citas encima`),
    parciales: resultado.parciales.length,
    cambioHorario: resultado.cambioHorario.status,
  }, null, 1));
}

main().catch(e => { console.error('AGENTE A FALLÓ:', e); process.exit(1); });
