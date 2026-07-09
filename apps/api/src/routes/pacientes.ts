import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../db';
import { requireAuth, requireScope } from '../middleware/auth';
import { AppError } from '../middleware/errorHandler';
import { auditEnTx } from '../services/audit';
import { alertaDePaciente, alertasDePacientes } from '../services/alertaPaciente';
import { familiaresDePaciente, familiaresDePacientes } from '../services/familiaresPaciente';
import { normalizarPaciente } from '../utils/normalizarPaciente';
import { datosFaltantes, faltanDatosPaciente } from '../utils/datosPaciente';

const router = Router();

// Los campos de texto se RECORTAN en la validación (zod `.trim()`) para que un
// valor con espacios alrededor (p.ej. " correo@x.com " pegado) no sea rechazado
// por `.email()` ni guarde espacios. La capitalización la hace `normalizarPaciente`.
const crearPacienteSchema = z.object({
  nombres: z.string().trim().min(2),
  apellidoPaterno: z.string().trim().min(2),
  apellidoMaterno: z.string().trim().min(2),
  tipoDocumento: z.enum(['DNI', 'CE', 'PASAPORTE', 'RUC']).default('DNI'),
  numeroDocumento: z.string().trim().min(8),
  telefono: z.string().trim().min(9),
  email: z.string().trim().toLowerCase().email().optional(),
  fechaNacimiento: z.string().optional(),
  sexo: z.enum(['masculino', 'femenino', 'otro']).optional(),
  notas: z.string().trim().optional(),
});

// ─── Búsqueda con trigram ─────────────────────────────────────────────────────
router.get('/buscar', requireAuth, requireScope('patients:read'), async (req, res) => {
  const q = (req.query.q as string)?.trim() ?? '';
  if (q.length < 2) {
    res.json([]);
    return;
  }

  const pacientes = await prisma.$queryRaw<{ id: string; nombres: string; apellidoPaterno: string; apellidoMaterno: string; telefono: string; tipoDocumento: string; numeroDocumento: string; email: string | null; fechaNacimiento: Date | null; requiereActualizacionDatos: boolean }[]>`
    SELECT id, nombres, "apellidoPaterno", "apellidoMaterno", telefono, "tipoDocumento", "numeroDocumento", email, "fechaNacimiento", "requiereActualizacionDatos"
    FROM pacientes
    WHERE "deletedAt" IS NULL
      AND (
        (nombres || ' ' || "apellidoPaterno" || ' ' || "apellidoMaterno") ILIKE ${'%' + q + '%'}
        OR "numeroDocumento" ILIKE ${'%' + q + '%'}
        OR telefono ILIKE ${'%' + q + '%'}
      )
    ORDER BY similarity(
      nombres || ' ' || "apellidoPaterno" || ' ' || "apellidoMaterno", ${q}
    ) DESC
    LIMIT 10
  `;

  const [alertas, familiares] = await Promise.all([
    alertasDePacientes(pacientes.map((p) => p.id)),
    familiaresDePacientes(pacientes.map((p) => p.id)),
  ]);

  res.json(pacientes.map((p: { id: string; nombres: string; apellidoPaterno: string; apellidoMaterno: string; telefono: string; numeroDocumento: string; tipoDocumento?: string }) => ({
    ...p,
    nombreCompleto: `${p.nombres} ${p.apellidoPaterno} ${p.apellidoMaterno}`,
    alerta: alertas.get(p.id) ?? null,
    familiares: familiares.get(p.id) ?? [],
  })));
});

