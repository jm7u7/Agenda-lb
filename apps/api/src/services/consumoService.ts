/**
 * Módulo Sesiones — servicio de CONSUMO operativo.
 *
 * FUENTE DE VERDAD del saldo: ConsumoSesion (vivos). El contador legacy
 * `sesionesUsadas` se mantiene por write-through (invariante verificada en tests:
 * legacy == count(consumos vivos)). El estado del paquete se RECALCULA siempre
 * server-side. El saldo jamás se edita: toda corrección es un consumo/anulación
 * trazable con AuditLog.
 *
 * Candado de sede (decisión 5): el consumo automático exige servicio Y sede
 * coincidentes con el paquete. Excepciones solo por consumo manual auditado.
 */
import { Prisma, PrismaClient } from '@prisma/client';
import { prisma } from '../db';
import { AppError } from '../middleware/errorHandler';

type Tx = Prisma.TransactionClient | PrismaClient;

export function hoyLima(): string {
  return new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Lima' })).toISOString().slice(0, 10);
}

// Estados de cita en los que el consumo se MANTIENE (el paciente llegó).
const ESTADOS_CON_CONSUMO = ['llego', 'en_atencion', 'completada'];

interface ItemComposicion {
  servicioId: string;
  cantidad: number;
  etiqueta: string;
  // Subcategoría FIJADA al vender (ej. Profilaxis → Premium). Si está presente, solo
  // consume citas de esa subcategoría; si es null/ausente, cualquier subcategoría.
  subcategoriaId?: string | null;
  subcategoriaEtiqueta?: string;
}

/** ¿El ítem del snapshot corresponde a (servicio, subcategoría) de una cita? */
function itemCoincide(i: ItemComposicion, servicioId: string, subcategoriaId: string | null): boolean {
  if (i.servicioId !== servicioId) return false;
  if (i.subcategoriaId && i.subcategoriaId !== subcategoriaId) return false; // subcategoría fijada
  return true;
}

/**
 * ¿Un paquete corresponde a una cita (servicio + subcategoría)? Regla: si el paquete
 * tiene composición (membresía) el match va SOLO por sus ítems (subcategoría-aware,
 * para que una membresía "Premium" no consuma una cita "Regular"); si no tiene
 * composición (paquete simple) va por el servicio resuelto (sin subcategoría).
 */
function paqueteCorresponde(
  pp: { servicioNuevoId: string | null; composicion: unknown },
  servicioId: string,
  subcategoriaId: string | null,
): boolean {
  const comp = (pp.composicion as ItemComposicion[] | null) ?? [];
  if (comp.length > 0) return comp.some((i) => itemCoincide(i, servicioId, subcategoriaId));
  return pp.servicioNuevoId === servicioId;
}

/** Recalcula write-through (sesionesUsadas) + estado del paquete. SIEMPRE en tx. */
export async function recalcularPaquete(tx: Tx, paqueteId: string): Promise<{ saldo: number; estado: string }> {
  const pp = await tx.paquetePaciente.findUnique({
    where: { id: paqueteId },
    select: { sesionesTotal: true, vigenciaFin: true, estado: true },
  });
  if (!pp) throw new AppError('Paquete no encontrado', 404);
  const vivos = await tx.consumoSesion.count({ where: { paqueteId, deletedAt: null } });
  const saldo = pp.sesionesTotal - vivos;
  let estado: string;
  if (pp.estado === 'ANULADO') estado = 'ANULADO';
  else if (pp.vigenciaFin && pp.vigenciaFin < hoyLima()) estado = 'VENCIDO';
  else if (saldo <= 0) estado = 'AGOTADO';
  else estado = 'ACTIVO';
  await tx.paquetePaciente.update({
    where: { id: paqueteId },
    data: { sesionesUsadas: vivos, estado, activo: estado === 'ACTIVO' },
  });
  return { saldo, estado };
}

/** Número de sesión que mostraría el PRÓXIMO consumo (numeración continua). */
export async function proximoNumeroSesion(tx: Tx, paqueteId: string): Promise<number> {
  const vivos = await tx.consumoSesion.count({ where: { paqueteId, deletedAt: null } });
  return vivos + 1;
}

/**
 * Paquetes ELEGIBLES para una cita (detección automática): paquetes ACTIVOS del
 * paciente cuyo servicio resuelto (o un ítem de la composición en membresías)
 * coincide con el servicio de la cita Y cuya sede coincide (candado). Orden FIFO
 * (vigenciaInicio/fechaCompra/creadoEn ascendente).
 */
