import { useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { format, parseISO } from 'date-fns';
import { es } from 'date-fns/locale';
import { citasApi, type CitaResumen } from '../../api/citas';
import { sedesApi } from '../../api';
import { useAuthStore } from '../../stores/authStore';

function hoyISO() { return format(new Date(), 'yyyy-MM-dd'); }
const esImagen = (mime: string | null) => !mime || mime.startsWith('image/');
// La URL guardada es absoluta (http://…:3002/uploads/…). La volvemos RELATIVA para servirla
// same-origin por el proxy /uploads → funciona en localhost y en la nube por igual.
function urlRelativa(u: string): string {
  try { const p = new URL(u, window.location.origin); return p.pathname + p.search; } catch { return u; }
}

const CSS = `
:root { --ink:#0E2233; --muted:#7A8794; --line:#E4EAEF; --jade:#0E9C88; }
@page { size: A4 portrait; margin: 7mm; }
.cp-shell { background:#E9EEF3; min-height:100vh; padding:22px 16px 48px;
  font-family:'Inter',system-ui,-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif; color:var(--ink); }
.cp-toolbar { max-width:820px; margin:0 auto 14px; display:flex; align-items:center; justify-content:space-between; gap:12px; }
.cp-hint { font-size:12.5px; color:var(--muted); }
.cp-hint b { color:#31465A; font-weight:600; }
.cp-btns { display:flex; gap:8px; }
.cp-btn { border:1px solid #CBD5DE; background:#fff; border-radius:9px; padding:9px 17px; font-size:12.5px; font-weight:500; cursor:pointer; color:#3A4C5C; }
.cp-btn-primary { background:var(--ink); border-color:var(--ink); color:#fff; }

/* ── documento (una hoja A4) ── */
.cp-doc { max-width:820px; margin:0 auto; background:#fff; border-radius:4px;
  box-shadow:0 14px 40px rgba(14,34,51,.13); overflow:hidden;
  aspect-ratio:210/297; display:flex; flex-direction:column;
  -webkit-print-color-adjust:exact; print-color-adjust:exact; }
.cp-head { flex-shrink:0; display:flex; align-items:baseline; justify-content:space-between; gap:16px;
  padding:12px 16px 10px; border-bottom:2px solid var(--ink); }
.cp-head-l .cp-eyebrow { font-size:9px; letter-spacing:.24em; text-transform:uppercase; color:var(--jade); font-weight:700; }
.cp-head-l h1 { margin:2px 0 0; font-size:16px; font-weight:700; color:var(--ink); letter-spacing:-.01em; }
.cp-head-r { text-align:right; }
.cp-head-r .cp-sede { font-size:13px; font-weight:700; color:var(--ink); }
.cp-head-r .cp-fecha { font-size:11px; color:var(--muted); text-transform:capitalize; }
.cp-head-r .cp-cont { font-size:10px; color:var(--jade); font-weight:700; margin-top:1px; }

/* grid auto-adaptable: --cols se calcula por cantidad; filas iguales que llenan la hoja */
.cp-grid { flex:1; min-height:0; display:grid; grid-template-columns:repeat(var(--cols),1fr);
  grid-auto-rows:1fr; gap:3mm; padding:4mm; }
.cp-cell { min-width:0; min-height:0; display:flex; flex-direction:column; border:1px solid var(--line);
  border-radius:4px; overflow:hidden; background:#fff; }
.cp-cell img { flex:1; min-height:0; width:100%; object-fit:contain; background:#F7F9FB; }
.cp-cell .cp-pdf { flex:1; min-height:0; display:flex; flex-direction:column; align-items:center; justify-content:center;
  gap:4px; background:#F7F9FB; color:var(--muted); font-size:10px; text-align:center; padding:6px; }
.cp-cap { flex-shrink:0; padding:2px 5px; border-top:1px solid var(--line); font-size:8px; line-height:1.25;
  color:#31465A; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.cp-cap b { font-variant-numeric:tabular-nums; }

.cp-empty { flex:1; display:flex; align-items:center; justify-content:center; color:#A9B5C0; font-size:14px; }
.cp-state { max-width:640px; margin:80px auto; text-align:center; color:var(--muted); font-size:15px; }

@media print {
  .cp-shell { background:#fff; padding:0; min-height:0; }
  .cp-toolbar { display:none; }
  .cp-doc { max-width:none; margin:0; border-radius:0; box-shadow:none; height:100vh; aspect-ratio:auto; }
  html, body { background:#fff; height:100%; }
}
`;

export function ComprobantesImprimirPage() {
  const [params] = useSearchParams();
  const sedeId = params.get('sede') ?? '';
  const fecha = /^\d{4}-\d{2}-\d{2}$/.test(params.get('fecha') ?? '') ? params.get('fecha')! : hoyISO();
  const token = useAuthStore(s => s.token);

  const { data: sedes } = useQuery({ queryKey: ['sedes'], queryFn: sedesApi.listar, enabled: !!token });
  const { data: citas, isLoading, isError } = useQuery({
    queryKey: ['comprobantes-imprimir', sedeId, fecha],
    queryFn: () => citasApi.listar({ sedeId, fecha }),
    enabled: !!token && !!sedeId,
  });

  // Solo citas con comprobante subido, ordenadas por hora.
  const comprobantes = useMemo(
    () => (citas ?? []).filter((c: CitaResumen) => !!c.comprobanteUrl).sort((a, b) => a.horaInicio.localeCompare(b.horaInicio)),
    [citas],
  );

  // Columnas según cantidad → todo entra SIEMPRE en una sola hoja (las filas se reparten
  // el alto de la página; la imagen se adapta con object-fit:contain sin importar su tamaño).
  const cols = Math.max(1, Math.ceil(Math.sqrt(comprobantes.length)));

  const sedeNombre = sedes?.find(s => s.id === sedeId)?.nombre ?? comprobantes[0]?.sede?.nombre ?? '—';
  const fechaLabel = format(parseISO(fecha), "EEEE d 'de' MMMM 'de' yyyy", { locale: es });

  if (!token) return <div className="cp-shell"><div className="cp-state">Inicia sesión en el sistema para ver este documento.</div></div>;

  return (
    <div className="cp-shell">
      <style>{CSS}</style>

      <div className="cp-toolbar">
        <span className="cp-hint">Cierre del día — <b>Imprimir → Guardar como PDF</b> o imprimir. Todo entra en una hoja.</span>
        <div className="cp-btns">
          <button className="cp-btn" onClick={() => window.close()}>Cerrar</button>
          <button className="cp-btn cp-btn-primary" onClick={() => window.print()}>Imprimir comprobantes</button>
        </div>
      </div>

      {isLoading ? (
        <div className="cp-state">Cargando comprobantes…</div>
      ) : isError ? (
        <div className="cp-state">No se pudieron cargar los comprobantes. Reintenta desde la agenda.</div>
      ) : (
        <div className="cp-doc">
          <div className="cp-head">
            <div className="cp-head-l">
              <div className="cp-eyebrow">limablue · cierre de caja</div>
              <h1>Comprobantes de pago</h1>
            </div>
            <div className="cp-head-r">
              <div className="cp-sede">{sedeNombre}</div>
              <div className="cp-fecha">{fechaLabel}</div>
              <div className="cp-cont">{comprobantes.length} comprobante{comprobantes.length === 1 ? '' : 's'}</div>
            </div>
          </div>

          {comprobantes.length === 0 ? (
            <div className="cp-empty">No hay comprobantes subidos para este día.</div>
          ) : (
            <div className="cp-grid" style={{ ['--cols' as string]: cols }}>
              {comprobantes.map((c) => {
                const nombre = `${c.paciente.nombres.split(' ')[0]} ${c.paciente.apellidoPaterno}`.trim();
                return (
                  <div key={c.id} className="cp-cell">
                    {esImagen(c.comprobanteMimeType) ? (
                      <img src={urlRelativa(c.comprobanteUrl!)} alt={`Comprobante ${nombre}`} loading="eager" />
                    ) : (
                      <div className="cp-pdf">
                        <span style={{ fontSize: 18 }}>📄</span>
                        <span>{c.comprobanteNombre ?? 'Archivo'} (no es imagen)</span>
                      </div>
                    )}
                    <div className="cp-cap"><b>{c.horaInicio}</b> · {nombre}</div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
