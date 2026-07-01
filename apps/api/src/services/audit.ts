import { Prisma } from '@prisma/client';
import { prisma } from '../db';

interface AuditParams {
  citaId?: string;
  usuarioId?: string;
  accion: string;
  entidad: string;
  entidadId: string;
  antes?: unknown;
  despues?: unknown;
  sedeId?: string;
  ip?: string;
  userAgent?: string;
}

// Cliente Prisma o cliente de transacción — para escribir el audit DENTRO de la
// misma transacción que la acción (historial atómico: o quedan ambos, o ninguno).
type PrismaLike = Pick<Prisma.TransactionClient, 'auditLog'>;

function datosAudit(params: AuditParams) {
  return {
    citaId: params.citaId,
    usuarioId: params.usuarioId,
    accion: params.accion,
    entidad: params.entidad,
    entidadId: params.entidadId,
    antes: params.antes as never,
    despues: params.despues as never,
    sedeId: params.sedeId,
    ip: params.ip,
    userAgent: params.userAgent,
  };
}

/**
 * Registra el audit FUERA de transacción (fire-and-forget): nunca bloquea ni
 * rompe la operación principal. Úsalo solo cuando el historial es "best effort".
 */
export async function registrarAudit(params: AuditParams): Promise<void> {
  try {
    await prisma.auditLog.create({ data: datosAudit(params) });
  } catch {
    // Audit logging never blocks the main operation
  }
}

/**
 * Registra el audit DENTRO de una transacción (`tx`). NO captura el error: si la
 * escritura del historial falla, toda la transacción (acción incluida) se revierte.
 * Garantiza "historial inmutable, escrito en la misma transacción que la acción".
 */
export async function auditEnTx(tx: PrismaLike, params: AuditParams): Promise<void> {
  await tx.auditLog.create({ data: datosAudit(params) });
}
