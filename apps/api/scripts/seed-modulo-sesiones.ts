/**
 * Seed del módulo Sesiones/Paquetes/Membresías (FASE 1b) — IDEMPOTENTE (upsert por clave natural).
 *
 * 1. FamiliaPaqueteGenexis: tabla de equivalencias FINAL según decisiones cerradas:
 *    - Laserterapia Onicomicosis (P12/P6/P4) → POD-05 Láser de Alta.
 *    - Laserterapia fascitis/juanete/talón/metatarso/tríceps (± Indometacina) → POD-06.
 *    - Paquete de Laser X12/X4 + citas "Laser N" (consumo del Regular) → POD-04.
 *    - "Laser Para Hongos" → UNITARIA (sin saldo; evidencia de paquete → ROJO).
 *    - Fisioterapia P12/P6 → POR SEDE: Paz Soldán/One → FIS-SES; Lince/LO/SM → POD-06.
 *    - Curaciones (matri/extracciones/rodeto/VPH/núcleo) → SIN_SALDO (trazabilidad, sin deuda).
 *    - Membresías → composición base: N del nombre = N profilaxis (POD-01).
 * 2. Catálogo: plantillas x4 y unitarias x1 (Alta y Regular), Laser-Fisio x12/x6,
 *    Membresía Genexis 6M/12M (solo migración); DESACTIVA la VENTA de los láser de 6
 *    (flag activo=false — jamás borrado: instancias existentes siguen consumibles).
 *
 * Uso: npx ts-node --transpile-only scripts/seed-modulo-sesiones.ts
 */
import { PrismaClient, Prisma } from '@prisma/client';

const prisma = new PrismaClient();

interface Ids {
  serv: Record<string, string>; // codigo → id
  sede: Record<string, string>; // nombre → id
}

async function resolverIds(): Promise<Ids> {
  const servicios = await prisma.servicio.findMany({ where: { deletedAt: null }, select: { id: true, codigo: true } });
  const sedes = await prisma.sede.findMany({ where: { deletedAt: null }, select: { id: true, nombre: true } });
  return {
    serv: Object.fromEntries(servicios.map((s) => [s.codigo, s.id])),
    sede: Object.fromEntries(sedes.map((s) => [s.nombre, s.id])),
  };
}

