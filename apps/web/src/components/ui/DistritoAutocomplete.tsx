// ─── Autocomplete de DISTRITO de residencia (UBIGEO) + PAÍS para extranjeros ───
// Un solo campo con búsqueda tipográfica 100% local (catálogo en el bundle) +
// chips de distritos frecuentes. El valor del formulario es SIEMPRE el código
// (ubigeoId de 6 dígitos / ISO-2 de país), nunca el nombre como texto libre.
// Reutilizado por el drawer de creación y la ficha de edición del paciente.
import { useMemo, useRef, useState, useId } from 'react';
import { useQuery } from '@tanstack/react-query';
import { PAISES, normalizarBusqueda, UBIGEO_EXTRANJERO, type Pais } from '@limablue/shared';
import { pacientesApi } from '../../api';
import { cn } from '../../utils/cn';
import {
  buscarDistritos, etiquetaDistrito, DISTRITOS_POR_ID, OPCIONES_ESPECIALES, CHIPS_FALLBACK,
  type DistritoUbigeo,
} from '../../data/ubigeo';

// ── Combobox base: input + dropdown con teclado y ARIA. Genérico y sin estado
//    de datos: recibe las opciones ya buscadas y reporta la selección. ─────────
interface Opcion { id: string; principal: string; secundaria?: string; especial?: boolean }