// ─── GET /pacientes/:id ───────────────────────────────────────────────────────
router.get('/:id', requireAuth, requireScope('patients:read'), async (req, res) => {
  const paciente = await prisma.paciente.findUnique({
    where: { id: req.params.id, deletedAt: null },
    include: {
      paquetes: {
        where: { deletedAt: null },
        include: { paquete: { include: { servicio: true } } },
        orderBy: { creadoEn: 'desc' },
      },
    },
  });
  if (!paciente) throw new AppError('Paciente no encontrado', 404);

  // Límite "mañana" (medianoche Lima) que separa el HISTORIAL (pasado + HOY) de las
  // PRÓXIMAS (mañana en adelante). Se usa el MISMO límite en ambas consultas → partición
  // exacta, sin solapes ni huecos. En hora Lima para no derivar en horas nocturnas UTC.
  const ahoraLima = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Lima' }));
  const manana = new Date(ahoraLima);
  manana.setDate(manana.getDate() + 1);
  manana.setHours(0, 0, 0, 0);

  // Historial de atenciones = citas PASADAS + las de HOY (fecha < mañana). Las FUTURAS
  // ya NO entran aquí (antes salían en historial Y en próximas, y enterraban las de hoy);
  // ahora viven solo en `proximas`. Incluye todos los estados para trazabilidad (solo
  // excluye soft-deleted). `totalCitas`/`resumenServicios` cuentan ese mismo conjunto.
  const historialWhere = { pacienteId: req.params.id, deletedAt: null, fecha: { lt: manana } };
  const [historial, totalCitas, resumenRaw] = await Promise.all([
    prisma.cita.findMany({
      where: historialWhere,
      include: {
        profesional: { select: { id: true, nombres: true, apellidos: true } },
        sede: { select: { id: true, nombre: true, color: true } },
        servicio: { select: { id: true, nombre: true, color: true, duracionMinutos: true } },
        subcategoria: { select: { id: true, nombre: true } },
        // Badge "Sesión x/total · paquete" (trazabilidad inversa cita→paquete)
        paquetePaciente: { select: { id: true, sesionesTotal: true, paquete: { select: { nombre: true } } } },
        comentarios: {
          where: { deletedAt: null },
          orderBy: { creadoEn: 'asc' },
          select: { id: true, texto: true, creadoEn: true, autorEtiqueta: true, autor: { select: { nombre: true } } },
        },
      },
      orderBy: [{ fecha: 'desc' }, { horaInicio: 'desc' }],
      take: 200,
    }),
    prisma.cita.count({ where: historialWhere }),
    // Conteo exacto por servicio sobre las atenciones (pasado + hoy, no acotado a 200).
    prisma.cita.groupBy({
      by: ['servicioId'],
      where: historialWhere,
      _count: { _all: true },
    }),
  ]);

  // Resolver nombres/colores de los servicios del resumen y ordenar de mayor a menor.
  const serviciosResumen = await prisma.servicio.findMany({
    where: { id: { in: resumenRaw.map(r => r.servicioId) } },
    select: { id: true, nombre: true, color: true },
  });
  const resumenServicios = resumenRaw
    .map(r => {
      const s = serviciosResumen.find(x => x.id === r.servicioId);
      return {
        servicioId: r.servicioId,
        nombre: s?.nombre ?? '—',
        color: s?.color ?? '#94A3B8',
        total: r._count._all,
      };
    })
    .sort((a, b) => b.total - a.total);

  // Próximas citas = mañana en adelante (mismo límite `manana` que el historial → no se
  // duplican ni se pierden citas entre ambas secciones). Las de hoy van en el historial.
  const proximas = await prisma.cita.findMany({
    where: {
      pacienteId: req.params.id,
      deletedAt: null,
      fecha: { gte: manana },
      estado: { notIn: ['cancelada', 'no_show'] },
    },
    select: {
      id: true, fecha: true, horaInicio: true, origenAsignacion: true,
      profesional: { select: { id: true, nombres: true, apellidos: true } },
      sede: { select: { id: true, nombre: true, color: true } },
      servicio: { select: { id: true, nombre: true } },
      subcategoria: { select: { id: true, nombre: true } },
    },
    orderBy: [{ fecha: 'asc' }, { horaInicio: 'asc' }],
    take: 50, // suficiente para paquetes grandes (p. ej. 12 sesiones) sin recortar
  });

  const [alerta, familiares] = await Promise.all([
    alertaDePaciente(req.params.id),
    familiaresDePaciente(req.params.id),
  ]);

  res.json({ ...paciente, alerta, familiares, historial, totalCitas, resumenServicios, proximas, datosFaltantes: datosFaltantes(paciente) });
});

