/**
 * Import Genexis → Limablue Agenda (pacientes + historial congelado).
 *
 * TRES etapas estrictamente secuenciales:
 *   1. Validación (sin escribir nada): encabezados, formatos, duplicados e
 *      integridad cruzada historial ↔ pacientes (CSV ∪ BD). Huérfanos = advertencia;
 *      ABORTA si superan MAX_HUERFANOS (100).
 *   2. Pacientes (upsert conservador): el dato de la Agenda SIEMPRE gana; solo se
 *      rellenan campos null/vacíos. Nuevos llevan origenImportacion='GENEXIS'.
 *   3. Historial (insert idempotente): createMany en lotes de 1,000 con
 *      skipDuplicates — el unique de hashRegistro hace seguras las re-ejecuciones
 *      y los deltas. NUNCA crea citas reales ni toca catálogos.
 *
 * Uso:
 *   npm run import:genexis -- --pacientes ruta/PACIENTES.csv --historial ruta/HISTORIAL.csv --tipo INICIAL --usuario DDOY
 *   npm run import:genexis -- --pacientes ruta/P_DELTA.csv --historial ruta/H_DELTA.csv --tipo DELTA --usuario DDOY
 *
 * ⚠️ NO ejecutar contra producción sin: backup del día con prueba de restauración,
 *    prueba en staging y doble ejecución idempotente confirmada (0 creados / 0
 *    insertados en la segunda corrida).
 */
import { createHash } from 'crypto';
import { readFileSync } from 'fs';
import { basename } from 'path';
import { parse } from 'csv-parse/sync';
import { PrismaClient, Prisma, TipoDocumento } from '@prisma/client';
import { faltanDatosPaciente } from '../src/utils/datosPaciente';

const prisma = new PrismaClient();

const BATCH = 1_000;
const MAX_HUERFANOS = 100;

// ─── CLI ──────────────────────────────────────────────────────────────────────

interface Args {
  pacientes: string;
  historial: string;
  tipo: 'INICIAL' | 'DELTA';
  usuario: string;
}

function parseArgs(): Args {
  const argv = process.argv.slice(2);
  const get = (flag: string): string => {
    const i = argv.indexOf(`--${flag}`);
    if (i === -1 || i === argv.length - 1) {
      console.error(`Falta el argumento obligatorio --${flag}`);
      process.exit(2);
    }
    return argv[i + 1];
  };
  const tipo = get('tipo');
  if (tipo !== 'INICIAL' && tipo !== 'DELTA') {
    console.error(`--tipo debe ser INICIAL o DELTA (recibido: "${tipo}")`);
    process.exit(2);
  }
  return { pacientes: get('pacientes'), historial: get('historial'), tipo, usuario: get('usuario') };
}

// ─── Parseo CSV ───────────────────────────────────────────────────────────────

const HEADERS_PACIENTES = [
  'tipo_documento', 'numero_documento', 'nombres', 'apellido_paterno', 'apellido_materno',
  'fecha_nacimiento', 'telefono', 'correo', 'requiere_actualizacion',
] as const;

const HEADERS_HISTORIAL = [
  'numero_documento', 'tipo_documento', 'fecha_cita', 'hora_cita', 'podologo', 'sede',
  'id_sucursal', 'servicio', 'obs_paciente', 'obs_podologo', 'consultorio', 'llego_paciente',
  'fecha_creacion', 'usuario_creacion',
] as const;

type FilaPaciente = Record<(typeof HEADERS_PACIENTES)[number], string>;
type FilaHistorial = Record<(typeof HEADERS_HISTORIAL)[number], string>;

