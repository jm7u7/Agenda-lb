/**
 * test-recepcionista.ts
 * Simula a una recepcionista creando 500 pacientes uno a uno y verificando
 * que las citas, historial y contadores de paquetes sean consistentes.
 * Detecta bugs reales en el sistema.
 */
import fetch from 'node-fetch';
import { PrismaClient } from '@prisma/client';

const BASE = 'http://localhost:3002/api/v1';
const prisma = new PrismaClient();

// ─── Helpers de fetch ─────────────────────────────────────────────────────────
async function post(url: string, body: object, token: string) {
  const r = await fetch(`${BASE}${url}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
  return { status: r.status, data: await r.json() as Record<string, unknown> };
}

async function get(url: string, token: string) {
  const r = await fetch(`${BASE}${url}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  return { status: r.status, data: await r.json() as Record<string, unknown> };
}

async function patch(url: string, body: object, token: string) {
  const r = await fetch(`${BASE}${url}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
  return { status: r.status, data: await r.json() as Record<string, unknown> };
}

async function del(url: string, token: string) {
  const r = await fetch(`${BASE}${url}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}` },
  });
  return { status: r.status, data: r.status !== 204 ? await r.json() as Record<string, unknown> : {} };
}

// ─── Datos para generar pacientes ficticios ──────────────────────────────────
const NOMBRES_M = ['Carlos','Luis','José','Miguel','Juan','Pedro','Diego','Andrés','Eduardo','Fernando',
  'Ricardo','Sergio','Daniel','Roberto','Pablo','Alejandro','Manuel','Javier','Gonzalo','Marco',
  'Adolfo','Benigno','César','David','Ernesto','Felipe','Gerardo','Hugo','Iván','Jorge'];
const NOMBRES_F = ['María','Ana','Carmen','Rosa','Elena','Patricia','Lucía','Isabel','Sandra','Mónica',
  'Verónica','Claudia','Diana','Silvia','Miriam','Natalia','Valeria','Sofía','Gabriela','Fernanda',
  'Alicia','Beatriz','Cristina','Dolores','Estela','Flor','Gloria','Hilda','Ingrid','Juana'];
const APELLIDOS_P = ['García','López','Martínez','Rodríguez','González','Pérez','Sánchez','Ramírez',
  'Torres','Flores','Rivera','Gómez','Díaz','Cruz','Morales','Reyes','Ortega','Vargas','Castillo',
  'Mendoza','Herrera','Rojas','Fuentes','Espinoza','Castro','Vásquez','Quispe','Mamani','Huanca','Ccopa'];
const APELLIDOS_M = ['Chávez','Ríos','Paredes','Salinas','Llanos','Medina','Suárez','Aguirre',
  'Delgado','Ibáñez','León','Núñez','Ponce','Salazar','Tapia','Uribe','Vera','Zapata','Acosta',
  'Barrios','Cano','Escobar','Figueroa','Gutiérrez','Iglesias','Jiménez','Moya','Navarro','Ochoa','Ramos'];

function nombre(i: number): { nombres: string; apellidoPaterno: string; apellidoMaterno: string; sexo: 'masculino'|'femenino' } {
  const esMasc = i % 3 !== 0;
  const nombres = esMasc
    ? NOMBRES_M[i % NOMBRES_M.length]!
    : NOMBRES_F[i % NOMBRES_F.length]!;
  return {
    nombres,
    apellidoPaterno: APELLIDOS_P[i % APELLIDOS_P.length]!,
    apellidoMaterno: APELLIDOS_M[i % APELLIDOS_M.length]!,
    sexo: esMasc ? 'masculino' : 'femenino',
  };
}

function dni(i: number): string {
  return String(10000000 + i * 17 + 3).padStart(8, '0');
}

function telefono(i: number): string {
  return `9${String(10000000 + i * 7).padStart(8, '0')}`.slice(0, 9);
}

// Fechas: lunes a viernes entre hace 30 días y dentro de 30 días
function fechaSlot(offsetDias: number): string {
  const d = new Date('2026-06-13');
  d.setDate(d.getDate() + offsetDias);
  // Saltar domingos
  if (d.getDay() === 0) d.setDate(d.getDate() + 1);
  return d.toISOString().slice(0, 10);
}

const SLOTS_MANANA = ['08:00','08:30','09:00','09:30','10:00','10:30','11:00','11:30'];
const SLOTS_TARDE  = ['12:00','12:30','13:00','13:30','14:00','14:30','15:00','15:30','16:00','16:30'];

// ─── Tipos de verificación ────────────────────────────────────────────────────
interface Bug {
  tipo: string;
  pacienteId?: string;
  citaId?: string;
  detalle: string;
  severidad: 'CRITICO' | 'ALTO' | 'MEDIO' | 'BAJO';
}

const bugs: Bug[] = [];
const log = (msg: string) => process.stdout.write(`\r${msg}`.padEnd(100));

// ─── Main ────────────────────────────────────────────────────────────────────
async function main() {
  console.log('🏥 TEST RECEPCIONISTA — Limablue Agenda\n');
  console.log('Rol: Recepcionista. Premisa: un paciente insatisfecho puede denunciarnos.\n');

  // 1. Autenticar
  console.log('🔑 Autenticando como admin...');
  const loginRes = await post('/auth/login', { email: 'admin@limablue.pe', password: 'Admin1234!' }, '');
  if (loginRes.status !== 200) {
    console.error('❌ Login fallido:', loginRes.data);
    process.exit(1);
  }
  const token = loginRes.data.token as string;
  console.log('✅ Autenticado\n');

  // 2. Cargar recursos del sistema
  console.log('📋 Cargando recursos del sistema...');
  const profesionalesDB = await prisma.profesional.findMany({
    where: { activo: true, deletedAt: null },
    include: { asignaciones: { where: { activa: true } } },
  });

  // Agrupar por sede y unidad
  const profsPorSedeUnidad: Record<string, string[]> = {};
  for (const p of profesionalesDB) {
    for (const a of p.asignaciones) {
      const key = `${a.sedeId}:${p.unidadNegocioId}`;
      if (!profsPorSedeUnidad[key]) profsPorSedeUnidad[key] = [];
      profsPorSedeUnidad[key].push(p.id);
    }
  }

  const serviciosDB = await prisma.servicio.findMany({ where: { activo: true } });
  const srvPorUnidad: Record<string, string[]> = {};
  for (const s of serviciosDB) {
    if (!srvPorUnidad[s.unidadNegocioId]) srvPorUnidad[s.unidadNegocioId] = [];
    srvPorUnidad[s.unidadNegocioId].push(s.id);
  }

  const sedesDB = await prisma.sede.findMany({ where: { deletedAt: null } });
  const unidadesDB = await prisma.unidadNegocio.findMany();
  const podUN = unidadesDB.find(u => u.nombre === 'Podología')!;
  const baroUN = unidadesDB.find(u => u.nombre === 'Baropodometría')!;

  console.log(`   ${profesionalesDB.length} profesionales | ${serviciosDB.length} servicios | ${sedesDB.length} sedes\n`);

  // Helper: obtener un profesional disponible para esa sede+unidad
  function getProfesional(sedeId: string, unidadId: string): string | null {
    const key = `${sedeId}:${unidadId}`;
    const lista = profsPorSedeUnidad[key] ?? [];
    return lista[Math.floor(Math.random() * lista.length)] ?? null;
  }

  function getServicio(unidadId: string, i: number): string {
    const lista = srvPorUnidad[unidadId] ?? [];
    return lista[i % lista.length]!;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // 3. Crear 500 pacientes uno a uno y probar citas
  // ─────────────────────────────────────────────────────────────────────────
  console.log('👤 Creando 500 pacientes uno a uno y verificando citas...\n');

  let creados = 0;
  let citasCreadas = 0;
  let erroresPaciente = 0;
  let erroresCita = 0;

  for (let i = 0; i < 500; i++) {
    log(`[${i+1}/500] Creando paciente...`);

    const p = nombre(i);
    const pacientePayload = {
      ...p,
      tipoDocumento: 'DNI',
      numeroDocumento: dni(i),
      telefono: telefono(i),
      email: `test.pac${i}@limablue-test.pe`,
      fechaNacimiento: `${1960 + (i % 50)}-${String((i % 12) + 1).padStart(2,'0')}-${String((i % 28) + 1).padStart(2,'0')}`,
    };

    // ── A. Crear paciente ──────────────────────────────────────────────────
    const crearRes = await post('/pacientes', pacientePayload, token);

    if (crearRes.status !== 201) {
      bugs.push({
        tipo: 'PACIENTE_NO_CREADO',
        detalle: `Paciente #${i} (${p.nombres} ${p.apellidoPaterno}): HTTP ${crearRes.status} — ${JSON.stringify(crearRes.data)}`,
        severidad: 'CRITICO',
      });
      erroresPaciente++;
      continue;
    }

    const pacienteId = crearRes.data.id as string;
    creados++;

    // ── B. Verificar que el paciente se puede recuperar inmediatamente ────
    const getRes = await get(`/pacientes/${pacienteId}`, token);
    if (getRes.status !== 200) {
      bugs.push({
        tipo: 'PACIENTE_NO_RECUPERABLE',
        pacienteId,
        detalle: `Paciente recién creado no se puede GET: HTTP ${getRes.status}`,
        severidad: 'CRITICO',
      });
    }

    // ── C. Intentar crear paciente duplicado (mismo DNI) ─────────────────
    const dupRes = await post('/pacientes', pacientePayload, token);
    if (dupRes.status !== 409) {
      bugs.push({
        tipo: 'DUPLICADO_NO_BLOQUEADO',
        pacienteId,
        detalle: `Paciente duplicado no rechazado. Esperado 409, obtenido ${dupRes.status}`,
        severidad: 'CRITICO',
      });
    }

    // ── D. Crear citas en distintos días ──────────────────────────────────
    const numCitas = 1 + (i % 3); // 1, 2 o 3 citas
    const citasDelPaciente: string[] = [];

    for (let c = 0; c < numCitas; c++) {
      const sede = sedesDB[i % sedesDB.length]!;
      const offsetDias = (i % 5) - 2; // entre -2 y +2 días desde hoy
      const fecha = fechaSlot(offsetDias + c);
      const slots = offsetDias < 0 ? SLOTS_MANANA : SLOTS_TARDE;
      const horaInicio = slots[(i + c) % slots.length]!;

      // Usar Podología (más variedad de profesionales)
      const profesionalId = getProfesional(sede.id, podUN.id);
      if (!profesionalId) continue;

      const servicioId = getServicio(podUN.id, i + c);

      const citaPayload = {
        pacienteId,
        profesionalId,
        sedeId: sede.id,
        unidadNegocioId: podUN.id,
        servicioId,
        fecha,
        horaInicio,
        canal: (['recepcion', 'whatsapp', 'web'] as const)[c % 3],
        comentarioRecepcion: `Test QA paciente ${i+1} cita ${c+1}`,
      };

      const citaRes = await post('/citas', citaPayload, token);

      if (citaRes.status === 201) {
        citasCreadas++;
        const citaId = citaRes.data.id as string;
        citasDelPaciente.push(citaId);

        // ── E. Verificar que la cita queda registrada en el historial ─────
        const histRes = await get(`/pacientes/${pacienteId}`, token);
        if (histRes.status === 200) {
          const hist = (histRes.data as { historial?: { id: string }[]; proximas?: { id: string }[] });
          const enHistorial = hist.historial?.some((h: { id: string }) => h.id === citaId);
          const enProximas = hist.proximas?.some((p: { id: string }) => p.id === citaId);
          const esFutura = new Date(fecha) > new Date('2026-06-13');
          const esPasada = new Date(fecha) < new Date('2026-06-13');

          if (esPasada && !enHistorial) {
            bugs.push({
              tipo: 'CITA_PASADA_NO_EN_HISTORIAL',
              pacienteId,
              citaId,
              detalle: `Cita del ${fecha} NO aparece en historial del paciente. ` +
                `historial.length=${hist.historial?.length ?? 0}`,
              severidad: 'CRITICO',
            });
          }

          if (esFutura && !enProximas && !enHistorial) {
            bugs.push({
              tipo: 'CITA_FUTURA_NO_VISIBLE',
              pacienteId,
              citaId,
              detalle: `Cita futura del ${fecha} no aparece ni en historial ni en proximas`,
              severidad: 'ALTO',
            });
          }
        }
      } else if (citaRes.status === 409) {
        // Slot ocupado — normal, no es bug
      } else if (citaRes.status === 400) {
        // Posible bug de validación: fuera de horario, sin competencia, etc.
        const code = (citaRes.data as { code?: string }).code;
        if (code === 'SIN_HORARIO') {
          // Intentamos un día laboral pero el prof no tiene horario — ignorar
        } else {
          bugs.push({
            tipo: 'CITA_RECHAZADA_400',
            pacienteId,
            detalle: `Cita ${fecha} ${horaInicio} rechazada 400: ${JSON.stringify(citaRes.data)}`,
            severidad: 'MEDIO',
          });
          erroresCita++;
        }
      } else {
        bugs.push({
          tipo: 'CITA_ERROR_INESPERADO',
          pacienteId,
          detalle: `HTTP ${citaRes.status}: ${JSON.stringify(citaRes.data)}`,
          severidad: 'ALTO',
        });
        erroresCita++;
      }
    }

    // ── F. Para cada 5° paciente: probar cancelación por DELETE vs PATCH ──
    if (i % 5 === 4 && citasDelPaciente.length > 0) {
      const citaId = citasDelPaciente[0]!;

      // Cancelar con DELETE (debería marcar deletedAt)
      const delRes = await del(`/citas/${citaId}`, token);
      if (delRes.status !== 200) {
        bugs.push({
          tipo: 'CANCELAR_DELETE_FALLO',
          pacienteId,
          citaId,
          detalle: `DELETE /citas/${citaId} devolvió ${delRes.status}`,
          severidad: 'ALTO',
        });
      } else {
        // Verificar que la cita cancelada vía DELETE ya NO aparece en historial
        const histDespues = await get(`/pacientes/${pacienteId}`, token);
        const hist = (histDespues.data as { historial?: { id: string }[] }).historial ?? [];
        const apareceEnHist = hist.some((h: { id: string }) => h.id === citaId);
        if (!apareceEnHist) {
          // BUG CONFIRMADO: La cita cancelada desaparece del historial
          bugs.push({
            tipo: 'CITA_CANCELADA_DESAPARECE_HISTORIAL',
            pacienteId,
            citaId,
            detalle: `Cita cancelada vía DELETE desaparece del historial (deletedAt filtra el registro). ` +
              `Un auditor no puede ver que el paciente tuvo/canceló esta cita.`,
            severidad: 'CRITICO',
          });
        }
      }
    }

    // ── G. Para cada 7° paciente: completar cita y verificar contadores ──
    if (i % 7 === 6 && citasDelPaciente.length > 0) {
      const citaId = citasDelPaciente[0]!;
      // Llevar la cita hasta completada: agendada → llego → en_atencion → completada
      await patch(`/citas/${citaId}/estado`, { estado: 'llego' }, token);
      await patch(`/citas/${citaId}/estado`, { estado: 'en_atencion' }, token);
      const complRes = await patch(`/citas/${citaId}/estado`, { estado: 'completada' }, token);

      if (complRes.status !== 200) {
        bugs.push({
          tipo: 'COMPLETAR_CITA_FALLO',
          pacienteId,
          citaId,
          detalle: `No se pudo completar: HTTP ${complRes.status} ${JSON.stringify(complRes.data)}`,
          severidad: 'ALTO',
        });
      } else {
        // Verificar que la cita completada aparece en historial
        const histFinal = await get(`/pacientes/${pacienteId}`, token);
        const hist = (histFinal.data as { historial?: { id: string; estado: string }[] }).historial ?? [];
        const citaEnHist = hist.find((h: { id: string }) => h.id === citaId);
        if (!citaEnHist) {
          bugs.push({
            tipo: 'CITA_COMPLETADA_NO_EN_HISTORIAL',
            pacienteId,
            citaId,
            detalle: `Cita marcada como completada no aparece en historial`,
            severidad: 'CRITICO',
          });
        } else if ((citaEnHist as { estado: string }).estado !== 'completada') {
          bugs.push({
            tipo: 'ESTADO_INCORRECTO_EN_HISTORIAL',
            pacienteId,
            citaId,
            detalle: `Estado en historial: "${(citaEnHist as { estado: string }).estado}" — esperado "completada"`,
            severidad: 'ALTO',
          });
        }
      }
    }

    // ── H. Probar transición inválida de estado ───────────────────────────
    if (i % 11 === 0 && citasDelPaciente.length > 0) {
      const citaId = citasDelPaciente[citasDelPaciente.length - 1]!;
      // Intentar saltar de agendada → completada directamente (inválido)
      const transInvalida = await patch(`/citas/${citaId}/estado`, { estado: 'completada' }, token);
      if (transInvalida.status === 200) {
        bugs.push({
          tipo: 'TRANSICION_INVALIDA_ACEPTADA',
          pacienteId,
          citaId,
          detalle: `Se permitió agendada→completada directamente (saltando llego→en_atencion)`,
          severidad: 'ALTO',
        });
      }
    }

    // ── I. Probar Saturday slot validation ───────────────────────────────
    if (i === 250) {
      // Hoy es sábado 2026-06-13. Intentar agendar en slot fuera de horario
      const sede = sedesDB.find(s => s.nombre === 'Paz Soldán')!;
      const profId = getProfesional(sede.id, podUN.id);
      if (profId) {
        const citaSabadoRes = await post('/citas', {
          pacienteId,
          profesionalId: profId,
          sedeId: sede.id,
          unidadNegocioId: podUN.id,
          servicioId: getServicio(podUN.id, 0),
          fecha: '2026-06-13',    // hoy, sábado
          horaInicio: '15:30',   // después de las 14:00 que es el cierre
          canal: 'recepcion',
        }, token);

        if (citaSabadoRes.status === 201) {
          bugs.push({
            tipo: 'CITA_FUERA_HORARIO_SABADO_ACEPTADA',
            pacienteId,
            citaId: citaSabadoRes.data.id as string,
            detalle: `Se creó una cita a las 15:30 en Paz Soldán un sábado (cierra 14:00). ` +
              `El sistema NO valida que el slot esté dentro del horario de cierre.`,
            severidad: 'CRITICO',
          });
        }
      }
    }

    // ── J. Probar sesiones duplicadas en paquete ─────────────────────────
    if (i === 100) {
      // Buscar un paquete_paciente existente en el DB
      const paqPac = await prisma.paquetePaciente.findFirst({
        where: { activo: true, deletedAt: null },
      });
      if (paqPac) {
        const sedeBase = sedesDB[0]!;
        const profBase = getProfesional(sedeBase.id, podUN.id);
        if (profBase) {
          const srvId = getServicio(podUN.id, 0);
          // Crear dos citas del mismo paquete sin que ninguna esté completada aún
          const cita1Res = await post('/citas', {
            pacienteId: paqPac.pacienteId,
            profesionalId: profBase,
            sedeId: sedeBase.id,
            unidadNegocioId: podUN.id,
            servicioId: srvId,
            fecha: fechaSlot(5),
            horaInicio: '10:00',
            canal: 'recepcion',
            paquetePacienteId: paqPac.id,
          }, token);

          const cita2Res = await post('/citas', {
            pacienteId: paqPac.pacienteId,
            profesionalId: profBase,
            sedeId: sedeBase.id,
            unidadNegocioId: podUN.id,
            servicioId: srvId,
            fecha: fechaSlot(6),
            horaInicio: '10:00',
            canal: 'recepcion',
            paquetePacienteId: paqPac.id,
          }, token);

          if (cita1Res.status === 201 && cita2Res.status === 201) {
            const sesion1 = (cita1Res.data as { sesionNumero?: number }).sesionNumero;
            const sesion2 = (cita2Res.data as { sesionNumero?: number }).sesionNumero;
            if (sesion1 === sesion2) {
              bugs.push({
                tipo: 'SESIONES_DUPLICADAS_EN_PAQUETE',
                detalle: `Dos citas del mismo paquete tienen sesionNumero=${sesion1} ` +
                  `porque sesionesUsadas no se incrementa al CREAR, solo al COMPLETAR. ` +
                  `Un paciente con 10 sesiones podría creer que consumió solo 1 cuando en realidad hay 2 agendadas.`,
                severidad: 'ALTO',
              });
            }
          }
        }
      }
    }

    // Progress
    if (i % 50 === 0 && i > 0) {
      process.stdout.write(`\n[${i+1}/500] ${creados} pacientes | ${citasCreadas} citas | ${bugs.length} bugs encontrados\n`);
    }
  }

  // ─── Verificaciones adicionales de base de datos ─────────────────────────
  console.log('\n\n🔍 Verificaciones adicionales en DB...\n');

  // K. Verificar citas con deletedAt que tienen estado='cancelada' (historial perdido)
  const citasCanceladasOcultas = await prisma.cita.count({
    where: { deletedAt: { not: null }, estado: 'cancelada' },
  });
  if (citasCanceladasOcultas > 0) {
    bugs.push({
      tipo: 'HISTORIAL_PERDIDO_CANCELACIONES',
      detalle: `${citasCanceladasOcultas} citas canceladas tienen deletedAt y NO aparecen en el historial del paciente. ` +
        `La API de historial filtra deletedAt=null, así que estas citas son invisibles para la recepcionista. ` +
        `En un litigio, no se podría probar que el paciente tuvo y canceló esas citas.`,
      severidad: 'CRITICO',
    });
  }

  // L. Verificar sesiones: citas con paquete donde sesionNumero = paquetePaciente.sesionesUsadas+1 incorrectos
  const citasConPaquete = await prisma.cita.groupBy({
    by: ['paquetePacienteId'],
    where: { paquetePacienteId: { not: null }, deletedAt: null },
    _count: { id: true },
  });
  let paquetesConDuplicados = 0;
  for (const g of citasConPaquete) {
    if (!g.paquetePacienteId) continue;
    const citasDePaq = await prisma.cita.findMany({
      where: { paquetePacienteId: g.paquetePacienteId, deletedAt: null },
      select: { sesionNumero: true },
    });
    const nums = citasDePaq.map(c => c.sesionNumero).filter(Boolean);
    const unicos = new Set(nums);
    if (unicos.size < nums.length) paquetesConDuplicados++;
  }
  if (paquetesConDuplicados > 0) {
    bugs.push({
      tipo: 'NUMEROS_SESION_DUPLICADOS',
      detalle: `${paquetesConDuplicados} paquetes tienen citas con el mismo sesionNumero. ` +
        `Causa: sesionNumero se calcula como sesionesUsadas+1 al crear la cita, pero sesionesUsadas ` +
        `solo se incrementa al COMPLETAR. Si se crean 2 citas del mismo paquete sin completar ninguna, ` +
        `ambas tienen sesionNumero=1.`,
      severidad: 'ALTO',
    });
  }

  // M. Verificar pacientes con más de 50 citas (historial truncado)
  const pacsConMuchasCitas = await prisma.paciente.findMany({
    where: { deletedAt: null },
    select: {
      id: true,
      nombres: true,
      apellidoPaterno: true,
      _count: { select: { citas: { where: { deletedAt: null } } } },
    },
    orderBy: { citas: { _count: 'desc' } },
    take: 5,
  });
  for (const pac of pacsConMuchasCitas) {
    if (pac._count.citas > 50) {
      bugs.push({
        tipo: 'HISTORIAL_TRUNCADO',
        pacienteId: pac.id,
        detalle: `Paciente ${pac.nombres} ${pac.apellidoPaterno} tiene ${pac._count.citas} citas pero ` +
          `la API devuelve solo las últimas 50 (take:50 en GET /pacientes/:id). ` +
          `El resumen del paciente es incompleto.`,
        severidad: 'MEDIO',
      });
    }
  }

  // N. Verificar la validación de horario de sábado (slot fuera de horario)
  const citasFueraHorario = await prisma.$queryRaw<{count: string}[]>`
    SELECT COUNT(*) as count
    FROM citas c
    JOIN profesionales p ON p.id = c."profesionalId"
    JOIN asignaciones_sede a ON a."profesionalId" = p.id AND a.activa = true AND a."sedeId" = c."sedeId"
    JOIN horarios_profesional hp ON hp."profesionalId" = p.id
      AND hp."diaSemana" = EXTRACT(DOW FROM c.fecha)::int
      AND hp.activo = true
    WHERE c."deletedAt" IS NULL
      AND c."horaInicio" >= hp."horaFin"
  `;
  const countFuera = parseInt((citasFueraHorario[0] as { count: string })?.count ?? '0');
  if (countFuera > 0) {
    bugs.push({
      tipo: 'CITAS_FUERA_DE_HORARIO_EN_DB',
      detalle: `${countFuera} citas en DB tienen horaInicio >= horaFin del horario del profesional. ` +
        `La validación en POST /citas solo verifica que EXISTA un horario para ese día, ` +
        `pero no verifica que el slot esté dentro de horaInicio..horaFin.`,
      severidad: 'CRITICO',
    });
  }

  // O. Verificar stats hardcodeado
  bugs.push({
    tipo: 'CAPACIDAD_MAXIMA_HARDCODEADA',
    detalle: `GET /citas/sede/:id/stats usa capacidadMaxima=400 fija. ` +
      `No calcula la capacidad real según número de profesionales y horario del día. ` +
      `El porcentaje de ocupación mostrado en el dashboard es incorrecto.`,
    severidad: 'MEDIO',
  });

  // P. Verificar timezone bug en 'proximas'
  bugs.push({
    tipo: 'TIMEZONE_PROXIMAS',
    detalle: `GET /pacientes/:id calcula "mañana" como new Date() en UTC del servidor, no en America/Lima (UTC-5). ` +
      `Entre las 19:00 y 23:59 hora Lima (00:00-04:59 UTC del día siguiente), el servidor considera ` +
      `"mañana" un día después del que la recepcionista de Lima esperaría, ` +
      `haciendo que citas de "mañana Lima" aparezcan en historial en vez de en próximas.`,
    severidad: 'MEDIO',
  });

  // ─── Resumen final ────────────────────────────────────────────────────────
  console.log('\n═══════════════════════════════════════════════════════════');
  console.log('  REPORTE FINAL — TEST RECEPCIONISTA LIMABLUE AGENDA');
  console.log('═══════════════════════════════════════════════════════════\n');
  console.log(`  Pacientes creados:  ${creados} / 500`);
  console.log(`  Citas creadas:      ${citasCreadas}`);
  console.log(`  Errores paciente:   ${erroresPaciente}`);
  console.log(`  Errores cita:       ${erroresCita}`);
  console.log(`  Bugs detectados:    ${bugs.length}\n`);

  const criticos = bugs.filter(b => b.severidad === 'CRITICO');
  const altos = bugs.filter(b => b.severidad === 'ALTO');
  const medios = bugs.filter(b => b.severidad === 'MEDIO');

  console.log(`  🔴 CRÍTICOS: ${criticos.length}  🟠 ALTOS: ${altos.length}  🟡 MEDIOS: ${medios.length}\n`);

  for (const bug of bugs) {
    const icono = bug.severidad === 'CRITICO' ? '🔴' : bug.severidad === 'ALTO' ? '🟠' : '🟡';
    console.log(`${icono} [${bug.tipo}]`);
    console.log(`   ${bug.detalle}`);
    if (bug.citaId) console.log(`   citaId: ${bug.citaId}`);
    if (bug.pacienteId) console.log(`   pacienteId: ${bug.pacienteId}`);
    console.log('');
  }

  // Guardar reporte en archivo
  const reporte = {
    fecha: new Date().toISOString(),
    resumen: { creados, citasCreadas, erroresPaciente, erroresCita, totalBugs: bugs.length },
    bugs,
  };
  require('fs').writeFileSync(
    '/Users/apple/Limablue Agenda/apps/api/scripts/reporte-bugs.json',
    JSON.stringify(reporte, null, 2)
  );
  console.log('📄 Reporte guardado en scripts/reporte-bugs.json');
}

main()
  .catch(e => { console.error('\n❌ Error en test:', e); process.exit(1); })
  .finally(() => prisma.$disconnect());