// ─── GET /pacientes/:id/paquetes — ENDPOINT ÚNICO de saldos (módulo Sesiones) ──
// Alimenta TODAS las variantes de SaldoPaquetes (compact | chip | detalle).
// Saldo SIEMPRE derivado de ConsumoSesion vivos — nunca editable.
router.get('/:id/paquetes', requireAuth, requireScope('patients:read'), async (req, res) => {
  const paquetes = await prisma.paquetePaciente.findMany({
    where: { pacienteId: req.params.id, deletedAt: null },
    include: {
      paquete: { select: { nombre: true } },
      sede: { select: { id: true, nombre: true, color: true } },
      servicioNuevo: { select: { id: true, nombre: true } },
      familia: { select: { nombreFamilia: true } },
      consumos: {
        where: { deletedAt: null },
        orderBy: { creadoEn: 'asc' },
        select: {
          id: true, fecha: true, origen: true, motivo: true, registradoPor: true, tipoSesion: true,
          cita: {
            select: {
              id: true, fecha: true, horaInicio: true,
              sede: { select: { nombre: true } },
              profesional: { select: { nombres: true, apellidos: true } },
              servicio: { select: { nombre: true } },
            },
          },
        },
      },
      conciliaciones: {
        where: { deletedAt: null },
        select: { lecturaServicio: true, lecturaObs: true, consumoAprobado: true, ajusteProCliente: true, decididoPor: true, decididoEn: true, confianza: true },
        take: 1,
      },
    },
    orderBy: [{ estado: 'asc' }, { fechaCompra: 'asc' }], // ACTIVO primero (orden alfabético favorece), FIFO dentro
  });

  const data = paquetes.map((pp) => {
    const consumidas = pp.consumos.length;
    const comp = (pp.composicion as { servicioId: string; cantidad: number; etiqueta: string; subcategoriaId?: string; subcategoriaEtiqueta?: string }[] | null) ?? null;
    return {
      id: pp.id,
      nombre: pp.paquete.nombre,
      tipo: pp.tipo,
      origen: pp.origen,
      sesionesTotal: pp.sesionesTotal,
      consumidas,
      saldo: Math.max(pp.sesionesTotal - consumidas, 0),
      estado: pp.estado,
      sede: pp.sede,
      servicioNuevoId: pp.servicioNuevoId,
      servicioNuevo: pp.servicioNuevo,
      vigenciaInicio: pp.vigenciaInicio,
      vigenciaFin: pp.vigenciaFin,
      familia: pp.familia?.nombreFamilia ?? null,
      // Composición con consumo por ítem (membresías multi-tipo)
      composicion: comp?.map((i) => ({
        ...i,
        consumidas: pp.consumos.filter((c) => c.tipoSesion === i.servicioId).length,
      })) ?? null,
      consumos: pp.consumos,
      conciliacion: pp.conciliaciones[0] ?? null,
    };
  });
  // ACTIVO → AGOTADO/VENCIDO/ANULADO al final (trazabilidad colapsada en la ficha)
  data.sort((a, b) => (a.estado === 'ACTIVO' ? 0 : 1) - (b.estado === 'ACTIVO' ? 0 : 1));
  res.json(data);
});

// ─── GET /pacientes/:id/historial-genexis/existe ──────────────────────────────
// Consulta liviana para decidir si el botón "Historial Genexis" se renderiza.
router.get('/:id/historial-genexis/existe', requireAuth, requireScope('patients:read'), async (req, res) => {
  const total = await prisma.historialGenexis.count({
    where: { pacienteId: req.params.id, deletedAt: null },
  });
  res.json({ existe: total > 0, total });
});