export async function paquetesElegibles(pacienteId: string, servicioId: string, sedeId: string, subcategoriaId: string | null = null) {
  const activos = await prisma.paquetePaciente.findMany({
    where: { pacienteId, deletedAt: null, estado: 'ACTIVO' },
    include: { paquete: { select: { nombre: true } } },
    orderBy: [{ fechaCompra: 'asc' }, { creadoEn: 'asc' }],
  });
  const hoy = hoyLima();
  return activos.filter((pp) => {
    if (pp.vigenciaFin && pp.vigenciaFin < hoy) return false;
    if (pp.sedeId !== sedeId) return false; // candado de sede
    return paqueteCorresponde(pp, servicioId, subcategoriaId);
  });
}

/** Paquetes del servicio correcto pero en OTRA sede (para el aviso "pertenece a {sede}"). */
export async function paquetesEnOtraSede(pacienteId: string, servicioId: string, sedeId: string, subcategoriaId: string | null = null) {
  const activos = await prisma.paquetePaciente.findMany({
    where: { pacienteId, deletedAt: null, estado: 'ACTIVO', NOT: { sedeId } },
    include: { sede: { select: { nombre: true } }, paquete: { select: { nombre: true } } },
  });
  return activos.filter((pp) => paqueteCorresponde(pp, servicioId, subcategoriaId));
}

/** Saldo restante de un ÍTEM de la composición (membresías multi-tipo). */
async function saldoItemComposicion(tx: Tx, paqueteId: string, servicioId: string, comp: ItemComposicion[]): Promise<number> {
  const item = comp.find((i) => i.servicioId === servicioId);
  if (!item) return 0;
  const usados = await tx.consumoSesion.count({ where: { paqueteId, tipoSesion: servicioId, deletedAt: null } });
  return item.cantidad - usados;
}

interface ConsumirCitaParams {
  citaId: string;
  paquetePacienteId: string;
  usuarioId?: string;
  usuarioNombre?: string;
}

/** Consumo confirmado desde el diálogo de llegada (origen CITA). */
export async function consumirDeCita(params: ConsumirCitaParams) {
  const cita = await prisma.cita.findFirst({
    where: { id: params.citaId, deletedAt: null },
    select: { id: true, pacienteId: true, servicioId: true, subcategoriaId: true, sedeId: true, estado: true, fecha: true, sesionNumero: true },
  });
  if (!cita) throw new AppError('Cita no encontrada', 404);
  if (!ESTADOS_CON_CONSUMO.includes(cita.estado)) {
    throw new AppError('Solo se consume sesión cuando el paciente llegó', 409, 'PACIENTE_NO_LLEGO');
  }

  return prisma.$transaction(async (tx) => {
    const pp = await tx.paquetePaciente.findFirst({
      where: { id: params.paquetePacienteId, deletedAt: null },
      include: { sede: { select: { nombre: true } } },
    });
    if (!pp) throw new AppError('Paquete no encontrado', 404);
    if (pp.pacienteId !== cita.pacienteId) throw new AppError('El paquete no es de este paciente', 400);
    if (pp.sedeId !== cita.sedeId) {
      throw new AppError(`El paquete de este paciente pertenece a ${pp.sede?.nombre ?? 'otra sede'}`, 409, 'PAQUETE_OTRA_SEDE');
    }
    const comp = (pp.composicion as ItemComposicion[] | null) ?? [];
    const esItem = comp.some((i) => itemCoincide(i, cita.servicioId, cita.subcategoriaId));
    if (!paqueteCorresponde(pp, cita.servicioId, cita.subcategoriaId)) {
      throw new AppError('El servicio o la subcategoría de la cita no corresponde a este paquete', 409, 'SERVICIO_NO_CORRESPONDE');
    }
    // Vigencia validada contra la FECHA DE LA CITA (no solo "hoy"): la cita debe caer dentro
    // de [vigenciaInicio, vigenciaFin] de la membresía/paquete para poder consumir.
    const fechaCita = cita.fecha.toISOString().slice(0, 10);
    if (pp.vigenciaInicio && fechaCita < pp.vigenciaInicio) {
      throw new AppError(`La membresía inicia su vigencia el ${pp.vigenciaInicio}`, 409, 'PAQUETE_NO_VIGENTE');
    }
    if (pp.vigenciaFin && fechaCita > pp.vigenciaFin) {
      await recalcularPaquete(tx, pp.id);
      throw new AppError(`La membresía vence el ${pp.vigenciaFin}`, 409, 'PAQUETE_VENCIDO');
    }
    const vivos = await tx.consumoSesion.count({ where: { paqueteId: pp.id, deletedAt: null } });
    if (vivos >= pp.sesionesTotal) throw new AppError('Paquete agotado: se cobra como venta normal', 409, 'PAQUETE_AGOTADO');
    if (esItem && comp.length > 0) {
      const saldoItem = await saldoItemComposicion(tx, pp.id, cita.servicioId, comp);
      if (saldoItem <= 0) throw new AppError('Ese tipo de sesión de la membresía ya se agotó', 409, 'ITEM_AGOTADO');
    }

    // Numeración: si la cita ya trae número ADJUDICADO (Genexis, desplegable manual)
    // se respeta; si no, continúa automática (apertura + 1).
    const numeroSesion = cita.sesionNumero ?? vivos + 1;
    const consumo = await tx.consumoSesion.create({
      data: {
        paqueteId: pp.id,
        citaId: cita.id,
        tipoSesion: esItem ? cita.servicioId : null,
        fecha: cita.fecha.toISOString().slice(0, 10),
        origen: 'CITA',
        registradoPorId: params.usuarioId ?? null,
        registradoPor: params.usuarioNombre ?? null,
      },
    });
    // Badge "Sesión x/total" en la cita (reusa columnas existentes).
    await tx.cita.update({
      where: { id: cita.id },
      data: { paquetePacienteId: pp.id, sesionNumero: numeroSesion, sesionConsumida: true },
    });
    const { saldo, estado } = await recalcularPaquete(tx, pp.id);
    await tx.auditLog.create({
      data: {
        usuarioId: params.usuarioId,
        citaId: cita.id,
        accion: 'consumir_sesion',
        entidad: 'paquete_paciente',
        entidadId: pp.id,
        despues: { consumoId: consumo.id, numeroSesion, saldo, estado, origen: 'CITA' } as never,
      },
    });
    return { consumo, numeroSesion, saldo, estado };
  });
}

