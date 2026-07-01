/**
 * Genera un "día como hoy" con citas demo a ~60% de ocupación en TODAS las sedes
 * y TODOS los negocios. Inserta directo en la BD (no por la API) para NO disparar
 * correos de confirmación. Respeta horario por profesional (con override de entrada),
 * almuerzos/permisos, regla de hora entera (servicios de 60 min solo en :00) y
 * anti-doble-booking (slots no solapados por profesional).
 *
 * Uso:  [TARGET=0.6] [DRY_RUN=1] npx ts-node --transpile-only scripts/generar-dia-demo.ts
 */
import { prisma } from '../src/db';

const TARGET = Number(process.env.TARGET ?? 0.6);   // ocupación objetivo (fracción de tiempo)
const DRY = process.env.DRY_RUN === '1';
const STEP = 30;                                     // rejilla en minutos

const toMin = (hhmm: string) => { const [h, m] = hhmm.split(':').map(Number); return h * 60 + m; };
const toHHMM = (min: number) => `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;
const pick = <T>(a: T[]) => a[Math.floor(Math.random() * a.length)];

async function main() {
  const hoyLima = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Lima' }));
  const iso = `${hoyLima.getFullYear()}-${String(hoyLima.getMonth() + 1).padStart(2, '0')}-${String(hoyLima.getDate()).padStart(2, '0')}`;
  const dow = hoyLima.getDay();                       // 3 = miércoles
  const nowMin = hoyLima.getHours() * 60 + hoyLima.getMinutes();  // hora actual (Lima), para estados realistas
  const fechaDb = new Date(iso + 'T12:00:00');
  const fechaDateOnly = new Date(iso + 'T00:00:00');
  console.log(`📅 Día: ${iso} (diaSemana=${dow}) · objetivo ocupación ${(TARGET * 100).toFixed(0)}% · ${DRY ? 'DRY-RUN' : 'ESCRIBE EN BD'}`);

  if (dow === 0) { console.log('Es domingo: no hay atención. Nada que generar.'); return; }

  // Limpia las citas de hoy (demo) para partir de cero.
  const ini = new Date(iso + 'T00:00:00'), fin = new Date(iso + 'T23:59:59');
  const prev = await prisma.cita.count({ where: { fecha: { gte: ini, lte: fin } } });
  if (!DRY && prev > 0) { await prisma.cita.deleteMany({ where: { fecha: { gte: ini, lte: fin } } }); }
  console.log(`🧹 Citas previas de hoy: ${prev}${DRY ? ' (no borradas, dry-run)' : ' eliminadas'}`);

  const sedes = await prisma.sede.findMany({ where: { deletedAt: null, activa: true }, select: { id: true, nombre: true } });
  const unidades = await prisma.unidadNegocio.findMany({ where: { deletedAt: null, activa: true }, select: { id: true, nombre: true, modoReserva: true } });
  const servicios = await prisma.servicio.findMany({ where: { deletedAt: null, activo: true }, select: { id: true, nombre: true, duracionMinutos: true, unidadNegocioId: true } });
  const servPorUnidad = new Map<string, typeof servicios>();
  for (const s of servicios) { const a = servPorUnidad.get(s.unidadNegocioId) ?? []; a.push(s); servPorUnidad.set(s.unidadNegocioId, a); }

  const pacientes = (await prisma.paciente.findMany({ where: { deletedAt: null }, select: { id: true } })).map(p => p.id);
  if (!pacientes.length) { console.log('No hay pacientes; aborta.'); return; }

  const citas: any[] = [];
  const ocupadoPorProf = new Map<string, Array<[number, number]>>();  // evita solapes del mismo profesional entre negocios (ej. Daniel)
  const solapa = (profId: string, a: number, b: number) => (ocupadoPorProf.get(profId) ?? []).some(([x, y]) => a < y && b > x);
  let totalProfs = 0;
  const resumen: Record<string, { profs: number; citas: number; cellsLibres: number; cellsOcup: number }> = {};

  for (const sede of sedes) {
    for (const u of unidades) {
      const servsU = (servPorUnidad.get(u.id) ?? []);
      if (!servsU.length) continue;
      const servIds = new Set(servsU.map(s => s.id));
      const key = `${sede.nombre} · ${u.nombre}`;
      resumen[key] = { profs: 0, citas: 0, cellsLibres: 0, cellsOcup: 0 };

      // Profesionales elegibles: asignación activa vigente en esta sede + competencia activa a algún servicio de la unidad.
      const profs = await prisma.profesional.findMany({
        where: {
          deletedAt: null, activo: true,
          asignaciones: { some: { sedeId: sede.id, activa: true, fechaInicio: { lte: fechaDb }, OR: [{ fechaFin: null }, { fechaFin: { gte: fechaDateOnly } }] } },
          competencias: { some: { activa: true, servicioId: { in: [...servIds] } } },
        },
        select: {
          id: true,
          horarios: { where: { diaSemana: dow, activo: true }, select: { horaInicio: true, horaFin: true } },
          competencias: { where: { activa: true, servicioId: { in: [...servIds] } }, select: { servicioId: true } },
          bloqueos: { where: { deletedAt: null, tipo: { in: ['ALMUERZO', 'PERMISO', 'CAPACITACION'] } }, select: { tipo: true, esRecurrente: true, horaInicio: true, horaFin: true, fechaInicio: true, fechaFin: true } },
          entradas: { where: { fecha: fechaDateOnly }, select: { horaInicio: true } },
        },
      });

      for (const p of profs) {
        const horario = p.horarios[0];
        if (!horario) continue;                       // no trabaja hoy
        const servProf = servsU.filter(s => p.competencias.some(c => c.servicioId === s.id));
        if (!servProf.length) continue;

        let winStart = toMin(horario.horaInicio);
        const winEnd = toMin(horario.horaFin);
        if (p.entradas[0]?.horaInicio) winStart = toMin(p.entradas[0].horaInicio);  // override entrada (8/9am)

        // Bloqueos del día (almuerzo recurrente + permisos/capacitaciones que cubren hoy).
        const bloques: Array<[number, number]> = [];
        for (const b of p.bloqueos) {
          if (b.esRecurrente) {
            if (b.horaInicio && b.horaFin) bloques.push([toMin(b.horaInicio), toMin(b.horaFin)]);
          } else if (b.fechaInicio <= fin && b.fechaFin >= ini) {
            const hi = b.horaInicio ? toMin(b.horaInicio) : 0;
            const hf = b.horaFin ? toMin(b.horaFin) : 24 * 60;
            bloques.push([hi, hf]);
          }
        }
        const cellBloqueada = (start: number) => bloques.some(([a, c]) => start < c && start + STEP > a);

        // Rejilla de celdas libres (30 min).
        const cells: number[] = [];
        for (let t = winStart; t + STEP <= winEnd; t += STEP) if (!cellBloqueada(t)) cells.push(t);
        if (!cells.length) continue;
        totalProfs++; resumen[key].profs++; resumen[key].cellsLibres += cells.length;

        const dur30 = servProf.filter(s => s.duracionMinutos === 30);
        const dur60 = servProf.filter(s => s.duracionMinutos === 60);

        // Patrón 3-de-5 (60%) sobre la secuencia de celdas libres; mezcla 30/60 min.
        const occupy = Math.round(cells.length * TARGET);
        let used = 0; let i = 0;
        while (i < cells.length && used < occupy) {
          const phase = i % 5;                         // 0..2 = reservar, 3..4 = dejar libre
          if (phase < 3) {
            const start = cells[i];
            const contiguo = i + 1 < cells.length && cells[i + 1] === start + STEP && (i + 1) % 5 < 3;
            const puede60 = dur60.length && start % 60 === 0 && contiguo && used + 2 <= occupy;
            const hacer60 = puede60 && Math.random() < 0.45;
            const serv = hacer60 ? pick(dur60) : (dur30.length ? pick(dur30) : pick(servProf));
            const dur = serv.duracionMinutos;
            // Verifica que cabe y no choca con bloqueo (para 60 min, la 2ª celda).
            const cabe = start + dur <= winEnd && (dur !== 60 || (start % 60 === 0 && !cellBloqueada(start + 30))) && !solapa(p.id, start, start + dur);
            if (cabe) {
              // Estado relativo a AHORA: lo ya terminado = completada (no "llegó" en el pasado, que dispararía
              // el auto-completado en masa); lo que está en curso = en atención/llegó; lo futuro = agendada/confirmada.
              const finCita = start + dur;
              const estado = finCita <= nowMin ? (Math.random() < 0.06 ? 'no_show' : 'completada')
                : start <= nowMin ? pick(['en_atencion', 'llego'])
                : pick(['agendada', 'agendada', 'confirmada']);
              citas.push({
                pacienteId: pick(pacientes), profesionalId: p.id, sedeId: sede.id, unidadNegocioId: u.id, servicioId: serv.id,
                fecha: fechaDb, horaInicio: toHHMM(start), duracionMinutos: dur, estado,
                canal: pick(['recepcion', 'recepcion', 'recepcion', 'whatsapp', 'web']),
                origenAsignacion: u.modoReserva === 'sin_eleccion' ? 'asignada_automaticamente' : 'elegida_por_paciente',
                estadoConfirmacion: estado === 'confirmada' ? 'confirmada' : 'pendiente',
              });
              (ocupadoPorProf.get(p.id) ?? ocupadoPorProf.set(p.id, []).get(p.id)!).push([start, start + dur]);
              resumen[key].citas++; resumen[key].cellsOcup += dur / STEP;
              used += dur / STEP; i += dur / STEP; continue;
            }
          }
          i++;
        }
      }
    }
  }

  // Insertar.
  let creadas = 0;
  if (!DRY) { const r = await prisma.cita.createMany({ data: citas }); creadas = r.count; }
  else creadas = citas.length;

  // Reporte.
  let libres = 0, ocup = 0;
  console.log('\n  Sede · Negocio                         profs  citas   ocupación');
  for (const k of Object.keys(resumen).sort()) {
    const r = resumen[k]; if (!r.profs) continue;
    libres += r.cellsLibres; ocup += r.cellsOcup;
    const pct = r.cellsLibres ? (r.cellsOcup / r.cellsLibres * 100) : 0;
    console.log(`  ${k.padEnd(38)} ${String(r.profs).padStart(4)} ${String(r.citas).padStart(6)}   ${pct.toFixed(0)}%`);
  }
  console.log(`\n✅ ${DRY ? '[DRY] ' : ''}${creadas} citas en ${totalProfs} profesionales · ocupación global ${(ocup / libres * 100).toFixed(1)}%`);
}

main().then(() => prisma.$disconnect()).catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
