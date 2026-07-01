import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../../api/client';
import { useAuthStore } from '../../stores/authStore';
import { cn } from '../../utils/cn';

interface Usuario {
  id: string;
  nombre: string;
  email: string;
  rol: string;
  activo: boolean;
  creadoEn: string;
}

interface Rol {
  id: string;
  nombre: string;
  label: string;
}

// Colores por índice para roles dinámicos
const PALETTE = [
  'bg-blue-500/20 text-blue-300 border-blue-500/30',
  'bg-purple-500/20 text-purple-300 border-purple-500/30',
  'bg-slate-500/20 text-slate-300 border-slate-500/30',
  'bg-teal-500/20 text-teal-300 border-teal-500/30',
  'bg-amber-500/20 text-amber-300 border-amber-500/30',
  'bg-rose-500/20 text-rose-300 border-rose-500/30',
  'bg-green-500/20 text-green-300 border-green-500/30',
];

function rolColor(rolNombre: string, roles: Rol[]): string {
  const idx = roles.findIndex(r => r.nombre === rolNombre);
  return PALETTE[idx % PALETTE.length] ?? PALETTE[0];
}

interface FormData {
  nombre: string;
  email: string;
  password: string;
  rol: string;
  activo: boolean;
}

const emptyForm: FormData = { nombre: '', email: '', password: '', rol: '', activo: true };

