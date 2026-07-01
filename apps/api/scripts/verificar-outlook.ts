/**
 * Verificación de la sincronización con Outlook usando un Microsoft Graph SIMULADO (mock de fetch).
 * Cubre los pasos 1–6 del prompt. El paso 7 (Outlook móvil real) requiere credenciales Azure reales.
 */
process.env.AZURE_TENANT_ID = 'tenant-test';
process.env.AZURE_CLIENT_ID = 'client-test';
process.env.AZURE_CLIENT_SECRET = 'secret-test';

import { prisma } from '../src/db';
import { sincronizarCitaOutlook } from '../src/services/outlookCalendarService';

interface Call { method: string; url: string }
const calls: Call[] = [];
let modo: 'ok' | 'fail' = 'ok';
let evtN = 0;
const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: any, init: any) => {
  const url = String(input); const method = init?.method ?? 'GET';
  if (url.includes('login.microsoftonline.com')) return new Response(JSON.stringify({ access_token: 'tok', expires_in: 3600 }), { status: 200 });
  calls.push({ method, url });
  if (modo === 'fail') return new Response('graph caído', { status: 500 });
  if (method === 'POST') return new Response(JSON.stringify({ id: `evt-${++evtN}` }), { status: 201 });
  if (method === 'PATCH') return new Response(JSON.stringify({ id: 'evt' }), { status: 200 });
  if (method === 'DELETE') return new Response(null, { status: 204 });
  return new Response('{}', { status: 200 });
}) as typeof fetch;

const ok = (b: boolean, msg: string) => console.log(`${b ? '✓' : '✗ FALLO:'} ${msg}`);
const ultimaLlamada = () => calls[calls.length - 1];

async function crearCitaPrueba(profId: string | null, pacienteId: string, sedeId: string, unidadId: string, servicioId: string, hora = '09:00') {
  return prisma.cita.create({ data: {
    pacienteId, profesionalId: profId, sedeId, unidadNegocioId: unidadId, servicioId,
    fecha: new Date('2026-12-01T12:00:00'), horaInicio: hora, duracionMinutos: 30, estado: 'agendada',
  } });
}

async function main() {
  const pod = (await prisma.unidadNegocio.findFirst({ where: { nombre: { contains: 'odolog' } }, select: { id: true } }))!;
  const one = (await prisma.sede.findFirst({ where: { nombre: 'One' }, select: { id: true } }))!;
  const serv = (await prisma.servicio.findFirst({ where: { unidadNegocioId: pod.id, activo: true }, select: { id: true } }))!;
  const pac = (await prisma.paciente.findFirst({ where: { deletedAt: null }, select: { id: true } }))!;
  const daniel = (await prisma.profesional.findFirst({ where: { tipo: 'podologa', nombres: { contains: 'Daniel' }, apellidos: { contains: 'Doy' } }, select: { id: true } }))!;
  const yasica = (await prisma.profesional.findFirst({ where: { tipo: 'podologa', nombres: { contains: 'Yasica' }, apellidos: { contains: 'Doy' } }, select: { id: true } }))!;
  const otro = (await prisma.profesional.findFirst({ where: { tipo: 'podologa', NOT: { apellidos: { contains: 'Doy' } } }, select: { id: true } }))!;

  const cd = await crearCitaPrueba(daniel.id, pac.id, one.id, pod.id, serv.id);
  const cy = await crearCitaPrueba(yasica.id, pac.id, one.id, pod.id, serv.id);
  const co = await crearCitaPrueba(otro.id, pac.id, one.id, pod.id, serv.id);
  const ids = [cd.id, cy.id, co.id];

  try {
    // 1) Daniel → evento en danieldoy@limablue.com
    await sincronizarCitaOutlook('crear', cd.id);
    let l = ultimaLlamada();
    ok(l?.method === 'POST' && l.url.includes('danieldoy%40limablue.com/events'), 'Paso 1: cita de Daniel → POST a danieldoy@limablue.com');
    let cdDb = await prisma.cita.findUnique({ where: { id: cd.id } });
    ok(!!cdDb?.outlookEventId, `Paso 1: outlookEventId guardado (${cdDb?.outlookEventId})`);

    // 2) Yasica → NO usa Graph (se notifica por Gmail con invitación .ics)
    const callsAntesYasica = calls.length;
    await sincronizarCitaOutlook('crear', cy.id);
    ok(calls.length === callsAntesYasica, 'Paso 2: cita de Yasica → NO usa Graph (va por Gmail .ics)');

    // 3) Otro profesional → NO sincroniza
    const antes = calls.length;
    await sincronizarCitaOutlook('crear', co.id);
    ok(calls.length === antes, 'Paso 3: cita de otro profesional → NO se sincroniza (0 llamadas Graph)');
    const coDb = await prisma.cita.findUnique({ where: { id: co.id } });
    ok(!coDb?.outlookEventId, 'Paso 3: otro profesional sin outlookEventId');

    // 4) Modificar Daniel → PATCH mismo evento (no duplica con POST)
    const postsAntes = calls.filter(c => c.method === 'POST').length;
    await sincronizarCitaOutlook('actualizar', cd.id);
    l = ultimaLlamada();
    const postsDespues = calls.filter(c => c.method === 'POST').length;
    ok(l?.method === 'PATCH' && l.url.includes(cdDb!.outlookEventId!) && postsDespues === postsAntes, 'Paso 4: modificar → PATCH al mismo evento (sin POST duplicado)');

    // 5) Cancelar Daniel → DELETE + limpia outlookEventId
    await sincronizarCitaOutlook('cancelar', cd.id);
    l = ultimaLlamada();
    cdDb = await prisma.cita.findUnique({ where: { id: cd.id } });
    ok(l?.method === 'DELETE' && !cdDb?.outlookEventId, 'Paso 5: cancelar → DELETE y outlookEventId limpiado');

    // 6) Fallo de Graph → la cita persiste, se registra el error, no rompe
    modo = 'fail';
    const cd2 = await crearCitaPrueba(daniel.id, pac.id, one.id, pod.id, serv.id, '10:00'); ids.push(cd2.id);
    let lanzo = false;
    await sincronizarCitaOutlook('crear', cd2.id).catch(() => { lanzo = true; });
    const cd2Db = await prisma.cita.findUnique({ where: { id: cd2.id } });
    ok(!lanzo && !!cd2Db && !cd2Db.outlookEventId && !!cd2Db.outlookSyncError, `Paso 6: Graph falla → cita persiste, sin evento, error registrado ("${cd2Db?.outlookSyncError?.slice(0, 40)}…")`);
    modo = 'ok';
  } finally {
    await prisma.cita.deleteMany({ where: { id: { in: ids } } });
    globalThis.fetch = realFetch;
    console.log('\nLimpieza: citas de prueba eliminadas.');
    await prisma.$disconnect();
  }
}
main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
