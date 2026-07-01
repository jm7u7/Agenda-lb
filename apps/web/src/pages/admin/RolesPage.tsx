import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../../api/client';
import { cn } from '../../utils/cn';

interface Rol {
  id: string;
  nombre: string;
  label: string;
  descripcion: string | null;
  permisos: string[];
  esSistema: boolean;
}

type GruposPermisos = Record<string, { id: string; label: string }[]>;

interface FormData {
  nombre: string;
  label: string;
  descripcion: string;
  permisos: string[];
}

const emptyForm: FormData = { nombre: '', label: '', descripcion: '', permisos: [] };

export function RolesPage() {
  const qc = useQueryClient();
  const [modal, setModal] = useState<{ open: boolean; editing: Rol | null }>({ open: false, editing: null });
  const [form, setForm] = useState<FormData>(emptyForm);
  const [formError, setFormError] = useState('');

  const { data: roles = [], isLoading } = useQuery({
    queryKey: ['roles'],
    queryFn: () => api.get<Rol[]>('/roles'),
  });

  const { data: gruposPermisos = {} } = useQuery({
    queryKey: ['roles-permisos'],
    queryFn: () => api.get<GruposPermisos>('/roles/permisos'),
  });

  const mutCreate = useMutation({
    mutationFn: (data: FormData) => api.post<Rol>('/roles', data),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['roles'] }); closeModal(); },
    onError: (e: Error) => setFormError(e.message),
  });

  const mutEdit = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Omit<FormData, 'nombre'> }) =>
      api.patch<Rol>(`/roles/${id}`, data),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['roles'] }); closeModal(); },
    onError: (e: Error) => setFormError(e.message),
  });

  const mutDelete = useMutation({
    mutationFn: (id: string) => api.delete(`/roles/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['roles'] }),
    onError: (e: Error) => alert(e.message),
  });

  const openCreate = () => {
    setForm(emptyForm);
    setFormError('');
    setModal({ open: true, editing: null });
  };

  const openEdit = (r: Rol) => {
    setForm({ nombre: r.nombre, label: r.label, descripcion: r.descripcion ?? '', permisos: r.permisos });
    setFormError('');
    setModal({ open: true, editing: r });
  };

  const closeModal = () => setModal({ open: false, editing: null });

  const togglePermiso = (id: string) => {
    setForm(f => ({
      ...f,
      permisos: f.permisos.includes(id) ? f.permisos.filter(p => p !== id) : [...f.permisos, id],
    }));
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setFormError('');
    if (modal.editing) {
      mutEdit.mutate({ id: modal.editing.id, data: { label: form.label, descripcion: form.descripcion, permisos: form.permisos } });
    } else {
      mutCreate.mutate(form);
    }
  };

  const isPending = mutCreate.isPending || mutEdit.isPending;
  const totalPermisos = Object.values(gruposPermisos).flat().length;

  return (
    <div className="flex flex-col h-full overflow-hidden bg-[#0a1628]">
      <header className="bg-[#111e35] border-b border-white/5 px-6 py-4 flex items-center justify-between flex-shrink-0">
        <div>
          <h1 className="text-lg font-bold text-white">Gestión de Roles</h1>
          <p className="text-slate-400 text-xs mt-0.5">{roles.length} roles definidos</p>
        </div>
        <button onClick={openCreate} className="bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold px-4 py-2 rounded-lg transition-colors">
          + Nuevo rol
        </button>
      </header>

      <div className="flex-1 overflow-y-auto px-4 py-4">
        {isLoading ? (
          <div className="flex justify-center pt-16">
            <div className="w-8 h-8 border-2 border-white/20 border-t-blue-500 rounded-full animate-spin" />
          </div>
        ) : (
          <div className="space-y-2">
            {roles.map((r) => (
              <div key={r.id} className="bg-[#111e35] rounded-xl border border-white/5 px-4 py-3">
                <div className="flex items-start gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-white font-semibold text-sm">{r.label}</span>
                      <code className="text-xs text-slate-500 bg-white/5 px-1.5 py-0.5 rounded">{r.nombre}</code>
                      {r.esSistema && (
                        <span className="text-xs text-amber-400 bg-amber-500/10 border border-amber-500/20 px-2 py-0.5 rounded-full">Sistema</span>
                      )}
                    </div>
                    {r.descripcion && <p className="text-slate-400 text-xs mt-1">{r.descripcion}</p>}

                    {/* Badges de permisos */}
                    <div className="flex flex-wrap gap-1 mt-2">
                      {r.permisos.length === totalPermisos ? (
                        <span className="text-xs bg-blue-500/20 text-blue-300 border border-blue-500/20 px-2 py-0.5 rounded-full">Acceso total</span>
                      ) : r.permisos.length === 0 ? (
                        <span className="text-xs text-slate-500">Sin permisos</span>
                      ) : (
                        r.permisos.map(p => (
                          <span key={p} className="text-xs bg-white/5 text-slate-400 px-2 py-0.5 rounded-full">{p}</span>
                        ))
                      )}
                    </div>
                  </div>

                  <div className="flex items-center gap-2 flex-shrink-0 mt-0.5">
                    <button onClick={() => openEdit(r)} className="text-xs bg-blue-600/20 hover:bg-blue-600/40 text-blue-300 font-medium px-3 py-1.5 rounded-lg transition-colors">
                      Editar
                    </button>
                    {!r.esSistema && (
                      <button
                        onClick={() => { if (confirm(`¿Eliminar el rol "${r.label}"?`)) mutDelete.mutate(r.id); }}
                        className="text-xs bg-red-500/10 hover:bg-red-500/20 text-red-400 font-medium px-3 py-1.5 rounded-lg transition-colors"
                      >
                        Eliminar
                      </button>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Modal crear/editar */}
      {modal.open && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-[#111e35] rounded-2xl shadow-2xl w-full max-w-lg border border-white/10 flex flex-col max-h-[90vh]">
            <div className="bg-[#003366] px-6 py-4 rounded-t-2xl flex-shrink-0">
              <h2 className="text-white font-semibold">{modal.editing ? 'Editar rol' : 'Nuevo rol'}</h2>
            </div>

            <form onSubmit={handleSubmit} className="flex flex-col flex-1 overflow-hidden">
              <div className="px-6 py-5 space-y-4 overflow-y-auto flex-1">

                {/* Nombre interno — solo en creación */}
                {!modal.editing && (
                  <div>
                    <label className="block text-xs font-medium text-slate-400 mb-1">
                      Nombre interno <span className="text-slate-500">(solo minúsculas, sin espacios)</span>
                    </label>
                    <input
                      type="text"
                      value={form.nombre}
                      onChange={e => setForm(f => ({ ...f, nombre: e.target.value.toLowerCase().replace(/\s/g, '_') }))}
                      required
                      placeholder="contact_center"
                      className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2.5 text-white text-sm placeholder-slate-500 focus:outline-none focus:border-blue-500 font-mono"
                    />
                  </div>
                )}

                <div>
                  <label className="block text-xs font-medium text-slate-400 mb-1">Nombre visible</label>
                  <input
                    type="text"
                    value={form.label}
                    onChange={e => setForm(f => ({ ...f, label: e.target.value }))}
                    required
                    placeholder="Contact Center"
                    className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2.5 text-white text-sm placeholder-slate-500 focus:outline-none focus:border-blue-500"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-400 mb-1">Descripción <span className="text-slate-500">(opcional)</span></label>
                  <input
                    type="text"
                    value={form.descripcion}
                    onChange={e => setForm(f => ({ ...f, descripcion: e.target.value }))}
                    placeholder="Atención telefónica y agendamiento"
                    className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2.5 text-white text-sm placeholder-slate-500 focus:outline-none focus:border-blue-500"
                  />
                </div>

                {/* Permisos por grupo */}
                <div>
                  <label className="block text-xs font-medium text-slate-400 mb-3">
                    Permisos <span className="text-slate-500">({form.permisos.length} seleccionados)</span>
                  </label>
                  <div className="space-y-4">
                    {Object.entries(gruposPermisos).map(([grupo, items]) => (
                      <div key={grupo}>
                        <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">{grupo}</p>
                        <div className="space-y-1.5">
                          {items.map(item => {
                            const checked = form.permisos.includes(item.id);
                            return (
                              <label key={item.id} className="flex items-center gap-3 cursor-pointer group">
                                <div
                                  onClick={() => togglePermiso(item.id)}
                                  className={cn(
                                    'w-5 h-5 rounded border-2 flex items-center justify-center flex-shrink-0 transition-colors cursor-pointer',
                                    checked ? 'bg-blue-600 border-blue-600' : 'border-white/20 bg-white/5 group-hover:border-white/40'
                                  )}
                                >
                                  {checked && <span className="text-white text-xs font-bold">✓</span>}
                                </div>
                                <div onClick={() => togglePermiso(item.id)} className="flex-1">
                                  <p className="text-sm text-white">{item.label}</p>
                                  <p className="text-xs text-slate-500 font-mono">{item.id}</p>
                                </div>
                              </label>
                            );
                          })}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                {formError && (
                  <p className="text-red-400 text-sm bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">{formError}</p>
                )}
              </div>

              <div className="flex gap-3 px-6 py-4 border-t border-white/5 flex-shrink-0">
                <button type="button" onClick={closeModal} className="flex-1 bg-white/5 hover:bg-white/10 text-slate-300 text-sm font-medium py-2.5 rounded-lg transition-colors">
                  Cancelar
                </button>
                <button type="submit" disabled={isPending} className="flex-1 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-800 text-white text-sm font-semibold py-2.5 rounded-lg transition-colors flex items-center justify-center gap-2">
                  {isPending ? <><span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" /> Guardando...</> : (modal.editing ? 'Guardar cambios' : 'Crear rol')}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
