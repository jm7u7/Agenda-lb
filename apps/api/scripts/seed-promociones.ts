/**
 * Siembra/actualiza las 15 promociones del Excel "PROMOS - LISTA PARA DANIEL".
 *
 * IDEMPOTENTE: upsert por `nombre` (entre las vivas). Correrlo 2 veces NO duplica.
 * NO toca ningún otro dato — es seguro contra la BD viva (a diferencia del seed destructivo).
 *
 *   npx ts-node --transpile-only scripts/seed-promociones.ts
 *
 * Tabla FIJA (sin parsear nombres en runtime). Todas activas EXCEPTO TRIFIT (activo=false:
 * queda para histórico/analytics pero no aparece en el desplegable hasta confirmar vigencia).
 */
import { PrismaClient, TipoPromocion, Prisma } from '@prisma/client';

const prisma = new PrismaClient();

type PromoSeed = { nombre: string; tipo: TipoPromocion; valor: number | null; activo?: boolean };

export const PROMOS: PromoSeed[] = [
  { nombre: '50% dscto Baropodometria - Llamada', tipo: 'PORCENTAJE', valor: 50 },
  { nombre: 'ROMO PLANT 349', tipo: 'PRECIO_FIJO', valor: 349 },
  { nombre: 'Promo120 (baropodometria mas Profilaxis)', tipo: 'PRECIO_FIJO', valor: 120 },
  { nombre: 'Trabajadores BBVA Baro S/25', tipo: 'PRECIO_FIJO', valor: 25 },
  { nombre: 'Trabajadores BBVA Plantillas S/299', tipo: 'PRECIO_FIJO', valor: 299 },
  { nombre: 'Intimo 25% Dscto Profilaxis', tipo: 'PORCENTAJE', valor: 25 },
  { nombre: 'Intimo 30% Dscto Baropodometria', tipo: 'PORCENTAJE', valor: 30 },
  { nombre: 'Somos Callao Baropodometria S/35 (Lince, LO y SM)', tipo: 'PRECIO_FIJO', valor: 35 },
  { nombre: 'Somos Callao Plantillas 1 par S/369', tipo: 'PRECIO_FIJO', valor: 369 },
  { nombre: 'Somos Callao Plantillas 2 pares S/699', tipo: 'PRECIO_FIJO', valor: 699 },
  { nombre: 'Somos Callao Plantillas 3 pares S/997', tipo: 'PRECIO_FIJO', valor: 997 },
  { nombre: 'Somos Callao Profilaxis S/50', tipo: 'PRECIO_FIJO', valor: 50 },
  { nombre: 'Scotiabank Tarjetahabientes Baropodometria y profilaxis a S/99', tipo: 'PRECIO_FIJO', valor: 99 },
  { nombre: 'ARIE SCANNER 3D', tipo: 'OTRO', valor: null },
  { nombre: 'TRIFIT (no se si sigue vigente)', tipo: 'OTRO', valor: null, activo: false },
];

/** Upsert idempotente de las 15 promos. Reutilizable desde seed.ts y desde el CLI. */
export async function sembrarPromociones(db: Pick<PrismaClient, 'promocion'> | Prisma.TransactionClient): Promise<{ creadas: number; actualizadas: number }> {
  let creadas = 0;
  let actualizadas = 0;
  for (let i = 0; i < PROMOS.length; i++) {
    const p = PROMOS[i]!;
    const activo = p.activo ?? true;
    const existente = await db.promocion.findFirst({ where: { nombre: p.nombre, deletedAt: null } });
    if (existente) {
      await db.promocion.update({ where: { id: existente.id }, data: { tipo: p.tipo, valor: p.valor ?? null, activo, orden: i } });
      actualizadas++;
    } else {
      await db.promocion.create({ data: { nombre: p.nombre, tipo: p.tipo, valor: p.valor ?? null, activo, orden: i } });
      creadas++;
    }
  }
  return { creadas, actualizadas };
}

// CLI: `npx ts-node --transpile-only scripts/seed-promociones.ts`
if (require.main === module) {
  sembrarPromociones(prisma)
    .then(async ({ creadas, actualizadas }) => {
      const total = await prisma.promocion.count({ where: { deletedAt: null } });
      console.log(`✅ Promociones — creadas: ${creadas}, actualizadas: ${actualizadas}, total vivas: ${total}`);
    })
    .catch((e) => { console.error('❌', e instanceof Error ? e.message : e); process.exit(1); })
    .finally(() => prisma.$disconnect());
}
