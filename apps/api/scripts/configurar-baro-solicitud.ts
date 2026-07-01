/**
 * Baropodometría: automática por defecto + opción de pedir a alguien específico.
 *  - Unidad Baropodometría → modoReserva 'preferencia_opcional'.
 *  - Daniel Doy → soloPorSolicitud=true (nunca auto; seleccionable en cualquier sede, baro y podología).
 *  - Crea los médicos del CSV como profesionales soloPorSolicitud=true con competencias de baro
 *    y horario amplio (lun-sáb 08-20), SIN asignación de sede (no son columnas fijas).
 * Idempotente.
 */
import { prisma } from '../src/db';

const DOCTORES = [
  'YOPLAC AUGUSTIN DANTE JAIME', 'MUÑOZ RAMIREZ XIOMARA MELANY', 'LEYVA PAULINI ALEXANDRA ANTONELLA',
  'ARRASCO GALVEZ LIBERTAD', 'SANCHEZ RAMOS ADRIAN', 'ROQUE COLQUI RODRIGO', 'PAZ INFANTE MERCEDES MARGARITA',
  'ROJAS GALVEZ CHRISTIAN ADRIAN', 'GABRIELA MANCILLA CHANG', 'TAFUR VILLACORTA JAIME',
  'RUIZ FERNANDEZ JAIME FERNANDO', 'VILLAFUERTE NISA JULIO RAMON', 'SIRA LUCENA DENNY OSCAR',
];
const titleCase = (s: string) => s.toLowerCase().split(/\s+/).map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z ]/g, '').replace(/\s+/g, ' ').trim();

async function main() {
  const baro = await prisma.unidadNegocio.findFirst({ where: { nombre: { contains: 'aropodometr' } }, select: { id: true } });
  if (!baro) throw new Error('No existe la unidad Baropodometría');

  await prisma.unidadNegocio.update({ where: { id: baro.id }, data: { modoReserva: 'preferencia_opcional' } });
  console.log('✓ Baropodometría → preferencia_opcional');

  const danis = await prisma.profesional.updateMany({ where: { tipo: 'podologa', nombres: { contains: 'Daniel' }, apellidos: { contains: 'Doy' } }, data: { soloPorSolicitud: true } });
  console.log(`✓ Daniel Doy → soloPorSolicitud (${danis.count})`);

  const serviciosBaro = await prisma.servicio.findMany({ where: { unidadNegocioId: baro.id, activo: true, deletedAt: null }, select: { id: true } });
  const existentes = await prisma.profesional.findMany({ where: { deletedAt: null }, select: { id: true, nombres: true, apellidos: true } });
  const existeNorm = new Set(existentes.map(p => norm(`${p.apellidos} ${p.nombres}`)));

  let creados = 0;
  for (const full of DOCTORES) {
    const tokens = full.trim().split(/\s+/);
    const apellidos = titleCase(tokens.slice(0, 2).join(' '));
    const nombres = titleCase(tokens.slice(2).join(' ') || tokens[0]);
    if (existeNorm.has(norm(`${apellidos} ${nombres}`)) || existeNorm.has(norm(full))) { continue; }

    const prof = await prisma.profesional.create({
      data: {
        nombres, apellidos, tipo: 'medico', unidadNegocioId: baro.id,
        soloPorSolicitud: true, activo: true, colorAvatar: '#0D9488',
        competencias: { create: serviciosBaro.map(s => ({ servicioId: s.id, habilitadoDesde: new Date(), activa: true })) },
        horarios: { create: [1, 2, 3, 4, 5, 6].map(d => ({ diaSemana: d, horaInicio: '08:00', horaFin: '20:00', activo: true })) },
      },
    });
    creados++; console.log(`  + Dr(a). ${nombres} ${apellidos} (${prof.id.slice(0, 8)})`);
  }
  console.log(`✓ Médicos creados: ${creados} (de ${DOCTORES.length}; el resto ya existían)`);

  // Resumen
  const totalSolic = await prisma.profesional.count({ where: { deletedAt: null, soloPorSolicitud: true } });
  console.log(`\nTotal profesionales "solo por solicitud": ${totalSolic}`);
}

main().then(() => prisma.$disconnect()).catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
