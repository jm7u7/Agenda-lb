// Constructor de Membresías (Herramientas — admin/dirección).
// Las membresías viven en el módulo Promociones (tipo MEMBRESIA) con contabilidad
// de sesiones. REGLA DE VERSIONADO: editar aquí NO altera las ya vendidas (la
// composición se copia como snapshot al vender).

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { api } from '../../api/client';
import { sedesApi, serviciosApi, pacientesApi } from '../../api';
import { Skeleton } from '../../components/ui/Skeleton';
import { cn } from '../../utils/cn';

interface ItemComp { servicioId: string; cantidad: number; etiqueta?: string; subcategoriaId?: string | null; subcategoriaEtiqueta?: string }
interface Membresia {
  id: string;
  nombre: string;
  descripcion: string | null;
  precio: number | null;
  activo: boolean;
  duracionMeses: number | null;
  sedesHabilitadas: string[] | null;
  composicion: ItemComp[];
  totalSesiones: number;
  ventas: number;
}

const KEY = ['membresias'];

// Fechas civiles YYYY-MM-DD (hora local). Para la vigencia de la membresía al vender.
const hoyISO = () => new Date().toLocaleDateString('en-CA');
function sumarMesesISO(iso: string, meses: number): string {
  const d = new Date(iso + 'T12:00:00');
  d.setMonth(d.getMonth() + meses);
  return d.toLocaleDateString('en-CA');
}

