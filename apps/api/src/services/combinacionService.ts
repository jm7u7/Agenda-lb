import { prisma } from '../db';

/**
 * Punto ÚNICO de verdad para la configuración de bloques combinados
 * (profilaxis ancla + servicio extra en el mismo slot de 1 h).
 */

/** Devuelve el `servicioAnclaId` configurado (profilaxis), o null si no hay ancla. */
export async function getServicioAnclaId(): Promise<string | null> {
  const cfg = await prisma.configuracionSistema.findFirst({
    orderBy: { actualizadoEn: 'desc' },
    select: { servicioAnclaId: true },
  });
  return cfg?.servicioAnclaId ?? null;
}

/** ¿`servicioExtraId` es un extra permitido y activo para combinar con la profilaxis? */
export async function esCombinacionPermitida(servicioExtraId: string): Promise<boolean> {
  const c = await prisma.combinacionPermitida.findFirst({
    where: { servicioExtraId, activo: true, deletedAt: null },
    select: { id: true },
  });
  return !!c;
}
