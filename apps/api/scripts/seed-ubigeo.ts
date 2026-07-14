/**
 * Seed del catálogo UBIGEO (INEI) — IDEMPOTENTE (upsert por id): correrlo N veces
 * no duplica ni falla. Fuente: prisma/data/ubigeo-peru.json (1892 distritos, nombres
 * con tildes, esLimaMetro precalculado para 1501xx + 0701xx).
 *
 * Además crea las 2 filas ESPECIALES (códigos imposibles en INEI):
 *   999999 "Extranjero (reside fuera del Perú)" — exige Paciente.paisResidencia
 *   999998 "No precisa"
 *
 * Uso standalone:  npx ts-node scripts/seed-ubigeo.ts
 * Desde seed.ts:   await sembrarUbigeo(prisma)
 */
import { PrismaClient } from '@prisma/client';
import * as fs from 'fs';
import * as path from 'path';

interface FilaUbigeo {
  id: string;
  distrito: string;
  provincia: string;
  departamento: string;
  esLimaMetro: boolean;
}

export const FILAS_ESPECIALES: FilaUbigeo[] = [
  { id: '999999', distrito: 'Extranjero (reside fuera del Perú)', provincia: '—', departamento: '—', esLimaMetro: false },
  { id: '999998', distrito: 'No precisa', provincia: '—', departamento: '—', esLimaMetro: false },
];

export async function sembrarUbigeo(db: PrismaClient): Promise<{ total: number; fuente: number }> {
  const ruta = path.join(__dirname, '..', 'prisma', 'data', 'ubigeo-peru.json');
  const filas: FilaUbigeo[] = JSON.parse(fs.readFileSync(ruta, 'utf8'));
  const todas = [...filas, ...FILAS_ESPECIALES];

  // Upsert por id en lotes (idempotente): actualiza nombres si el catálogo cambia,
  // nunca duplica. 1894 upserts en transacciones de 200 (~10 round-trips).
  const LOTE = 200;
  for (let i = 0; i < todas.length; i += LOTE) {
    const lote = todas.slice(i, i + LOTE);
    await db.$transaction(lote.map((f) =>
      db.ubigeo.upsert({
        where: { id: f.id },
        create: { id: f.id, distrito: f.distrito, provincia: f.provincia, departamento: f.departamento, esLimaMetro: f.esLimaMetro },
        update: { distrito: f.distrito, provincia: f.provincia, departamento: f.departamento, esLimaMetro: f.esLimaMetro, deletedAt: null },
      }),
    ));
  }

  const total = await db.ubigeo.count();
  return { total, fuente: filas.length };
}

// Ejecución directa (standalone)
if (require.main === module) {
  const db = new PrismaClient();
  sembrarUbigeo(db)
    .then(({ total, fuente }) => {
      console.log(`✓ Ubigeo sembrado. Fuente: ${fuente} distritos + ${FILAS_ESPECIALES.length} especiales → COUNT(*) = ${total}`);
    })
    .catch((e) => { console.error(e); process.exit(1); })
    .finally(() => db.$disconnect());
}
