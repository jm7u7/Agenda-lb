/**
 * Backfill del módulo Sesiones: genera los ConsumoSesion equivalentes de las
 * instancias PaquetePaciente EXISTENTES (ventas nativas pre-módulo), de modo que
 * el saldo derivado (fuente de verdad nueva) reproduzca EXACTAMENTE su estado
 * actual (contador legacy `sesionesUsadas`). También backfillea sedeId (sede
 * predominante de sus citas), servicioNuevoId (= servicio de la plantilla) y
 * recalcula `estado`.
 *
 * Idempotente: un paquete que ya tiene consumos se salta (reporta y verifica).
 *
 * Uso: npx ts-node --transpile-only scripts/backfill-consumos.ts
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

function hoyLima(): string {
  return new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Lima' })).toISOString().slice(0, 10);
}

async function main(): Promise<void> {
  const paquetes = await prisma.paquetePaciente.findMany({
    where: { deletedAt: null },
    include: {
      paquete: { select: { servicioId: true, nombre: true } },
      citas: {
        where: { deletedAt: null },
        select: { id: true, fecha: true, sedeId: true, sesionConsumida: true, sede: { select: { nombre: true } } },
        orderBy: { fecha: 'asc' },
      },
      consumos: { where: { deletedAt: null }, select: { id: true } },
      paciente: { select: { nombres: true, apellidoPaterno: true, numeroDocumento: true } },
    },
    orderBy: { creadoEn: 'asc' },
  });

  console.log(`Instancias PaquetePaciente vivas: ${paquetes.length}\n`);
  let ok = 0;

  for (const pp of paquetes) {
    const etiqueta = `${pp.paciente.nombres} ${pp.paciente.apellidoPaterno} (${pp.paciente.numeroDocumento}) · ${pp.paquete.nombre}`;

    // Sede predominante de sus citas (candado de sede para paquetes legacy).
    const porSede = new Map<string, { n: number; nombre: string }>();
    for (const c of pp.citas) {
      const e = porSede.get(c.sedeId) ?? { n: 0, nombre: c.sede.nombre };
      e.n += 1;
      porSede.set(c.sedeId, e);
    }
    const sedeTop = [...porSede.entries()].sort((a, b) => b[1].n - a[1].n)[0];

    const consumidoras = pp.citas.filter((c) => c.sesionConsumida);

    await prisma.$transaction(async (tx) => {
      if (pp.consumos.length === 0) {
        // 1 consumo por cita consumidora (origen CITA, ligado a la cita real).
        for (const c of consumidoras) {
          await tx.consumoSesion.create({
            data: {
              paqueteId: pp.id,
              citaId: c.id,
              fecha: c.fecha.toISOString().slice(0, 10),
              origen: 'CITA',
              registradoPor: 'Backfill módulo sesiones',
            },
          });
        }
        // Diferencia contador legacy vs citas consumidoras → ajuste trazable (no
        // se pierde saldo ni se inventa: reproduce el estado actual EXACTO).
        for (let i = consumidoras.length; i < pp.sesionesUsadas; i++) {
          await tx.consumoSesion.create({
            data: {
              paqueteId: pp.id,
              fecha: hoyLima(),
              origen: 'AJUSTE_MANUAL',
              motivo: 'Backfill: consumo del contador legacy sin cita vinculada',
              registradoPor: 'Backfill módulo sesiones',
            },
          });
        }
      }

      const vivos = await tx.consumoSesion.count({ where: { paqueteId: pp.id, deletedAt: null } });
      const saldo = pp.sesionesTotal - vivos;
      const estado = !pp.activo ? (saldo <= 0 ? 'AGOTADO' : 'ANULADO') : saldo <= 0 ? 'AGOTADO' : 'ACTIVO';

      await tx.paquetePaciente.update({
        where: { id: pp.id },
        data: {
          sedeId: pp.sedeId ?? sedeTop?.[0] ?? null,
          servicioNuevoId: pp.servicioNuevoId ?? pp.paquete.servicioId,
          estado,
        },
      });
      await tx.auditLog.create({
        data: {
          accion: 'backfill_consumos_paquete',
          entidad: 'paquete_paciente',
          entidadId: pp.id,
          despues: { consumosGenerados: vivos, sesionesUsadasLegacy: pp.sesionesUsadas, saldo, estado } as never,
        },
      });

      const invariante = vivos === pp.sesionesUsadas ? '✓' : `✗ (consumos=${vivos} vs legacy=${pp.sesionesUsadas})`;
      if (vivos === pp.sesionesUsadas) ok += 1;
      console.log(
        `${invariante} ${etiqueta}\n    usadas=${pp.sesionesUsadas}/${pp.sesionesTotal} · consumos vivos=${vivos} · saldo=${saldo} · estado=${estado} · sede=${sedeTop?.[1].nombre ?? '(sin citas — REVISAR)'}`
      );
    });
  }

  console.log(`\nInvariante legacy==derivado: ${ok}/${paquetes.length}`);
  if (ok !== paquetes.length) process.exit(1);
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e instanceof Error ? e.stack : e);
    await prisma.$disconnect();
    process.exit(1);
  });