async function main(): Promise<void> {
  const ids = await resolverIds();
  const req = (codigo: string): string => {
    const id = ids.serv[codigo];
    if (!id) throw new Error(`Servicio ${codigo} no encontrado en el catálogo`);
    return id;
  };
  const POD01 = req('POD-01'); // Profilaxis
  const POD04 = req('POD-04'); // Láser Regular (Laser para Hongos)
  const POD05 = req('POD-05'); // Láser de Alta
  const POD06 = req('POD-06'); // Laserterapia-Fisioterapia
  const FISSES = req('FIS-SES'); // Sesión de Fisioterapia
  const BAREVAL = req('BAR-EVAL');

  // Mapeo por sede de Fisioterapia P12/P6 (decisión 6, último punto).
  const fisioPorSede = {
    porSede: {
      [ids.sede['Paz Soldán']]: FISSES,
      [ids.sede['One']]: FISSES,
      [ids.sede['Lince']]: POD06,
      [ids.sede['Los Olivos']]: POD06,
      [ids.sede['San Miguel']]: POD06,
    },
  };

  const compProfilaxis = (n: number) => [{ servicioId: POD01, cantidad: n, etiqueta: 'Profilaxis' }];

  interface FamiliaSeed {
    nombreFamilia: string;
    patronesServicio: string[]; // regex (se aplican sobre el nombre normalizado, ver motor)
    patronesObs?: string[];
    mapeoServicio?: Prisma.InputJsonValue | null;
    tipo: 'PAQUETE' | 'MEMBRESIA' | 'UNITARIA' | 'SIN_SALDO';
    sesionesTotales?: number;
    composicion?: Prisma.InputJsonValue;
    duracionMeses?: number;
  }

  const OBS_LASER = ['la[sc]er', 'lasser'];
  const OBS_FISIO = ['fisio'];
  const OBS_MEMB = ['membre', 'profi'];

  const FAMILIAS: FamiliaSeed[] = [
    // ── Láser de Alta (onicomicosis) ──
    { nombreFamilia: 'LASERTERAPIA_ONICO_P12', tipo: 'PAQUETE', sesionesTotales: 12, mapeoServicio: { default: POD05 }, patronesObs: OBS_LASER,
      patronesServicio: ['^laserterapia p12 - onicomicosis(?: - sesion (\\d+))?$'] },
    { nombreFamilia: 'LASERTERAPIA_ONICO_P6', tipo: 'PAQUETE', sesionesTotales: 6, mapeoServicio: { default: POD05 }, patronesObs: OBS_LASER,
      patronesServicio: ['^laserterapia p6 - onicomicosis(?: - sesion (\\d+))?$'] },
    { nombreFamilia: 'LASERTERAPIA_ONICO_P4', tipo: 'PAQUETE', sesionesTotales: 4, mapeoServicio: { default: POD05 }, patronesObs: OBS_LASER,
      patronesServicio: ['^laserterapia p4 - onicomicosis(?: - sesion (\\d+))?$'] },
    { nombreFamilia: 'LASER_ALTA_P6', tipo: 'PAQUETE', sesionesTotales: 6, mapeoServicio: { default: POD05 }, patronesObs: OBS_LASER,
      patronesServicio: ['^regalasalud .*laser de alta s(\\d+)$', '^6 sesiones de laser de alta'] },
    { nombreFamilia: 'LASER_ALTA_P4', tipo: 'PAQUETE', sesionesTotales: 4, mapeoServicio: { default: POD05 }, patronesObs: OBS_LASER,
      patronesServicio: ['^4 sesiones de laser de alta'] },
    // ── Laserterapia condiciones (fisioterapéuticas) → POD-06 ──
    { nombreFamilia: 'LASERTERAPIA_FISIO_P6', tipo: 'PAQUETE', sesionesTotales: 6, mapeoServicio: { default: POD06 }, patronesObs: OBS_LASER,
      patronesServicio: ['^laserterapia p6(?: \\+ indometacina)? - (?:fascitis|juanete|talon|metatarso|triceps sural|tendon)(?: - sesion (\\d+))?'] },
    { nombreFamilia: 'LASERTERAPIA_FISIO_P4', tipo: 'PAQUETE', sesionesTotales: 4, mapeoServicio: { default: POD06 }, patronesObs: OBS_LASER,
      patronesServicio: ['^laserterapia p4(?: \\+ indometacina)? - (?:fascitis|juanete|talon|metatarso|triceps sural|tendon)(?: - sesion (\\d+))?'] },
    // ── Láser Regular: compra "Paquete X12/X4"; consumo = citas "Laser N" ──
    { nombreFamilia: 'LASER_REGULAR_X12', tipo: 'PAQUETE', sesionesTotales: 12, mapeoServicio: { default: POD04 }, patronesObs: OBS_LASER,
      patronesServicio: ['^paquete de laser x 12', '^laser (\\d{1,2})$', '^profilaser 12 sesiones'] },
    { nombreFamilia: 'LASER_REGULAR_X4', tipo: 'PAQUETE', sesionesTotales: 4, mapeoServicio: { default: POD04 }, patronesObs: OBS_LASER,
      patronesServicio: ['^paquete de laser x 4'] },
    { nombreFamilia: 'PROMO_COMBO_LEGACY', tipo: 'PAQUETE', sesionesTotales: 4, mapeoServicio: { default: POD04 }, patronesObs: OBS_LASER,
      patronesServicio: ['^promopies.*(?:sesion laser (\\d+))?', '^profilaxis( adulto mayor)? \\+ fisioterapia'] },
    // ── Laser Para Hongos = venta UNITARIA (decisión 6): sin saldo; evidencia de paquete → ROJO ──
    { nombreFamilia: 'LASER_HONGOS_UNITARIA', tipo: 'UNITARIA', mapeoServicio: { default: POD04 }, patronesObs: OBS_LASER,
      patronesServicio: ['^laser para hongos(?: p(?:12|4))?(?: - sesion (\\d+))?$'] },
    // ── Fisioterapia (mapeo POR SEDE) ──
    { nombreFamilia: 'FISIOTERAPIA_P12', tipo: 'PAQUETE', sesionesTotales: 12, mapeoServicio: fisioPorSede, patronesObs: OBS_FISIO,
      patronesServicio: ['^fisioterapia p12 - sesion (\\d+)$'] },
    { nombreFamilia: 'FISIOTERAPIA_P6', tipo: 'PAQUETE', sesionesTotales: 6, mapeoServicio: fisioPorSede, patronesObs: OBS_FISIO,
      patronesServicio: ['^fisioterapia p6 - sesion (\\d+)$'] },
    // ── Curaciones y análogas = SIN_SALDO (decisión 8: seguimiento hasta el alta, no deuda) ──
    { nombreFamilia: 'CURACIONES_SIN_SALDO', tipo: 'SIN_SALDO', mapeoServicio: null,
      patronesServicio: [
        '^matricectomia - curacion (\\d+)$',
        '^extraccion de u(?:n|ñ)a (?:grande|peque(?:n|ñ)a) - curacion (\\d+)$',
        '^extraccion de nucleo - curacion (\\d+)$',
        '^rodetoplastia - curacion (\\d+)$',
        '^vph - ble - curacion (\\d+)$',
        '^vph - an(?: - sesion (\\d+))?$',
      ] },
  ];

  // ── Membresías Genexis (composición base: N del nombre = N profilaxis) ──
  const membresia = (nombreFamilia: string, patron: string, n: number, meses: number): FamiliaSeed => ({
    nombreFamilia, tipo: 'MEMBRESIA', sesionesTotales: n, duracionMeses: meses,
    composicion: compProfilaxis(n), mapeoServicio: { default: POD01 }, patronesObs: OBS_MEMB,
    patronesServicio: [patron],
  });
  FAMILIAS.push(
    membresia('MEMB_GEN_12M_2024', '^membresias 12 meses 2024 \\(s1-12\\)(?: - sesion (.+))?$', 12, 12),
    membresia('MEMB_GEN_6M_2024', '^membresias 6 meses 2024 \\(s1-6\\)(?: - sesion (.+))?$', 6, 6),
    membresia('MEMB_LISMLO_12M_2025', '^membresias li - sm - lo 12 meses 2025 \\(s1-12\\)(?: - sesion (.+))?$', 12, 12),
    membresia('MEMB_LISMLO_6M_2025', '^membresias li - sm - lo 6 meses 2025 \\(s1-6\\)(?: - sesion (.+))?$', 6, 6),
    membresia('MEMB_SI_12M_2025', '^membresias san isidro 12 meses 2025 \\(s1-12\\)(?: - sesion (.+))?$', 12, 12),
    membresia('MEMB_SI_6M_2025', '^membresias san isidro 6 meses 2025 \\(s1-6\\)(?: - sesion (.+))?$', 6, 6),
    membresia('MEMB_LNSMLO_12M_2026', '^membresia ln sm lo 12m 2026 . (.+?)(?: (\\d+))?$', 12, 12),
    membresia('MEMB_LNSMLO_6M_2026', '^membresia ln sm lo 6m 2026 . (.+?)(?: (\\d+))?$', 6, 6),
    membresia('MEMB_SI_12M_2026', '^membresia si 12m 2026 . (.+?)(?: (\\d+))?$', 12, 12),
    membresia('MEMB_SI_6M_2026', '^membresia si 6m 2026 . (.+?)(?: (\\d+))?$', 6, 6),
    membresia('MEMB_ONE_12M_2026', '^membresia one 12m 2026 . (.+?)(?: (\\d+))?$', 12, 12),
    membresia('MEMB_ONE_6M_2026', '^membresia one 6m 2026 . (.+?)(?: (\\d+))?$', 6, 6),
    membresia('MEMB_LEGACY_NUM', '^membresia (\\d{1,2})$', 12, 12),
    membresia('MEMB_2024_4PROFI', '^membresia \\(4 profilaxis\\) 2024$', 4, 12),
    membresia('MEMB_2024_SEDE_12S', '^membresia 2024 - (?:lince|los olivos) 12 sesiones$', 12, 12),
    membresia('MEMB_2024_SEDE_06S', '^membresia 2024 - (?:lince|los olivos) 06 sesiones$', 6, 6),
  );

  for (const f of FAMILIAS) {
    await prisma.familiaPaqueteGenexis.upsert({
      where: { nombreFamilia: f.nombreFamilia },
      create: {
        nombreFamilia: f.nombreFamilia,
        patronesServicio: f.patronesServicio,
        patronesObs: f.patronesObs ?? [],
        mapeoServicio: f.mapeoServicio === null ? Prisma.DbNull : f.mapeoServicio,
        tipo: f.tipo,
        sesionesTotales: f.sesionesTotales ?? null,
        composicion: f.composicion ?? Prisma.DbNull,
        duracionMeses: f.duracionMeses ?? null,
      },
      update: {
        patronesServicio: f.patronesServicio,
        patronesObs: f.patronesObs ?? [],
        mapeoServicio: f.mapeoServicio === null ? Prisma.DbNull : f.mapeoServicio,
        tipo: f.tipo,
        sesionesTotales: f.sesionesTotales ?? null,
        composicion: f.composicion ?? Prisma.DbNull,
        duracionMeses: f.duracionMeses ?? null,
      },
    });
  }
  console.log(`✔ Familias sembradas: ${FAMILIAS.length}`);

  // ── Catálogo vendible (decisión 7) ──────────────────────────────────────────
  interface PlantillaSeed {
    nombre: string;
    servicioId: string;
    total: number;
    tipo: 'PAQUETE' | 'MEMBRESIA' | 'UNITARIA';
    ventaActiva: boolean;
    composicion?: Prisma.InputJsonValue;
    duracionMeses?: number;
  }
  const PLANTILLAS: PlantillaSeed[] = [
    { nombre: 'Paquete x4 Láser de Alta', servicioId: POD05, total: 4, tipo: 'PAQUETE', ventaActiva: true },
    { nombre: 'Paquete x4 Láser Regular', servicioId: POD04, total: 4, tipo: 'PAQUETE', ventaActiva: true },
    { nombre: 'Sesión Unitaria Láser de Alta', servicioId: POD05, total: 1, tipo: 'UNITARIA', ventaActiva: true },
    { nombre: 'Sesión Unitaria Láser Regular', servicioId: POD04, total: 1, tipo: 'UNITARIA', ventaActiva: true },
    // Para aperturas Genexis de laserterapia-fisio y fisio mapeada a POD-06:
    { nombre: 'Laserterapia-Fisioterapia x12', servicioId: POD06, total: 12, tipo: 'PAQUETE', ventaActiva: true },
    { nombre: 'Laserterapia-Fisioterapia x6', servicioId: POD06, total: 6, tipo: 'PAQUETE', ventaActiva: false },
    { nombre: 'Laserterapia-Fisioterapia x4', servicioId: POD06, total: 4, tipo: 'PAQUETE', ventaActiva: true },
    // Membresías Genexis (solo migración — la venta nueva usa el constructor):
    { nombre: 'Membresía Genexis 6 Meses', servicioId: POD01, total: 6, tipo: 'MEMBRESIA', ventaActiva: false, composicion: compProfilaxis(6), duracionMeses: 6 },
    { nombre: 'Membresía Genexis 12 Meses', servicioId: POD01, total: 12, tipo: 'MEMBRESIA', ventaActiva: false, composicion: compProfilaxis(12), duracionMeses: 12 },
    { nombre: 'Membresía Genexis 4 Profilaxis', servicioId: POD01, total: 4, tipo: 'MEMBRESIA', ventaActiva: false, composicion: compProfilaxis(4), duracionMeses: 12 },
  ];
  for (const p of PLANTILLAS) {
    const existente = await prisma.paquete.findFirst({ where: { nombre: p.nombre, deletedAt: null } });
    if (existente) {
      await prisma.paquete.update({
        where: { id: existente.id },
        data: { tipo: p.tipo, activo: p.ventaActiva, composicion: p.composicion ?? Prisma.DbNull, duracionMeses: p.duracionMeses ?? null },
      });
    } else {
      await prisma.paquete.create({
        data: {
          nombre: p.nombre, servicioId: p.servicioId, totalSesiones: p.total, tipo: p.tipo,
          activo: p.ventaActiva, composicion: p.composicion ?? Prisma.DbNull, duracionMeses: p.duracionMeses ?? null,
        },
      });
    }
  }
  console.log(`✔ Plantillas de catálogo aseguradas: ${PLANTILLAS.length}`);

  // Desactivar la VENTA de los paquetes de 6 de láser (flag — JAMÁS borrado).
  const seis = await prisma.paquete.updateMany({
    where: {
      deletedAt: null,
      totalSesiones: 6,
      nombre: { in: ['Láser Regular 1era sesión hasta la 6', 'Láser Alta Hongos 1era sesión hasta la 6'] },
    },
    data: { activo: false },
  });
  console.log(`✔ Venta desactivada en ${seis.count} paquetes láser de 6 sesiones (instancias existentes siguen consumibles)`);

  // Marcar tipo=BAR-EVAL disponible para composiciones futuras (nada que hacer: constructor lo usa).
  void BAREVAL;
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e instanceof Error ? e.stack : e);
    await prisma.$disconnect();
    process.exit(1);
  });