/**
 * Devolución automática: si la cita consumidora deja de estar en un estado con
 * llegada (cancelada / no_show / revertida), su consumo vivo se soft-deletea.
 * Idempotente; también CREA el consumo al completar una cita agendada contra
 * paquete que nunca pasó por el diálogo (compatibilidad con el flujo legacy).
 */
export async function sincronizarConsumoCita(citaId: string): Promise<'consumida' | 'devuelta' | 'sin_cambio'> {
  const cita = await prisma.cita.findUnique({
    where: { id: citaId },
    select: { id: true, estado: true, fecha: true, paquetePacienteId: true, sesionConsumida: true, servicioId: true, subcategoriaId: true, sesionNumero: true },
  });
  if (!cita?.paquetePacienteId) return 'sin_cambio';
  const debeConsumir = ESTADOS_CON_CONSUMO.includes(cita.estado);
  const consumoVivo = await prisma.consumoSesion.findFirst({ where: { citaId, deletedAt: null } });

  // Devolución: ya no está llegada/atendida pero hay consumo vivo.
  if (!debeConsumir && consumoVivo) {
    return prisma.$transaction<'devuelta'>(async (tx) => {
      await tx.consumoSesion.update({
        where: { id: consumoVivo.id },
        data: { deletedAt: new Date(), anuladoMotivo: `Devolución automática: cita pasó a ${cita.estado}` },
      });
      await tx.cita.update({ where: { id: citaId }, data: { sesionConsumida: false } });
      const { saldo } = await recalcularPaquete(tx, consumoVivo.paqueteId);
      await tx.auditLog.create({
        data: {
          citaId,
          accion: 'devolver_sesion',
          entidad: 'paquete_paciente',
          entidadId: consumoVivo.paqueteId,
          despues: { consumoId: consumoVivo.id, motivo: `cita → ${cita.estado}`, saldo } as never,
        },
      });
      return 'devuelta';
    });
  }

  // Consumo automático al COMPLETAR una cita agendada contra paquete sin consumo
  // previo (flujo legacy sin diálogo). El diálogo de llegada es el camino normal.
  if (cita.estado === 'completada' && !consumoVivo) {
    return prisma.$transaction<'consumida' | 'sin_cambio'>(async (tx) => {
      const pp = await tx.paquetePaciente.findUnique({ where: { id: cita.paquetePacienteId! }, select: { sesionesTotal: true, composicion: true } });
      if (!pp) return 'sin_cambio';
      const vivos = await tx.consumoSesion.count({ where: { paqueteId: cita.paquetePacienteId!, deletedAt: null } });
      if (vivos >= pp.sesionesTotal) return 'sin_cambio'; // nunca sobre-consume
      const comp = (pp.composicion as ItemComposicion[] | null) ?? [];
      const esItem = comp.some((i) => itemCoincide(i, cita.servicioId, cita.subcategoriaId));
      await tx.consumoSesion.create({
        data: {
          paqueteId: cita.paquetePacienteId!,
          citaId,
          tipoSesion: esItem ? cita.servicioId : null,
          fecha: cita.fecha.toISOString().slice(0, 10),
          origen: 'CITA',
          registradoPor: 'Auto (cita completada)',
        },
      });
      await tx.cita.update({ where: { id: citaId }, data: { sesionConsumida: true, sesionNumero: cita.sesionNumero ?? vivos + 1 } });
      const { saldo } = await recalcularPaquete(tx, cita.paquetePacienteId!);
      await tx.auditLog.create({
        data: {
          citaId,
          accion: 'consumir_sesion',
          entidad: 'paquete_paciente',
          entidadId: cita.paquetePacienteId!,
          despues: { numeroSesion: vivos + 1, saldo, origen: 'CITA', auto: true } as never,
        },
      });
      return 'consumida';
    });
  }

  return 'sin_cambio';
}

