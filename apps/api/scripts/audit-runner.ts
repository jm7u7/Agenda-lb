/**
 * Runner de auditoría masiva — Limablue Agenda.
 *
 * Ejecuta escenarios end-to-end contra una API apuntada a una DB de PRUEBA aislada
 * (nunca la real). Uso:
 *   1) Crear/seedear DB de prueba:  DATABASE_URL=...agenda_test npx ts-node prisma/seed.ts
 *   2) Levantar API contra esa DB:  DATABASE_URL=...agenda_test PORT=3099 CONFIRM_TOKEN_SECRET=... ts-node-dev src/index.ts
 *   3) Correr:  DATABASE_URL=...agenda_test API_URL=http://localhost:3099 N=200 npx ts-node --transpile-only scripts/audit-runner.ts
 *
 * Gmail se "mockea" por diseño: la DB de prueba no tiene MailConfig conectada, así que
 * el envío automático se omite (no se gastan correos). Los flujos de confirmar/cancelar
 * se prueban firmando el token con CONFIRM_TOKEN_SECRET (igual que el servidor).
 */
import { prisma } from '../src/db';
import jwt from 'jsonwebtoken';
import { esEmailEnviable } from '../src/services/mailService';

const API = process.env.API_URL || 'http://localhost:3099';
const N = Number(process.env.N || 200);
const SECRET = process.env.CONFIRM_TOKEN_SECRET || 'limablue-confirm-secreto-dev-2025';

