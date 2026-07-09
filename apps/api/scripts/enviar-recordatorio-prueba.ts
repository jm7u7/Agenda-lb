/**
 * PRUEBA one-off: envía el correo de RECORDATORIO (con botones Confirmar / Reprogramar)
 * a un destinatario de prueba, usando una cita de prueba desechable y tokens reales
 * (para que los botones funcionen). No toca datos reales.
 *
 *   npx ts-node scripts/enviar-recordatorio-prueba.ts danieldoy1@hotmail.com
 */
import 'dotenv/config';
import { prisma } from '../src/db';
import { crearTokenAccion } from '../src/services/tokenAccionCita';
import { enviarCorreoRecordatorio, resendConfigurado } from '../src/services/emailService';

async function main() {
  const destino = process.argv[2];
  if (!destino) throw new Error('Uso: ts-node scripts/enviar-recordatorio-prueba.ts <email>');
  if (!resendConfigurado()) throw new Error('RESEND_API_KEY ausente: no se puede enviar.');

  // Catálogo real para FKs válidas (no altera nada existente).
  const sede = await prisma.sede.findFirst({ where: { deletedAt: null }, orderBy: { orden: 'asc' } });
  if (!sede) throw new Error('No hay sedes');
  const su = await prisma.sedeUnidadNegocio.findFirst({
    where: { sedeId: sede.id },
    include: { unidadNegocio: true },
  });
  if (!su) throw new Error('La sede no tiene unidad de negocio');
  const servicio = await prisma.servicio.findFirst({
    where: { unidadNegocioId: su.unidadNegocioId, activo: true, deletedAt: null },
    orderBy: { nombre: 'asc' },
  });
  if (!servicio) throw new Error('No hay servicio para la unidad');
  const profesional = await prisma.profesional.findFirst({
    where: { unidadNegocioId: su.unidadNegocioId, activo: true, deletedAt: null },
  });

  // Paciente de prueba con el correo destino (find-or-create; numeroDocumento no es único).
  const docPrueba = 'TEST-RECORD-0001';
  const existente = await prisma.paciente.findFirst({ where: { numeroDocumento: docPrueba } });
  const paciente = existente
    ? await prisma.paciente.update({ where: { id: existente.id }, data: { email: destino, deletedAt: null } })
    : await prisma.paciente.create({
        data: {
          nombres: 'Daniel (PRUEBA)', apellidoPaterno: 'Doy', apellidoMaterno: 'Test',
          tipoDocumento: 'DNI', numeroDocumento: docPrueba, telefono: '999999999', email: destino,
        },
      });

  // Cita de prueba en fecha lejana (evita chocar con slots reales). Marcada en el motivo.
  const cita = await prisma.cita.create({
    data: {
      pacienteId: paciente.id,
      profesionalId: profesional?.id ?? null,
      sedeId: sede.id,
      unidadNegocioId: su.unidadNegocioId,
      servicioId: servicio.id,
      fecha: new Date('2026-12-15T00:00:00.000Z'),
      horaInicio: '10:00',
      duracionMinutos: servicio.duracionMinutos,
      estado: 'agendada',
      canal: 'recepcion',
    },
  });

  const apiBase = (process.env.API_BASE_URL || 'http://localhost:3002').replace(/\/$/, '');
  const expira = new Date(Date.now() + 30 * 24 * 60 * 60_000); // 30 días para poder probar
  const tConf = await crearTokenAccion(cita.id, 'confirmar', expira);
  const tRep = await crearTokenAccion(cita.id, 'reprogramar', expira);

  const r = await enviarCorreoRecordatorio({
    citaId: cita.id,
    urlConfirmar: `${apiBase}/api/v1/citas/confirmar/${tConf}`,
    urlReprogramar: `${apiBase}/api/v1/citas/reprogramar/${tRep}`,
  });

  console.log(JSON.stringify({
    enviadoA: r.to, resendId: r.id, citaPruebaId: cita.id,
    servicio: servicio.nombre, sede: sede.nombre, profesional: profesional ? `${profesional.nombres} ${profesional.apellidos}` : null,
    urlConfirmar: `${apiBase}/api/v1/citas/confirmar/${tConf}`,
    urlReprogramar: `${apiBase}/api/v1/citas/reprogramar/${tRep}`,
  }, null, 2));

  await prisma.$disconnect();
}

main().catch((e) => { console.error('ERROR:', e instanceof Error ? e.message : e); process.exit(1); });