function parsearCsv<T>(ruta: string, headersEsperados: readonly string[]): T[] {
  const contenido = readFileSync(ruta, 'utf-8');
  const filas = parse(contenido, {
    columns: true,
    bom: true,
    skip_empty_lines: true,
    trim: false, // los valores se conservan crudos; el trim se aplica campo a campo
  }) as Record<string, string>[];
  if (filas.length === 0) throw new Error(`${basename(ruta)}: el archivo no tiene filas de datos`);
  const headers = Object.keys(filas[0]);
  if (headers.length !== headersEsperados.length || headersEsperados.some((h, i) => headers[i] !== h)) {
    throw new Error(
      `${basename(ruta)}: encabezados inválidos.\n  Esperado: ${headersEsperados.join(',')}\n  Recibido: ${headers.join(',')}`
    );
  }
  return filas as T[];
}

// ─── Normalización y reglas ───────────────────────────────────────────────────

const RE_FECHA = /^\d{4}-\d{2}-\d{2}$/;
const RE_DNI = /^\d{8}$/;

/** CSV → enum TipoDocumento. "SIN INFORMACIÓN" (y cualquier no estándar) → OTRO. */
function mapTipoDocumento(crudo: string): TipoDocumento {
  const t = crudo.trim().toUpperCase();
  if (t === 'DNI') return TipoDocumento.DNI;
  if (t === 'CE') return TipoDocumento.CE;
  if (t === 'PASAPORTE') return TipoDocumento.PASAPORTE;
  if (t === 'RUC') return TipoDocumento.RUC;
  return TipoDocumento.OTRO;
}

function claveDoc(tipo: TipoDocumento, numero: string): string {
  return `${tipo}|${numero.trim()}`;
}

function vacioANull(v: string | undefined): string | null {
  const t = (v ?? '').trim();
  return t === '' ? null : t;
}

/** SHA-256 de la concatenación normalizada (trim + lowercase) — clave de idempotencia. */
function hashRegistro(f: FilaHistorial): string {
  const norm = (v: string | undefined): string => (v ?? '').trim().toLowerCase();
  const partes = [
    f.numero_documento, f.fecha_cita, f.hora_cita, f.sede, f.servicio,
    f.podologo, f.fecha_creacion, f.usuario_creacion, f.obs_paciente, f.obs_podologo,
  ].map(norm);
  return createHash('sha256').update(partes.join('|'), 'utf-8').digest('hex');
}

// ─── Etapa 1 — Validación (sin escribir) ─────────────────────────────────────

interface ErrorValidacion {
  archivo: string;
  fila: number; // 1-based, contando el encabezado como fila 1
  columna: string;
  motivo: string;
}

interface ResultadoValidacion {
  huerfanos: { tipo: string; numero: string }[];
}

