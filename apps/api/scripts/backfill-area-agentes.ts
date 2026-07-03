/**
 * Backfill de Usuario.area y Usuario.sedeAsignadaId (Desempeño de Agentes).
 *
 * Reglas (solo llena NULLs, nunca sobreescribe un valor existente):
 *  - rol 'contact_center'  → area = CONTACT_CENTER
 *  - rol 'recepcionista'   → area = RECEPCION
 *  - otros roles           → se dejan en null (sin clasificar; no inventar)
 *  - sedeAsignadaId: solo para usuarios con EXACTAMENTE una sede en UsuarioSede.
 *
 * Uso:
 *   npx ts-node --transpile-only scripts/backfill-area-agentes.ts          # DRY-RUN (default)
 *   npx ts-node --transpile-only scripts/backfill-area-agentes.ts --apply  # escribe
 */
import { PrismaClient, AreaAgente } from '@prisma/client';

const prisma = new PrismaClient();
const APPLY = process.argv.includes('--apply');

const AREA_POR_ROL: Record<string, AreaAgente> = {
  contact_center: 'CONTACT_CENTER',
  recepcionista: 'RECEPCION',
};

async function main() {
  console.log(`Modo: ${APPLY ? 'APPLY (escribe)' : 'DRY-RUN (solo reporta)'}\n`);

  const usuarios = await prisma.usuario.findMany({
    where: { deletedAt: null },
    select: { id: true, rol: true, area: true, sedeAsignadaId: true, sedes: { select: { sedeId: true } } },
  });

  const planArea: { id: string; area: AreaAgente }[] = [];
  const planSede: { id: string; sedeId: string }[] = [];
  const resumen = { yaConArea: 0, sinRolMapeable: 0, multiSede: 0, sinSede: 0 };

  for (const u of usuarios) {
    const area = AREA_POR_ROL[u.rol];
    if (u.area !== null) resumen.yaConArea++;
    else if (area) planArea.push({ id: u.id, area });
    else resumen.sinRolMapeable++;

    if (u.sedeAsignadaId === null && area) {
      if (u.sedes.length === 1) planSede.push({ id: u.id, sedeId: u.sedes[0]!.sedeId });
      else if (u.sedes.length > 1) resumen.multiSede++;
      else resumen.sinSede++;
    }
  }

  const porArea = planArea.reduce<Record<string, number>>((acc, p) => {
    acc[p.area] = (acc[p.area] ?? 0) + 1;
    return acc;
  }, {});
  console.log(`Usuarios activos analizados:      ${usuarios.length}`);
  console.log(`Se poblaría 'area':               ${planArea.length}  ${JSON.stringify(porArea)}`);
  console.log(`Ya tenían 'area' (no se toca):    ${resumen.yaConArea}`);
  console.log(`Rol no mapeable (queda null):     ${resumen.sinRolMapeable}`);
  console.log(`Se poblaría 'sedeAsignadaId':     ${planSede.length}`);
  console.log(`Multi-sede (queda null):          ${resumen.multiSede}`);
  console.log(`Sin sede en UsuarioSede (null):   ${resumen.sinSede}`);

  if (!APPLY) {
    console.log('\nDRY-RUN: no se escribió nada. Ejecuta con --apply para aplicar.');
    return;
  }

  let a = 0, s = 0;
  for (const p of planArea) {
    // Doble guardia: solo si sigue en null (no pisar cambios concurrentes/manuales).
    const r = await prisma.usuario.updateMany({ where: { id: p.id, area: null }, data: { area: p.area } });
    a += r.count;
  }
  for (const p of planSede) {
    const r = await prisma.usuario.updateMany({ where: { id: p.id, sedeAsignadaId: null }, data: { sedeAsignadaId: p.sedeId } });
    s += r.count;
  }
  console.log(`\nAPLICADO: area en ${a} usuario(s), sedeAsignadaId en ${s} usuario(s).`);
}

main().finally(() => prisma.$disconnect());
