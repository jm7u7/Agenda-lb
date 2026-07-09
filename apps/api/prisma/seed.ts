import { PrismaClient, TipoProfesional, EstadoCita, CanalReserva, OrigenAsignacion } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { subDays, format } from 'date-fns';
import * as path from 'path';
import { aplicarListaFinal } from '../scripts/aplicar-csv-final';
import { sembrarPromociones } from '../scripts/seed-promociones';

const prisma = new PrismaClient();

const HOY = new Date();
HOY.setHours(0, 0, 0, 0);
const AHORA_HORA = 12; // hora de referencia fija para demo (mañana=completada, tarde=agendada)

function colorAvatar(i: number): string {
  const c = ['#3B82F6','#8B5CF6','#EC4899','#F59E0B','#10B981','#6366F1','#EF4444',
             '#14B8A6','#F97316','#84CC16','#06B6D4','#A855F7','#F43F5E','#D97706',
             '#059669','#0EA5E9','#7C3AED','#BE185D','#B45309','#166534'];
  return c[i % c.length]!;
}

function estadoPorHora(horaSlot: string): EstadoCita {
  const h = parseInt(horaSlot.split(':')[0]!);
  if (h < AHORA_HORA - 1) return Math.random() > 0.08 ? 'completada' : 'no_show';
  if (h === AHORA_HORA - 1) return Math.random() > 0.4 ? 'completada' : 'en_atencion';
  if (h === AHORA_HORA) return Math.random() > 0.5 ? 'llego' : 'en_atencion';
  return Math.random() > 0.45 ? 'confirmada' : 'agendada';
}

async function crearCita(params: {
  pacienteId: string; profesionalId: string; sedeId: string;
  unidadNegocioId: string; servicioId: string; fecha: Date;
  horaInicio: string; duracionMinutos: number; canal: CanalReserva;
  origen: OrigenAsignacion; paquetePacienteId?: string; sesionNumero?: number;
}) {
  // Anti-doble-booking: el índice único es PARCIAL (solo citas activas), ya no es una
  // @@unique de Prisma, así que verificamos con findFirst en vez de findUnique por clave.
  const existente = await prisma.cita.findFirst({
    where: { profesionalId: params.profesionalId, fecha: params.fecha, horaInicio: params.horaInicio, deletedAt: null },
  });
  if (existente) return null;
  return prisma.cita.create({
    data: {
      pacienteId: params.pacienteId, profesionalId: params.profesionalId,
      sedeId: params.sedeId, unidadNegocioId: params.unidadNegocioId,
      servicioId: params.servicioId, fecha: params.fecha,
      horaInicio: params.horaInicio, duracionMinutos: params.duracionMinutos,
      estado: estadoPorHora(params.horaInicio), canal: params.canal,
      origenAsignacion: params.origen, paquetePacienteId: params.paquetePacienteId,
      sesionNumero: params.sesionNumero,
    },
  });
}

// ── Personal real del Excel (Personal 062026) ─────────────────────────────────
// Formato: { nombres, apellidos }
// Parseado desde APELLIDO1 APELLIDO2 NOMBRE1 NOMBRE2 → apellidos = ap1 ap2, nombres = nom1 nom2

const PODOLOGAS_POR_SEDE: Record<string, { nombres: string; apellidos: string }[]> = {
  'Paz Soldán': [
    { nombres: 'Nelly Juana',          apellidos: 'Noteno Jacinto'           }, // Asistente
    { nombres: 'Glenda Milagritos',    apellidos: 'Paredes Salinas'          },
    { nombres: 'Mayra Estephany',      apellidos: 'Sosa Baquerizo'           },
    { nombres: 'Milagros Mercedes',    apellidos: 'Flores Paredes'           }, // Asistente
    { nombres: 'Jenny Rosario',        apellidos: 'Chiclla Suehara'          },
    { nombres: 'Hayde Milagros',       apellidos: 'Salinas Ubillus'          },
    { nombres: 'Carla Cynthia',        apellidos: 'Castro Valdez'            },
  ],
  'Lince': [
    { nombres: 'Fiorella',             apellidos: 'Rios Peñaherrera'         }, // Supervisora
    { nombres: 'Tania Cleofe',         apellidos: 'Pacco Gutierrez'          },
    { nombres: 'Carmen Ines',          apellidos: 'Culquicondor Franco'      },
    { nombres: 'Ivonne Jill',          apellidos: 'Auris Asca'               },
    { nombres: 'Martha Ybelice',       apellidos: 'Pisco Panduro'            },
    { nombres: 'Lesly Selene',         apellidos: 'Chavez Ocampo'            },
    { nombres: 'Milagros Maria',       apellidos: 'Zambrano Cuevas'          },
    { nombres: 'Yeccijca Rosario',     apellidos: 'Chamorro Meza'            }, // Asistente
    { nombres: 'Vanessa Elizabeth',    apellidos: 'Puerta Ramos'             }, // Asistente
  ],
  'Los Olivos': [
    { nombres: 'Sonia Marlene',        apellidos: 'Tejada Bazan'             }, // Supervisora
    { nombres: 'Gissela Victoria',     apellidos: 'Morote Carmona'           },
    { nombres: 'Mirtha',               apellidos: 'Chavez Vazquez'           }, // Asistente
    { nombres: 'Erika Maria',          apellidos: 'Saavedra Carbajal'        },
    { nombres: 'Luz Haydee',           apellidos: 'Saldaña Mostacero'        },
    { nombres: 'Laura Kelly',          apellidos: 'Escalante Mendoza'        }, // Asistente
  ],
  'San Miguel': [
    { nombres: 'Doris Vicenta',        apellidos: 'Marquina Vasquez'         },
    { nombres: 'Raysa Alessandra',     apellidos: 'Rodriguez Haro'           },
    { nombres: 'Maximina',             apellidos: 'Gutierrez Ñahuis'         },
    { nombres: 'Miluska Isabel',       apellidos: 'Valencia Chiyuare'        },
    { nombres: 'Angelica Isabel',      apellidos: 'Taya Huallpacuna'         },
  ],
  'One': [
    { nombres: 'Sarai Abigail',        apellidos: 'Diaz Vergara'             },
    { nombres: 'Erika Shabell',        apellidos: 'Chamorro Pacheco'         },
    { nombres: 'Fiorella Estephany',   apellidos: 'Bouisson Carbajal'        },
  ],
};