// ─── GET /pacientes/:id/historial-genexis ─────────────────────────────────────
// Historial CONGELADO del sistema antiguo Genexis: SOLO LECTURA (no existen
// endpoints de creación/edición/borrado). Los campos sede/servicio/podologo son
// texto crudo del sistema viejo — NO son FKs a los catálogos actuales y no
// participan en KPIs. El `resumen` se calcula sobre TODO el historial del
// paciente; `sede`/`anio` filtran solo el listado paginado.
const historialGenexisQuery = z.object({
  sede: z.string().trim().min(1).optional(),
  anio: z.string().regex(/^\d{4}$/).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

router.get('/:id/historial-genexis', requireAuth, requireScope('patients:read'), async (req, res) => {
  const q = historialGenexisQuery.parse(req.query);
  const paciente = await prisma.paciente.findUnique({
    where: { id: req.params.id, deletedAt: null },
    select: { id: true },
  });
  if (!paciente) throw new AppError('Paciente no encontrado', 404);

  const base = { pacienteId: req.params.id, deletedAt: null };
  const where = {
    ...base,
    ...(q.sede ? { sede: q.sede } : {}),
    ...(q.anio ? { fechaCita: { startsWith: `${q.anio}-` } } : {}),
  };

  const [registros, total, agregados, asistencia, porSede, aniosRaw] = await Promise.all([
    prisma.historialGenexis.findMany({
      where,
      // horaCita se ordena tal cual viene (string crudo): suficiente para desempatar
      // dentro de un día; el orden principal es la fecha.
      orderBy: [{ fechaCita: 'desc' }, { horaCita: 'desc' }],
      skip: (q.page - 1) * q.limit,
      take: q.limit,
    }),
    prisma.historialGenexis.count({ where }),
    prisma.historialGenexis.aggregate({
      where: base,
      _count: { _all: true },
      _min: { fechaCita: true },
      _max: { fechaCita: true },
    }),
    prisma.historialGenexis.groupBy({ by: ['llegoPaciente'], where: base, _count: { _all: true } }),
    prisma.historialGenexis.groupBy({
      by: ['sede'],
      where: base,
      _count: { _all: true },
      orderBy: { _count: { sede: 'desc' } },
    }),
    prisma.$queryRaw<{ anio: string }[]>`
      SELECT DISTINCT substring("fechaCita", 1, 4) AS anio
      FROM historial_genexis
      WHERE "pacienteId" = ${req.params.id}::uuid AND "deletedAt" IS NULL
      ORDER BY anio DESC`,
  ]);

  // % de asistencia histórica: Sí / (Sí + No), ignorando registros sin dato.
  const si = asistencia.find((a) => a.llegoPaciente === 'Sí')?._count._all ?? 0;
  const no = asistencia.find((a) => a.llegoPaciente === 'No')?._count._all ?? 0;
  const porcentajeAsistencia = si + no > 0 ? Math.round((si / (si + no)) * 1000) / 10 : null;

  res.json({
    data: registros,
    page: q.page,
    limit: q.limit,
    total,
    resumen: {
      totalAtenciones: agregados._count._all,
      primeraCita: agregados._min.fechaCita,
      ultimaCita: agregados._max.fechaCita,
      porcentajeAsistencia,
      sedes: porSede.map((s) => ({ sede: s.sede, total: s._count._all })),
      anios: aniosRaw.map((a) => a.anio),
    },
  });
});

// ─── POST /pacientes ──────────────────────────────────────────────────────────
router.post('/', requireAuth, async (req, res) => {
  const data = normalizarPaciente(crearPacienteSchema.parse(req.body));

  // Primera capa: verificación en la app (mensaje claro inmediato).
  const existente = await prisma.paciente.findFirst({
    where: { tipoDocumento: data.tipoDocumento as never, numeroDocumento: data.numeroDocumento, deletedAt: null },
  });
  if (existente) throw new AppError('Ya existe un paciente con este documento', 409, 'PACIENTE_DUPLICADO');

  // Creación + audit en la MISMA transacción (historial inmutable). La última
  // línea de defensa es el índice DB `pacientes_documento_unico`: si dos altas
  // simultáneas pasan el findFirst, la segunda falla con P2002 → 409 claro.
  const paciente = await prisma.$transaction(async (tx) => {
    const p = await tx.paciente.create({
      data: {
        nombres: data.nombres,
        apellidoPaterno: data.apellidoPaterno,
        apellidoMaterno: data.apellidoMaterno,
        tipoDocumento: data.tipoDocumento as never,
        numeroDocumento: data.numeroDocumento,
        telefono: data.telefono,
        email: data.email,
        fechaNacimiento: data.fechaNacimiento ? new Date(data.fechaNacimiento) : undefined,
        sexo: data.sexo as never,
        notas: data.notas,
        // Bandera "actualizar datos": SIEMPRE calculada server-side (el schema zod
        // no la acepta del cliente).
        requiereActualizacionDatos: faltanDatosPaciente({
          email: data.email ?? null,
          telefono: data.telefono,
          fechaNacimiento: data.fechaNacimiento ? new Date(data.fechaNacimiento) : null,
        }),
      },
    });
    await auditEnTx(tx, {
      usuarioId: req.user?.userId,
      accion: 'crear_paciente',
      entidad: 'paciente',
      entidadId: p.id,
      despues: { nombres: p.nombres, apellidoPaterno: p.apellidoPaterno, apellidoMaterno: p.apellidoMaterno, tipoDocumento: p.tipoDocumento, numeroDocumento: p.numeroDocumento, telefono: p.telefono, email: p.email },
      ip: req.ip,
    });
    return p;
  });

  res.status(201).json(paciente);
});

// ─── PATCH /pacientes/:id ─────────────────────────────────────────────────────
router.patch('/:id', requireAuth, async (req, res) => {
  const data = normalizarPaciente(crearPacienteSchema.partial().parse(req.body));
  const antes = await prisma.paciente.findUnique({ where: { id: req.params.id, deletedAt: null } });
  if (!antes) throw new AppError('Paciente no encontrado', 404);

  // Si se cambia el documento, revalidar unicidad contra OTROS pacientes vivos
  // (la edición no debe abrir una puerta trasera a duplicados). El índice DB es el respaldo.
  const nuevoTipo = data.tipoDocumento ?? (antes.tipoDocumento as string);
  const nuevoNum = data.numeroDocumento ?? antes.numeroDocumento;
  if (nuevoTipo !== antes.tipoDocumento || nuevoNum !== antes.numeroDocumento) {
    const choque = await prisma.paciente.findFirst({
      where: { tipoDocumento: nuevoTipo as never, numeroDocumento: nuevoNum, deletedAt: null, id: { not: antes.id } },
    });
    if (choque) throw new AppError('Ya existe otro paciente con ese documento', 409, 'PACIENTE_DUPLICADO');
  }

  // Recalcular la bandera "actualizar datos" con el estado FINAL (lo enviado
  // mezclado con lo existente). Server-side siempre: el cliente no puede setearla.
  const requiereActualizacionDatos = faltanDatosPaciente({
    email: data.email !== undefined ? data.email : antes.email,
    telefono: data.telefono ?? antes.telefono,
    fechaNacimiento: data.fechaNacimiento ? new Date(data.fechaNacimiento) : antes.fechaNacimiento,
  });

  // Update + audit en la misma transacción. `.partial()` + spread: los campos NO
  // enviados quedan `undefined` → Prisma NO los toca (nunca se pisan con vacío).
  const paciente = await prisma.$transaction(async (tx) => {
    const p = await tx.paciente.update({
      where: { id: req.params.id, deletedAt: null },
      data: {
        ...data,
        tipoDocumento: data.tipoDocumento as never,
        sexo: data.sexo as never,
        fechaNacimiento: data.fechaNacimiento ? new Date(data.fechaNacimiento) : undefined,
        requiereActualizacionDatos,
      },
    });
    await auditEnTx(tx, {
      usuarioId: req.user?.userId,
      accion: 'editar_paciente',
      entidad: 'paciente',
      entidadId: p.id,
      antes: { nombres: antes.nombres, apellidoPaterno: antes.apellidoPaterno, apellidoMaterno: antes.apellidoMaterno, numeroDocumento: antes.numeroDocumento, telefono: antes.telefono, email: antes.email },
      despues: { nombres: p.nombres, apellidoPaterno: p.apellidoPaterno, apellidoMaterno: p.apellidoMaterno, numeroDocumento: p.numeroDocumento, telefono: p.telefono, email: p.email },
      ip: req.ip,
    });
    return p;
  });

  // `datosFaltantes` alimenta el tooltip del toggle ("Falta: correo, …") y permite
  // al frontend apagar el switch sin recargar cuando ya no falta nada.
  res.json({ ...paciente, datosFaltantes: datosFaltantes(paciente) });
});

export default router;