export function UsersPage() {
  const qc = useQueryClient();
  const { usuario: me } = useAuthStore();

  const [modal, setModal] = useState<{ open: boolean; editing: Usuario | null }>({ open: false, editing: null });
  const [form, setForm] = useState<FormData>(emptyForm);
  const [formError, setFormError] = useState('');

  const { data: usuarios = [], isLoading } = useQuery({
    queryKey: ['users'],
    queryFn: () => api.get<Usuario[]>('/users'),
  });

  const { data: roles = [] } = useQuery({
    queryKey: ['roles'],
    queryFn: () => api.get<Rol[]>('/roles'),
  });

  const mutCreate = useMutation({
    mutationFn: (data: FormData) => api.post<Usuario>('/users', data),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['users'] }); closeModal(); },
    onError: (e: Error) => setFormError(e.message),
  });

  const mutEdit = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<FormData> }) =>
      api.put<Usuario>(`/users/${id}`, data),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['users'] }); closeModal(); },
    onError: (e: Error) => setFormError(e.message),
  });

  const mutToggle = useMutation({
    mutationFn: ({ id, activo }: { id: string; activo: boolean }) =>
      api.put<Usuario>(`/users/${id}`, { activo }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['users'] }),
  });

  const openCreate = () => {
    setForm({ ...emptyForm, rol: roles[0]?.nombre ?? '' });
    setFormError('');
    setModal({ open: true, editing: null });
  };

  const openEdit = (u: Usuario) => {
    setForm({ nombre: u.nombre, email: u.email, password: '', rol: u.rol, activo: u.activo });
    setFormError('');
    setModal({ open: true, editing: u });
  };

  const closeModal = () => setModal({ open: false, editing: null });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setFormError('');
    if (modal.editing) {
      const payload: Partial<FormData> = { nombre: form.nombre, email: form.email, rol: form.rol, activo: form.activo };
      if (form.password) payload.password = form.password;
      mutEdit.mutate({ id: modal.editing.id, data: payload });
    } else {
      mutCreate.mutate(form);
    }
  };

  const rolLabel = (nombre: string) => roles.find(r => r.nombre === nombre)?.label ?? nombre;
  const isPending = mutCreate.isPending || mutEdit.isPending;

  return (
    <div className="flex flex-col h-full overflow-hidden bg-[#0a1628]">
      {/* Header */}
      <header className="bg-[#111e35] border-b border-white/5 px-6 py-4 flex items-center justify-between flex-shrink-0">
        <div>
          <h1 className="text-lg font-bold text-white">Gestión de Usuarios</h1>
          <p className="text-slate-400 text-xs mt-0.5">{usuarios.length} usuarios registrados</p>
        </div>
        <button onClick={openCreate} className="bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold px-4 py-2 rounded-lg transition-colors">
          + Nuevo usuario
        </button>
      </header>

      {/* Lista */}
      <div className="flex-1 overflow-y-auto px-4 py-4">
        {isLoading ? (
          <div className="flex justify-center pt-16">
            <div className="w-8 h-8 border-2 border-white/20 border-t-blue-500 rounded-full animate-spin" />
          </div>
        ) : (
          <div className="space-y-2">
            {usuarios.map((u) => {
              const esYo = u.id === me?.id;
              return (
                <div
                  key={u.id}
                  className={cn(
                    'bg-[#111e35] rounded-xl border border-white/5 px-4 py-3 flex items-center gap-3',
                    esYo && 'border-blue-500/20 bg-blue-600/5'
                  )}
                >
                  <div className="w-9 h-9 rounded-full bg-blue-600/30 flex items-center justify-center flex-shrink-0">
                    <span className="text-sm font-bold text-blue-300">
                      {u.nombre.split(' ').map(n => n[0]).slice(0, 2).join('')}
                    </span>
                  </div>

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-white font-medium text-sm truncate">{u.nombre}</span>
                      {esYo && <span className="text-xs text-blue-400 flex-shrink-0">(tú)</span>}
                      <span className={cn('text-xs px-2 py-0.5 rounded-full border flex-shrink-0', rolColor(u.rol, roles))}>
                        {rolLabel(u.rol)}
                      </span>
                      <span className={cn('text-xs px-2 py-0.5 rounded-full flex-shrink-0', u.activo ? 'bg-green-500/20 text-green-400' : 'bg-red-500/20 text-red-400')}>
                        {u.activo ? 'Activo' : 'Inactivo'}
                      </span>
                    </div>
                    <p className="text-slate-400 text-xs truncate mt-0.5">{u.email}</p>
                  </div>

                  <div className="flex items-center gap-2 flex-shrink-0">
                    <button onClick={() => openEdit(u)} className="text-xs bg-blue-600/20 hover:bg-blue-600/40 text-blue-300 font-medium px-3 py-1.5 rounded-lg transition-colors">
                      Editar
                    </button>
                    {!esYo && (
                      <button
                        onClick={() => mutToggle.mutate({ id: u.id, activo: !u.activo })}
                        className={cn('text-xs font-medium px-3 py-1.5 rounded-lg transition-colors', u.activo ? 'bg-red-500/10 hover:bg-red-500/20 text-red-400' : 'bg-green-500/10 hover:bg-green-500/20 text-green-400')}
                      >
                        {u.activo ? 'Desactivar' : 'Activar'}
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Modal crear/editar */}
      {modal.open && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-[#111e35] rounded-2xl shadow-2xl w-full max-w-md border border-white/10">
            <div className="bg-[#003366] px-6 py-4 rounded-t-2xl">
              <h2 className="text-white font-semibold">{modal.editing ? 'Editar usuario' : 'Nuevo usuario'}</h2>
            </div>

            <form onSubmit={handleSubmit} className="px-6 py-5 space-y-4">
              <div>
                <label className="block text-xs font-medium text-slate-400 mb-1">Nombre completo</label>
                <input type="text" value={form.nombre} onChange={e => setForm(f => ({ ...f, nombre: e.target.value }))} required className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2.5 text-white text-sm placeholder-slate-500 focus:outline-none focus:border-blue-500" />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-400 mb-1">Correo electrónico</label>
                <input type="email" value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} required className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2.5 text-white text-sm placeholder-slate-500 focus:outline-none focus:border-blue-500" />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-400 mb-1">
                  Contraseña {modal.editing && <span className="text-slate-500">(dejar vacío para no cambiar)</span>}
                </label>
                <input type="password" value={form.password} onChange={e => setForm(f => ({ ...f, password: e.target.value }))} required={!modal.editing} minLength={6} placeholder={modal.editing ? '••••••••' : ''} className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2.5 text-white text-sm placeholder-slate-500 focus:outline-none focus:border-blue-500" />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-400 mb-1">Rol</label>
                <select value={form.rol} onChange={e => setForm(f => ({ ...f, rol: e.target.value }))} required className="w-full bg-[#0a1628] border border-white/10 rounded-lg px-3 py-2.5 text-white text-sm focus:outline-none focus:border-blue-500">
                  <option value="">Selecciona un rol...</option>
                  {roles.map(r => (
                    <option key={r.nombre} value={r.nombre}>{r.label}</option>
                  ))}
                </select>
              </div>

              <div className="flex items-center gap-3">
                <button type="button" onClick={() => setForm(f => ({ ...f, activo: !f.activo }))} className={cn('relative w-10 h-6 rounded-full transition-colors flex-shrink-0', form.activo ? 'bg-blue-600' : 'bg-white/10')}>
                  <span className={cn('absolute top-1 w-4 h-4 rounded-full bg-white transition-all', form.activo ? 'left-5' : 'left-1')} />
                </button>
                <span className="text-sm text-slate-300">Usuario activo</span>
              </div>

              {formError && (
                <p className="text-red-400 text-sm bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">{formError}</p>
              )}

              <div className="flex gap-3 pt-2">
                <button type="button" onClick={closeModal} className="flex-1 bg-white/5 hover:bg-white/10 text-slate-300 text-sm font-medium py-2.5 rounded-lg transition-colors">Cancelar</button>
                <button type="submit" disabled={isPending} className="flex-1 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-800 text-white text-sm font-semibold py-2.5 rounded-lg transition-colors flex items-center justify-center gap-2">
                  {isPending ? <><span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" /> Guardando...</> : (modal.editing ? 'Guardar cambios' : 'Crear usuario')}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