async function etapa1Validar(pacientes: FilaPaciente[], historial: FilaHistorial[]): Promise<ResultadoValidacion> {
  const errores: ErrorValidacion[] = [];
  const err = (archivo: string, fila: number, columna: string, motivo: string): void => {
    errores.push({ archivo, fila, columna, motivo });
  };

  // Pacientes: documento no vacío, DNI de 8 dígitos, fecha_nacimiento bien formada,
  // sin duplicados por (tipo, número) — crudos Y mapeados a enum (colisiones tipo
  // "SIN INFORMACIÓN"/"OTRO" con el mismo número chocarían contra el unique de BD).
  const vistosCrudo = new Set<string>();
  const vistosMapeado = new Set<string>();
  pacientes.forEach((f, i) => {
    const fila = i + 2;
    const num = f.numero_documento.trim();
    if (!num) err('pacientes', fila, 'numero_documento', 'documento vacío');
    if (f.tipo_documento.trim().toUpperCase() === 'DNI' && !RE_DNI.test(num))
      err('pacientes', fila, 'numero_documento', `DNI debe tener 8 dígitos: "${num}"`);
    const fn = f.fecha_nacimiento.trim();
    if (fn && !RE_FECHA.test(fn)) err('pacientes', fila, 'fecha_nacimiento', `formato inválido: "${fn}"`);
    const crudo = `${f.tipo_documento.trim()}|${num}`;
    if (vistosCrudo.has(crudo)) err('pacientes', fila, 'numero_documento', `documento duplicado en el CSV: ${crudo}`);
    vistosCrudo.add(crudo);
    const mapeado = claveDoc(mapTipoDocumento(f.tipo_documento), num);
    if (vistosMapeado.has(mapeado))
      err('pacientes', fila, 'tipo_documento', `colisión tras mapear a enum (${mapeado}): dos filas apuntan al mismo paciente`);
    vistosMapeado.add(mapeado);
  });

  // Historial: documento no vacío, fecha_cita bien formada.
  historial.forEach((f, i) => {
    const fila = i + 2;
    if (!f.numero_documento.trim()) err('historial', fila, 'numero_documento', 'documento vacío');
    if (!RE_FECHA.test(f.fecha_cita.trim())) err('historial', fila, 'fecha_cita', `formato inválido: "${f.fecha_cita}"`);
  });

  if (errores.length > 0) {
    console.error(`\n✖ Etapa 1: ${errores.length} error(es) de validación — NO se escribió nada:\n`);
    for (const e of errores.slice(0, 50)) console.error(`  [${e.archivo} fila ${e.fila}, ${e.columna}] ${e.motivo}`);
    if (errores.length > 50) console.error(`  … y ${errores.length - 50} más`);
    throw new Error(`Validación fallida (${errores.length} errores)`);
  }

  // Integridad cruzada: todo documento del historial existe en el CSV de pacientes
  // o ya existe en la BD (caso delta). Huérfanos = ADVERTENCIA (entran con
  // pacienteId null); ABORTA si superan MAX_HUERFANOS.
  const docsCsv = new Set(pacientes.map((f) => claveDoc(mapTipoDocumento(f.tipo_documento), f.numero_documento)));
  const docsDb = await prisma.paciente.findMany({
    where: { deletedAt: null },
    select: { tipoDocumento: true, numeroDocumento: true },
  });
  const docsDbSet = new Set(docsDb.map((p) => claveDoc(p.tipoDocumento, p.numeroDocumento)));

  const huerfanosSet = new Map<string, { tipo: string; numero: string }>();
  for (const f of historial) {
    const clave = claveDoc(mapTipoDocumento(f.tipo_documento), f.numero_documento);
    if (!docsCsv.has(clave) && !docsDbSet.has(clave)) {
      huerfanosSet.set(clave, { tipo: f.tipo_documento.trim(), numero: f.numero_documento.trim() });
    }
  }
  const huerfanos = [...huerfanosSet.values()];
  if (huerfanos.length > MAX_HUERFANOS) {
    console.error(`\n✖ Etapa 1: ${huerfanos.length} documentos del historial sin paciente (límite: ${MAX_HUERFANOS}) — NO se escribió nada.`);
    for (const h of huerfanos.slice(0, 30)) console.error(`  ${h.tipo} ${h.numero}`);
    throw new Error(`Integridad cruzada fallida: ${huerfanos.length} huérfanos > ${MAX_HUERFANOS}`);
  }
  if (huerfanos.length > 0) {
    console.warn(`\n⚠ ${huerfanos.length} documento(s) del historial sin paciente — entrarán con pacienteId = null:`);
    for (const h of huerfanos) console.warn(`  ${h.tipo} ${h.numero}`);
  }

  console.log(`✔ Etapa 1: validación OK — ${pacientes.length} pacientes, ${historial.length} historiales, ${huerfanos.length} huérfanos`);
  return { huerfanos };
}

// ─── Etapa 2 — Pacientes (upsert conservador) ────────────────────────────────

interface ContadoresPacientes {
  creados: number;
  actualizados: number;
  omitidos: number;
}

/** Campos existentes del paciente que el upsert conservador puede rellenar. */
interface PacienteExistente {
  id: string;
  telefono: string;
  email: string | null;
  fechaNacimiento: Date | null;
  requiereActualizacionDatos: boolean;
}