function ComboboxBase({ opciones, onSeleccionar, consulta, setConsulta, placeholder, inputRef, listboxId }: {
  opciones: Opcion[];
  onSeleccionar: (id: string) => void;
  consulta: string;
  setConsulta: (q: string) => void;
  placeholder: string;
  inputRef: React.MutableRefObject<HTMLInputElement | null>;
  listboxId: string;
}) {
  const [abierto, setAbierto] = useState(false);
  const [activo, setActivo] = useState(0);
  const visibles = abierto && opciones.length > 0;

  const elegir = (id: string) => {
    onSeleccionar(id);
    setConsulta('');
    setAbierto(false);
  };

  return (
    <div className="relative">
      <input
        ref={inputRef}
        role="combobox"
        aria-expanded={visibles}
        aria-controls={listboxId}
        aria-activedescendant={visibles ? `${listboxId}-${activo}` : undefined}
        aria-autocomplete="list"
        className="input text-sm w-full"
        placeholder={placeholder}
        value={consulta}
        onChange={(e) => { setConsulta(e.target.value); setAbierto(true); setActivo(0); }}
        onFocus={() => setAbierto(true)}
        onBlur={() => setTimeout(() => setAbierto(false), 150)} // deja pasar el click en la opción
        onKeyDown={(e) => {
          if (!visibles) return;
          if (e.key === 'ArrowDown') { e.preventDefault(); setActivo((a) => Math.min(a + 1, opciones.length - 1)); }
          else if (e.key === 'ArrowUp') { e.preventDefault(); setActivo((a) => Math.max(a - 1, 0)); }
          else if (e.key === 'Enter') { e.preventDefault(); const o = opciones[activo]; if (o) elegir(o.id); }
          else if (e.key === 'Escape') { setAbierto(false); }
        }}
      />
      {visibles && (
        <ul
          id={listboxId}
          role="listbox"
          className="absolute z-30 mt-1 w-full max-h-64 overflow-y-auto bg-white border border-slate-200 rounded-lg shadow-lg py-1"
        >
          {opciones.map((o, i) => (
            <li
              key={o.id}
              id={`${listboxId}-${i}`}
              role="option"
              aria-selected={i === activo}
              onMouseDown={(e) => { e.preventDefault(); elegir(o.id); }}
              onMouseEnter={() => setActivo(i)}
              className={cn(
                'px-3 py-1.5 text-sm cursor-pointer flex items-baseline gap-1.5',
                i === activo ? 'bg-limablue-50 text-limablue-800' : 'text-slate-700',
                o.especial && 'border-t border-slate-100 text-slate-500 italic',
              )}
            >
              <span className="font-medium">{o.principal}</span>
              {o.secundaria && <span className="text-xs text-slate-400">{o.secundaria}</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ── Valor seleccionado: etiqueta + botón X para limpiar ────────────────────────
function ValorSeleccionado({ etiqueta, onLimpiar }: { etiqueta: string; onLimpiar: () => void }) {
  return (
    <div className="input text-sm w-full flex items-center justify-between gap-2 bg-limablue-50/60 border-limablue-200">
      <span className="truncate text-slate-800">{etiqueta}</span>
      <button
        type="button"
        onClick={onLimpiar}
        title="Quitar"
        aria-label="Quitar selección"
        className="shrink-0 w-5 h-5 rounded-full flex items-center justify-center text-slate-400 hover:bg-slate-200 hover:text-slate-700 transition-colors"
      >✕</button>
    </div>
  );
}

// ── DISTRITO ───────────────────────────────────────────────────────────────────
export function DistritoAutocomplete({ value, onChange, conChips = true }: {
  /** ubigeoId seleccionado (6 dígitos, 999999 Extranjero, 999998 No precisa) o null. */
  value: string | null;
  onChange: (ubigeoId: string | null) => void;
  conChips?: boolean;
}) {
  const [consulta, setConsulta] = useState('');
  const inputRef = useRef<HTMLInputElement | null>(null);
  const listboxId = useId();

  // Chips de frecuentes: NUNCA bloquean el formulario. Si el endpoint falla o
  // tarda, se usa el fallback fijo. 6 frecuentes + 2 especiales (Extranjero / No precisa).
  const { data: frecuentes } = useQuery({
    queryKey: ['distritos-frecuentes'],
    queryFn: () => pacientesApi.distritosFrecuentes(),
    staleTime: 24 * 60 * 60 * 1000,
    retry: 1,
  });
  const chips: DistritoUbigeo[] = useMemo(() => {
    // Frecuentes reales primero; se COMPLETA con el fallback hasta 6 chips (mientras
    // haya pocos pacientes con distrito, la lista no queda vacía ni pobre).
    const ids = [...new Set([...(frecuentes ?? []).map((f) => f.id), ...CHIPS_FALLBACK])];
    const base = ids.map((id) => DISTRITOS_POR_ID.get(id)).filter(Boolean) as DistritoUbigeo[];
    return [...base.slice(0, 6), ...OPCIONES_ESPECIALES];
  }, [frecuentes]);

  // Búsqueda local memoizada por consulta (el catálogo ya viene pre-normalizado).
  const opciones: Opcion[] = useMemo(() => {
    const encontrados = buscarDistritos(consulta, 10).map((d) => ({
      id: d.id,
      principal: d.distrito,
      secundaria: d.provincia === '—' ? undefined : `— ${d.provincia}, ${d.departamento}`,
    }));
    // Opciones especiales SIEMPRE al final (vía de escape contra data contaminada).
    const especiales = OPCIONES_ESPECIALES
      .filter((e) => !encontrados.some((x) => x.id === e.id))
      .map((e) => ({ id: e.id, principal: e.distrito, especial: true }));
    return consulta.trim().length >= 2 || encontrados.length > 0
      ? [...encontrados, ...especiales]
      : [];
  }, [consulta]);

  const etiqueta = etiquetaDistrito(value);

  return (
    <div className="space-y-1.5">
      {conChips && !value && (
        <div className="flex flex-wrap gap-1.5">
          {chips.map((c) => (
            <button
              key={c.id}
              type="button"
              onClick={() => onChange(c.id)}
              className={cn(
                'px-2 py-0.5 rounded-full border text-xxs font-medium transition-colors',
                c.provincia === '—'
                  ? 'border-slate-200 text-slate-500 hover:border-slate-300 bg-slate-50'
                  : 'border-limablue-200 text-limablue-700 bg-limablue-50 hover:bg-limablue-100',
              )}
            >
              {c.distrito}
            </button>
          ))}
        </div>
      )}
      {value && etiqueta ? (
        <ValorSeleccionado etiqueta={etiqueta} onLimpiar={() => { onChange(null); setTimeout(() => inputRef.current?.focus(), 0); }} />
      ) : (
        <ComboboxBase
          opciones={opciones}
          onSeleccionar={(id) => onChange(id)}
          consulta={consulta}
          setConsulta={setConsulta}
          placeholder="Buscar distrito… (ej. Surco, SJL, San Isidro)"
          inputRef={inputRef}
          listboxId={listboxId}
        />
      )}
    </div>
  );
}

// ── PAÍS de residencia (solo visible cuando el distrito es Extranjero) ─────────
const CHIPS_PAISES = ['VE', 'CO', 'CL', 'EC', 'US', 'ES'];

const PAISES_BUSCABLES: (Pais & { busqueda: string })[] = PAISES.map((p) => ({
  ...p,
  busqueda: normalizarBusqueda(p.nombre),
}));

export function PaisAutocomplete({ value, onChange }: {
  /** Código ISO 3166-1 alpha-2 ("VE") o null. */
  value: string | null;
  onChange: (codigo: string | null) => void;
}) {
  const [consulta, setConsulta] = useState('');
  const inputRef = useRef<HTMLInputElement | null>(null);
  const listboxId = useId();

  const opciones: Opcion[] = useMemo(() => {
    const q = normalizarBusqueda(consulta);
    if (q.length < 2) return [];
    const m = PAISES_BUSCABLES
      .filter((p) => p.busqueda.startsWith(q) || p.busqueda.includes(q) || p.codigo.toLowerCase() === q)
      .sort((a, b) => {
        const sa = a.busqueda.startsWith(q) ? 0 : 1;
        const sb = b.busqueda.startsWith(q) ? 0 : 1;
        return sa !== sb ? sa - sb : a.nombre.localeCompare(b.nombre, 'es');
      })
      .slice(0, 10);
    return m.map((p) => ({ id: p.codigo, principal: p.nombre, secundaria: p.codigo }));
  }, [consulta]);

  const seleccionado = PAISES.find((p) => p.codigo === value);

  return (
    <div className="space-y-1.5">
      {!value && (
        <div className="flex flex-wrap gap-1.5">
          {CHIPS_PAISES.map((c) => {
            const p = PAISES.find((x) => x.codigo === c);
            if (!p) return null;
            return (
              <button
                key={c}
                type="button"
                onClick={() => onChange(c)}
                className="px-2 py-0.5 rounded-full border border-emerald-200 text-emerald-700 bg-emerald-50 hover:bg-emerald-100 text-xxs font-medium transition-colors"
              >
                {p.nombre}
              </button>
            );
          })}
        </div>
      )}
      {value && seleccionado ? (
        <ValorSeleccionado etiqueta={seleccionado.nombre} onLimpiar={() => { onChange(null); setTimeout(() => inputRef.current?.focus(), 0); }} />
      ) : (
        <ComboboxBase
          opciones={opciones}
          onSeleccionar={(id) => onChange(id)}
          consulta={consulta}
          setConsulta={setConsulta}
          placeholder="Buscar país… (ej. Venezuela)"
          inputRef={inputRef}
          listboxId={listboxId}
        />
      )}
    </div>
  );
}