interface ConsumoManualParams {
  paquetePacienteId: string;
  citaId?: string; // cita del día del paciente (opcional)
  motivo?: string; // obligatorio si no hay cita
  esAdmin: boolean;
  usuarioId?: string;
  usuarioNombre: string;
}

/** Válvula de escape: consumo manual auditado (recepción). */
export async function consumoManual(params: ConsumoManualParams) {
  if (!params.citaId && !params.motivo?.trim()) {
    throw new AppError('Vincula una cita del día o escribe el motivo', 400, 'MOTIVO_REQUERIDO');
  }
  return prisma.$transaction(async (tx) => {
    const pp = await tx.paquetePaciente.findFirst({ where: { id: params.paquetePacienteId, deletedAt: null } });
    if (!pp) throw new AppError('Paquete no encontrado', 404);
    if (params.citaId) {
      const cita = await tx.cita.findFirst({
        where: { id: params.citaId, deletedAt: null, pacienteId: pp.pacienteId },
        select: { id: true },
      });
      if (!cita) throw new AppError('La cita vinculada no existe o no es de este paciente', 400, 'CITA_INVALIDA');
      const ya = await tx.consumoSesion.findFirst({ where: { citaId: params.citaId, deletedAt: null } });
      if (ya) throw new AppError('Esa cita ya consumió una sesión', 409, 'CITA_YA_CONSUMIO');
    }
    const vivos = await tx.consumoSesion.count({ where: { paqueteId: pp.id, deletedAt: null } });
    if (vivos >= pp.sesionesTotal && !params.esAdmin) {
      throw new AppError('Paquete agotado: solo un admin puede registrar un ajuste con motivo', 409, 'PAQUETE_AGOTADO');
    }
    const numeroSesion = vivos + 1;
    const consumo = await tx.consumoSesion.create({
      data: {
        paqueteId: pp.id,
        citaId: params.citaId ?? null,
        fecha: hoyLima(),
        origen: 'AJUSTE_MANUAL',
        motivo: params.motivo?.trim() || (params.citaId ? 'Consumo manual vinculado a cita del día' : null),
        registradoPorId: params.usuarioId ?? null,
        registradoPor: params.usuarioNombre,
      },
    });
    if (params.citaId) {
      await tx.cita.update({ where: { id: params.citaId }, data: { paquetePacienteId: pp.id, sesionNumero: numeroSesion, sesionConsumida: true } });
    }
    const { saldo, estado } = await recalcularPaquete(tx, pp.id);
    await tx.auditLog.create({
      data: {
        usuarioId: params.usuarioId,
        citaId: params.citaId,
        accion: 'consumo_manual_sesion',
        entidad: 'paquete_paciente',
        entidadId: pp.id,
        despues: { consumoId: consumo.id, numeroSesion, saldo, estado, motivo: params.motivo ?? null } as never,
      },
    });
    return { consumo, numeroSesion, saldo, estado };
  });
}

/** "Anular consumo" (admin, motivo obligatorio): jamás editando números. */
export async function anularConsumo(consumoId: string, motivo: string, usuarioId: string | undefined, usuarioNombre: string) {
  return prisma.$transaction(async (tx) => {
    const consumo = await tx.consumoSesion.findFirst({ where: { id: consumoId, deletedAt: null } });
    if (!consumo) throw new AppError('Consumo no encontrado', 404);
    await tx.consumoSesion.update({
      where: { id: consumoId },
      data: { deletedAt: new Date(), anuladoMotivo: motivo },
    });
    if (consumo.citaId) {
      await tx.cita.update({ where: { id: consumo.citaId }, data: { sesionConsumida: false } });
    }
    const { saldo, estado } = await recalcularPaquete(tx, consumo.paqueteId);
    await tx.auditLog.create({
      data: {
        usuarioId,
        citaId: consumo.citaId,
        accion: 'anular_consumo_sesion',
        entidad: 'paquete_paciente',
        entidadId: consumo.paqueteId,
        antes: { consumoId, origen: consumo.origen } as never,
        despues: { motivo, anuladoPor: usuarioNombre, saldo, estado } as never,
      },
    });
    return { saldo, estado };
  });
}