async function cargarPacientesExistentes(): Promise<Map<string, PacienteExistente>> {
  const existentes = await prisma.paciente.findMany({
    where: { deletedAt: null },
    select: {
      id: true, tipoDocumento: true, numeroDocumento: true,
      telefono: true, email: true, fechaNacimiento: true, requiereActualizacionDatos: true,
    },
  });
  return new Map(existentes.map((p) => [claveDoc(p.tipoDocumento, p.numeroDocumento), p]));
}

async function etapa2Pacientes(
  filas: FilaPaciente[],
  loteId: string,
  usuario: string
): Promise<ContadoresPacientes> {
  const cont: ContadoresPacientes = { creados: 0, actualizados: 0, omitidos: 0 };
  const existentes = await cargarPacientesExistentes();

  interface Nuevo {
    fila: FilaPaciente;
    data: Prisma.PacienteCreateManyInput;
  }
  const nuevos: Nuevo[] = [];
  interface Relleno {
    id: string;
    data: Prisma.PacienteUpdateInput;
    relleno: string[]; // campos de datos rellenados (excluye la bandera)
  }
  const rellenos: Relleno[] = [];

  for (const f of filas) {
    const tipo = mapTipoDocumento(f.tipo_documento);
    const numero = f.numero_documento.trim();
    const existente = existentes.get(claveDoc(tipo, numero));
    const telefonoCsv = f.telefono.trim();
    const emailCsv = vacioANull(f.correo);
    const fnCsv = f.fecha_nacimiento.trim() ? new Date(f.fecha_nacimiento.trim()) : null;

    if (!existente) {
      nuevos.push({
        fila: f,
        data: {
          nombres: f.nombres.trim(),
          apellidoPaterno: f.apellido_paterno.trim(),
          apellidoMaterno: f.apellido_materno.trim(), // puede quedar '' (columna NOT NULL)
          tipoDocumento: tipo,
          numeroDocumento: numero,
          telefono: telefonoCsv, // NOT NULL: vacío queda ''
          email: emailCsv,
          fechaNacimiento: fnCsv,
          origenImportacion: 'GENEXIS',
          loteImportacionId: loteId,
          // FUENTE ÚNICA DE VERDAD: la bandera se calcula SIEMPRE con la regla
          // compartida (utils/datosPaciente), ignorando la columna
          // `requiere_actualizacion` del CSV — así creación, relleno y PATCH del
          // API nunca divergen (crítico para el delta pre-go-live).
          requiereActualizacionDatos: faltanDatosPaciente({
            email: emailCsv,
            telefono: telefonoCsv,
            fechaNacimiento: fnCsv,
          }),
        },
      });
      continue;
    }

    // REGLA DE ORO: el dato de la Agenda SIEMPRE gana. Solo rellenar null/vacío.
    const data: Prisma.PacienteUpdateInput = {};
    const relleno: string[] = [];
    if (!existente.telefono.trim() && telefonoCsv) {
      data.telefono = telefonoCsv;
      relleno.push('telefono');
    }
    if (!existente.email?.trim() && emailCsv) {
      data.email = emailCsv;
      relleno.push('email');
    }
    if (!existente.fechaNacimiento && fnCsv) {
      data.fechaNacimiento = fnCsv;
      relleno.push('fechaNacimiento');
    }
    // Recalcular la bandera según los campos que SIGAN faltando tras el relleno.
    const telefonoFinal = relleno.includes('telefono') ? telefonoCsv : existente.telefono;
    const emailFinal = relleno.includes('email') ? emailCsv : existente.email;
    const fnFinal = relleno.includes('fechaNacimiento') ? fnCsv : existente.fechaNacimiento;
    const bandera = faltanDatosPaciente({ email: emailFinal, telefono: telefonoFinal, fechaNacimiento: fnFinal });
    if (bandera !== existente.requiereActualizacionDatos) data.requiereActualizacionDatos = bandera;

    if (Object.keys(data).length > 0) {
      rellenos.push({ id: existente.id, data, relleno });
      // "actualizado" solo si se rellenó un dato; un cambio solo de bandera cuenta como omitido.
      if (relleno.length > 0) cont.actualizados += 1;
      else cont.omitidos += 1;
    } else {
      cont.omitidos += 1;
    }
  }

  // Nuevos: createMany en lotes de 1,000 dentro de transacción + audit por lote.
  for (let i = 0; i < nuevos.length; i += BATCH) {
    const lote = nuevos.slice(i, i + BATCH);
    const numLote = Math.floor(i / BATCH) + 1;
    await prisma.$transaction(async (tx) => {
      const r = await tx.paciente.createMany({ data: lote.map((n) => n.data), skipDuplicates: true });
      cont.creados += r.count;
      cont.omitidos += lote.length - r.count;
      await tx.auditLog.create({
        data: {
          accion: 'import_genexis_pacientes_lote',
          entidad: 'import_genexis_lote',
          entidadId: loteId,
          despues: { lote: numLote, filas: lote.length, creados: r.count, usuario } as never,
        },
      });
    });
    console.log(`  · pacientes: lote ${numLote} (${Math.min(i + BATCH, nuevos.length)}/${nuevos.length} nuevos)`);
  }

  // Rellenos: updates individuales (pocos por diseño), en lotes transaccionales.
  for (let i = 0; i < rellenos.length; i += BATCH) {
    const lote = rellenos.slice(i, i + BATCH);
    await prisma.$transaction(async (tx) => {
      for (const r of lote) {
        await tx.paciente.update({ where: { id: r.id }, data: r.data });
      }
      await tx.auditLog.create({
        data: {
          accion: 'import_genexis_pacientes_relleno',
          entidad: 'import_genexis_lote',
          entidadId: loteId,
          despues: {
            filas: lote.length,
            rellenados: lote.filter((r) => r.relleno.length > 0).length,
            usuario,
          } as never,
        },
      });
    });
  }

  console.log(`✔ Etapa 2: pacientes — ${cont.creados} creados, ${cont.actualizados} actualizados, ${cont.omitidos} omitidos`);
  return cont;
}

