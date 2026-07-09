/**
 * Aprobación de aperturas Genexis: la CONCILIACIÓN APROBADA ES LA ACTIVACIÓN.
 * Crea el PaquetePaciente (origen GENEXIS_APERTURA) + sus ConsumoSesion de
 * APERTURA en una sola transacción, con write-through al contador legacy.
 * El saldo JAMÁS se edita: nace derivado de los consumos.
 */
import { Prisma } from '@prisma/client';
import { prisma } from '../db';
import { AppError } from '../middleware/errorHandler';
import { auditEnTx } from '../services/audit';

interface AprobarParams {
  conciliacionId: string;
  usuarioId?: string;
  usuarioNombre: string;
  // Ediciones opcionales (si difieren de lo propuesto → estado EDITADA, original preservado)
  consumo?: number;
  sedeId?: string;
  vigenciaFin?: string; // "YYYY-MM-DD" (membresías)
  notas?: string;
}

function hoyLima(): string {
  return new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Lima' })).toISOString().slice(0, 10);
}

export async function aprobarApertura(params: AprobarParams) {
  const c = await prisma.conciliacionApertura.findFirst({
    where: { id: params.conciliacionId, deletedAt: null },
    include: { familia: true },
  });
  if (!c) throw new AppError('Propuesta no encontrada', 404);
  if (c.estado !== 'PENDIENTE') throw new AppError('La propuesta ya fue decidida', 409, 'YA_DECIDIDA');

  const consumo = params.consumo ?? c.consumoPropuesto;
  if (consumo === null || consumo === undefined) {
    throw new AppError('Propuesta ILEGIBLE: indica el consumo aprobado', 400, 'CONSUMO_REQUERIDO');
  }
  const sedeId = params.sedeId ?? c.sedeAprobadaId ?? c.sedeInferidaId;
  if (!sedeId) throw new AppError('Indica la sede del paquete (candado de sede)', 400, 'SEDE_REQUERIDA');

  const familia = c.familia;
  if (familia.tipo === 'SIN_SALDO' || familia.tipo === 'UNITARIA') {
    // UNITARIA solo se aprueba si el humano decide abrir un paquete real: exige
    // consumo y usa el paquete Regular correspondiente — pero por defecto no aplica.
    if (familia.tipo === 'SIN_SALDO') throw new AppError('Las familias sin saldo no generan paquetes', 400, 'FAMILIA_SIN_SALDO');
  }
  // Tamaño REAL: la obs ("paquete de N") manda sobre el tamaño de la familia.
  const sesionesTotales = c.sesionesTotalReal ?? familia.sesionesTotales;
  if (!sesionesTotales) throw new AppError('Familia sin tamaño de paquete definido', 400, 'FAMILIA_SIN_TAMANO');
  if (consumo > sesionesTotales) throw new AppError(`El consumo (${consumo}) excede el tamaño del paquete (${sesionesTotales})`, 400, 'CONSUMO_EXCEDE');

  // Servicio resuelto: mapeo de la familia según la sede APROBADA.
  const mapeo = familia.mapeoServicio as { default?: string; porSede?: Record<string, string> } | null;
  const servicioNuevoId = mapeo?.porSede ? mapeo.porSede[sedeId] ?? null : mapeo?.default ?? null;
  if (!servicioNuevoId) throw new AppError('La familia no tiene servicio equivalente para esa sede', 400, 'SIN_EQUIVALENTE');

  // Plantilla Paquete que respalda la instancia (columna legacy paqueteId NOT NULL).
  // El paquete lleva su propio sesionesTotal (el REAL); la plantilla es solo el
  // respaldo: se prefiere una del tamaño exacto, si no, cualquiera del servicio.
  const plantillaWhere = familia.tipo === 'MEMBRESIA'
    ? { deletedAt: null, tipo: 'MEMBRESIA', nombre: { startsWith: 'Membresía Genexis' } }
    : { deletedAt: null, tipo: { in: ['PAQUETE', 'UNITARIA'] }, servicioId: servicioNuevoId };
  const plantilla =
    (await prisma.paquete.findFirst({ where: { ...plantillaWhere, totalSesiones: sesionesTotales }, orderBy: { creadoEn: 'asc' } })) ??
    (await prisma.paquete.findFirst({ where: plantillaWhere, orderBy: { totalSesiones: 'desc' } }));
  if (!plantilla) {
    throw new AppError(`No existe plantilla de paquete para ${familia.nombreFamilia} (${sesionesTotales} sesiones)`, 500, 'PLANTILLA_FALTANTE');
  }

  // Vigencia (solo membresías).
  let vigenciaInicio: string | null = null;
  let vigenciaFin: string | null = null;
  if (familia.tipo === 'MEMBRESIA') {
    vigenciaFin = params.vigenciaFin ?? c.vigenciaFinEstimada ?? null;
    if (!vigenciaFin) throw new AppError('Membresía sin vigencia: indícala', 400, 'VIGENCIA_REQUERIDA');
    const d = new Date(vigenciaFin + 'T12:00:00');
    d.setMonth(d.getMonth() - (familia.duracionMeses ?? 12));
    vigenciaInicio = d.toISOString().slice(0, 10);
  }

  const fueEditada =
    (params.consumo !== undefined && params.consumo !== c.consumoPropuesto) ||
    (params.sedeId !== undefined && params.sedeId !== c.sedeInferidaId) ||
    (params.vigenciaFin !== undefined && params.vigenciaFin !== c.vigenciaFinEstimada);

  const hoy = hoyLima();
  const composicion = familia.composicion as Prisma.InputJsonValue | null;

  return prisma.$transaction(async (tx) => {
    const saldo = sesionesTotales - consumo;
    const estado = familia.tipo === 'MEMBRESIA' && vigenciaFin! < hoy ? 'VENCIDO' : saldo <= 0 ? 'AGOTADO' : 'ACTIVO';
    const pp = await tx.paquetePaciente.create({
      data: {
        pacienteId: c.pacienteId,
        paqueteId: plantilla.id,
        fechaCompra: new Date((vigenciaInicio ?? hoy) + 'T12:00:00Z'),
        sesionesTotal: sesionesTotales,
        sesionesUsadas: consumo, // write-through del contador legacy
        sedeId,
        servicioNuevoId,
        tipo: familia.tipo,
        composicion: composicion ?? Prisma.DbNull,
        vigenciaInicio,
        vigenciaFin,
        origen: 'GENEXIS_APERTURA',
        familiaId: familia.id,
        estado,
        activo: estado === 'ACTIVO',
      },
    });

    // Consumos de APERTURA: la evidencia queda en la conciliación (evidenciaIds).
    const consumosData = Array.from({ length: consumo }, () => ({
      paqueteId: pp.id,
      fecha: hoy,
      origen: 'APERTURA',
      tipoSesion: familia.tipo === 'MEMBRESIA' ? servicioNuevoId : null,
      registradoPorId: params.usuarioId ?? null,
      registradoPor: params.usuarioNombre,
    }));
    if (consumosData.length > 0) await tx.consumoSesion.createMany({ data: consumosData });

    await tx.conciliacionApertura.update({
      where: { id: c.id },
      data: {
        estado: fueEditada ? 'EDITADA' : 'APROBADA',
        consumoAprobado: consumo,
        sedeAprobadaId: sedeId,
        servicioResueltoId: servicioNuevoId,
        paquetePacienteId: pp.id,
        decididoPor: params.usuarioNombre,
        decididoEn: new Date(),
        ...(params.notas ? { notas: params.notas } : {}),
        ...(fueEditada
          ? {
              valoresOriginales: {
                consumoPropuesto: c.consumoPropuesto,
                sedeInferidaId: c.sedeInferidaId,
                vigenciaFinEstimada: c.vigenciaFinEstimada,
              } as never,
            }
          : {}),
      },
    });

    await auditEnTx(tx, {
      usuarioId: params.usuarioId,
      accion: 'aprobar_apertura_genexis',
      entidad: 'paquete_paciente',
      entidadId: pp.id,
      despues: {
        conciliacionId: c.id,
        familia: familia.nombreFamilia,
        consumoAprobado: consumo,
        saldo,
        sedeId,
        servicioNuevoId,
        editada: fueEditada,
        proCliente: c.ajusteProCliente,
      },
    });
    return pp;
  });
}
