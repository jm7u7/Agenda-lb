import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { promocionesApi, formatPromoValor, type Promocion, type TipoPromocion } from '../../api/promociones';
import { useAuthStore } from '../../stores/authStore';

const TIPOS: { value: TipoPromocion; label: string; hint: string }[] = [
  { value: 'PRECIO_FIJO', label: 'Precio fijo (S/)', hint: 'S/' },
  { value: 'PORCENTAJE', label: 'Descuento (%)', hint: '%' },
  { value: 'OTRO', label: 'Otro (sin valor)', hint: '—' },
];

export function PromocionesPage() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const puedeGestionar = useAuthStore(s => s.isCoordinadora()); // admin + coordinadora_sedes

  // Form "agregar"
  const [nombre, setNombre] = useState('');
  const [tipo, setTipo] = useState<TipoPromocion>('PRECIO_FIJO');
  const [valor, setValor] = useState('');

  // Edición inline
  const [editId, setEditId] = useState<string | null>(null);
  const [eNombre, setENombre] = useState('');
  const [eTipo, setETipo] = useState<TipoPromocion>('PRECIO_FIJO');
  const [eValor, setEValor] = useState('');

  const { data: promos = [], isLoading } = useQuery({
    queryKey: ['promociones-todas'],
    queryFn: promocionesApi.todas,
    enabled: puedeGestionar,
  });

  const invalidar = () => { qc.invalidateQueries({ queryKey: ['promociones-todas'] }); qc.invalidateQueries({ queryKey: ['promociones-activas'] }); };
  const parseValor = (t: TipoPromocion, v: string): number | null => (t === 'OTRO' || v.trim() === '' ? null : Number(v));

  const crearMut = useMutation({
    mutationFn: () => promocionesApi.crear({ nombre: nombre.trim(), tipo, valor: parseValor(tipo, valor) }),
    onSuccess: () => { invalidar(); setNombre(''); setValor(''); toast.success('Promoción agregada'); },
    onError: (e: Error) => toast.error(e.message),
  });
  const actualizarMut = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<{ nombre: string; tipo: TipoPromocion; valor: number | null; activo: boolean }> }) => promocionesApi.actualizar(id, data),
    onSuccess: () => { invalidar(); setEditId(null); },
    onError: (e: Error) => toast.error(e.message),
  });
  const eliminarMut = useMutation({
    mutationFn: (id: string) => promocionesApi.eliminar(id),
    onSuccess: (r) => { invalidar(); toast.success(r.desactivado ? `Promoción desactivada (tiene ${r.enUso} citas, se conserva el historial)` : 'Promoción eliminada'); },
    onError: (e: Error) => toast.error(e.message),
  });

  const guardarEdicion = (id: string) => actualizarMut.mutate({ id, data: { nombre: eNombre.trim(), tipo: eTipo, valor: parseValor(eTipo, eValor) } });

  if (!puedeGestionar) {
    return <div className="flex-1 flex items-center justify-center bg-slate-50 text-slate-400 text-sm">Solo la Coordinadora de Sedes (y el admin) pueden gestionar promociones.</div>;
  }

  return (
    <div className="flex-1 overflow-y-auto bg-slate-50">
      {/* Header */}
      <div className="bg-white border-b border-slate-200 px-6 py-4 flex items-center gap-3 sticky top-0 z-10">
        <button onClick={() => navigate('/herramientas')} className="w-8 h-8 rounded-lg flex items-center justify-center text-slate-500 hover:bg-slate-100 hover:text-slate-800 transition-all" title="Volver a Herramientas">
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" /></svg>
        </button>
        <div className="w-9 h-9 rounded-xl bg-pink-500 flex items-center justify-center shrink-0"><span className="text-white text-lg">🎁</span></div>
        <div>
          <h1 className="text-base font-bold text-slate-900">Promociones</h1>
          <p className="text-xs text-slate-500">Promos para agendar — agrega o quita, define precio/descuento. Alimenta Analytics.</p>
        </div>
      </div>

      <div className="max-w-2xl mx-auto px-4 py-6 space-y-4">
        {/* Nueva promoción */}
        <div className="bg-white border border-slate-200 rounded-xl p-5">
          <p className="text-xs font-bold text-slate-500 uppercase tracking-widest mb-2">Agregar promoción</p>
          <div className="space-y-2">
            <input
              className="input text-sm w-full"
              placeholder="Nombre (ej: Promo120 baropodometría + profilaxis)"
              value={nombre}
              maxLength={160}
              onChange={e => setNombre(e.target.value)}
            />
            <div className="flex gap-2">
              <select className="input text-sm flex-1" value={tipo} onChange={e => setTipo(e.target.value as TipoPromocion)}>
                {TIPOS.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
              <input
                className="input text-sm w-28"
                type="number" min="0" step="0.01"
                placeholder={tipo === 'PORCENTAJE' ? '%' : 'S/'}
                value={valor}
                disabled={tipo === 'OTRO'}
                onChange={e => setValor(e.target.value)}
              />
              <button
                onClick={() => crearMut.mutate()}
                disabled={nombre.trim().length < 2 || crearMut.isPending}
                className="px-4 py-2 rounded-xl text-sm font-semibold text-white bg-pink-600 hover:bg-pink-700 disabled:opacity-40 transition-colors shrink-0"
              >+ Agregar</button>
            </div>
          </div>
        </div>

        {/* Lista */}
        <div className="space-y-2">
          <p className="text-xs font-bold text-slate-500 uppercase tracking-widest px-1">Promociones</p>
          {isLoading ? (
            <div className="flex justify-center py-8"><div className="w-7 h-7 border-2 border-pink-400 border-t-transparent rounded-full animate-spin" /></div>
          ) : promos.map((p: Promocion) => (
            <div key={p.id} className="bg-white border border-slate-200 rounded-xl p-4 flex items-center gap-3">
              <div className="flex-1 min-w-0">
                {editId === p.id ? (
                  <div className="space-y-2">
                    <input className="input text-sm w-full" value={eNombre} onChange={e => setENombre(e.target.value)} autoFocus />
                    <div className="flex gap-2">
                      <select className="input text-sm flex-1" value={eTipo} onChange={e => setETipo(e.target.value as TipoPromocion)}>
                        {TIPOS.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                      </select>
                      <input className="input text-sm w-24" type="number" min="0" step="0.01" value={eValor} disabled={eTipo === 'OTRO'} onChange={e => setEValor(e.target.value)} placeholder={eTipo === 'PORCENTAJE' ? '%' : 'S/'} />
                      <button onClick={() => guardarEdicion(p.id)} className="text-xs font-semibold text-pink-700 px-2">Guardar</button>
                      <button onClick={() => setEditId(null)} className="text-xs text-slate-400 px-1">Cancelar</button>
                    </div>
                  </div>
                ) : (
                  <p className={'text-sm font-semibold ' + (p.activo ? 'text-slate-900' : 'text-slate-400 line-through')}>
                    {p.nombre}
                    <span className="ml-2 text-xxs font-normal text-pink-600">{formatPromoValor(p.tipo, p.valor)}</span>
                    {!p.activo && <span className="ml-2 text-xxs font-normal text-slate-400">(inactiva)</span>}
                    {(p.enUso ?? 0) > 0 && <span className="ml-2 text-xxs font-normal text-slate-400">· {p.enUso} citas</span>}
                  </p>
                )}
              </div>
              {editId !== p.id && (
                <div className="flex items-center gap-1 shrink-0">
                  <button
                    onClick={() => actualizarMut.mutate({ id: p.id, data: { activo: !p.activo } })}
                    className={'text-xxs font-semibold px-2 py-1 rounded-lg ' + (p.activo ? 'text-slate-500 hover:bg-slate-100' : 'text-emerald-600 hover:bg-emerald-50')}
                    title={p.activo ? 'Desactivar (deja de aparecer al reservar)' : 'Activar'}
                  >{p.activo ? 'Desactivar' : 'Activar'}</button>
                  <button onClick={() => { setEditId(p.id); setENombre(p.nombre); setETipo(p.tipo); setEValor(p.valor == null ? '' : String(p.valor)); }} className="p-2 text-slate-400 hover:text-pink-600 hover:bg-pink-50 rounded-lg transition-all" title="Editar">
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" /></svg>
                  </button>
                  <button onClick={() => eliminarMut.mutate(p.id)} disabled={eliminarMut.isPending} className="p-2 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-all disabled:opacity-50" title="Quitar">
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                  </button>
                </div>
              )}
            </div>
          ))}
          <p className="text-xxs text-slate-400 px-1 pt-1">Si quitas una promoción que ya tiene citas, se <b>desactiva</b> (no se borra) para conservar el historial y Analytics. Si no tiene citas, se elimina.</p>
        </div>
      </div>
    </div>
  );
}
