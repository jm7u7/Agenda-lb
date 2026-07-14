import { useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { composicionSedeApi, type PersonaRoster, type SedeComposicion } from '../../api/composicionSede';
import { useAuthStore } from '../../stores/authStore';

// Los cargos son las filas de la matriz. El color codifica el rol (sistema de color del documento):
// un lomo saturado en el riel de la izquierda + un tinte muy tenue en las celdas de esa fila.
const CARGOS = [
  { key: 'recepcionistas',  label: 'Recepción',    role: '#3F7A5E', tint: '#F1F7F4', rail: '#E4EFE9', num: '#356A51' },
  { key: 'doctores',        label: 'Doctores',     role: '#9A6B2F', tint: '#FAF6EF', rail: '#F4EBDA', num: '#83591F' },
  { key: 'fisioterapeutas', label: 'Fisioterapia', role: '#4B4E8A', tint: '#F2F3F9', rail: '#E7E8F3', num: '#3E4179' },
  { key: 'podologas',       label: 'Podología',    role: '#1E6E9E', tint: '#EFF6FA', rail: '#E1EFF6', num: '#155B85' },
] as const;

function mesActualISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

// Los nombres llegan con mayúsculas inconsistentes (unos en Título, otros en MAYÚSCULA).
// Normalizamos a Título respetando las partículas ("de", "del", "la"…) para una tipografía uniforme.
const PARTICULAS = new Set(['de', 'del', 'la', 'las', 'los', 'y', 'e', 'da', 'do', 'van', 'von']);
function tituloNombre(s: string): string {
  return s.trim().toLowerCase().split(/\s+/).map((w, i) =>
    i > 0 && PARTICULAS.has(w) ? w : w.charAt(0).toUpperCase() + w.slice(1)
  ).join(' ');
}

// Nota de vigencia cuando la persona NO está el mes completo; null = cubre todo el mes (sin nota).
function vigencia(p: PersonaRoster, ultimoDia: number): string | null {
  const d1 = parseInt(p.desde.slice(0, 2), 10);
  const d2 = parseInt(p.hasta.slice(0, 2), 10);
  if (p.indefinido) return d1 === 1 ? null : `desde el ${d1}`;
  if (d1 === 1 && d2 === ultimoDia) return null;
  if (d1 === d2) return `solo el ${d1}`;
  return `del ${d1} al ${d2}`;
}

const CSS = `
:root {
  --paper:#E9EEF3; --doc:#FFFFFF;
  --ink:#0E2233; --ink-2:#31465A; --body:#283A49;
  --muted:#788894; --faint:#A9B5C0;
  --line:#E4EAEF; --line-2:#EEF2F6;
  --jade:#0E9C88; --jade-deep:#0A7D6E; --jade-tint:#E6F5F1; --jade-soft:#63C7B7;
}
@page { size: A4 landscape; margin: 8mm; }

.dp-shell { background: var(--paper); min-height: 100vh; padding: 26px 18px 56px;
  font-family: 'Inter', system-ui, -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
  color: var(--body); -webkit-font-smoothing: antialiased; }

.dp-toolbar { max-width: 1180px; margin: 0 auto 18px; display: flex; align-items: center; justify-content: space-between; gap: 12px; }
.dp-hint { font-size: 12.5px; color: var(--muted); }
.dp-hint b { color: var(--ink-2); font-weight: 600; }
.dp-btns { display: flex; gap: 8px; }
.dp-btn { border: 1px solid #CBD5DE; background: #fff; border-radius: 9px; padding: 9px 17px; font-size: 12.5px; font-weight: 500; cursor: pointer; color: #3A4C5C; transition: background .12s, border-color .12s; }
.dp-btn:hover { background: #F4F7F9; }
.dp-btn-primary { background: var(--ink); border-color: var(--ink); color: #fff; }
.dp-btn-primary:hover { background: #163247; }

/* ── documento ── */
.dp-doc { max-width: 1180px; margin: 0 auto; background: var(--doc); border-radius: 5px;
  box-shadow: 0 18px 48px rgba(14,34,51,.14), 0 2px 6px rgba(14,34,51,.06); overflow: hidden;
  -webkit-print-color-adjust: exact; print-color-adjust: exact; }

/* ── masthead ── */
.dp-mast { position: relative; background: var(--ink); color: #fff; padding: 13px 28px 13px;
  display: flex; align-items: flex-end; justify-content: space-between; gap: 24px; }
.dp-mast::after { content:''; position:absolute; left:0; right:0; bottom:0; height:3px;
  background: linear-gradient(90deg, var(--jade) 0%, var(--jade) 34%, var(--jade-soft) 100%); }
/* Lockup horizontal: logo del login a la izquierda + título a la derecha. */
.dp-mast-l { display: flex; align-items: center; gap: 16px; }
/* Logo del login (blanco sobre transparente) recortado por CSS a su marca visible —
   bbox medido en el PNG 4500²: x 345..4154, y 1125..3306. Escala a 56px de alto. */
.dp-logo { width: 98px; height: 56px; overflow: hidden; flex-shrink: 0; }
/* max-width:none anula el reset de Tailwind (img{max-width:100%}) que si no comprime el ancho
   al del contenedor y deforma el logo. El img debe quedar CUADRADO (116×116) para no estirarse. */
.dp-logo img { width: 116px; height: 116px; max-width: none; margin: -28.9px 0 0 -8.9px; display: block; }
.dp-title { margin: 0; font-family: 'Fraunces', Georgia, serif; font-optical-sizing: auto;
  font-weight: 500; font-size: 28px; line-height: 1.02; letter-spacing: -.01em; color: #fff; }
.dp-mast-r { text-align: right; flex-shrink: 0; }
.dp-period-lbl { font-size: 8.5px; letter-spacing: .26em; text-transform: uppercase; color: #7E93A5; }
.dp-period-val { font-family: 'Fraunces', Georgia, serif; font-optical-sizing: auto; font-weight: 500;
  font-size: 22px; line-height: 1.05; color: #fff; text-transform: capitalize; margin-top: 1px; }
.dp-summary { margin-top: 5px; font-size: 10px; color: #A6B8C6; letter-spacing: .01em; }
.dp-summary b { color: #fff; font-weight: 600; }

/* ── matriz ── */
.dp-grid { width: 100%; border-collapse: collapse; table-layout: fixed; }
.dp-grid th, .dp-grid td { vertical-align: top; }

.dp-corner { width: 104px; background: #F6F9FB; border-bottom: 2px solid var(--ink); border-right: 1px solid var(--line);
  vertical-align: bottom; padding: 0 0 7px 13px; }
.dp-corner span { font-size: 8.5px; letter-spacing: .2em; text-transform: uppercase; color: var(--faint); font-weight: 600; }

.dp-sede { background: #fff; border-bottom: 2px solid var(--ink); border-right: 1px solid var(--line);
  text-align: center; padding: 9px 8px 8px; }
.dp-sede:last-child { border-right: 0; }
.dp-sede-nom { display: block; font-family: 'Fraunces', Georgia, serif; font-optical-sizing: auto;
  font-weight: 500; font-size: 13.5px; line-height: 1.08; color: var(--ink); letter-spacing: .002em; }
.dp-sede-cnt { display: inline-block; margin-top: 4px; font-size: 8px; letter-spacing: .11em; text-transform: uppercase;
  color: var(--ink-2); font-weight: 600; background: #F1F5F8; border-radius: 20px; padding: 1.5px 8px; }

/* riel de cargos (izquierda) */
.dp-rail { width: 104px; border-bottom: 1px solid var(--line); border-right: 1px solid var(--line);
  padding: 7px 8px 7px 12px; position: relative; }
.dp-rail::before { content:''; position:absolute; left:0; top:0; bottom:0; width:4px; background: var(--role); }
.dp-rail-nom { display: flex; align-items: center; gap: 6px; font-size: 9.5px; font-weight: 600; letter-spacing: .04em;
  text-transform: uppercase; color: var(--ink); line-height: 1.12; }
.dp-rail-dot { width: 7px; height: 7px; border-radius: 50%; background: var(--role); flex-shrink: 0; }
.dp-rail-cnt { margin-top: 3px; margin-left: 13px; font-size: 14px; font-weight: 600; color: var(--role);
  font-variant-numeric: tabular-nums; line-height: 1; }
.dp-rail-cnt small { font-size: 7.5px; font-weight: 500; color: var(--muted); letter-spacing: .04em; margin-left: 3px; }

/* celdas de personas */
.dp-cell { border-bottom: 1px solid var(--line); border-right: 1px solid var(--line-2);
  padding: 6px 8px 6px; background: var(--tint); }
.dp-cell:last-child { border-right: 0; }
.dp-list { list-style: none; margin: 0; padding: 0; counter-reset: dp; }
.dp-list li { counter-increment: dp; position: relative; padding-left: 14px; margin-bottom: 1.5px; line-height: 1.2; }
.dp-list li:last-child { margin-bottom: 0; }
.dp-list li::before { content: counter(dp); position: absolute; left: 0; top: .5px; width: 11px;
  font-size: 7px; font-weight: 600; color: var(--role); font-variant-numeric: tabular-nums; text-align: left; }
.dp-name { font-size: 8.5px; font-weight: 500; color: var(--body); letter-spacing: .002em; }
.dp-pill { display: inline-block; margin-left: 5px; padding: .5px 5.5px 1px; border-radius: 20px;
  background: var(--jade-tint); color: var(--jade-deep); font-size: 7px; font-weight: 600;
  letter-spacing: .01em; white-space: nowrap; vertical-align: .5px; }
.dp-empty { font-size: 9px; color: var(--faint); }

/* ── pie ── */
.dp-foot { display: flex; align-items: center; justify-content: space-between; gap: 16px;
  padding: 8px 28px 9px; border-top: 1px solid var(--line-2); }
.dp-legend { display: flex; align-items: center; gap: 14px; font-size: 8.5px; color: var(--muted); flex-wrap: wrap; }
.dp-legend-item { display: inline-flex; align-items: center; gap: 5px; }
.dp-legend .dp-pill { margin: 0; }
.dp-range { font-size: 8.5px; color: var(--faint); letter-spacing: .04em; font-variant-numeric: tabular-nums; white-space: nowrap; }

.dp-state { max-width: 640px; margin: 90px auto; text-align: center; color: var(--muted); font-size: 15px; }

@media print {
  .dp-shell { background: #fff; padding: 0; min-height: 0; }
  .dp-toolbar { display: none; }
  .dp-doc { max-width: none; margin: 0; border-radius: 0; box-shadow: none; }
  html, body { background: #fff; }
  .dp-doc, .dp-mast, .dp-sede, .dp-rail, .dp-cell, .dp-sede-cnt, .dp-pill, .dp-rail-dot, .dp-mast::after, .dp-rail::before {
    -webkit-print-color-adjust: exact; print-color-adjust: exact; }
}
`;

export function ComposicionImprimirPage() {
  const [params] = useSearchParams();
  const mes = /^\d{4}-\d{2}$/.test(params.get('mes') ?? '') ? params.get('mes')! : mesActualISO();
  const token = useAuthStore(s => s.token);

  const { data: comp, isLoading, isError } = useQuery({
    queryKey: ['composicion-imprimir', mes],
    queryFn: () => composicionSedeApi.composicion(mes),
    enabled: !!token,
  });

  const ultimoDia = useMemo(() => {
    const [y, m] = mes.split('-').map(Number);
    return new Date(Date.UTC(y!, m!, 0)).getUTCDate();
  }, [mes]);

  const resumen = useMemo(() => {
    if (!comp) return { personas: 0, sedes: 0, especialidades: 0 };
    const personas = comp.sedes.reduce(
      (n, s) => n + s.podologas.length + s.fisioterapeutas.length + s.doctores.length + s.recepcionistas.length, 0);
    const especialidades = CARGOS.filter(c => comp.sedes.some(s => (s[c.key] as PersonaRoster[]).length > 0)).length;
    return { personas, sedes: comp.sedes.length, especialidades };
  }, [comp]);

  if (!token) return <div className="dp-shell"><div className="dp-state">Inicia sesión en el sistema para ver este documento.</div></div>;

  return (
    <div className="dp-shell">
      <style>{CSS}</style>

      <div className="dp-toolbar">
        <span className="dp-hint">Vista de impresión — usa <b>Imprimir → Guardar como PDF</b>, en horizontal, cabe en una hoja.</span>
        <div className="dp-btns">
          <button className="dp-btn" onClick={() => window.close()}>Cerrar</button>
          <button className="dp-btn dp-btn-primary" onClick={() => window.print()}>Imprimir / Guardar PDF</button>
        </div>
      </div>

      {isLoading ? (
        <div className="dp-state">Preparando el cuadro…</div>
      ) : isError || !comp ? (
        <div className="dp-state">No se pudo cargar la composición. Reintenta desde la herramienta.</div>
      ) : (
        <div className="dp-doc">
          <div className="dp-mast">
            <div className="dp-mast-l">
              <div className="dp-logo"><img src="/logo-login.png" alt="Limablue" /></div>
              <h1 className="dp-title">Distribución de personal</h1>
            </div>
            <div className="dp-mast-r">
              <div className="dp-period-lbl">Periodo</div>
              <div className="dp-period-val">{comp.mesLabel}</div>
              <div className="dp-summary">
                <b>{resumen.personas}</b> personas · <b>{resumen.sedes}</b> sedes · <b>{resumen.especialidades}</b> especialidades
              </div>
            </div>
          </div>

          <table className="dp-grid">
            <thead>
              <tr>
                <th className="dp-corner"><span>Cargo</span></th>
                {comp.sedes.map((s: SedeComposicion) => {
                  const total = s.podologas.length + s.fisioterapeutas.length + s.doctores.length + s.recepcionistas.length;
                  return (
                    <th key={s.sedeId} className="dp-sede">
                      <span className="dp-sede-nom">{s.nombre}</span>
                      <span className="dp-sede-cnt">{total} {total === 1 ? 'persona' : 'personas'}</span>
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {CARGOS.map(cargo => {
                const totalCargo = comp.sedes.reduce((n, s) => n + (s[cargo.key] as PersonaRoster[]).length, 0);
                const vars = { ['--role' as string]: cargo.role, ['--tint' as string]: cargo.tint };
                return (
                  <tr key={cargo.key}>
                    <th className="dp-rail" style={{ ['--role' as string]: cargo.role, background: cargo.rail }}>
                      <div className="dp-rail-nom"><span className="dp-rail-dot" />{cargo.label}</div>
                      <div className="dp-rail-cnt">{totalCargo}<small>{totalCargo === 1 ? 'persona' : 'personas'}</small></div>
                    </th>
                    {comp.sedes.map(s => {
                      const gente = s[cargo.key] as PersonaRoster[];
                      return (
                        <td key={s.sedeId} className="dp-cell" style={vars}>
                          {gente.length === 0 ? (
                            <span className="dp-empty">—</span>
                          ) : (
                            <ol className="dp-list">
                              {gente.map((p, i) => {
                                const vig = vigencia(p, ultimoDia);
                                return (
                                  <li key={`${p.id}-${i}`}>
                                    <span className="dp-name">{tituloNombre(p.nombre)}</span>
                                    {vig && <span className="dp-pill">{vig}</span>}
                                  </li>
                                );
                              })}
                            </ol>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>

          <div className="dp-foot">
            <div className="dp-legend">
              <span className="dp-legend-item">Sin etiqueta junto al nombre = <b style={{ color: 'var(--ink-2)', fontWeight: 600 }}>todo el mes</b> en la sede.</span>
              <span className="dp-legend-item"><span className="dp-pill">del 1 al 15</span> = solo esos días del mes.</span>
            </div>
            <span className="dp-range">{comp.inicio} — {comp.fin}</span>
          </div>
        </div>
      )}
    </div>
  );
}
