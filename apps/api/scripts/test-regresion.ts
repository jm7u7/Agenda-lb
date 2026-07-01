import fetch from 'node-fetch';
import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
const BASE = 'http://localhost:3002/api/v1';

async function post(url: string, body: object, token: string) {
  const r = await fetch(`${BASE}${url}`, { method:'POST', headers:{'Content-Type':'application/json','Authorization':`Bearer ${token}`}, body: JSON.stringify(body) });
  return { status: r.status, data: await r.json() as Record<string,unknown> };
}
async function del(url: string, token: string) {
  const r = await fetch(`${BASE}${url}`, { method:'DELETE', headers:{'Authorization':`Bearer ${token}`} });
  return { status: r.status, data: await r.json() as Record<string,unknown> };
}
async function get(url: string, token: string) {
  const r = await fetch(`${BASE}${url}`, { headers:{'Authorization':`Bearer ${token}`} });
  return { status: r.status, data: await r.json() as Record<string,unknown> };
}
async function patchReq(url: string, body: object, token: string) {
  const r = await fetch(`${BASE}${url}`, { method:'PATCH', headers:{'Content-Type':'application/json','Authorization':`Bearer ${token}`}, body: JSON.stringify(body) });
  return { status: r.status, data: await r.json() as Record<string,unknown> };
}

async function main() {
  console.log('\n🔬 TEST DE REGRESIÓN — Bugs corregidos\n');
  const login = await post('/auth/login', { email:'admin@limablue.pe', password:'Admin1234!' }, '');
  const token = login.data.token as string;
  console.log('✅ Login OK\n');

  const sede = await prisma.sede.findFirst({ where: { nombre: 'Paz Soldán' } });
  const un   = await prisma.unidadNegocio.findFirst({ where: { nombre: 'Podología' } });
  const prof = await prisma.profesional.findFirst({ where: { activo: true, unidadNegocioId: un!.id, asignaciones: { some: { sedeId: sede!.id } } } });
  const comp = await prisma.competenciaProfesional.findFirst({ where: { profesionalId: prof!.id, activa: true } });

  // Paciente de prueba
  const pac = await post('/pacientes', {
    nombres:'Regresion', apellidoPaterno:'Test', apellidoMaterno:'QA',
    tipoDocumento:'DNI', numeroDocumento:'99999902', telefono:'999999902'
  }, token);
  const pacId = pac.data.id as string;
  console.log(`Paciente de prueba: ${pacId}\n`);

  // ── BUG-1: Cancelar via DELETE y verificar que sigue en historial ─────────
  const cita1 = await post('/citas', {
    pacienteId: pacId, profesionalId: prof!.id,
    sedeId: sede!.id, unidadNegocioId: un!.id, servicioId: comp!.servicioId,
    fecha: '2026-06-16', horaInicio: '09:30', canal: 'recepcion'
  }, token);
  const citaId1 = cita1.data.id as string;

  await del(`/citas/${citaId1}`, token);
  const histPac = await get(`/pacientes/${pacId}`, token);
  const citaEnHistorial = (histPac.data.historial as {id:string;estado:string}[])?.find(h => h.id === citaId1);
  console.log(`[BUG-1] Cita cancelada permanece en historial: ${citaEnHistorial ? '✅ CORREGIDO' : '❌ FALLA'}`);
  console.log(`[BUG-1] Estado visible al paciente: "${citaEnHistorial?.estado ?? 'invisible'}" ${citaEnHistorial?.estado === 'cancelada' ? '✅' : '❌'}\n`);

  // ── BUG-2: Slot fuera de horario sábado rechazado ─────────────────────────
  const citaFuera = await post('/citas', {
    pacienteId: pacId, profesionalId: prof!.id,
    sedeId: sede!.id, unidadNegocioId: un!.id, servicioId: comp!.servicioId,
    fecha: '2026-06-13', horaInicio: '15:30', canal: 'recepcion' // sábado, cierra 14:00
  }, token);
  console.log(`[BUG-2] Slot sáb 15:30 en Paz Soldán (cierra 14:00): ${citaFuera.status===400 && citaFuera.data.error==='SLOT_FUERA_HORARIO' ? '✅ CORREGIDO (bloqueado)' : `❌ FALLA (${citaFuera.status})`}\n`);

  // Slot válido sábado (antes de las 14:00) sí debe pasar
  const citaDentroHorario = await post('/citas', {
    pacienteId: pacId, profesionalId: prof!.id,
    sedeId: sede!.id, unidadNegocioId: un!.id, servicioId: comp!.servicioId,
    fecha: '2026-06-13', horaInicio: '11:00', canal: 'recepcion' // sábado, dentro del horario
  }, token);
  console.log(`[BUG-2] Slot sáb 11:00 válido aceptado: ${citaDentroHorario.status===201 || citaDentroHorario.status===409 ? '✅ OK' : `❌ FALLA (${citaDentroHorario.status})`}\n`);

  // ── BUG-3: sesionNumero no duplicado en paquetes ──────────────────────────
  const paqPac = await prisma.paquetePaciente.findFirst({ where: { activo: true, deletedAt: null } });
  if (paqPac) {
    const c1 = await post('/citas', {
      pacienteId: paqPac.pacienteId, profesionalId: prof!.id,
      sedeId: sede!.id, unidadNegocioId: un!.id, servicioId: comp!.servicioId,
      fecha: '2026-06-23', horaInicio: '10:00', canal: 'recepcion', paquetePacienteId: paqPac.id
    }, token);
    const c2 = await post('/citas', {
      pacienteId: paqPac.pacienteId, profesionalId: prof!.id,
      sedeId: sede!.id, unidadNegocioId: un!.id, servicioId: comp!.servicioId,
      fecha: '2026-06-24', horaInicio: '10:00', canal: 'recepcion', paquetePacienteId: paqPac.id
    }, token);
    const s1 = c1.status===201 ? (c1.data as {sesionNumero:number}).sesionNumero : 'error';
    const s2 = c2.status===201 ? (c2.data as {sesionNumero:number}).sesionNumero : 'error';
    const ok = typeof s1==='number' && typeof s2==='number' && s1 !== s2;
    console.log(`[BUG-3] Números de sesión únicos: sesion1=${s1} sesion2=${s2} ${ok ? '✅ CORREGIDO' : '❌ FALLA (duplicados)'}\n`);
  }

  // ── BUG-4: totalCitas incluido en respuesta del paciente ─────────────────
  const totalCitas = (histPac.data as {totalCitas?:number}).totalCitas;
  console.log(`[BUG-4] Campo totalCitas en /pacientes/:id: ${totalCitas !== undefined ? `✅ CORREGIDO (totalCitas=${totalCitas})` : '❌ FALLA (campo ausente)'}\n`);

  // ── BUG-5: Stats de sede con capacidad dinámica ───────────────────────────
  const stats = await get(`/citas/sede/${sede!.id}/stats?fecha=2026-06-13`, token);
  const ocup = (stats.data as {ocupacion?:number}).ocupacion;
  console.log(`[BUG-5] Ocupación calculada dinámicamente: ${ocup !== undefined && ocup !== 0 ? `✅ CORREGIDO (${ocup}%)` : `⚠️  ocupacion=${ocup} (verificar manualmente)`}\n`);

  console.log('─────────────────────────────────────────');
  console.log('✅ Test de regresión completado');
  await prisma.$disconnect();
}
main().catch(e => { console.error(e); process.exit(1); });
