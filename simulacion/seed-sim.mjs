// ─── SEED de la simulación: 20 operadores + 500 pacientes ZZTEST ──────────────
// Los pacientes se crean VÍA API (POST /pacientes) repartidos entre los 20
// operadores en paralelo — esto ya es parte de la prueba (alta masiva concurrente).
import fs from 'node:fs';
import path from 'node:path';
import { req, login, crearRng, generarPaciente, pool, DIR, evento } from './lib.mjs';

const rng = crearRng(2026);
const PASSWORD = 'Simulacion2026!';

async function main() {
  const admin = await login('admin@limablue.pe', 'Admin1234!');

  // Sedes reales del catálogo
  const sedes = (await req('GET', '/sedes', { token: admin, plantilla: '/sedes' })).data;
  console.log('sedes:', sedes.map(s => s.nombre).join(', '));

  // ── 20 operadores: 12 recepcionistas (2-3 por sede real) + 8 contact center ──
  const operadores = [];
  let r = 0;
  for (let i = 0; i < 12; i++) {
    const sede = sedes[i % sedes.length];
    operadores.push({
      nombre: `Recep Sim ${String(i + 1).padStart(2, '0')} ${sede.nombre}`,
      email: `sim.recep${String(i + 1).padStart(2, '0')}@simulacion.local`,
      rol: 'recepcionista', sedeId: sede.id, sedeNombre: sede.nombre, tipo: 'recepcion',
    });
  }
  for (let i = 0; i < 8; i++) {
    operadores.push({
      nombre: `Contact Sim ${String(i + 1).padStart(2, '0')}`,
      email: `sim.cc${String(i + 1).padStart(2, '0')}@simulacion.local`,
      rol: 'contact_center', sedeId: null, sedeNombre: null, tipo: 'contact_center',
    });
  }

  for (const op of operadores) {
    const res = await req('POST', '/users', {
      token: admin, plantilla: '/users',
      body: { nombre: op.nombre, email: op.email, password: PASSWORD, rol: op.rol, ...(op.sedeId ? { sedeIds: [op.sedeId] } : {}) },
    });
    if (res.status !== 201 && res.status !== 200) {
      // quizá ya existe de una corrida previa → seguir
      evento('seed_usuario_error', { email: op.email, status: res.status, resp: JSON.stringify(res.data).slice(0, 200) });
    }
  }
  // login de los 20
  for (const op of operadores) op.token = await login(op.email, PASSWORD);
  console.log(`operadores listos: ${operadores.length}`);

  // ── 500 pacientes ZZTEST vía API, repartidos entre operadores (concurrente) ──
  const indices = Array.from({ length: 500 }, (_, i) => i + 1);
  const pacientesGenerados = indices.map(n => generarPaciente(rng, n));
  const resultados = await pool(indices, 20, async (n, i) => {
    const op = operadores[i % operadores.length];
    const p = pacientesGenerados[i];
    const res = await req('POST', '/pacientes', { token: op.token, body: p, plantilla: '/pacientes [crear]', quien: op.email });
    if (res.status !== 201) {
      evento('seed_paciente_error', { n, status: res.status, resp: JSON.stringify(res.data).slice(0, 250) });
      return null;
    }
    return { id: res.data.id, n, ubigeoId: p.ubigeoId, email: p.email, doc: p.numeroDocumento };
  });
  const creados = resultados.filter(Boolean);
  console.log(`pacientes creados vía API: ${creados.length}/500`);

  fs.writeFileSync(path.join(DIR, 'out', 'estado-sim.json'), JSON.stringify({
    operadores: operadores.map(({ token, ...o }) => o),
    tokens: Object.fromEntries(operadores.map(o => [o.email, o.token])),
    adminToken: admin,
    pacientes: creados,
  }, null, 1));
  console.log('estado-sim.json guardado');
}

main().catch(e => { console.error('SEED FALLÓ:', e); process.exit(1); });