let TOKEN = '';
const H = () => ({ 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}` });

async function login(email = 'admin@limablue.pe', password = 'Admin1234!') {
  const r = await fetch(`${API}/api/v1/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }) });
  const j = await r.json();
  return j.token as string;
}
function firmarToken(citaId: string, opts: { secret?: string; expiresIn?: string; tipo?: string } = {}) {
  return jwt.sign({ citaId, tipo: opts.tipo ?? 'cita-confirmacion' }, opts.secret ?? SECRET, { expiresIn: (opts.expiresIn ?? '30d') as any });
}
const slot = (h: number, m: number) => `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;

type Res = { escenario: string; ejecutados: number; pasados: number; fallidos: number; ejemplosFallo: string[] };
function R(escenario: string): Res { return { escenario, ejecutados: 0, pasados: 0, fallidos: 0, ejemplosFallo: [] }; }
function ok(r: Res) { r.ejecutados++; r.pasados++; }
function bad(r: Res, msg: string) { r.ejecutados++; r.fallidos++; if (r.ejemplosFallo.length < 5) r.ejemplosFallo.push(msg); }

async function crearCita(body: any) {
  const r = await fetch(`${API}/api/v1/citas`, { method: 'POST', headers: H(), body: JSON.stringify(body) });
  return { status: r.status, json: await r.json().catch(() => ({})) };
}

async function main() {
  TOKEN = await login();
  if (!TOKEN) throw new Error('No se pudo autenticar contra la API de prueba');

  // ── Descubrir datos de referencia (Prisma → DB de prueba) ──
  const uniPod = (await prisma.unidadNegocio.findFirst({ where: { nombre: 'Podología' }, select: { id: true } }))!;
  const serv = (await prisma.servicio.findFirst({ where: { unidadNegocioId: uniPod.id, codigo: 'POD-PRO' }, select: { id: true, duracionMinutos: true } }))
    ?? (await prisma.servicio.findFirst({ where: { unidadNegocioId: uniPod.id, nombre: 'Profilaxis' }, select: { id: true, duracionMinutos: true } }))!;
  // Podólogas con competencia a ese servicio + asignación activa + horario
  const profs = await prisma.profesional.findMany({
    where: { tipo: 'podologa', deletedAt: null, activo: true, competencias: { some: { servicioId: serv.id, activa: true } } },
    select: { id: true, asignaciones: { where: { activa: true }, select: { sedeId: true }, take: 1 }, horarios: { select: { diaSemana: true } } },
  });
  const pool = profs.filter(p => p.asignaciones[0]).map(p => ({ profId: p.id, sedeId: p.asignaciones[0]!.sedeId }));
  if (pool.length === 0) throw new Error('Sin podólogas elegibles en la DB de prueba');

  // Fecha base = hoy + 14, evitando domingo (0)
  const base = new Date(); base.setUTCHours(0, 0, 0, 0); base.setUTCDate(base.getUTCDate() + 14);
  while (base.getUTCDay() === 0) base.setUTCDate(base.getUTCDate() + 1);
  const fechaISO = (d: Date) => d.toISOString().slice(0, 10);

  // Paciente de prueba con email enviable (para no depender de datos demo)
  const docBase = Date.now().toString().slice(-9);
  const pacResp = await fetch(`${API}/api/v1/pacientes`, { method: 'POST', headers: H(), body: JSON.stringify({ nombres: 'Test', apellidoPaterno: 'Auditoria', apellidoMaterno: 'QA', numeroDocumento: 'A' + docBase, telefono: '999000111', email: 'qa.real@gmail.com' }) });
  const pacJson = await pacResp.json();
  const pacienteId: string = pacJson.id ?? (await prisma.paciente.findFirst({ where: { deletedAt: null } }))!.id;

  // Pool de slots únicos (prof, fecha, hora entera 08-16 evitando almuerzo 12-14) sobre 2 fechas
  // Horas siempre válidas (entrada 8/9 → empezamos 09:00; salida 18:00 L-V → fin ≤ 17:00)
  const horas = [9, 10, 11, 15, 16];
  // Solo Lun-Vie (evita el cierre temprano de sábado 14/15h, que es comportamiento correcto del sistema)
  const fechas: Date[] = [];
  { const d = new Date(base); while (fechas.length < 16) { const dow = d.getUTCDay(); if (dow >= 1 && dow <= 5) fechas.push(new Date(d)); d.setUTCDate(d.getUTCDate() + 1); } }
  const slots: { profId: string; sedeId: string; fecha: string; hora: string }[] = [];
  for (const f of fechas) for (const h of horas) for (const p of pool) slots.push({ ...p, fecha: fechaISO(f), hora: slot(h, 0) });

  // RESET al inicio (solo DB de prueba aislada): libera slots para una corrida reproducible.
  await prisma.cita.deleteMany({});
  await prisma.paquetePaciente.deleteMany({});

  const resultados: Res[] = [];
  let idx = 0;
  const nextSlot = () => slots[idx++];

  // ───────────────────────────── S1: Agendamiento feliz ─────────────────────────────
  {
    const r = R('S1 Agendamiento feliz'); const creadas: { id: string; s: any }[] = [];
    for (let i = 0; i < N; i++) {
      const s = nextSlot(); if (!s) break;
      const { status, json } = await crearCita({ pacienteId, profesionalId: s.profId, sedeId: s.sedeId, unidadNegocioId: uniPod.id, servicioId: serv.id, fecha: s.fecha, horaInicio: s.hora, canal: 'recepcion' });
      if (status === 201 && json.id && json.estado === 'agendada') { ok(r); creadas.push({ id: json.id, s }); }
      else bad(r, `status=${status} ${json.error ?? ''} ${json.message ?? ''} @${s.fecha} ${s.hora}`);
    }
    resultados.push(r);
    (globalThis as any).__creadas = creadas;
  }
  const creadas: { id: string; s: any }[] = (globalThis as any).__creadas || [];

  // ───────────────────────────── S2: Confirmación por token ─────────────────────────────
  {
    const r = R('S2 Confirmación por token (enlace paciente)');
    for (const c of creadas.slice(0, N)) {
      const tk = firmarToken(c.id);
      const resp = await fetch(`${API}/api/v1/citas/confirmar?token=${encodeURIComponent(tk)}`);
      const html = await resp.text();
      const cita = await prisma.cita.findUnique({ where: { id: c.id }, select: { estado: true, estadoConfirmacion: true, confirmadaEn: true, creadoEn: true } });
      const okEstado = cita?.estadoConfirmacion === 'confirmada' && cita?.confirmadaEn != null && cita.confirmadaEn >= cita.creadoEn;
      if (resp.status === 200 && /confirmada|confirmar/i.test(html) && okEstado) ok(r);
      else bad(r, `status=${resp.status} estado=${cita?.estadoConfirmacion} confAt=${cita?.confirmadaEn ? 'set' : 'null'}`);
    }
    resultados.push(r);
  }

  // ───────────────────────────── S3: Cancelación por token ─────────────────────────────
  {
    const r = R('S3 Cancelación por token'); const paraCancelar = creadas.slice(N, N * 2).length ? creadas.slice(N, N * 2) : [];
    // Si no hay suficientes, creamos un set nuevo aparte para cancelar
    const set = paraCancelar.length ? paraCancelar : [];
    if (!set.length) { while (set.length < N) { const s = nextSlot(); if (!s) break; const { status, json } = await crearCita({ pacienteId, profesionalId: s.profId, sedeId: s.sedeId, unidadNegocioId: uniPod.id, servicioId: serv.id, fecha: s.fecha, horaInicio: s.hora, canal: 'recepcion' }); if (status === 201) set.push({ id: json.id, s }); } }
    for (const c of set) {
      const tk = firmarToken(c.id);
      const resp = await fetch(`${API}/api/v1/citas/cancelar?token=${encodeURIComponent(tk)}`);
      const cita = await prisma.cita.findUnique({ where: { id: c.id }, select: { estado: true, estadoConfirmacion: true } });
      if (resp.status === 200 && cita?.estado === 'cancelada' && cita?.estadoConfirmacion === 'cancelada') ok(r);
      else bad(r, `status=${resp.status} estado=${cita?.estado}`);
    }
    resultados.push(r);
  }

  // ───────────────────────────── S4: Doble reserva / choque ─────────────────────────────
  {
    const r = R('S4 Doble reserva mismo slot (debe bloquear)');
    for (let i = 0; i < N; i++) {
      const s = nextSlot(); if (!s) break;
      const a = await crearCita({ pacienteId, profesionalId: s.profId, sedeId: s.sedeId, unidadNegocioId: uniPod.id, servicioId: serv.id, fecha: s.fecha, horaInicio: s.hora, canal: 'recepcion' });
      if (a.status !== 201) { bad(r, `1ra no creó: ${a.json.error}`); continue; }
      const b = await crearCita({ pacienteId, profesionalId: s.profId, sedeId: s.sedeId, unidadNegocioId: uniPod.id, servicioId: serv.id, fecha: s.fecha, horaInicio: s.hora, canal: 'recepcion' });
      if (b.status >= 400 && !b.json.id) ok(r); else bad(r, `2da NO se bloqueó (status=${b.status})`);
    }
    resultados.push(r);
  }

  // ───────────────────────────── S5: Tokens inválidos / expirados / manipulados ─────────────────────────────
  {
    const r = R('S5 Tokens inválidos/expirados/manipulados (deben rechazar)');
    const cBase = creadas[0]?.id ?? pacienteId;
    for (let i = 0; i < N; i++) {
      let tk: string; const tipo = i % 5;
      if (tipo === 0) tk = firmarToken(cBase, { expiresIn: '-1h' });           // expirado
      else if (tipo === 1) tk = firmarToken(cBase, { secret: 'secreto-incorrecto' }); // firma mala
      else if (tipo === 2) { const v = firmarToken(cBase); tk = v.slice(0, -3) + 'xyz'; } // manipulado
      else if (tipo === 3) tk = firmarToken('00000000-0000-0000-0000-000000000000'); // cita inexistente
      else tk = 'basura.no.jwt';                                                // basura
      const resp = await fetch(`${API}/api/v1/citas/confirmar?token=${encodeURIComponent(tk)}`);
      const html = await resp.text();
      // Debe NO confirmar: status 400/404 o página de error; nunca "¡Cita confirmada!"
      const confirmoIndebido = /¡Cita confirmada!/i.test(html);
      if (!confirmoIndebido && (resp.status === 400 || resp.status === 404)) ok(r);
      else bad(r, `tipo=${tipo} status=${resp.status} confirmoIndebido=${confirmoIndebido}`);
    }
    resultados.push(r);
  }

  // ───────────────────────────── S6: Idempotencia ─────────────────────────────
  {
    const r = R('S6 Idempotencia (confirmar 2x, cancelar tras confirmar)');
    const set = creadas.slice(0, Math.min(N, creadas.length));
    for (const c of set) {
      const tk = firmarToken(c.id);
      await fetch(`${API}/api/v1/citas/confirmar?token=${encodeURIComponent(tk)}`); // ya confirmada antes en S2
      const r2 = await fetch(`${API}/api/v1/citas/confirmar?token=${encodeURIComponent(tk)}`);
      const cancel = await fetch(`${API}/api/v1/citas/cancelar?token=${encodeURIComponent(tk)}`);
      const cita = await prisma.cita.findUnique({ where: { id: c.id }, select: { estado: true, estadoConfirmacion: true } });
      // Confirmar 2x no rompe; cancelar tras confirmar: la cita estaba confirmada → cancelar la pasa a cancelada (acción del paciente válida) o la mantiene; lo que NO debe pasar es 500/corrupción
      if (r2.status === 200 && cancel.status === 200 && cita) ok(r);
      else bad(r, `r2=${r2.status} cancel=${cancel.status} estado=${cita?.estado}`);
    }
    resultados.push(r);
  }

  // ───────────────────────────── S7: Filtro de correos sucios (anti-rebote) ─────────────────────────────
  {
    const r = R('S7 Filtro email enviable (datos sucios)');
    const validos = ['a@gmail.com', 'b.c@hotmail.com', 'x_y@outlook.es', 'real@empresa.pe'];
    const invalidos = ['maría@email.com', 'x@email.com', 'y@limablue-test.pe', 'sinarroba', 'a@b', '', 'pep@x.test', 'José.García@mail.com'];
    for (let i = 0; i < N; i++) {
      const esperadoEnviable = i % 2 === 0;
      const email = esperadoEnviable ? validos[i % validos.length] : invalidos[i % invalidos.length];
      const real = esEmailEnviable(email);
      if (real === esperadoEnviable) ok(r); else bad(r, `email="${email}" esperado=${esperadoEnviable} real=${real}`);
    }
    resultados.push(r);
  }

  // ───────────────────────────── S8: Control de acceso (no-admin → MailConfig) ─────────────────────────────
  {
    const r = R('S8 Control de acceso (recepcionista NO puede MailConfig)');
    let recToken = '';
    try { recToken = await login('recepcion.lince@limablue.pe', 'Recepcion2025!'); } catch { /* */ }
    if (!recToken) { recToken = await login('recepcion.losolivos@limablue.pe', 'Recepcion2025!').catch(() => ''); }
    for (let i = 0; i < N; i++) {
      const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${recToken}` };
      const get = await fetch(`${API}/api/v1/herramientas/mail-config`, { headers });
      const put = await fetch(`${API}/api/v1/herramientas/mail-config`, { method: 'PUT', headers, body: JSON.stringify({ fromEmail: 'hack@x.com', fromName: 'x' }) });
      if (get.status === 403 && put.status === 403) ok(r); else bad(r, `GET=${get.status} PUT=${put.status} (recToken=${recToken ? 'ok' : 'VACIO'})`);
    }
    resultados.push(r);
  }

  // ───────────────────────────── S9: Concurrencia (5 confirmaciones simultáneas) ─────────────────────────────
  {
    const r = R('S9 Concurrencia: 5 confirmaciones simultáneas misma cita');
    const set: { id: string }[] = [];
    while (set.length < N) { const s = nextSlot(); if (!s) break; const { status, json } = await crearCita({ pacienteId, profesionalId: s.profId, sedeId: s.sedeId, unidadNegocioId: uniPod.id, servicioId: serv.id, fecha: s.fecha, horaInicio: s.hora, canal: 'recepcion' }); if (status === 201) set.push({ id: json.id }); }
    for (const c of set) {
      const tk = firmarToken(c.id);
      const resps = await Promise.all(Array.from({ length: 5 }, () => fetch(`${API}/api/v1/citas/confirmar?token=${encodeURIComponent(tk)}`)));
      const codes = resps.map(x => x.status);
      const cita = await prisma.cita.findUnique({ where: { id: c.id }, select: { estadoConfirmacion: true } });
      if (codes.every(x => x === 200) && cita?.estadoConfirmacion === 'confirmada') ok(r);
      else bad(r, `codes=${codes.join(',')} estado=${cita?.estadoConfirmacion}`);
    }
    resultados.push(r);
  }

  // ───────────────────────────── S10: Proveedor de correo caído (cita debe crearse igual) ─────────────────────────────
  {
    const r = R('S10 Gmail no conectado: la cita igual se crea');
    // En la DB de prueba no hay MailConfig conectada → el auto-envío se omite; la cita debe crearse.
    let creadas10 = 0;
    for (let i = 0; i < N; i++) {
      const s = nextSlot(); if (!s) break;
      const { status, json } = await crearCita({ pacienteId, profesionalId: s.profId, sedeId: s.sedeId, unidadNegocioId: uniPod.id, servicioId: serv.id, fecha: s.fecha, horaInicio: s.hora, canal: 'recepcion' });
      if (status === 201 && json.id) { ok(r); creadas10++; } else bad(r, `status=${status} ${json.error}`);
    }
    resultados.push(r);
  }

  // ── Reporte ──
  console.log('\n================= RESULTADOS AUDITORÍA MASIVA =================');
  console.log(`API: ${API} (DB de prueba) · N objetivo por escenario: ${N} · pool podólogas: ${pool.length} · slots: ${slots.length}\n`);
  let totE = 0, totP = 0, totF = 0;
  for (const r of resultados) {
    totE += r.ejecutados; totP += r.pasados; totF += r.fallidos;
    const pct = r.ejecutados ? ((r.pasados / r.ejecutados) * 100).toFixed(1) : '0';
    console.log(`${r.pasados === r.ejecutados && r.ejecutados > 0 ? '✅' : '❌'} ${r.escenario}: ${r.pasados}/${r.ejecutados} (${pct}%)`);
    if (r.ejemplosFallo.length) r.ejemplosFallo.forEach(e => console.log(`      ↳ ${e}`));
  }
  console.log(`\nTOTAL: ${totP}/${totE} pasados (${totE ? ((totP / totE) * 100).toFixed(1) : 0}%) · fallidos: ${totF}`);
  console.log('===============================================================');
  require('fs').writeFileSync('/tmp/audit-resultados.json', JSON.stringify(resultados, null, 2));
  await prisma.$disconnect();
}
main().catch(async (e) => { console.error('ERROR runner:', e); await prisma.$disconnect(); process.exit(1); });
