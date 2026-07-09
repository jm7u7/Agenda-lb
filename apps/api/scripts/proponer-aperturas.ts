/**
 * MOTOR DE PROPUESTAS de apertura (FASE 2) — read-only sobre historial_genexis;
 * escribe ÚNICAMENTE en ConciliacionApertura (estado PENDIENTE).
 *
 * IDEMPOTENTE: re-correr borra y regenera solo las PENDIENTES; JAMÁS toca
 * APROBADAS/EDITADAS/DESCARTADAS (si existe una decidida para paciente×familia,
 * no se propone de nuevo). NUNCA crea PaquetePaciente — eso ocurre al aprobar.
 *
 * Reglas (decisiones cerradas):
 *  - Consumo SOLO de citas con llego_paciente='Sí'.
 *  - Alcance: familias con evidencia (llegó o compra) 2026 del paciente.
 *  - CLARO: A==B o B ausente o secuencia completa → consumo=max(A,B), VERDE.
 *  - INCONSISTENTE: discrepancia → consumo=max(A,B)−1 (piso 0), pro-cliente, ÁMBAR.
 *  - ILEGIBLE: indicios sin lectura → propuesta null, ROJO.
 *  - SIN_SALDO (curaciones): sin propuestas. UNITARIA (hongos): solo ROJO si hay
 *    evidencia de paquete con pendientes bajo ese nombre.
 *  - Sede inferida = predominante de la evidencia; multi-sede → degrada confianza.
 *
 * Uso: npm run proponer:aperturas   (o npx ts-node --transpile-only scripts/proponer-aperturas.ts)
 */
import { PrismaClient, Prisma } from '@prisma/client';

const prisma = new PrismaClient();

// El sistema viejo llamaba "San Isidro" a la sede actual Paz Soldán.
const ALIAS_SEDE: Record<string, string> = { 'San Isidro': 'Paz Soldán' };

function norm(s: string | null | undefined): string {
  return (s ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

const RE_OBS_NUM = [/\bs\s*(\d{1,2})\b/g, /sesi[o]?n\s*(\d{1,2})\b/g, /\b(\d{1,2})\s*(?:de|\/)\s*(\d{1,2})\b/g];

// TAMAÑO REAL del paquete escrito en la obs: "de paquete de 4 sesiones", "paquete
// de 6", "pack de 4". Manda sobre el tamaño de la familia (el nombre a veces dice
// P12 pero el paciente compró un paquete de 4).
const RE_TAMANO_OBS = /paquete\s+de\s+(\d{1,2})|pack\s+de\s+(\d{1,2})/g;

function tamanoEnObs(obsNorm: string): number | null {
  RE_TAMANO_OBS.lastIndex = 0;
  let m: RegExpExecArray | null;
  let n: number | null = null;
  while ((m = RE_TAMANO_OBS.exec(obsNorm)) !== null) {
    const v = parseInt(m[1] ?? m[2], 10);
    if (v >= 1 && v <= 12) n = v; // ignora basura (999, 500) y toma el último válido
  }
  return n;
}

function maxNumEnObs(obsNorm: string): number {
  let mx = 0;
  for (const rx of RE_OBS_NUM) {
    rx.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = rx.exec(obsNorm)) !== null) {
      const n = parseInt(m[1], 10);
      if (n >= 1 && n <= 24) mx = Math.max(mx, n);
    }
  }
  return mx;
}

interface FamiliaCargada {
  id: string;
  nombreFamilia: string;
  tipo: string;
  sesionesTotales: number | null;
  duracionMeses: number | null;
  mapeoServicio: { default?: string; porSede?: Record<string, string> } | null;
  regexes: RegExp[];
  obsKeyword: RegExp | null;
}

interface Acum {
  nums: number[];
  compra: number;
  ev2026: boolean;
  evidencia: string[]; // ids historial de la familia
  sedes: Map<string, number>; // sedeId real → conteo (solo llegadas)
  primeraFecha: string | null;
  ultimaFecha: string | null; // última sesión LLEGADA — decide qué generación está vigente
  tamanos: Map<number, number>; // tamaño real "paquete de N" leído en la obs → frecuencia
}