// ─── Etapa 3 — Historial (insert idempotente) ────────────────────────────────

interface ContadoresHistorial {
  insertados: number;
  omitidos: number;
  sinPaciente: number;
}

async function etapa3Historial(
  filas: FilaHistorial[],
  loteId: string,
  usuario: string
): Promise<ContadoresHistorial> {
  const cont: ContadoresHistorial = { insertados: 0, omitidos: 0, sinPaciente: 0 };

  // Resolver pacienteId con el mapa RECARGADO (incluye los creados en Etapa 2).
  const pacientes = await cargarPacientesExistentes();
  // pacientes es Map<claveDoc, {id,...}> — solo necesitamos id aquí.

  const datos: Prisma.HistorialGenexisCreateManyInput[] = filas.map((f) => {
    const pacienteId = pacientes.get(claveDoc(mapTipoDocumento(f.tipo_documento), f.numero_documento))?.id ?? null;
    if (!pacienteId) cont.sinPaciente += 1;
    return {
      pacienteId,
      tipoDocumento: f.tipo_documento.trim(), // crudo (conserva "SIN INFORMACIÓN")
      numeroDocumento: f.numero_documento.trim(),
      fechaCita: f.fecha_cita.trim(),
      horaCita: vacioANull(f.hora_cita),
      podologo: vacioANull(f.podologo),
      sede: vacioANull(f.sede),
      idSucursal: vacioANull(f.id_sucursal),
      servicio: vacioANull(f.servicio),
      obsPaciente: vacioANull(f.obs_paciente),
      obsPodologo: vacioANull(f.obs_podologo),
      consultorio: vacioANull(f.consultorio),
      llegoPaciente: vacioANull(f.llego_paciente),
      fechaCreacionGx: vacioANull(f.fecha_creacion),
      usuarioCreacionGx: vacioANull(f.usuario_creacion),
      hashRegistro: hashRegistro(f),
      loteId,
    };
  });

  for (let i = 0; i < datos.length; i += BATCH) {
    const lote = datos.slice(i, i + BATCH);
    const numLote = Math.floor(i / BATCH) + 1;
    await prisma.$transaction(async (tx) => {
      const r = await tx.historialGenexis.createMany({ data: lote, skipDuplicates: true });
      cont.insertados += r.count;
      cont.omitidos += lote.length - r.count;
      await tx.auditLog.create({
        data: {
          accion: 'import_genexis_historial_lote',
          entidad: 'import_genexis_lote',
          entidadId: loteId,
          despues: { lote: numLote, filas: lote.length, insertados: r.count, usuario } as never,
        },
      });
    });
    if (numLote % 25 === 0 || i + BATCH >= datos.length) {
      console.log(`  · historial: lote ${numLote} (${Math.min(i + BATCH, datos.length)}/${datos.length})`);
    }
  }

  console.log(`✔ Etapa 3: historial — ${cont.insertados} insertados, ${cont.omitidos} omitidos, ${cont.sinPaciente} sin paciente`);
  return cont;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const args = parseArgs();
  console.log(`Import Genexis — tipo ${args.tipo}, usuario ${args.usuario}`);
  console.log(`  pacientes: ${args.pacientes}\n  historial: ${args.historial}\n`);

  const filasPacientes = parsearCsv<FilaPaciente>(args.pacientes, HEADERS_PACIENTES);
  const filasHistorial = parsearCsv<FilaHistorial>(args.historial, HEADERS_HISTORIAL);

  // Etapa 1 — si falla, no se ha escrito NADA (ni siquiera el lote).
  const { huerfanos } = await etapa1Validar(filasPacientes, filasHistorial);

  const lote = await prisma.importGenexisLote.create({
    data: {
      nombreArchivo: `${basename(args.pacientes)} + ${basename(args.historial)}`,
      tipo: args.tipo,
      totalFilas: filasPacientes.length + filasHistorial.length,
      importadoPor: args.usuario,
    },
  });
  console.log(`Lote ${lote.id} creado (EN_PROCESO)\n`);

  try {
    const pac = await etapa2Pacientes(filasPacientes, lote.id, args.usuario);
    const hist = await etapa3Historial(filasHistorial, lote.id, args.usuario);

    await prisma.importGenexisLote.update({
      where: { id: lote.id },
      data: {
        estado: 'COMPLETADO',
        pacientesCreados: pac.creados,
        pacientesActualizados: pac.actualizados,
        pacientesOmitidos: pac.omitidos,
        historialInsertado: hist.insertados,
        historialOmitido: hist.omitidos,
        ...(huerfanos.length > 0
          ? { errores: { advertencias: { huerfanos, sinPaciente: hist.sinPaciente } } as never }
          : {}),
      },
    });
    await prisma.auditLog.create({
      data: {
        accion: 'import_genexis_completado',
        entidad: 'import_genexis_lote',
        entidadId: lote.id,
        despues: { tipo: args.tipo, usuario: args.usuario, pacientes: pac, historial: hist } as never,
      },
    });
    console.log(`\n✔ Lote ${lote.id} COMPLETADO`);
  } catch (e) {
    const mensaje = e instanceof Error ? e.message : String(e);
    await prisma.importGenexisLote.update({
      where: { id: lote.id },
      data: { estado: 'FALLIDO', errores: { error: mensaje } as never },
    });
    console.error(`\n✖ Lote ${lote.id} FALLIDO: ${mensaje}`);
    throw e;
  }
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e instanceof Error ? e.stack : e);
    await prisma.$disconnect();
    process.exit(1);
  });