const FISIOTERAPEUTAS = [
  { nombres: 'Catherine Isabel', apellidos: 'Paucar Arellano' },
  { nombres: 'Alicia Maribel',   apellidos: 'Cisneros Mija'   },
];

// Baropodometría: recursos genéricos "Baro N" por sede (no nombre de médico)
const BAROS_POR_SEDE: Record<string, number> = {
  'Paz Soldán': 2,
  'Lince':      1,
  'Los Olivos': 1,
  'San Miguel': 1,
  'One':        1,
};

async function main() {
  console.log('🌱 Iniciando seed de Limablue Agenda — Personal real...');

  // ── GUARDIA DE SEGURIDAD ───────────────────────────────────────────────────
  // El seed destruye TODOS los datos y los recrea desde cero.
  // Para evitar accidentes en producción, requiere la variable FORCE_SEED=true.
  const citasExistentes = await prisma.cita.count();
  if (citasExistentes > 0 && process.env.FORCE_SEED !== 'true') {
    console.error('');
    console.error('❌ SEED BLOQUEADO — La base de datos ya tiene datos reales.');
    console.error(`   Se encontraron ${citasExistentes} citas en la base de datos.`);
    console.error('');
    console.error('   ⚠️  El seed BORRA TODO y recrea los datos de demo.');
    console.error('   Si realmente quieres hacerlo, ejecuta:');
    console.error('');
    console.error('   FORCE_SEED=true npx prisma db seed');
    console.error('');
    process.exit(0);
  }

  if (process.env.FORCE_SEED === 'true') {
    console.log('⚠️  FORCE_SEED=true — Borrando todos los datos existentes...');
  }

  // ── Limpiar DB ──────────────────────────────────────────────────────────────
  await prisma.auditLog.deleteMany();
  await prisma.webhookLog.deleteMany();
  await prisma.webhookSubscription.deleteMany();
  await prisma.agregadoDiario.deleteMany();
  // Hijos de Cita con onDelete: Restrict — borrar antes que las citas.
  await prisma.recordatorioCita.deleteMany();
  await prisma.tokenAccionCita.deleteMany();
  await prisma.comentarioCita.deleteMany();
  await prisma.cita.deleteMany();
  await prisma.paquetePaciente.deleteMany();
  await prisma.paquete.deleteMany();
  await prisma.competenciaProfesional.deleteMany();
  await prisma.bloqueoAgenda.deleteMany();
  await prisma.horarioProfesional.deleteMany();
  await prisma.asignacionSede.deleteMany();
  await prisma.combinacionPermitida.deleteMany(); // FK → servicio: borrar antes
  await prisma.configuracionSistema.deleteMany(); // FK → servicio: borrar antes
  await prisma.promocion.deleteMany(); // citas (FK→promocion) ya borradas arriba
  await prisma.servicio.deleteMany();
  await prisma.apiKey.deleteMany();
  await prisma.usuarioSede.deleteMany();
  // Notificaciones referencian usuarios (creadoPor / vistas) — borrar antes que usuarios.
  await prisma.notificacionVista.deleteMany();
  await prisma.notificacionSede.deleteMany();
  await prisma.notificacion.deleteMany();
  await prisma.usuario.deleteMany();
  await prisma.paciente.deleteMany();
  await prisma.entradaPodologa.deleteMany(); // FK → profesional
  await prisma.profesional.deleteMany();
  await prisma.excepcionHorario.deleteMany();
  await prisma.sedeUnidadNegocio.deleteMany();
  await prisma.unidadNegocio.deleteMany();
  await prisma.sede.deleteMany();

  // ── Unidades de Negocio ─────────────────────────────────────────────────────
  console.log('  → Unidades de negocio...');
  const podologiaUN = await prisma.unidadNegocio.create({ data: { nombre: 'Podología',      modoReserva: 'preferencia_opcional',    color: '#3B82F6' } });
  const baroUN      = await prisma.unidadNegocio.create({ data: { nombre: 'Baropodometría', modoReserva: 'sin_eleccion',             color: '#8B5CF6' } });
  const fisioUN     = await prisma.unidadNegocio.create({ data: { nombre: 'Fisioterapia',   modoReserva: 'preferencia_obligatoria',  color: '#10B981' } });

  // ── Sedes ───────────────────────────────────────────────────────────────────
  console.log('  → Sedes...');

  // Horario: keys son día JS (0=domingo … 6=sábado), abierto=false = cerrado
  const horarioStd = { // Paz Soldán / One / Lince: L-V 8-18, S 8-14
    '1': { apertura: '08:00', cierre: '18:00', abierto: true },
    '2': { apertura: '08:00', cierre: '18:00', abierto: true },
    '3': { apertura: '08:00', cierre: '18:00', abierto: true },
    '4': { apertura: '08:00', cierre: '18:00', abierto: true },
    '5': { apertura: '08:00', cierre: '18:00', abierto: true },
    '6': { apertura: '08:00', cierre: '14:00', abierto: true },
    '0': { abierto: false },
  };
  const horarioSMOlivos = { // San Miguel / Los Olivos: L-V 9-18, S 8-15
    '1': { apertura: '09:00', cierre: '18:00', abierto: true },
    '2': { apertura: '09:00', cierre: '18:00', abierto: true },
    '3': { apertura: '09:00', cierre: '18:00', abierto: true },
    '4': { apertura: '09:00', cierre: '18:00', abierto: true },
    '5': { apertura: '09:00', cierre: '18:00', abierto: true },
    '6': { apertura: '08:00', cierre: '15:00', abierto: true },
    '0': { abierto: false },
  };

  // `orden`: secuencia de las pestañas de sede en la agenda (Los Olivos, One, San Miguel, Lince, Paz Soldán).
  const sedesData = [
    { nombre: 'Los Olivos',  direccion: 'Av. Antúnez de Mayolo 567, Los Olivos, Lima',    color: '#10B981', horario: horarioSMOlivos, orden: 1 },
    { nombre: 'San Miguel',  direccion: 'Av. La Marina 2000, San Miguel, Lima',             color: '#3B82F6', horario: horarioSMOlivos, orden: 3 },
    { nombre: 'Paz Soldán',  direccion: 'Calle Paz Soldán 890, San Isidro, Lima',           color: '#8B5CF6', horario: horarioStd, orden: 5 },
    { nombre: 'Lince',       direccion: 'Av. Arequipa 2340, Lince, Lima',                   color: '#F59E0B', horario: horarioStd, orden: 4 },
    { nombre: 'One',         direccion: 'Av. Javier Prado Este 4200, Santiago de Surco',   color: '#EF4444', horario: horarioStd, orden: 2 },
  ];

  const sedesCreadas: Record<string, { id: string; nombre: string }> = {};
  for (const s of sedesData) {
    const sede = await prisma.sede.create({ data: s });
    sedesCreadas[s.nombre] = sede;
  }
  const todasLasSedes = Object.values(sedesCreadas);

  // Unidades ↔ Sedes
  for (const sede of todasLasSedes) {
    await prisma.sedeUnidadNegocio.createMany({
      data: [
        { sedeId: sede.id, unidadNegocioId: podologiaUN.id },
        { sedeId: sede.id, unidadNegocioId: baroUN.id },
      ],
    });
  }
  // Fisioterapia: solo Paz Soldán
  await prisma.sedeUnidadNegocio.create({ data: { sedeId: sedesCreadas['Paz Soldán']!.id, unidadNegocioId: fisioUN.id } });

  // ── Servicios ───────────────────────────────────────────────────────────────
  console.log('  → Servicios...');
  const srvPod = await Promise.all([
    prisma.servicio.create({ data: { nombre: 'Limpieza Clínica del Pie - Regular', codigo: 'POD-LCP-REG', duracionMinutos: 30, color: '#3B82F6', precioReferencial: 60,  unidadNegocioId: podologiaUN.id } }),
    prisma.servicio.create({ data: { nombre: 'Limpieza Clínica del Pie - Premium', codigo: 'POD-LCP-PRE', duracionMinutos: 30, color: '#6366F1', precioReferencial: 80,  unidadNegocioId: podologiaUN.id } }),
    prisma.servicio.create({ data: { nombre: 'Profilaxis',                          codigo: 'POD-PRO',     duracionMinutos: 60, color: '#8B5CF6', precioReferencial: 90,  unidadNegocioId: podologiaUN.id } }),
    prisma.servicio.create({ data: { nombre: 'Curación de Úlcera',                  codigo: 'POD-CUR-ULC', duracionMinutos: 60, color: '#EF4444', precioReferencial: 120, unidadNegocioId: podologiaUN.id } }),
    prisma.servicio.create({ data: { nombre: 'Láser Podológico',                    codigo: 'POD-LASER',   duracionMinutos: 30, color: '#F59E0B', precioReferencial: 100, unidadNegocioId: podologiaUN.id } }),
    prisma.servicio.create({ data: { nombre: 'Quiropodia',                          codigo: 'POD-QUI',     duracionMinutos: 30, color: '#10B981', precioReferencial: 70,  unidadNegocioId: podologiaUN.id } }),
    prisma.servicio.create({ data: { nombre: 'Onicocriptosis',                      codigo: 'POD-ONI',     duracionMinutos: 30, color: '#14B8A6', precioReferencial: 85,  unidadNegocioId: podologiaUN.id } }),
    prisma.servicio.create({ data: { nombre: 'Heloma Simple',                       codigo: 'POD-HEL-SIM', duracionMinutos: 30, color: '#06B6D4', precioReferencial: 55,  unidadNegocioId: podologiaUN.id } }),
    prisma.servicio.create({ data: { nombre: 'Heloma Vascular',                     codigo: 'POD-HEL-VAS', duracionMinutos: 30, color: '#0EA5E9', precioReferencial: 70,  unidadNegocioId: podologiaUN.id } }),
    prisma.servicio.create({ data: { nombre: 'Verruga Plantar',                     codigo: 'POD-VER',     duracionMinutos: 30, color: '#F97316', precioReferencial: 80,  unidadNegocioId: podologiaUN.id } }),
    prisma.servicio.create({ data: { nombre: 'Control Post-operatorio',             codigo: 'POD-CPO',     duracionMinutos: 30, color: '#84CC16', precioReferencial: 60,  unidadNegocioId: podologiaUN.id } }),
  ]);

  const srvBaro = await Promise.all([
    prisma.servicio.create({ data: { nombre: 'Baropodometría Computarizada', codigo: 'BAR-COMP', duracionMinutos: 30, color: '#8B5CF6', precioReferencial: 150, unidadNegocioId: baroUN.id } }),
    prisma.servicio.create({ data: { nombre: 'Evaluación Biomecánica',       codigo: 'BAR-BIO',  duracionMinutos: 30, color: '#A855F7', precioReferencial: 180, unidadNegocioId: baroUN.id } }),
    prisma.servicio.create({ data: { nombre: 'Plantillas Ortopédicas',       codigo: 'BAR-PLA',  duracionMinutos: 30, color: '#7C3AED', precioReferencial: 200, unidadNegocioId: baroUN.id } }),
    prisma.servicio.create({ data: { nombre: 'Seguimiento Baropodométrico',  codigo: 'BAR-SEG',  duracionMinutos: 30, color: '#6D28D9', precioReferencial: 100, unidadNegocioId: baroUN.id } }),
  ]);

  const srvFisio = await Promise.all([
    prisma.servicio.create({ data: { nombre: 'Tecarterapia',      codigo: 'FIS-TEC', duracionMinutos: 60, color: '#10B981', precioReferencial: 120, unidadNegocioId: fisioUN.id } }),
    prisma.servicio.create({ data: { nombre: 'Ondas de Choque',   codigo: 'FIS-ODC', duracionMinutos: 60, color: '#059669', precioReferencial: 130, unidadNegocioId: fisioUN.id } }),
    prisma.servicio.create({ data: { nombre: 'Electroterapia',    codigo: 'FIS-ELE', duracionMinutos: 60, color: '#047857', precioReferencial: 90,  unidadNegocioId: fisioUN.id } }),
    prisma.servicio.create({ data: { nombre: 'Masoterapia Podal', codigo: 'FIS-MAS', duracionMinutos: 60, color: '#065F46', precioReferencial: 80,  unidadNegocioId: fisioUN.id } }),
    prisma.servicio.create({ data: { nombre: 'Kinesiotaping',     codigo: 'FIS-KIN', duracionMinutos: 60, color: '#064E3B', precioReferencial: 70,  unidadNegocioId: fisioUN.id } }),
  ]);

  // ── Bloques combinados: servicio ANCLA (profilaxis) + servicios combinables ──
  // El ancla se guarda en ConfiguracionSistema (fila única). Los combinables van en
  // CombinacionPermitida. Se intenta calzar con los nombres de la captura (catálogo
  // real); si el catálogo demo no los tiene, se cae a un set razonable de extras de
  // podología para que el flujo sea probable en demo.
  console.log('  → Combinaciones de bloque (profilaxis + extra)...');
  const profilaxis = srvPod[2]!; // POD-PRO
  await prisma.configuracionSistema.create({ data: { servicioAnclaId: profilaxis.id } });

  // ── Subcategorías de Profilaxis (Regular/Premium/Infantil/Adulto mayor) ──────
  // Misma duración (60 min); precio propio. Elegir una es obligatorio al agendar y
  // se fija al vender membresías. Ajustables desde Administración.
  console.log('  → Subcategorías de Profilaxis...');
  await prisma.subcategoriaServicio.createMany({
    data: [
      { servicioId: profilaxis.id, nombre: 'Regular',       precioReferencial: 90,  orden: 1 },
      { servicioId: profilaxis.id, nombre: 'Premium',       precioReferencial: 130, orden: 2 },
      { servicioId: profilaxis.id, nombre: 'Infantil',      precioReferencial: 80,  orden: 3 },
      { servicioId: profilaxis.id, nombre: 'Adulto mayor',  precioReferencial: 85,  orden: 4 },
    ],
  });

  const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const nombresCaptura = [
    'Curación Bleo', 'Curación extracción uña', 'Fisio',
    'Infiltración de Helomas', 'Láser Alta Hongos', 'Láser Regular',
    'Trinit Onicomicosis', 'Trinit VPH',
  ];
  const todosServicios = await prisma.servicio.findMany({
    where: { deletedAt: null }, select: { id: true, nombre: true, codigo: true },
  });
  const idsCombinables = new Set<string>();
  for (const objetivo of nombresCaptura) {
    const o = norm(objetivo);
    for (const s of todosServicios) if (norm(s.nombre).includes(o)) idsCombinables.add(s.id);
  }
  // Fallback demo: extras de podología (sin el ancla ni las limpiezas base).
  if (idsCombinables.size === 0) {
    const codigosDemo = ['POD-LASER', 'POD-CUR-ULC', 'POD-ONI', 'POD-HEL-SIM', 'POD-HEL-VAS', 'POD-VER'];
    for (const s of todosServicios) if (codigosDemo.includes(s.codigo)) idsCombinables.add(s.id);
  }
  idsCombinables.delete(profilaxis.id); // el ancla nunca es su propio extra
  for (const servicioExtraId of idsCombinables) {
    await prisma.combinacionPermitida.create({ data: { servicioExtraId } });
  }
  console.log(`     ✓ ${idsCombinables.size} combinables; ancla = ${profilaxis.nombre}`);

  // ── Promociones (15 del Excel; TRIFIT inactiva) — misma lógica que el script CLI ──
  console.log('  → Promociones...');
  const promoRes = await sembrarPromociones(prisma);
  console.log(`     ✓ promociones creadas: ${promoRes.creadas}`);

  // ── Profesionales ───────────────────────────────────────────────────────────
  console.log('  → Profesionales (personal real)...');

  const inicio = new Date(2025, 5, 1);
  let colorIdx = 0;

  // Podólogas
  const podologasList: { id: string; sedeId: string; nombres: string; apellidos: string }[] = [];
  for (const [sedeNombre, lista] of Object.entries(PODOLOGAS_POR_SEDE)) {
    const sede = sedesCreadas[sedeNombre]!;
    for (const p of lista) {
      const prof = await prisma.profesional.create({
        data: { nombres: p.nombres, apellidos: p.apellidos, tipo: TipoProfesional.podologa, unidadNegocioId: podologiaUN.id, colorAvatar: colorAvatar(colorIdx++), activo: true },
      });
      await prisma.asignacionSede.create({ data: { profesionalId: prof.id, sedeId: sede.id, fechaInicio: inicio, activa: true } });
      podologasList.push({ id: prof.id, sedeId: sede.id, nombres: p.nombres, apellidos: p.apellidos });
    }
  }

  // Fisioterapeutas (solo Paz Soldán)
  const sedePazSoldan = sedesCreadas['Paz Soldán']!;
  const fisioterapeutasList: { id: string }[] = [];
  for (const ft of FISIOTERAPEUTAS) {
    const prof = await prisma.profesional.create({
      data: { nombres: ft.nombres, apellidos: ft.apellidos, tipo: TipoProfesional.fisioterapeuta, unidadNegocioId: fisioUN.id, colorAvatar: colorAvatar(colorIdx++), activo: true },
    });
    await prisma.asignacionSede.create({ data: { profesionalId: prof.id, sedeId: sedePazSoldan.id, fechaInicio: inicio, activa: true } });
    fisioterapeutasList.push({ id: prof.id });
  }

  // Baropodometría: recursos genéricos "Baro N" por sede
  // Nombre display: nombres='Baro' apellidos='1' → muestra "Baro 1" en la columna
  const barosList: { id: string; sedeId: string; label: string }[] = [];
  const baroColores = ['#8B5CF6','#7C3AED','#6D28D9','#5B21B6','#4C1D95','#3730A3','#A855F7','#9333EA','#7E22CE','#6B21A8'];
  let baroColorIdx = 0;
  for (const [sedeNombre, cantidad] of Object.entries(BAROS_POR_SEDE)) {
    const sede = sedesCreadas[sedeNombre]!;
    for (let n = 1; n <= cantidad; n++) {
      const prof = await prisma.profesional.create({
        data: {
          nombres: 'Baro',
          apellidos: String(n),
          tipo: TipoProfesional.medico,
          unidadNegocioId: baroUN.id,
          colorAvatar: baroColores[baroColorIdx++ % baroColores.length]!,
          activo: true,
        },
      });
      await prisma.asignacionSede.create({ data: { profesionalId: prof.id, sedeId: sede.id, fechaInicio: inicio, activa: true } });
      barosList.push({ id: prof.id, sedeId: sede.id, label: `Baro ${n}` });
    }
  }

  // ── Horarios ────────────────────────────────────────────────────────────────
  console.log('  → Horarios...');
  const todosIds = [
    ...podologasList.map(p => p.id),
    ...fisioterapeutasList.map(f => f.id),
    ...barosList.map(b => b.id),
  ];

  // Mapa profId → sedeId para aplicar el cierre correcto de sábado
  const sedeIdPorProf: Record<string, string> = {};
  for (const p of podologasList) sedeIdPorProf[p.id] = p.sedeId;
  for (const b of barosList) sedeIdPorProf[b.id] = b.sedeId;
  for (const f of fisioterapeutasList) sedeIdPorProf[f.id] = sedePazSoldan.id;

  // Los Olivos y San Miguel cierran a las 15:00 el sábado; el resto a las 14:00
  const sedesCierre15 = new Set([sedesCreadas['Los Olivos']!.id, sedesCreadas['San Miguel']!.id]);

  for (const profId of todosIds) {
    for (let dia = 1; dia <= 5; dia++) {
      await prisma.horarioProfesional.create({ data: { profesionalId: profId, diaSemana: dia, horaInicio: '08:00', horaFin: '20:00', turno: 'completo' } });
    }
    const sedeProf = sedeIdPorProf[profId];
    const cierreSab = sedeProf && sedesCierre15.has(sedeProf) ? '15:00' : '14:00';
    await prisma.horarioProfesional.create({ data: { profesionalId: profId, diaSemana: 6, horaInicio: '08:00', horaFin: cierreSab, turno: 'manana' } });
  }

  // ── Competencias ────────────────────────────────────────────────────────────
  console.log('  → Competencias...');
  const hoy = new Date();
  const srvBase = [srvPod[0]!, srvPod[1]!, srvPod[5]!, srvPod[7]!, srvPod[10]!];
  const srvEspec = [srvPod[4]!, srvPod[2]!, srvPod[6]!, srvPod[9]!, srvPod[8]!, srvPod[3]!];

  for (let i = 0; i < podologasList.length; i++) {
    const pid = podologasList[i]!.id;
    for (const s of srvBase) await prisma.competenciaProfesional.create({ data: { profesionalId: pid, servicioId: s.id, habilitadoDesde: hoy } });
    if (i < 25) await prisma.competenciaProfesional.create({ data: { profesionalId: pid, servicioId: srvEspec[0]!.id, habilitadoDesde: hoy } }); // Laser
    if (i < 20) await prisma.competenciaProfesional.create({ data: { profesionalId: pid, servicioId: srvEspec[1]!.id, habilitadoDesde: hoy } }); // Profilaxis
    if (i < 22) await prisma.competenciaProfesional.create({ data: { profesionalId: pid, servicioId: srvEspec[2]!.id, habilitadoDesde: hoy } }); // Oni
    if (i < 15) await prisma.competenciaProfesional.create({ data: { profesionalId: pid, servicioId: srvEspec[3]!.id, habilitadoDesde: hoy } }); // Verruga
    if (i % 2 === 0) await prisma.competenciaProfesional.create({ data: { profesionalId: pid, servicioId: srvEspec[4]!.id, habilitadoDesde: hoy } }); // Heloma Vascular
    if (i < 12) await prisma.competenciaProfesional.create({ data: { profesionalId: pid, servicioId: srvEspec[5]!.id, habilitadoDesde: hoy } }); // Úlcera
  }
  for (const ft of fisioterapeutasList) {
    for (const s of srvFisio) await prisma.competenciaProfesional.create({ data: { profesionalId: ft.id, servicioId: s.id, habilitadoDesde: hoy } });
  }
  for (const baro of barosList) {
    for (const s of srvBaro) await prisma.competenciaProfesional.create({ data: { profesionalId: baro.id, servicioId: s.id, habilitadoDesde: hoy } });
  }

  // ── Pacientes (400) ──────────────────────────────────────────────────────────
  console.log('  → Pacientes...');
  const nombresF = ['María','Carmen','Ana','Laura','Rosa','Elena','Isabel','Patricia','Sofía','Lucía',
    'Valeria','Diana','Claudia','Paola','Jennifer','Natalia','Vanessa','Karla','Milagros','Estela',
    'Fátima','Gloria','Silvia','Norma','Betty','Pilar','Nancy','Edith','Hilda','Olga'];
  const nombresM = ['Carlos','Luis','Jorge','Miguel','José','Roberto','Fernando','Diego','Andrés','Ricardo',
    'Eduardo','Manuel','Pedro','Alejandro','Javier','Francisco','Antonio','Daniel','Sergio','Gustavo'];
  const ape1 = ['García','Rodríguez','López','Martínez','González','Pérez','Sánchez','Ramírez','Torres','Flores',
    'Rivera','Gómez','Díaz','Morales','Hernández','Muñoz','Álvarez','Jiménez','Ruiz','Castillo',
    'Quispe','Mamani','Huanca','Puma','Rojas','Vargas','Castro','Mendoza','Vega','Palomino'];
  const ape2 = ['Silva','Vega','Lima','Soto','Pinto','Mora','Cruz','Lara','Puma','Rojas',
    'Ticona','Ccoa','Mamani','Quispe','Luna','Torres','Castro','Flores','Inca','Pillco'];

  const pacientes: { id: string }[] = [];
  for (let i = 0; i < 400; i++) {
    const esFem = Math.random() > 0.35;
    const nombres = esFem ? nombresF[i % nombresF.length]! : nombresM[i % nombresM.length]!;
    const a1 = ape1[i % ape1.length]!;
    const a2 = ape2[(i + 7) % ape2.length]!;
    const dni = String(10000000 + (i * 37 + 12345678) % 89999999).padStart(8, '0').slice(0, 8);
    const tel = `9${String(10000000 + (i * 13 + 55555555) % 89999999).padStart(8, '0').slice(0, 8)}`;
    const p = await prisma.paciente.create({
      data: {
        nombres, apellidoPaterno: a1, apellidoMaterno: a2,
        tipoDocumento: 'DNI', numeroDocumento: dni,
        sexo: esFem ? 'femenino' : 'masculino', telefono: tel,
        email: `${nombres.toLowerCase()}.${a1.toLowerCase()}${i}@email.com`,
        fechaNacimiento: new Date(1955 + (i % 50), i % 12, 1 + (i % 28)),
      },
    });
    pacientes.push(p);
  }

  // ── Paquetes ─────────────────────────────────────────────────────────────────
  console.log('  → Paquetes...');
  const paqLaser12 = await prisma.paquete.create({ data: { nombre: 'Paquete Láser 12 Sesiones', servicioId: srvPod[4]!.id, totalSesiones: 12, consumeNoShow: false, precio: 900 } });
  const paqLaser6  = await prisma.paquete.create({ data: { nombre: 'Paquete Láser 6 Sesiones',  servicioId: srvPod[4]!.id, totalSesiones: 6,  consumeNoShow: false, precio: 500 } });

  const paquetesPaciente: { pacienteId: string; paqPacId: string; sesiones: number }[] = [];
  for (let i = 0; i < 15; i++) {
    const sesiones = (i % 11) + 1;
    const paq = i < 8 ? paqLaser12 : paqLaser6;
    const pp = await prisma.paquetePaciente.create({
      data: {
        pacienteId: pacientes[i]!.id, paqueteId: paq.id,
        fechaCompra: subDays(hoy, 30 + i * 7),
        sesionesTotal: paq.totalSesiones, sesionesUsadas: sesiones, activo: true,
      },
    });
    paquetesPaciente.push({ pacienteId: pacientes[i]!.id, paqPacId: pp.id, sesiones });
  }

  // ── Citas: AGENDA ~65% OCUPADA ───────────────────────────────────────────
  console.log('  → Creando agenda (65% ocupación)...');
  // 35% de slots quedan libres para simular disponibilidad real
  const OCUPACION = 0.65;

  // Sábado: limitar slots según cierre de sede
  const esSabado = HOY.getDay() === 6;
  // minutos desde 08:00 hasta el cierre del sábado por sede
  const cierreSabMin: Record<string, number> = {
    [sedesCreadas['Los Olivos']!.id]: 420,  // 15:00 - 08:00 = 7h = 420 min
    [sedesCreadas['San Miguel']!.id]: 420,
    [sedesCreadas['Paz Soldán']!.id]: 360,  // 14:00 - 08:00 = 6h = 360 min
    [sedesCreadas['Lince']!.id]:      360,
    [sedesCreadas['One']!.id]:        360,
  };
  // Para un slot con horaInicio "HH:MM", devuelve los minutos desde 08:00
  const slotAMin = (hora: string) => {
    const [h, m] = hora.split(':').map(Number);
    return (h! - 8) * 60 + m!;
  };
  const slotPermitido = (hora: string, sedeId: string) => {
    if (!esSabado) return true;
    return slotAMin(hora) < (cierreSabMin[sedeId] ?? 720);
  };

  const canales: CanalReserva[] = ['recepcion', 'whatsapp', 'web'];
  let citasCreadas = 0;
  let pIdx = 0;
  const nextPac = () => { const p = pacientes[pIdx % pacientes.length]!; pIdx++; return p; };

  // Servicios 30min para rotación
  const srvs30 = [srvPod[4]!, srvPod[0]!, srvPod[5]!, srvPod[7]!, srvPod[1]!, srvPod[6]!, srvPod[10]!, srvPod[8]!, srvPod[9]!];
  const srvs60 = [srvPod[2]!, srvPod[3]!];

  // ─── PODOLOGÍA: patrón mixto 60/30 sin solapamiento ────────────────────────
  for (const pod of podologasList) {
    interface SlotPlan { hora: string; duracion: number; srvId: string }
    const plan: SlotPlan[] = [];
    let min = 0; // minutos desde 08:00
    let turno = 0;
    let idx30 = 0, idx60 = 0;

    const maxMin = esSabado ? (cierreSabMin[pod.sedeId] ?? 720) : 720;
    while (min < maxMin) {
      const h = Math.floor(min / 60 + 8);
      const m = min % 60;
      const hora = `${h.toString().padStart(2,'0')}:${m.toString().padStart(2,'0')}`;
      const posBloque = turno % 6;
      const es60 = (posBloque === 0 || posBloque === 3) && (min + 60 <= maxMin);

      if (es60) {
        plan.push({ hora, duracion: 60, srvId: srvs60[idx60 % srvs60.length]!.id });
        idx60++; min += 60;
      } else {
        plan.push({ hora, duracion: 30, srvId: srvs30[idx30 % srvs30.length]!.id });
        idx30++; min += 30;
      }
      turno++;
    }

    for (let si = 0; si < plan.length; si++) {
      if (Math.random() > OCUPACION) continue;
      const { hora, duracion, srvId } = plan[si]!;
      const pac = nextPac();
      const esLaser = srvId === srvPod[4]!.id;
      const paqInfo = esLaser && pIdx <= 15 ? paquetesPaciente[(pIdx - 1) % 15] : undefined;

      const c = await crearCita({
        pacienteId: pac.id, profesionalId: pod.id, sedeId: pod.sedeId,
        unidadNegocioId: podologiaUN.id, servicioId: srvId,
        fecha: HOY, horaInicio: hora, duracionMinutos: duracion,
        canal: canales[si % 3]!, origen: si % 4 === 0 ? 'elegida_por_paciente' : 'asignada_automaticamente',
        paquetePacienteId: paqInfo?.paqPacId, sesionNumero: paqInfo?.sesiones,
      });
      if (c) citasCreadas++;
    }
  }

  // ─── BAROPODOMETRÍA: Baro 1, Baro 2 — agenda llena de 30 min ───────────────
  const slots30 = ['08:00','08:30','09:00','09:30','10:00','10:30','11:00','11:30',
                   '12:00','12:30','13:00','13:30','14:00','14:30','15:00','15:30',
                   '16:00','16:30','17:00','17:30','18:00','18:30','19:00','19:30'];

  for (const baro of barosList) {
    for (let si = 0; si < slots30.length; si++) {
      if (!slotPermitido(slots30[si]!, baro.sedeId)) continue;
      if (Math.random() > OCUPACION) continue;
      const c = await crearCita({
        pacienteId: nextPac().id, profesionalId: baro.id, sedeId: baro.sedeId,
        unidadNegocioId: baroUN.id, servicioId: srvBaro[si % srvBaro.length]!.id,
        fecha: HOY, horaInicio: slots30[si]!, duracionMinutos: 30,
        canal: canales[si % 3]!, origen: 'asignada_automaticamente',
      });
      if (c) citasCreadas++;
    }
  }

  // ─── FISIOTERAPIA: slots de 60 min ─────────────────────────────────────────
  const slots60 = ['08:00','09:00','10:00','11:00','12:00','13:00','14:00','15:00','16:00','17:00','18:00','19:00'];
  for (const ft of fisioterapeutasList) {
    for (let si = 0; si < slots60.length; si++) {
      if (!slotPermitido(slots60[si]!, sedePazSoldan.id)) continue;
      if (Math.random() > OCUPACION) continue;
      const c = await crearCita({
        pacienteId: nextPac().id, profesionalId: ft.id, sedeId: sedePazSoldan.id,
        unidadNegocioId: fisioUN.id, servicioId: srvFisio[si % srvFisio.length]!.id,
        fecha: HOY, horaInicio: slots60[si]!, duracionMinutos: 60,
        canal: 'recepcion', origen: 'elegida_por_paciente',
      });
      if (c) citasCreadas++;
    }
  }

  console.log(`  ✓ ${citasCreadas} citas creadas`);

  // ── Historial ─────────────────────────────────────────────────────────────
  console.log('  → Historial últimas 2 semanas...');
  const podsLosOlivos = podologasList.filter(p => p.sedeId === sedesCreadas['Los Olivos']!.id);
  const podsSanMiguel = podologasList.filter(p => p.sedeId === sedesCreadas['San Miguel']!.id);
  for (let diasAtras = 1; diasAtras <= 10; diasAtras++) {
    const fecha = subDays(HOY, diasAtras);
    if (fecha.getDay() === 0) continue;
    const pods = diasAtras % 2 === 0 ? podsLosOlivos : podsSanMiguel;
    const sedId = diasAtras % 2 === 0 ? sedesCreadas['Los Olivos']!.id : sedesCreadas['San Miguel']!.id;
    for (const pod of pods.slice(0, 4)) {
      for (const slot of ['08:00','08:30','09:00','09:30','10:00','10:30']) {
        await crearCita({
          pacienteId: nextPac().id, profesionalId: pod.id, sedeId: sedId,
          unidadNegocioId: podologiaUN.id, servicioId: srvPod[0]!.id,
          fecha, horaInicio: slot, duracionMinutos: 30, canal: 'recepcion', origen: 'asignada_automaticamente',
        });
      }
    }
  }

  // ── Roles ─────────────────────────────────────────────────────────────────
  console.log('  → Roles del sistema...');
  const TODOS_PERMISOS = [
    'agenda.ver', 'agenda.editar',
    'pacientes.ver', 'pacientes.editar',
    'admin.ver', 'analytics.ver', 'analytics.agentes',
    'usuarios.ver', 'usuarios.editar',
    'roles.editar',
  ];
  await prisma.rol.createMany({
    data: [
      { nombre: 'admin', label: 'Administrador', descripcion: 'Acceso total al sistema', permisos: TODOS_PERMISOS, esSistema: true },
      { nombre: 'coordinadora_sedes', label: 'Coordinadora de Sedes', descripcion: 'Gestión de agenda, pacientes y reportes', permisos: ['agenda.ver','agenda.editar','pacientes.ver','pacientes.editar','admin.ver','analytics.ver','analytics.agentes'], esSistema: true },
      { nombre: 'recepcionista', label: 'Recepcionista', descripcion: 'Agenda y atención al paciente', permisos: ['agenda.ver','agenda.editar','pacientes.ver','pacientes.editar'], esSistema: true },
      { nombre: 'contact_center', label: 'Contact Center', descripcion: 'Atención telefónica y agendamiento', permisos: ['agenda.ver','agenda.editar','pacientes.ver','pacientes.editar'], esSistema: false },
    ],
    skipDuplicates: true,
  });

  // ── Usuarios ──────────────────────────────────────────────────────────────
  console.log('  → Usuarios...');
  const hashAdmin = await bcrypt.hash('Admin1234!', 10);
  const hashRecep = await bcrypt.hash('Recepcion2025!', 10);

  const admin = await prisma.usuario.create({
    data: { nombre: 'Administrador Sistema', email: 'admin@limablue.pe', passwordHash: hashAdmin, rol: 'admin', activo: true },
  });
  const coord = await prisma.usuario.create({
    data: { nombre: 'Coordinadora Sedes', email: 'coordinadora@limablue.pe', passwordHash: hashAdmin, rol: 'coordinadora_sedes', activo: true },
  });

  const emailSede: Record<string, string> = {
    'Los Olivos': 'recepcion.losolivos@limablue.pe',
    'San Miguel': 'recepcion.sanmiguel@limablue.pe',
    'Paz Soldán': 'recepcion.pazsoldan@limablue.pe',
    'Lince':      'recepcion.lince@limablue.pe',
    'One':        'recepcion.one@limablue.pe',
  };

  for (const sede of todasLasSedes) {
    const recep = await prisma.usuario.create({
      data: { nombre: `Recepcionista ${sede.nombre}`, email: emailSede[sede.nombre]!, passwordHash: hashRecep, rol: 'recepcionista', activo: true },
    });
    await prisma.usuarioSede.create({ data: { usuarioId: recep.id, sedeId: sede.id } });
    await prisma.usuarioSede.create({ data: { usuarioId: admin.id, sedeId: sede.id } });
    await prisma.usuarioSede.create({ data: { usuarioId: coord.id, sedeId: sede.id } });
  }

  // ── Fisioterapia: catálogo de reserva (Evaluación + Sesión) + paquetes 6/12 ─
  {
    const uniFisio = await prisma.unidadNegocio.findFirst({ where: { nombre: 'Fisioterapia' }, select: { id: true } });
    if (uniFisio) {
      const ensureServ = async (nombre: string, codigo: string, dur: number) => {
        const ex = await prisma.servicio.findUnique({ where: { codigo } });
        if (ex) { await prisma.servicio.update({ where: { id: ex.id }, data: { nombre, duracionMinutos: dur, activo: true, deletedAt: null, unidadNegocioId: uniFisio.id } }); return ex.id; }
        const s = await prisma.servicio.create({ data: { nombre, codigo, duracionMinutos: dur, color: '#14B8A6', unidadNegocioId: uniFisio.id, activo: true } });
        return s.id;
      };
      const evalId = await ensureServ('Evaluación de Fisioterapia', 'FIS-EVAL', 30);
      const sesId = await ensureServ('Sesión de Fisioterapia', 'FIS-SES', 60);
      const fisios = await prisma.profesional.findMany({ where: { tipo: 'fisioterapeuta', deletedAt: null }, select: { id: true } });
      for (const f of fisios) for (const sid of [evalId, sesId]) {
        const e = await prisma.competenciaProfesional.findUnique({ where: { profesionalId_servicioId: { profesionalId: f.id, servicioId: sid } } });
        if (!e) await prisma.competenciaProfesional.create({ data: { profesionalId: f.id, servicioId: sid, habilitadoDesde: new Date(), activa: true } });
      }
      for (const [nombre, total] of [['Fisio 1era sesión hasta la 6', 6], ['Fisio 1era sesión hasta la 12', 12]] as const) {
        const ex = await prisma.paquete.findFirst({ where: { nombre } });
        if (ex) await prisma.paquete.update({ where: { id: ex.id }, data: { servicioId: sesId, totalSesiones: total, activo: true, deletedAt: null } });
        else await prisma.paquete.create({ data: { nombre, servicioId: sesId, totalSesiones: total, consumeNoShow: false } });
      }
      await prisma.servicio.updateMany({ where: { unidadNegocioId: uniFisio.id, codigo: { in: ['FIS-TEC', 'FIS-MAS', 'FIS-ODC', 'FIS-ELE', 'FIS-KIN'] } }, data: { activo: false } });
      console.log('   🧑‍⚕️ Fisioterapia: 2 servicios de reserva + paquetes 6/12 verificados');
    }
  }

  // ── Daniel Doy: también disponible en Baropodometría (además de Podología) ──
  {
    const dd = await prisma.profesional.findFirst({ where: { nombres: { contains: 'Daniel' }, apellidos: { contains: 'Doy' }, tipo: 'podologa', deletedAt: null }, select: { id: true } });
    const baroU = await prisma.unidadNegocio.findFirst({ where: { nombre: 'Baropodometría' }, select: { id: true } });
    if (dd && baroU) {
      const servs = await prisma.servicio.findMany({ where: { unidadNegocioId: baroU.id, activo: true, deletedAt: null }, select: { id: true } });
      for (const s of servs) {
        const e = await prisma.competenciaProfesional.findUnique({ where: { profesionalId_servicioId: { profesionalId: dd.id, servicioId: s.id } } });
        if (!e) await prisma.competenciaProfesional.create({ data: { profesionalId: dd.id, servicioId: s.id, habilitadoDesde: new Date(), activa: true } });
      }
      console.log('   🦶 Daniel Doy habilitado también en Baropodometría');
    }
  }

  // ── Aplicar la Lista Final (sede + competencias por podóloga, fuente de verdad) ──
  try {
    const res = await aplicarListaFinal(path.join(__dirname, 'data', 'lista-final-especialistas.csv'), { log: false });
    console.log(`   📋 Lista Final aplicada: ${res.matched}/${res.total} podólogas (sedes/competencias)`);
    if (res.noMatch.length) console.log(`   ⚠️ Sin emparejar en Lista Final: ${res.noMatch.length}`);
  } catch (e) {
    console.log('   ⚠️ No se pudo aplicar la Lista Final (CSV):', e instanceof Error ? e.message : e);
  }

  // ── Índices únicos PARCIALES: MOVIDOS A MIGRACIONES ─────────────────────────
  // Los 5 índices parciales (citas_slot_activo_unique, recordatorios_cita_unico,
  // asignaciones_sede_una_abierta, pacientes_documento_unico, citas_idempotency_unico)
  // ya NO se crean aquí. Viven en la migración baseline
  // (`prisma/migrations/00000000000000_baseline/migration.sql`). El seed es SOLO datos.
  // Estructura = migraciones (`prisma migrate deploy`), nunca el seed.

  // ── Resumen ───────────────────────────────────────────────────────────────
  console.log('');
  console.log('✅ Seed completado con personal real!');
  console.log('');
  console.log('   👤 Credenciales:');
  console.log('   • admin@limablue.pe / Admin1234!');
  console.log('   • coordinadora@limablue.pe / Admin1234!');
  console.log('   • recepcion.[sede]@limablue.pe / Recepcion2025!');
  console.log('');
  console.log('   📋 Personal real del Excel:');
  console.log(`   • Paz Soldán:  ${PODOLOGAS_POR_SEDE['Paz Soldán']!.length} podólogas + Baro 1 + Baro 2 + 2 fisioterapeutas`);
  console.log(`   • Lince:       ${PODOLOGAS_POR_SEDE['Lince']!.length} podólogas + Baro 1 + Baro 2`);
  console.log(`   • Los Olivos:  ${PODOLOGAS_POR_SEDE['Los Olivos']!.length} podólogas + Baro 1 + Baro 2`);
  console.log(`   • San Miguel:  ${PODOLOGAS_POR_SEDE['San Miguel']!.length} podólogas + Baro 1`);
  console.log(`   • One:         ${PODOLOGAS_POR_SEDE['One']!.length} podólogas + Baro 1`);
  console.log(`   • ${citasCreadas} citas creadas para hoy`);
}

main()
  .catch((e) => { console.error('❌ Error:', e); process.exit(1); })
  .finally(async () => { await prisma.$disconnect(); });