async function main(): Promise<void> {
  const familias = await prisma.familiaPaqueteGenexis.findMany({ where: { activa: true, deletedAt: null } });
  const sedesDb = await prisma.sede.findMany({ where: { deletedAt: null }, select: { id: true, nombre: true } });
  const sedeIdPorNombre = new Map(sedesDb.map((s) => [s.nombre, s.id]));
  const resolverSedeId = (cruda: string | null): string | null => {
    if (!cruda) return null;
    const nombre = ALIAS_SEDE[cruda] ?? cruda;
    return sedeIdPorNombre.get(nombre) ?? null;
  };

  const fams: FamiliaCargada[] = familias
    .filter((f) => f.tipo !== 'SIN_SALDO') // curaciones: solo trazabilidad, jamás deuda
    .map((f) => ({
      id: f.id,
      nombreFamilia: f.nombreFamilia,
      tipo: f.tipo,
      sesionesTotales: f.sesionesTotales,
      duracionMeses: f.duracionMeses,
      mapeoServicio: f.mapeoServicio as FamiliaCargada['mapeoServicio'],
      regexes: (f.patronesServicio as string[]).map((p) => new RegExp(p)),
      obsKeyword: ((f.patronesObs as string[] | null) ?? []).length > 0
        ? new RegExp(((f.patronesObs as string[]).join('|')))
        : null,
    }));

  console.log(`Familias con propuesta posible: ${fams.length} (SIN_SALDO excluidas)`);

  // ── Recorrido del historial (streaming por lotes para no cargar 257k de golpe) ──
  const porPacienteFamilia = new Map<string, Map<string, Acum>>(); // pacienteId → familiaId → acum
  const obsPorPaciente = new Map<string, { texto: string; id: string; fecha: string }[]>(); // solo llegadas con obs

  const PAGE = 20_000;
  let cursor: string | undefined;
  let leidas = 0;
  for (;;) {
    const filas = await prisma.historialGenexis.findMany({
      where: { deletedAt: null, pacienteId: { not: null } },
      select: { id: true, pacienteId: true, fechaCita: true, servicio: true, obsPaciente: true, obsPodologo: true, llegoPaciente: true, sede: true },
      orderBy: { id: 'asc' },
      take: PAGE,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
    });
    if (filas.length === 0) break;
    cursor = filas[filas.length - 1].id;
    leidas += filas.length;

    for (const r of filas) {
      const pid = r.pacienteId!;
      const llegoSi = r.llegoPaciente === 'Sí';
      const servicioNorm = norm(r.servicio);
      const obs = `${r.obsPaciente ?? ''} / ${r.obsPodologo ?? ''}`;
      if (llegoSi && obs.length > 4) {
        let lista = obsPorPaciente.get(pid);
        if (!lista) obsPorPaciente.set(pid, (lista = []));
        lista.push({ texto: norm(obs), id: r.id, fecha: r.fechaCita });
      }
      for (const f of fams) {
        let match: RegExpMatchArray | null = null;
        for (const rx of f.regexes) {
          match = servicioNorm.match(rx);
          if (match) break;
        }
        if (!match) continue;
        let porFam = porPacienteFamilia.get(pid);
        if (!porFam) porPacienteFamilia.set(pid, (porFam = new Map()));
        let acum = porFam.get(f.id);
        if (!acum) porFam.set(f.id, (acum = { nums: [], compra: 0, ev2026: false, evidencia: [], sedes: new Map(), primeraFecha: null, ultimaFecha: null, tamanos: new Map() }));

        acum.evidencia.push(r.id);
        // Tamaño real escrito en la obs de ESTA fila de la familia.
        const tam = tamanoEnObs(norm(obs));
        if (tam !== null) acum.tamanos.set(tam, (acum.tamanos.get(tam) ?? 0) + 1);
        const num = match[1] && /^\d+$/.test(match[1]) ? parseInt(match[1], 10) : null;
        const esCompra = num === null;
        if (llegoSi) {
          if (num !== null) acum.nums.push(num);
          const sid = resolverSedeId(r.sede);
          if (sid) acum.sedes.set(sid, (acum.sedes.get(sid) ?? 0) + 1);
          if (!acum.primeraFecha || r.fechaCita < acum.primeraFecha) acum.primeraFecha = r.fechaCita;
          if (!acum.ultimaFecha || r.fechaCita > acum.ultimaFecha) acum.ultimaFecha = r.fechaCita;
          if (r.fechaCita >= '2026-01-01') acum.ev2026 = true;
        }
        if (esCompra) {
          acum.compra += 1;
          if (r.fechaCita >= '2026-01-01') acum.ev2026 = true;
        }
        break; // una fila pertenece a UNA familia (primer match gana)
      }
    }
    if (leidas % 100_000 < PAGE) console.log(`  · leídas ${leidas} filas…`);
  }
  console.log(`Historial recorrido: ${leidas} filas\n`);

  // ── Decididas existentes (no se re-proponen) + limpieza de PENDIENTES ──
  const decididas = await prisma.conciliacionApertura.findMany({
    where: { estado: { not: 'PENDIENTE' }, deletedAt: null },
    select: { pacienteId: true, familiaId: true },
  });
  const decididaSet = new Set(decididas.map((d) => `${d.pacienteId}|${d.familiaId}`));
  const borradas = await prisma.conciliacionApertura.deleteMany({ where: { estado: 'PENDIENTE' } });
  console.log(`PENDIENTES regeneradas (borradas: ${borradas.count}; decididas intactas: ${decididas.length})`);

  // ── Resolución y propuestas ──
  const propuestas: Prisma.ConciliacionAperturaCreateManyInput[] = [];
  const resumen = { VERDE: 0, AMBAR: 0, ROJO: 0 };
  const porFamilia = new Map<string, { V: number; A: number; R: number }>();

  const hoy = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Lima' })).toISOString().slice(0, 10);

  for (const [pid, porFam] of porPacienteFamilia) {
    const obsList = obsPorPaciente.get(pid) ?? [];
    // Candidatas del paciente: se agrupan por LÍNEA DE TRATAMIENTO (servicio resuelto)
    // antes de publicarse — ver regla de generaciones más abajo.
    const candidatas: (Prisma.ConciliacionAperturaCreateManyInput & {
      _grupo: string; _ultimaFecha: string | null; _familia: string;
    })[] = [];
    for (const f of fams) {
      const acum = porFam.get(f.id);
      if (!acum || !acum.ev2026) continue; // alcance: solo evidencia 2026
      if (decididaSet.has(`${pid}|${f.id}`)) continue; // jamás re-proponer decididas

      const A = acum.nums.length > 0 ? Math.max(...acum.nums) : 0;
      const distintos = new Set(acum.nums).size;
      // Evidencia B: obs de TODAS las citas llegadas del paciente que mencionen la familia.
      let B = 0;
      const evidenciaObs: string[] = [];
      if (f.obsKeyword) {
        for (const o of obsList) {
          if (f.obsKeyword.test(o.texto)) {
            const n = maxNumEnObs(o.texto);
            if (n > 0) {
              evidenciaObs.push(o.id);
              B = Math.max(B, n);
            }
          }
        }
      }

      // Sede inferida (predominante de las llegadas de la familia).
      const sedesOrdenadas = [...acum.sedes.entries()].sort((a, b) => b[1] - a[1]);
      const sedeInferidaId = sedesOrdenadas[0]?.[0] ?? null;
      const multiSede = sedesOrdenadas.length > 1;

      // Servicio resuelto según mapeo (porSede usa la sede inferida).
      let servicioResueltoId: string | null = null;
      if (f.mapeoServicio?.porSede && sedeInferidaId) servicioResueltoId = f.mapeoServicio.porSede[sedeInferidaId] ?? null;
      else if (f.mapeoServicio?.default) servicioResueltoId = f.mapeoServicio.default;

      // TAMAÑO REAL: si la obs dijo "paquete de N", ese manda sobre el tamaño de la
      // familia. Se toma el más frecuente. Solo aplica a PAQUETE (no membresías).
      let sesionesTotalReal: number | null = null;
      if (f.tipo === 'PAQUETE' && acum.tamanos.size > 0) {
        const modo = [...acum.tamanos.entries()].sort((a, b) => b[1] - a[1])[0][0];
        if (modo !== f.sesionesTotales) sesionesTotalReal = modo; // solo si difiere del default
      }
      const tamanoEfectivo = sesionesTotalReal ?? f.sesionesTotales;

      // Resolución
      let confianza: 'VERDE' | 'AMBAR' | 'ROJO';
      let consumoPropuesto: number | null;
      let ajusteProCliente = false;
      const sinHuecos = A > 0 && distintos === A;

      if (f.tipo === 'UNITARIA') {
        // Venta unitaria: no genera saldo. Solo ROJO si la evidencia sugiere paquete
        // pagado con pendientes bajo ese nombre (numeración en nombres u obs).
        if (A === 0 && B === 0) continue;
        confianza = 'ROJO';
        consumoPropuesto = null;
      } else if (A === 0 && B === 0 && acum.compra > 0) {
        confianza = 'VERDE'; // compra clara sin consumo: saldo completo
        consumoPropuesto = 0;
      } else if (A === 0 && B === 0) {
        confianza = 'ROJO'; // indicios sin lectura numérica
        consumoPropuesto = null;
      } else if (A === B || B === 0 || sinHuecos) {
        confianza = 'VERDE';
        consumoPropuesto = Math.max(A, B);
      } else {
        confianza = 'AMBAR';
        consumoPropuesto = Math.max(Math.max(A, B) - 1, 0); // regla pro-cliente: max − 1, piso 0
        ajusteProCliente = true;
      }
      if (multiSede && confianza === 'VERDE') confianza = 'AMBAR'; // anomalía de sede degrada

      // Membresías: vigencia estimada; vencida-pero-con-consumo-2026 → flag de revisión.
      let vigenciaFinEstimada: string | null = null;
      let flagVigencia = false;
      if (f.tipo === 'MEMBRESIA' && acum.primeraFecha && f.duracionMeses) {
        const d = new Date(acum.primeraFecha + 'T12:00:00');
        d.setMonth(d.getMonth() + f.duracionMeses);
        vigenciaFinEstimada = d.toISOString().slice(0, 10);
        flagVigencia = vigenciaFinEstimada < hoy;
      }

      // Tope: el consumo propuesto nunca excede el tamaño REAL del paquete.
      if (consumoPropuesto !== null && tamanoEfectivo !== null && consumoPropuesto > tamanoEfectivo) {
        confianza = 'AMBAR';
        ajusteProCliente = true;
        consumoPropuesto = tamanoEfectivo;
      }

      candidatas.push({
        pacienteId: pid,
        familiaId: f.id,
        lecturaServicio: A || null,
        lecturaObs: B || null,
        consumoPropuesto,
        sesionesTotalReal,
        ajusteProCliente,
        confianza,
        sedeInferidaId,
        servicioResueltoId,
        vigenciaFinEstimada,
        flagVigencia,
        evidenciaIds: [...acum.evidencia, ...evidenciaObs] as unknown as Prisma.InputJsonValue,
        notas: multiSede ? `Sesiones repartidas entre ${sedesOrdenadas.length} sedes — fijar sede a mano` : null,
        _grupo: servicioResueltoId ?? `fam:${f.id}`,
        _ultimaFecha: acum.ultimaFecha,
        _familia: f.nombreFamilia,
      });
    }

    // ── REGLA DE GENERACIONES (caso Marisol): si el paciente tiene VARIAS familias
    // de la misma línea de tratamiento (mismo servicio resuelto, p. ej. P12 viejo +
    // P6 vigente de láser onicomicosis), solo la de ÚLTIMA actividad se propone
    // normal; las anteriores fueron REEMPLAZADAS → ROJO, decisión 100% humana,
    // con nota explicativa. Evita abrir deuda de paquetes que el paciente ya renovó.
    const porGrupo = new Map<string, typeof candidatas>();
    for (const c of candidatas) {
      const g = porGrupo.get(c._grupo) ?? [];
      g.push(c);
      porGrupo.set(c._grupo, g);
    }
    for (const grupo of porGrupo.values()) {
      if (grupo.length > 1) {
        const maxFecha = grupo.reduce<string | null>((m, c) => (c._ultimaFecha && (!m || c._ultimaFecha > m) ? c._ultimaFecha : m), null);
        const vigentes = grupo.filter((c) => c._ultimaFecha === maxFecha);
        for (const c of grupo) {
          if (!vigentes.includes(c)) {
            const vig = vigentes[0];
            c.confianza = 'ROJO';
            c.consumoPropuesto = null;
            c.ajusteProCliente = false;
            c.notas = [c.notas, `⚠ Posible paquete ANTERIOR ya reemplazado por ${vig._familia} (última sesión ${vig._ultimaFecha}) — NO abrir salvo confirmación del paciente`]
              .filter(Boolean)
              .join(' · ');
          } else if (grupo.length > vigentes.length) {
            c.notas = [c.notas, `Tiene ${grupo.length - vigentes.length} paquete(s) anterior(es) de la misma línea (ver propuestas ROJAS)`]
              .filter(Boolean)
              .join(' · ');
          }
        }
      }
    }

    for (const c of candidatas) {
      const { _grupo, _ultimaFecha, _familia, ...propuesta } = c;
      propuestas.push(propuesta);
      resumen[c.confianza as 'VERDE' | 'AMBAR' | 'ROJO'] += 1;
      const pf = porFamilia.get(_familia) ?? { V: 0, A: 0, R: 0 };
      if (c.confianza === 'VERDE') pf.V += 1;
      else if (c.confianza === 'AMBAR') pf.A += 1;
      else pf.R += 1;
      porFamilia.set(_familia, pf);
    }
  }

  // Insertar en lotes.
  for (let i = 0; i < propuestas.length; i += 1000) {
    await prisma.conciliacionApertura.createMany({ data: propuestas.slice(i, i + 1000) });
  }
  await prisma.auditLog.create({
    data: {
      accion: 'motor_propuestas_aperturas',
      entidad: 'conciliacion_apertura',
      entidadId: '00000000-0000-0000-0000-000000000000',
      despues: { propuestas: propuestas.length, ...resumen } as never,
    },
  });

  console.log(`\n✔ Propuestas generadas: ${propuestas.length}`);
  console.log(`  VERDE: ${resumen.VERDE} | ÁMBAR: ${resumen.AMBAR} | ROJO: ${resumen.ROJO}\n`);
  const orden = [...porFamilia.entries()].sort((a, b) => b[1].V + b[1].A + b[1].R - (a[1].V + a[1].A + a[1].R));
  for (const [nombre, c] of orden) console.log(`  ${nombre.padEnd(28)} V:${c.V}  A:${c.A}  R:${c.R}`);
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e instanceof Error ? e.stack : e);
    await prisma.$disconnect();
    process.exit(1);
  });