export function MembresiasPage() {
  const qc = useQueryClient();
  const { data: membresias, isLoading } = useQuery({ queryKey: KEY, queryFn: () => api.get<Membresia[]>('/membresias') });
  const { data: sedes } = useQuery({ queryKey: ['sedes'], queryFn: sedesApi.listar });
  const { data: servicios } = useQuery({ queryKey: ['servicios-todos'], queryFn: () => serviciosApi.listar({ activo: true }) });
  const [editando, setEditando] = useState<Membresia | 'nueva' | null>(null);
  const invalidar = () => qc.invalidateQueries({ queryKey: KEY });

  const desactivarMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/membresias/${id}`),
    onSuccess: () => { invalidar(); toast.success('Membresía desactivada (las vendidas siguen vivas)'); },
    onError: (e: Error) => toast.error(e.message),
  });
  const activarMutation = useMutation({
    mutationFn: (id: string) => api.post(`/membresias/${id}/activar`),
    onSuccess: () => { invalidar(); toast.success('Membresía reactivada — ya se puede vender'); },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <header className="bg-white border-b border-slate-200 px-6 py-4 flex items-center gap-3">
        <div>
          <h1 className="text-lg font-bold text-slate-900">Constructor de Membresías</h1>
          <p className="text-xs text-slate-400">Editar una membresía NO altera las ya vendidas (snapshot al vender)</p>
        </div>
        <div className="flex-1" />
        <button onClick={() => setEditando('nueva')} className="btn-primary btn-sm">+ Nueva membresía</button>
      </header>

      <div className="flex-1 overflow-y-auto px-6 py-4 space-y-2">
        {isLoading && [1, 2].map((i) => <Skeleton key={i} className="h-16 w-full" />)}
        {membresias?.length === 0 && <p className="text-center text-slate-400 py-10 text-sm">Sin membresías — crea la primera</p>}
        {membresias?.map((m) => (
          <div key={m.id} className={cn('bg-white rounded-xl border px-4 py-3 flex items-center gap-3 flex-wrap', m.activo ? 'border-slate-200' : 'border-slate-100 opacity-60')}>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-slate-800">
                {m.nombre} {!m.activo && <span className="text-[10px] text-slate-400 font-normal">(inactiva)</span>}
              </p>
              <p className="text-xs text-slate-500">
                {m.duracionMeses} meses · {m.totalSesiones} sesiones ({m.composicion.map((i) => `${i.cantidad}× ${i.etiqueta}${i.subcategoriaEtiqueta ? ` (${i.subcategoriaEtiqueta})` : ''}`).join(' + ')})
                {m.precio != null && ` · S/ ${m.precio}`}
                · {m.sedesHabilitadas?.length ? `${m.sedesHabilitadas.length} sedes` : 'todas las sedes'}
                · <b>{m.ventas} vendidas</b>
              </p>
            </div>
            <button onClick={() => setEditando(m)} className="btn-secondary btn-sm">Editar</button>
            {m.activo ? (
              <button
                onClick={() => { if (window.confirm(`¿Desactivar "${m.nombre}"? Las vendidas siguen consumibles.`)) desactivarMutation.mutate(m.id); }}
                className="btn-sm text-red-500 border border-red-200 rounded-lg px-3 hover:bg-red-50"
              >
                Desactivar
              </button>
            ) : (
              <button
                onClick={() => activarMutation.mutate(m.id)}
                disabled={activarMutation.isPending}
                className="btn-sm text-emerald-600 border border-emerald-200 rounded-lg px-3 hover:bg-emerald-50 disabled:opacity-50"
              >
                Activar
              </button>
            )}
          </div>
        ))}
      </div>

      {editando && (
        <FormMembresia
          membresia={editando === 'nueva' ? null : editando}
          sedes={sedes ?? []}
          servicios={(servicios ?? []).map((s) => ({ id: s.id, nombre: s.nombre, subcategorias: s.subcategorias ?? [] }))}
          onCerrar={() => setEditando(null)}
          onGuardado={() => { invalidar(); setEditando(null); }}
        />
      )}
    </div>
  );
}

// ─── Form crear/editar ────────────────────────────────────────────────────────

function FormMembresia({ membresia, sedes, servicios, onCerrar, onGuardado }: {
  membresia: Membresia | null;
  sedes: { id: string; nombre: string }[];
  servicios: { id: string; nombre: string; subcategorias: { id: string; nombre: string; precioReferencial: number | null }[] }[];
  onCerrar: () => void;
  onGuardado: () => void;
}) {
  const [nombre, setNombre] = useState(membresia?.nombre ?? '');
  const [duracion, setDuracion] = useState(membresia?.duracionMeses ?? 12);
  const [precio, setPrecio] = useState<string>(membresia?.precio != null ? String(membresia.precio) : '');
  const [sedesSel, setSedesSel] = useState<string[]>(membresia?.sedesHabilitadas ?? []);
  const [items, setItems] = useState<ItemComp[]>(membresia?.composicion ?? [{ servicioId: '', cantidad: 12 }]);

  const mutation = useMutation({
    mutationFn: () => {
      const body = {
        nombre: nombre.trim(),
        duracionMeses: duracion,
        precio: precio ? Number(precio) : null,
        // SIEMPRE se envía (aunque sea []): [] = todas las sedes. Con `undefined` el PATCH no
        // actualizaba el campo, así que no se podía "limpiar" para dejarla en todas las sedes.
        sedesHabilitadas: sedesSel,
        composicion: items.filter((i) => i.servicioId && i.cantidad > 0).map((i) => ({ servicioId: i.servicioId, cantidad: i.cantidad, ...(i.subcategoriaId ? { subcategoriaId: i.subcategoriaId } : {}) })),
      };
      return membresia ? api.patch(`/membresias/${membresia.id}`, body) : api.post('/membresias', body);
    },
    onSuccess: () => { toast.success(membresia ? 'Membresía actualizada (ventas previas intactas)' : 'Membresía creada'); onGuardado(); },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <>
      <div className="fixed inset-0 z-[70] bg-black/40" onClick={onCerrar} />
      <div className="fixed z-[80] left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[480px] max-h-[85vh] overflow-y-auto bg-white rounded-2xl shadow-2xl border border-slate-200 p-5 space-y-3" role="dialog">
        <p className="text-sm font-bold text-slate-900">{membresia ? `Editar: ${membresia.nombre}` : 'Nueva membresía'}</p>
        {membresia && membresia.ventas > 0 && (
          <p className="text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-1">
            ⚠ {membresia.ventas} ya vendidas: NO cambiarán (snapshot). Los cambios aplican a ventas futuras.
          </p>
        )}
        <label className="block text-xs text-slate-500">Nombre
          <input className="input text-sm" value={nombre} onChange={(e) => setNombre(e.target.value)} />
        </label>
        <div className="flex gap-2">
          <label className="block text-xs text-slate-500 flex-1">Duración (meses)
            <input type="number" min={1} className="input text-sm" value={duracion} onChange={(e) => setDuracion(Number(e.target.value))} />
          </label>
          <label className="block text-xs text-slate-500 flex-1">Precio S/ (opcional)
            <input type="number" min={0} className="input text-sm" value={precio} onChange={(e) => setPrecio(e.target.value)} />
          </label>
        </div>
        <div>
          <p className="text-xs text-slate-500 mb-1">Sedes donde se vende (ninguna marcada = TODAS)</p>
          <div className="flex gap-1.5 flex-wrap">
            {sedes.map((s) => (
              <button key={s.id} type="button"
                onClick={() => setSedesSel((prev) => prev.includes(s.id) ? prev.filter((x) => x !== s.id) : [...prev, s.id])}
                className={cn('px-2 py-1 rounded-lg text-xs border', sedesSel.includes(s.id) ? 'bg-limablue-600 text-white border-limablue-600' : 'bg-white text-slate-600 border-slate-200')}>
                {s.nombre}
              </button>
            ))}
          </div>
          {/* Aviso claro del alcance real: evita restringir por accidente (ojo: el botón "One" es
              la SEDE One, no el nombre de la membresía). */}
          <p className={cn('text-xxs mt-1 font-medium', sedesSel.length === 0 ? 'text-emerald-600' : 'text-amber-600')}>
            {sedesSel.length === 0
              ? '✓ Se venderá y usará en TODAS las sedes.'
              : `⚠ Solo en: ${sedes.filter(s => sedesSel.includes(s.id)).map(s => s.nombre).join(', ')}. Deselecciona todas para dejarla en todas las sedes.`}
          </p>
        </div>
        <div>
          <p className="text-xs text-slate-500 mb-1">Composición (servicio + cantidad)</p>
          <div className="space-y-1.5">
            {items.map((item, i) => {
              const subs = servicios.find((s) => s.id === item.servicioId)?.subcategorias ?? [];
              return (
              <div key={i} className="space-y-1">
                <div className="flex gap-1.5 items-center">
                  <select className="input text-xs flex-1" value={item.servicioId}
                    onChange={(e) => setItems((prev) => prev.map((x, j) => j === i ? { ...x, servicioId: e.target.value, subcategoriaId: null } : x))}>
                    <option value="">— servicio —</option>
                    {servicios.map((s) => <option key={s.id} value={s.id}>{s.nombre}</option>)}
                  </select>
                  <input type="number" min={1} className="input text-xs w-16" value={item.cantidad} onChange={(e) => setItems((prev) => prev.map((x, j) => j === i ? { ...x, cantidad: Number(e.target.value) } : x))} />
                  <button type="button" onClick={() => setItems((prev) => prev.filter((_, j) => j !== i))} className="text-red-400 text-xs px-1">✕</button>
                </div>
                {subs.length > 0 && (
                  <select className="input text-xs w-full" value={item.subcategoriaId ?? ''}
                    onChange={(e) => setItems((prev) => prev.map((x, j) => j === i ? { ...x, subcategoriaId: e.target.value || null } : x))}>
                    <option value="">Tipo: elegir al vender</option>
                    {subs.map((sc) => <option key={sc.id} value={sc.id}>Tipo: {sc.nombre}{sc.precioReferencial != null ? ` · S/ ${Number(sc.precioReferencial).toFixed(2)}` : ''}</option>)}
                  </select>
                )}
              </div>
            );})}
          </div>
          <button type="button" onClick={() => setItems((prev) => [...prev, { servicioId: '', cantidad: 1 }])} className="mt-1 text-xs text-limablue-600 hover:underline">+ Agregar ítem</button>
        </div>
        <div className="flex gap-2 pt-1">
          <button
            onClick={() => mutation.mutate()}
            disabled={mutation.isPending || !nombre.trim() || items.every((i) => !i.servicioId)}
            className="btn-primary btn-sm flex-1 disabled:opacity-50"
          >
            {mutation.isPending ? 'Guardando…' : 'Guardar'}
          </button>
          <button onClick={onCerrar} className="btn-secondary btn-sm">Cancelar</button>
        </div>
      </div>
    </>
  );
}

// ─── Vender a un paciente ─────────────────────────────────────────────────────

function VenderMembresia({ membresia, sedes, onCerrar, onVendida }: {
  membresia: Membresia;
  sedes: { id: string; nombre: string }[];
  onCerrar: () => void;
  onVendida: () => void;
}) {
  const [q, setQ] = useState('');
  const [pacienteId, setPacienteId] = useState('');
  const [sedeId, setSedeId] = useState('');
  // Vigencia editable (fechas abiertas): inicio + fin. El fin se sugiere por la duración,
  // pero se puede cambiar. La membresía solo sirve para agendar dentro de [inicio, fin].
  const [inicio, setInicio] = useState(hoyISO());
  const [fin, setFin] = useState(() => sumarMesesISO(hoyISO(), membresia.duracionMeses ?? 12));
  // Subcategoría FIJADA al vender: servicioId → subcategoriaId (ej. Profilaxis → Premium).
  const [subcatSel, setSubcatSel] = useState<Record<string, string>>({});
  const rangoInvalido = fin <= inicio;
  const { data: resultados } = useQuery({
    queryKey: ['pacientes-buscar', q],
    queryFn: () => pacientesApi.buscar(q),
    enabled: q.length >= 2,
  });
  // Servicios (con sus subcategorías activas) para saber qué ítems exigen elegir una.
  const { data: servicios } = useQuery({ queryKey: ['servicios-all'], queryFn: () => serviciosApi.listar({ activo: true }) });
  const subcatsPorServicio = new Map((servicios ?? []).map((s) => [s.id, s.subcategorias ?? []]));
  // Ítems que requieren elegir subcategoría AL VENDER: servicio con subcategorías activas y
  // SIN una ya fijada en el constructor (esas se respetan tal cual, no se vuelven a preguntar).
  const itemsConSubcat = membresia.composicion.filter((i) => !i.subcategoriaId && (subcatsPorServicio.get(i.servicioId)?.length ?? 0) > 0);
  const faltanSubcats = itemsConSubcat.some((i) => !subcatSel[i.servicioId]);

  const habilitadas = membresia.sedesHabilitadas?.length ? sedes.filter((s) => membresia.sedesHabilitadas!.includes(s.id)) : sedes;
  const mutation = useMutation({
    mutationFn: () => api.post(`/membresias/${membresia.id}/vender`, {
      pacienteId, sedeId, fechaVenta: inicio, fechaFin: fin,
      subcategorias: Object.entries(subcatSel).map(([servicioId, subcategoriaId]) => ({ servicioId, subcategoriaId })),
    }),
    onSuccess: () => { toast.success('Membresía vendida — paquete activo con snapshot'); onVendida(); },
    onError: (e: Error) => toast.error(e.message),
  });
  return (
    <>
      <div className="fixed inset-0 z-[70] bg-black/40" onClick={onCerrar} />
      <div className="fixed z-[80] left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[420px] bg-white rounded-2xl shadow-2xl border border-slate-200 p-5 space-y-3" role="dialog">
        <p className="text-sm font-bold text-slate-900">Vender: {membresia.nombre}</p>
        <input className="input text-sm" placeholder="Buscar paciente (nombre o DNI)…" value={q} onChange={(e) => { setQ(e.target.value); setPacienteId(''); }} />
        <div className="max-h-36 overflow-y-auto space-y-1">
          {resultados?.map((p) => (
            <button key={p.id} onClick={() => setPacienteId(p.id)} className={cn('w-full text-left px-2 py-1.5 rounded-lg text-xs border', pacienteId === p.id ? 'border-limablue-400 bg-limablue-50' : 'border-slate-100 hover:bg-slate-50')}>
              {p.nombreCompleto} · {p.numeroDocumento}
            </button>
          ))}
        </div>
        <label className="block text-xs text-slate-500">Sede (donde se vende = donde se atiende)
          <select className="input text-sm" value={sedeId} onChange={(e) => setSedeId(e.target.value)}>
            <option value="">— sede —</option>
            {habilitadas.map((s) => <option key={s.id} value={s.id}>{s.nombre}</option>)}
          </select>
        </label>
        {/* Vigencia (fechas abiertas): solo se puede agendar/consumir dentro de este rango. */}
        <div className="flex gap-2">
          <label className="block text-xs text-slate-500 flex-1">Inicio de vigencia
            <input type="date" className="input text-sm" value={inicio}
              onChange={(e) => { const v = e.target.value; setInicio(v); if (v) setFin(sumarMesesISO(v, membresia.duracionMeses ?? 12)); }} />
          </label>
          <label className="block text-xs text-slate-500 flex-1">Fin de vigencia
            <input type="date" className={cn('input text-sm', rangoInvalido && 'border-rose-400')} value={fin} min={inicio} onChange={(e) => setFin(e.target.value)} />
          </label>
        </div>
        {rangoInvalido && <p className="text-xxs text-rose-500">El fin debe ser posterior al inicio.</p>}
        {/* Subcategoría FIJADA al vender: por cada ítem cuyo servicio la requiera (ej. Profilaxis) */}
        {itemsConSubcat.map((item) => (
          <label key={item.servicioId} className="block text-xs text-slate-500">
            Tipo de {item.etiqueta ?? 'servicio'} <span className="text-red-500">*</span>
            <select className="input text-sm" value={subcatSel[item.servicioId] ?? ''} onChange={(e) => setSubcatSel((prev) => ({ ...prev, [item.servicioId]: e.target.value }))}>
              <option value="">— elegir tipo —</option>
              {(subcatsPorServicio.get(item.servicioId) ?? []).map((sc) => (
                <option key={sc.id} value={sc.id}>{sc.nombre}{sc.precioReferencial != null ? ` · S/ ${Number(sc.precioReferencial).toFixed(2)}` : ''}</option>
              ))}
            </select>
          </label>
        ))}
        <div className="flex gap-2">
          <button onClick={() => mutation.mutate()} disabled={mutation.isPending || !pacienteId || !sedeId || faltanSubcats || rangoInvalido} className="btn-primary btn-sm flex-1 disabled:opacity-50">
            {mutation.isPending ? 'Vendiendo…' : 'Confirmar venta'}
          </button>
          <button onClick={onCerrar} className="btn-secondary btn-sm">Cancelar</button>
        </div>
      </div>
    </>
  );
}
