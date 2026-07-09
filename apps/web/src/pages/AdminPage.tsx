import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { competenciasApi, serviciosApi, profesionalesApi, sedesApi, asignacionesApi, paquetesApi, type Profesional, type Servicio, type PlantillaPaquete } from '../api';
import { Avatar } from '../components/ui/Avatar';
import { cn } from '../utils/cn';
import { format } from 'date-fns';

type AdminTab = 'competencias' | 'paquetes' | 'profesionales' | 'servicios' | 'auditoria';

export function AdminPage() {
  const [tab, setTab] = useState<AdminTab>('competencias');

  const TABS: { id: AdminTab; label: string; icon: string }[] = [
    { id: 'competencias', label: 'Competencias', icon: '🎯' },
    { id: 'paquetes', label: 'Paquetes', icon: '📦' },
    { id: 'profesionales', label: 'Podólogas', icon: '👤' },
    { id: 'servicios', label: 'Servicios', icon: '📋' },
    { id: 'auditoria', label: 'Auditoría', icon: '📜' },
  ];

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <header className="bg-white border-b border-slate-200 px-6 py-4">
        <h1 className="text-lg font-bold text-slate-900">Administración</h1>
        <div className="flex gap-1 mt-3">
          {TABS.map(t => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={cn(
                'px-4 py-2 rounded-lg text-sm font-medium transition-all flex items-center gap-2',
                tab === t.id
                  ? 'bg-limablue-600 text-white'
                  : 'text-slate-600 hover:bg-slate-100'
              )}
            >
              <span>{t.icon}</span>
              {t.label}
            </button>
          ))}
        </div>
      </header>

      <div className="flex-1 overflow-y-auto">
        {tab === 'competencias' && <MatrizCompetencias />}
        {tab === 'paquetes' && <GestionPaquetes />}
        {tab === 'profesionales' && <GestionProfesionales />}
        {tab === 'servicios' && <GestionServicios />}
        {tab === 'auditoria' && <VisorAuditoria />}
      </div>
    </div>
  );
}

// ─── Matriz de Competencias ───────────────────────────────────────────────────

function MatrizCompetencias() {
  const qc = useQueryClient();
  const [filtroProf, setFiltroProf]       = useState('');
  const [sedeIdFiltro, setSedeIdFiltro]   = useState<string>('todas');
  const [unidadFiltro, setUnidadFiltro]   = useState<string>('todas');
  const [pendientes, setPendientes]        = useState<Record<string, boolean>>({});

  const { data: sedes }        = useQuery({ queryKey: ['sedes'], queryFn: sedesApi.listar });
  const { data: competencias } = useQuery({ queryKey: ['competencias'], queryFn: () => competenciasApi.listar() });
  const { data: profesionales } = useQuery({ queryKey: ['profesionales-todos'], queryFn: () => profesionalesApi.listar({ activo: true }) });
  const { data: servicios }    = useQuery({ queryKey: ['servicios-todos'], queryFn: () => serviciosApi.listar({ activo: true }) });

  const toggleMutation = useMutation({
    mutationFn: ({ profesionalId, servicioId, activa }: { profesionalId: string; servicioId: string; activa: boolean }) =>
      competenciasApi.toggle(profesionalId, servicioId, activa),
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: ['competencias'] });
      setPendientes(p => { const n = { ...p }; delete n[`${vars.profesionalId}::${vars.servicioId}`]; return n; });
    },
    onError: (e: Error, vars) => {
      toast.error(e.message);
      setPendientes(p => { const n = { ...p }; delete n[`${vars.profesionalId}::${vars.servicioId}`]; return n; });
    },
  });

  const toggle = (profesionalId: string, servicioId: string, activa: boolean) => {
    const key = `${profesionalId}::${servicioId}`;
    setPendientes(p => ({ ...p, [key]: true }));
    toggleMutation.mutate({ profesionalId, servicioId, activa });
    toast.success(activa ? '✓ Competencia agregada' : 'Competencia quitada', { duration: 1500 });
  };

  const tieneCompetencia = (profId: string, servId: string) =>
    competencias?.some(c => c.profesional.id === profId && c.servicio.id === servId && c.activa) ?? false;

  // Profesionales asignados a la sede seleccionada
  const profsFiltrados = (profesionales ?? [])
    .filter(p => p.tipo !== 'medico') // excluir Baros (no tienen competencias)
    .filter(p => sedeIdFiltro === 'todas' || p.sedeActual?.id === sedeIdFiltro)
    .filter(p => filtroProf === '' || `${p.nombres} ${p.apellidos}`.toLowerCase().includes(filtroProf.toLowerCase()));

  // Unidades de negocio disponibles
  const unidades = [...new Set((servicios ?? []).map(s => s.unidadNegocio.nombre))];

  const servsFiltrados = (servicios ?? [])
    .filter(s => unidadFiltro === 'todas' || s.unidadNegocio.nombre === unidadFiltro);

  // Bulk: activar/desactivar toda una fila o columna
  const toggleFila = (profId: string, activar: boolean, nombreProf: string) => {
    const accion = activar ? 'agregar' : 'quitar';
    const msg = activar
      ? `¿Estás segura de agregar todos los servicios a ${nombreProf}?`
      : `¿Estás segura de quitar todos los servicios a ${nombreProf}?`;
    if (!confirm(msg)) return;
    servsFiltrados.forEach(s => {
      const tiene = tieneCompetencia(profId, s.id);
      if (activar !== tiene) toggle(profId, s.id, activar);
    });
    void accion;
  };

  const toggleColumna = (servId: string, activar: boolean, nombreServ: string) => {
    const msg = activar
      ? `¿Estás segura de agregar "${nombreServ}" a todas las profesionales?`
      : `¿Estás segura de quitar "${nombreServ}" a todas las profesionales?`;
    if (!confirm(msg)) return;
    profsFiltrados.forEach(p => {
      const tiene = tieneCompetencia(p.id, servId);
      if (activar !== tiene) toggle(p.id, servId, activar);
    });
  };

  // Resumen de cobertura
  const totalCeldas = profsFiltrados.length * servsFiltrados.length;
  const totalActivas = profsFiltrados.reduce((acc, p) =>
    acc + servsFiltrados.filter(s => tieneCompetencia(p.id, s.id)).length, 0);
  const pct = totalCeldas > 0 ? Math.round((totalActivas / totalCeldas) * 100) : 0;

  return (
    <div className="p-6 space-y-4">
      {/* Filtros */}
      <div className="flex flex-wrap gap-3 items-end">
        <div>
          <label className="block text-xs font-semibold text-slate-500 mb-1">Sede</label>
          <select className="input text-sm" value={sedeIdFiltro} onChange={e => setSedeIdFiltro(e.target.value)}>
            <option value="todas">Todas las sedes</option>
            {sedes?.map(s => <option key={s.id} value={s.id}>{s.nombre}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-xs font-semibold text-slate-500 mb-1">Área</label>
          <select className="input text-sm" value={unidadFiltro} onChange={e => setUnidadFiltro(e.target.value)}>
            <option value="todas">Todas las áreas</option>
            {unidades.map(u => <option key={u} value={u}>{u}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-xs font-semibold text-slate-500 mb-1">Buscar profesional</label>
          <input className="input text-sm w-52" placeholder="Nombre..." value={filtroProf} onChange={e => setFiltroProf(e.target.value)} />
        </div>
        <div className="flex-1" />
        {/* Resumen cobertura */}
        <div className="flex items-center gap-3 bg-white border border-slate-200 rounded-xl px-4 py-2">
          <div>
            <p className="text-xs text-slate-500">Cobertura</p>
            <p className="text-sm font-bold text-slate-800">{totalActivas}/{totalCeldas} competencias</p>
          </div>
          <div className="w-24">
            <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
              <div className="h-full bg-limablue-500 rounded-full transition-all" style={{ width: `${pct}%` }} />
            </div>
            <p className="text-xs text-limablue-700 font-semibold text-right mt-0.5">{pct}%</p>
          </div>
        </div>
      </div>

      {profsFiltrados.length === 0 || servsFiltrados.length === 0 ? (
        <div className="bg-white rounded-xl border border-slate-200 p-12 text-center text-slate-400">
          <p className="text-lg mb-1">Sin resultados</p>
          <p className="text-sm">Ajusta los filtros para ver profesionales y servicios.</p>
        </div>
      ) : (
        <div className="overflow-auto max-h-[calc(100vh-320px)] bg-white rounded-xl border border-slate-200">
          <table className="text-sm border-collapse w-full">
            <thead>
              <tr>
                {/* Celda esquina */}
                <th className="sticky left-0 top-0 z-30 bg-slate-50 border-b border-r border-slate-200 px-3 py-2 min-w-[200px]">
                  <span className="text-xs text-slate-400 font-normal">
                    {profsFiltrados.length} prof. · {servsFiltrados.length} servicios
                  </span>
                </th>
                {servsFiltrados.map(s => {
                  const todosActivos = profsFiltrados.every(p => tieneCompetencia(p.id, s.id));
                  return (
                    <th key={s.id} className="sticky top-0 z-20 bg-white border-b border-slate-200 px-2 py-2 text-xs font-medium text-slate-600 min-w-[110px]">
                      <div className="w-2 h-2 rounded-full mx-auto mb-1" style={{ backgroundColor: s.color }} />
                      <div className="truncate text-center leading-tight">{s.nombre}</div>
                      <div className="text-slate-400 font-normal text-center">{s.duracionMinutos}min</div>
                      {/* Bulk columna */}
                      <button
                        onClick={() => toggleColumna(s.id, !todosActivos, s.nombre)}
                        className={cn(
                          'mt-1.5 mx-auto block text-xxs px-2 py-0.5 rounded-full border transition-all',
                          todosActivos
                            ? 'border-red-200 text-red-500 hover:bg-red-50'
                            : 'border-limablue-200 text-limablue-600 hover:bg-limablue-50'
                        )}
                      >
                        {todosActivos ? 'Quitar todas' : 'Agregar todas'}
                      </button>
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {profsFiltrados.map(prof => {
                const todosActivos = servsFiltrados.every(s => tieneCompetencia(prof.id, s.id));
                const algunoActivo = servsFiltrados.some(s => tieneCompetencia(prof.id, s.id));
                const count = servsFiltrados.filter(s => tieneCompetencia(prof.id, s.id)).length;

                return (
                  <tr key={prof.id} className="hover:bg-slate-50/70 group">
                    {/* Nombre profesional + bulk fila */}
                    <td className="sticky left-0 z-10 bg-white group-hover:bg-slate-50/70 border-b border-r border-slate-200 px-3 py-2">
                      <div className="flex items-center gap-2">
                        <Avatar iniciales={prof.iniciales} color={prof.colorAvatar} size="xs" />
                        <div className="min-w-0 flex-1">
                          <p className="text-xs font-medium text-slate-800 leading-tight truncate">
                            {prof.nombres.split(' ')[0]} {prof.apellidos.split(' ')[0]}
                          </p>
                          <div className="flex items-center gap-1.5 mt-0.5">
                            <span className="text-xxs text-slate-400">{count}/{servsFiltrados.length}</span>
                            <button
                              onClick={() => toggleFila(prof.id, !todosActivos, `${prof.nombres.split(' ')[0]} ${prof.apellidos.split(' ')[0]}`)}
                              className={cn(
                                'text-xxs px-1.5 py-0.5 rounded-full border transition-all',
                                todosActivos
                                  ? 'border-red-200 text-red-500 hover:bg-red-50'
                                  : algunoActivo
                                  ? 'border-amber-200 text-amber-600 hover:bg-amber-50'
                                  : 'border-limablue-200 text-limablue-600 hover:bg-limablue-50'
                              )}
                            >
                              {todosActivos ? 'Quitar todas' : 'Agregar todas'}
                            </button>
                          </div>
                        </div>
                      </div>
                    </td>

                    {/* Celdas de competencia */}
                    {servsFiltrados.map(srv => {
                      const activa = tieneCompetencia(prof.id, srv.id);
                      const key = `${prof.id}::${srv.id}`;
                      const isPending = !!pendientes[key];

                      return (
                        <td key={srv.id} className="border-b border-slate-100 text-center py-2 px-1">
                          <button
                            onClick={() => !isPending && toggle(prof.id, srv.id, !activa)}
                            disabled={isPending}
                            title={activa ? `Quitar "${srv.nombre}" de ${prof.nombres}` : `Agregar "${srv.nombre}" a ${prof.nombres}`}
                            className={cn(
                              'w-7 h-7 rounded-lg transition-all border flex items-center justify-center mx-auto',
                              isPending && 'opacity-50 cursor-wait',
                              activa
                                ? 'bg-limablue-500 border-limablue-600 text-white hover:bg-red-500 hover:border-red-600'
                                : 'bg-white border-slate-200 hover:border-limablue-400 hover:bg-limablue-50'
                            )}
                            aria-label={`${activa ? 'Quitar' : 'Agregar'} ${srv.nombre}`}
                          >
                            {isPending ? (
                              <svg className="w-3 h-3 animate-spin" fill="none" viewBox="0 0 24 24">
                                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z"/>
                              </svg>
                            ) : activa ? (
                              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                              </svg>
                            ) : (
                              <svg className="w-3 h-3 text-slate-300" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                              </svg>
                            )}
                          </button>
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <p className="text-xs text-slate-400">
        Haz clic en una celda para agregar o quitar la competencia. Hover sobre una celda azul la marca en rojo = quitar.
        Usa los botones de fila/columna para operaciones masivas.
      </p>
    </div>
  );
}

// ─── Gestión de Paquetes ─────────────────────────────────────────────────────

function GestionPaquetes() {
  const qc = useQueryClient();
  const [editando, setEditando] = useState<PlantillaPaquete | null>(null);
  const [creando, setCreando] = useState(false);

  const { data: paquetes, isLoading } = useQuery({
    queryKey: ['paquetes-admin'],
    queryFn: paquetesApi.plantillas,
  });
  const { data: servicios } = useQuery({
    queryKey: ['servicios-todos'],
    queryFn: () => serviciosApi.listar({ activo: true }),
  });

  const crearMut = useMutation({
    mutationFn: paquetesApi.crear,
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['paquetes-admin'] }); setCreando(false); toast.success('Paquete creado'); },
    onError: (e: Error) => toast.error(e.message),
  });
  const actualizarMut = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Parameters<typeof paquetesApi.actualizar>[1] }) => paquetesApi.actualizar(id, data),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['paquetes-admin'] }); setEditando(null); toast.success('Paquete actualizado'); },
    onError: (e: Error) => toast.error(e.message),
  });
  const eliminarMut = useMutation({
    mutationFn: paquetesApi.eliminar,
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['paquetes-admin'] }); toast.success('Paquete eliminado'); },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="p-6 space-y-6 max-w-3xl">
      {/* Encabezado */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-base font-semibold text-slate-900">Paquetes de sesiones</h2>
          <p className="text-sm text-slate-500 mt-0.5">
            Los paquetes activos aparecen como un círculo numerado en las tarjetas de la agenda.
          </p>
        </div>
        <button
          onClick={() => { setCreando(true); setEditando(null); }}
          className="btn btn-primary btn-sm"
        >
          + Nuevo paquete
        </button>
      </div>

      {/* Formulario nuevo */}
      {creando && (
        <FormularioPaquete
          servicios={servicios ?? []}
          onGuardar={(data) => crearMut.mutate(data)}
          onCancelar={() => setCreando(false)}
          guardando={crearMut.isPending}
        />
      )}

      {/* Lista de paquetes */}
      {isLoading ? (
        <p className="text-sm text-slate-400">Cargando…</p>
      ) : (paquetes ?? []).length === 0 ? (
        <div className="bg-white rounded-xl border border-dashed border-slate-300 p-12 text-center text-slate-400">
          <div className="text-4xl mb-3">📦</div>
          <p className="font-medium">Sin paquetes configurados</p>
          <p className="text-sm mt-1">Crea el primer paquete con el botón de arriba</p>
        </div>
      ) : (
        <div className="space-y-3">
          {(paquetes ?? []).map(p => (
            <div key={p.id}>
              {editando?.id === p.id ? (
                <FormularioPaquete
                  inicial={p}
                  servicios={servicios ?? []}
                  onGuardar={(data) => actualizarMut.mutate({ id: p.id, data })}
                  onCancelar={() => setEditando(null)}
                  guardando={actualizarMut.isPending}
                />
              ) : (
                <div className="bg-white rounded-xl border border-slate-200 px-5 py-4 flex items-center gap-4">
                  {/* Círculo de sesión demo */}
                  <div
                    className="w-9 h-9 rounded-full flex items-center justify-center font-bold text-white text-sm shrink-0"
                    style={{ backgroundColor: p.servicio.color || '#6366f1' }}
                    title="Así aparece en las tarjetas de agenda"
                  >
                    {p.totalSesiones}
                  </div>

                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-slate-900 text-sm">{p.nombre}</p>
                    <div className="flex items-center gap-3 mt-0.5 flex-wrap">
                      <span className="text-xs text-slate-500">
                        <span className="inline-block w-2 h-2 rounded-full mr-1" style={{ backgroundColor: p.servicio.color }} />
                        {p.servicio.nombre}
                      </span>
                      <span className="text-xs text-slate-500">{p.totalSesiones} sesiones</span>
                      {p.precio && (
                        <span className="text-xs text-slate-500">S/ {Number(p.precio).toFixed(2)}</span>
                      )}
                      {p.consumeNoShow && (
                        <span className="text-xxs px-1.5 py-0.5 bg-amber-100 text-amber-700 rounded-full">cuenta no-shows</span>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      onClick={() => { setEditando(p); setCreando(false); }}
                      className="text-xs px-3 py-1.5 rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50 transition-colors"
                    >
                      Editar
                    </button>
                    <button
                      onClick={() => { if (confirm(`¿Eliminar "${p.nombre}"?`)) eliminarMut.mutate(p.id); }}
                      className="text-xs px-3 py-1.5 rounded-lg border border-red-200 text-red-500 hover:bg-red-50 transition-colors"
                    >
                      Eliminar
                    </button>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      <div className="bg-slate-50 rounded-xl p-4 border border-slate-200">
        <p className="text-xs font-semibold text-slate-600 mb-1">¿Cómo funciona?</p>
        <ul className="text-xs text-slate-500 space-y-1 list-disc list-inside">
          <li>Al crear una cita puedes vincularla a un paquete activo del paciente</li>
          <li>El número de sesión aparece como un círculo oscuro en la esquina de la tarjeta (1, 2, 3…)</li>
          <li>Al marcar la cita como <strong>completada</strong> se incrementa automáticamente el contador de sesiones usadas</li>
          <li>Puedes elegir si los no-shows cuentan como sesión usada</li>
        </ul>
      </div>
    </div>
  );
}

interface FormularioPaqueteProps {
  inicial?: PlantillaPaquete;
  servicios: Servicio[];
  onGuardar: (data: { nombre: string; servicioId: string; totalSesiones: number; consumeNoShow: boolean; precio?: number }) => void;
  onCancelar: () => void;
  guardando: boolean;
}

function FormularioPaquete({ inicial, servicios, onGuardar, onCancelar, guardando }: FormularioPaqueteProps) {
  const [nombre, setNombre]               = useState(inicial?.nombre ?? '');
  const [servicioId, setServicioId]       = useState(inicial?.servicio.id ?? '');
  const [totalSesiones, setTotalSesiones] = useState(String(inicial?.totalSesiones ?? 10));
  const [precio, setPrecio]               = useState(inicial?.precio ? String(Number(inicial.precio)) : '');
  const [consumeNoShow, setConsumeNoShow] = useState(inicial?.consumeNoShow ?? false);

  const submit = () => {
    if (!nombre.trim() || !servicioId || !totalSesiones) { toast.error('Completa los campos obligatorios'); return; }
    onGuardar({
      nombre: nombre.trim(),
      servicioId,
      totalSesiones: parseInt(totalSesiones),
      consumeNoShow,
      ...(precio ? { precio: parseFloat(precio) } : {}),
    });
  };

  const SESIONES_RAPIDAS = [6, 12];

  return (
    <div className="bg-slate-50 rounded-xl border border-limablue-200 p-5 space-y-4">
      <p className="text-sm font-semibold text-slate-800">{inicial ? 'Editar paquete' : 'Nuevo paquete'}</p>

      <div className="grid grid-cols-2 gap-3">
        <div className="col-span-2">
          <label className="block text-xs font-semibold text-slate-500 mb-1">Nombre del paquete *</label>
          <input
            className="input w-full text-sm"
            placeholder="Ej: Paquete Láser Alta 12 sesiones"
            value={nombre}
            onChange={e => setNombre(e.target.value)}
          />
        </div>

        <div>
          <label className="block text-xs font-semibold text-slate-500 mb-1">Servicio *</label>
          <select className="input w-full text-sm" value={servicioId} onChange={e => setServicioId(e.target.value)}>
            <option value="">Seleccionar servicio…</option>
            {servicios.map(s => (
              <option key={s.id} value={s.id}>{s.nombre} ({s.unidadNegocio.nombre})</option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-xs font-semibold text-slate-500 mb-1">N° de sesiones *</label>
          <input
            className="input w-full text-sm"
            type="number"
            min="1"
            max="100"
            value={totalSesiones}
            onChange={e => setTotalSesiones(e.target.value)}
          />
          <div className="flex gap-1 mt-1.5 flex-wrap">
            {SESIONES_RAPIDAS.map(n => (
              <button
                key={n}
                onClick={() => setTotalSesiones(String(n))}
                className={cn(
                  'text-xxs px-2 py-0.5 rounded-full border transition-all',
                  String(n) === totalSesiones
                    ? 'bg-limablue-600 text-white border-limablue-600'
                    : 'bg-white text-slate-600 border-slate-200 hover:border-limablue-400'
                )}
              >
                {n}
              </button>
            ))}
          </div>
        </div>

        <div>
          <label className="block text-xs font-semibold text-slate-500 mb-1">Precio S/ (opcional)</label>
          <input
            className="input w-full text-sm"
            type="number"
            min="0"
            step="0.01"
            placeholder="0.00"
            value={precio}
            onChange={e => setPrecio(e.target.value)}
          />
        </div>

        <div className="flex items-center gap-2 self-end pb-1">
          <input
            id="consume-noshow"
            type="checkbox"
            checked={consumeNoShow}
            onChange={e => setConsumeNoShow(e.target.checked)}
            className="w-4 h-4 rounded border-slate-300 text-limablue-600"
          />
          <label htmlFor="consume-noshow" className="text-xs text-slate-600 cursor-pointer">
            Los no-shows cuentan como sesión
          </label>
        </div>
      </div>

      <div className="flex gap-2 pt-1">
        <button onClick={submit} disabled={guardando} className="btn btn-primary btn-sm">
          {guardando ? 'Guardando…' : (inicial ? 'Guardar cambios' : 'Crear paquete')}
        </button>
        <button onClick={onCancelar} className="btn btn-secondary btn-sm">Cancelar</button>
      </div>
    </div>
  );
}

// ─── Gestión de Profesionales ─────────────────────────────────────────────────

const AVATAR_COLORES = [
  '#3B82F6', '#8B5CF6', '#EC4899', '#F59E0B', '#10B981',
  '#EF4444', '#06B6D4', '#84CC16', '#F97316', '#6B7280',
];

const TIPO_LABELS: Record<string, string> = {
  podologa: 'Podóloga',
  medico: 'Médico',
  fisioterapeuta: 'Fisioterapeuta',
};

interface FormProfesional {
  nombres: string;
  apellidos: string;
  tipo: string;
  unidadNegocioId: string;
  colorAvatar: string;
}

function FormularioProfesional({
  inicial,
  unidades,
  onGuardar,
  onCancelar,
  guardando,
}: {
  inicial?: Partial<FormProfesional>;
  unidades: { id: string; nombre: string }[];
  onGuardar: (data: FormProfesional) => void;
  onCancelar: () => void;
  guardando: boolean;
}) {
  const [nombres, setNombres] = useState(inicial?.nombres ?? '');
  const [apellidos, setApellidos] = useState(inicial?.apellidos ?? '');
  const [tipo, setTipo] = useState(inicial?.tipo ?? 'podologa');
  const [unidadNegocioId, setUnidadNegocioId] = useState(inicial?.unidadNegocioId ?? '');
  const [colorAvatar, setColorAvatar] = useState(inicial?.colorAvatar ?? AVATAR_COLORES[0]);

  const submit = () => {
    if (!nombres.trim() || !apellidos.trim() || !unidadNegocioId) {
      toast.error('Completa nombres, apellidos y área');
      return;
    }
    onGuardar({ nombres: nombres.trim(), apellidos: apellidos.trim(), tipo, unidadNegocioId, colorAvatar });
  };

  return (
    <div className="bg-slate-50 rounded-xl border border-limablue-200 p-5 space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-xs font-semibold text-slate-500 mb-1">Nombres *</label>
          <input className="input w-full text-sm" value={nombres} onChange={e => setNombres(e.target.value)} placeholder="Ej: Ana María" />
        </div>
        <div>
          <label className="block text-xs font-semibold text-slate-500 mb-1">Apellidos *</label>
          <input className="input w-full text-sm" value={apellidos} onChange={e => setApellidos(e.target.value)} placeholder="Ej: López Torres" />
        </div>
        <div>
          <label className="block text-xs font-semibold text-slate-500 mb-1">Tipo</label>
          <select className="input w-full text-sm" value={tipo} onChange={e => setTipo(e.target.value)}>
            {Object.entries(TIPO_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-xs font-semibold text-slate-500 mb-1">Área *</label>
          <select className="input w-full text-sm" value={unidadNegocioId} onChange={e => setUnidadNegocioId(e.target.value)}>
            <option value="">Seleccionar área…</option>
            {unidades.map(u => <option key={u.id} value={u.id}>{u.nombre}</option>)}
          </select>
        </div>
        <div className="col-span-2">
          <label className="block text-xs font-semibold text-slate-500 mb-1.5">Color de avatar</label>
          <div className="flex gap-2 flex-wrap">
            {AVATAR_COLORES.map(c => (
              <button
                key={c}
                type="button"
                onClick={() => setColorAvatar(c)}
                className={cn(
                  'w-7 h-7 rounded-full border-2 transition-all',
                  colorAvatar === c ? 'border-slate-800 scale-110' : 'border-transparent hover:scale-105'
                )}
                style={{ backgroundColor: c }}
              />
            ))}
          </div>
          <div className="flex items-center gap-2 mt-2">
            <span
              className="w-8 h-8 rounded-full flex items-center justify-center text-white text-xs font-bold"
              style={{ backgroundColor: colorAvatar }}
            >
              {(nombres[0] ?? '?')}{(apellidos[0] ?? '')}
            </span>
            <span className="text-xs text-slate-500">Vista previa del avatar</span>
          </div>
        </div>
      </div>
      <div className="flex gap-2 pt-1">
        <button onClick={submit} disabled={guardando} className="btn btn-primary btn-sm">
          {guardando ? 'Guardando…' : (inicial?.nombres ? 'Guardar cambios' : 'Crear profesional')}
        </button>
        <button onClick={onCancelar} className="btn btn-secondary btn-sm">Cancelar</button>
      </div>
    </div>
  );
}

function GestionProfesionales() {
  const qc = useQueryClient();
  const [filtro, setFiltro] = useState<'todos' | 'activos' | 'inactivos'>('activos');
  const [busqueda, setBusqueda] = useState('');
  const [creando, setCreando] = useState(false);
  const [editandoId, setEditandoId] = useState<string | null>(null);

  const { data: profesionales, isLoading } = useQuery({
    queryKey: ['profesionales-admin'],
    queryFn: () => profesionalesApi.listar({}),
  });
  const { data: sedes } = useQuery({ queryKey: ['sedes'], queryFn: sedesApi.listar });

  const unidades = [...new Map(
    (sedes ?? []).flatMap(s => s.unidadesNegocio).map(u => [u.id, u])
  ).values()];

  const crearMut = useMutation({
    mutationFn: (data: FormProfesional) => profesionalesApi.crear(data),
    onSuccess: (p) => {
      qc.invalidateQueries({ queryKey: ['profesionales'] });
      qc.invalidateQueries({ queryKey: ['profesionales-admin'] });
      qc.invalidateQueries({ queryKey: ['profesionales-todos'] });
      setCreando(false);
      toast.success(`${p.nombres} ${p.apellidos} agregada al sistema`);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const editarMut = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<FormProfesional & { activo: boolean }> }) =>
      profesionalesApi.editar(id, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['profesionales'] });
      qc.invalidateQueries({ queryKey: ['profesionales-admin'] });
      qc.invalidateQueries({ queryKey: ['profesionales-todos'] });
      setEditandoId(null);
      toast.success('Profesional actualizada');
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const toggleActivo = (prof: Profesional) => {
    const accion = prof.activo ? 'desactivar' : 'reactivar';
    const msg = prof.activo
      ? `¿Desactivar a ${prof.nombres} ${prof.apellidos}? Dejará de aparecer en la agenda.`
      : `¿Reactivar a ${prof.nombres} ${prof.apellidos}?`;
    if (!confirm(msg)) return;
    editarMut.mutate({ id: prof.id, data: { activo: !prof.activo } });
    toast.success(prof.activo ? 'Profesional desactivada' : 'Profesional reactivada', { duration: 2000 });
    void accion;
  };

  const profsFiltrados = (profesionales ?? [])
    .filter(p => filtro === 'todos' ? true : filtro === 'activos' ? p.activo : !p.activo)
    .filter(p => busqueda === '' || `${p.nombres} ${p.apellidos}`.toLowerCase().includes(busqueda.toLowerCase()));

  return (
    <div className="p-6 space-y-4">
      {/* Controles superiores */}
      <div className="flex flex-wrap gap-3 items-end justify-between">
        <div className="flex gap-2 items-end flex-wrap">
          <div>
            <label className="block text-xs font-semibold text-slate-500 mb-1">Estado</label>
            <select className="input text-sm" value={filtro} onChange={e => setFiltro(e.target.value as typeof filtro)}>
              <option value="activos">Solo activas</option>
              <option value="inactivos">Solo inactivas</option>
              <option value="todos">Todas</option>
            </select>
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-500 mb-1">Buscar</label>
            <input
              className="input text-sm w-52"
              placeholder="Nombre o apellido…"
              value={busqueda}
              onChange={e => setBusqueda(e.target.value)}
            />
          </div>
        </div>
        <button
          onClick={() => { setCreando(true); setEditandoId(null); }}
          className="btn btn-primary btn-sm"
        >
          + Nueva podóloga
        </button>
      </div>

      {/* Formulario creación */}
      {creando && (
        <FormularioProfesional
          unidades={unidades}
          onGuardar={(data) => crearMut.mutate(data)}
          onCancelar={() => setCreando(false)}
          guardando={crearMut.isPending}
        />
      )}

      {/* Lista */}
      {isLoading ? (
        <div className="flex items-center justify-center py-16">
          <div className="w-8 h-8 border-2 border-limablue-500 border-t-transparent rounded-full animate-spin" />
        </div>
      ) : profsFiltrados.length === 0 ? (
        <div className="bg-white rounded-xl border border-dashed border-slate-300 p-12 text-center text-slate-400">
          <p className="text-3xl mb-2">👤</p>
          <p className="font-medium">Sin resultados</p>
          <p className="text-sm mt-1">Ajusta los filtros o crea una nueva profesional</p>
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-xs text-slate-500 border-b border-slate-100 bg-slate-50">
                <th className="px-5 py-2.5 text-left font-semibold">Profesional</th>
                <th className="px-4 py-2.5 text-left font-semibold">Tipo</th>
                <th className="px-4 py-2.5 text-left font-semibold">Área</th>
                <th className="px-4 py-2.5 text-left font-semibold">Sede actual</th>
                <th className="px-4 py-2.5 text-left font-semibold">Estado</th>
                <th className="px-4 py-2.5 text-left font-semibold">Acciones</th>
              </tr>
            </thead>
            <tbody>
              {profsFiltrados.map(prof => (
                <>
                  <tr key={prof.id} className={cn('border-b border-slate-50 hover:bg-slate-50/70', !prof.activo && 'opacity-60')}>
                    <td className="px-5 py-3">
                      <div className="flex items-center gap-2.5">
                        <Avatar iniciales={prof.iniciales} color={prof.colorAvatar} size="sm" />
                        <div>
                          <p className="font-medium text-slate-800">{prof.nombres} {prof.apellidos}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-slate-600 text-xs">{TIPO_LABELS[prof.tipo] ?? prof.tipo}</td>
                    <td className="px-4 py-3 text-slate-600 text-xs">{prof.unidadNegocio.nombre}</td>
                    <td className="px-4 py-3 text-xs">
                      {prof.sedeActual ? (
                        <span className="flex items-center gap-1.5">
                          <span className="w-2 h-2 rounded-full" style={{ backgroundColor: prof.sedeActual.color }} />
                          {prof.sedeActual.nombre}
                        </span>
                      ) : (
                        <span className="text-slate-400">Sin sede</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <span className={cn(
                        'inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium',
                        prof.activo ? 'bg-green-100 text-green-700' : 'bg-slate-100 text-slate-500'
                      )}>
                        {prof.activo ? 'Activa' : 'Inactiva'}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex gap-2">
                        <button
                          onClick={() => { setEditandoId(prof.id); setCreando(false); }}
                          className="text-xs px-2.5 py-1 rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50 transition-colors"
                        >
                          Editar
                        </button>
                        <button
                          onClick={() => toggleActivo(prof)}
                          className={cn(
                            'text-xs px-2.5 py-1 rounded-lg border transition-colors',
                            prof.activo
                              ? 'border-red-200 text-red-500 hover:bg-red-50'
                              : 'border-green-200 text-green-600 hover:bg-green-50'
                          )}
                        >
                          {prof.activo ? 'Desactivar' : 'Reactivar'}
                        </button>
                      </div>
                    </td>
                  </tr>
                  {editandoId === prof.id && (
                    <tr key={`${prof.id}-form`} className="bg-slate-50/50">
                      <td colSpan={6} className="px-5 py-4">
                        <FormularioProfesional
                          inicial={{ nombres: prof.nombres, apellidos: prof.apellidos, tipo: prof.tipo, unidadNegocioId: prof.unidadNegocio.id, colorAvatar: prof.colorAvatar }}
                          unidades={unidades}
                          onGuardar={(data) => editarMut.mutate({ id: prof.id, data })}
                          onCancelar={() => setEditandoId(null)}
                          guardando={editarMut.isPending}
                        />
                      </td>
                    </tr>
                  )}
                </>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="text-xs text-slate-400">
        Las profesionales desactivadas no aparecen en la agenda ni en la lista de movimientos.
        Para asignar una profesional a una sede, usa el módulo de <strong>Movimientos</strong>.
      </p>
    </div>
  );
}

// ─── Gestión de Servicios ─────────────────────────────────────────────────────

interface FormServicio {
  nombre: string;
  codigo: string;
  duracionMinutos: string;
  color: string;
  precioReferencial: string;
  unidadNegocioId: string;
}

function FormularioServicio({
  inicial,
  unidades,
  onGuardar,
  onCancelar,
  guardando,
}: {
  inicial?: Partial<FormServicio>;
  unidades: { id: string; nombre: string }[];
  onGuardar: (data: FormServicio) => void;
  onCancelar: () => void;
  guardando: boolean;
}) {
  const [nombre, setNombre] = useState(inicial?.nombre ?? '');
  const [codigo, setCodigo] = useState(inicial?.codigo ?? '');
  const [duracionMinutos, setDuracionMinutos] = useState(inicial?.duracionMinutos ?? '30');
  const [color, setColor] = useState(inicial?.color ?? '#6B7F9E');
  const [precioReferencial, setPrecioReferencial] = useState(inicial?.precioReferencial ?? '');
  const [unidadNegocioId, setUnidadNegocioId] = useState(inicial?.unidadNegocioId ?? '');

  const submit = () => {
    if (!nombre.trim() || !unidadNegocioId || !duracionMinutos) {
      toast.error('Completa nombre, área y duración');
      return;
    }
    // El código lo asigna el backend automáticamente (POD-/BAR-/FIS-…). En edición se conserva el existente.
    onGuardar({ nombre: nombre.trim(), codigo: codigo.trim(), duracionMinutos, color, precioReferencial, unidadNegocioId });
  };

  const DURACIONES = [30, 60];

  return (
    <div className="bg-slate-50 rounded-xl border border-limablue-200 p-5 space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <div className="col-span-2">
          <label className="block text-xs font-semibold text-slate-500 mb-1">Nombre del servicio *</label>
          <input
            className="input w-full text-sm"
            placeholder="Ej: Láser Alta Intensidad"
            value={nombre}
            onChange={e => setNombre(e.target.value)}
          />
        </div>
        <div>
          <label className="block text-xs font-semibold text-slate-500 mb-1">Código</label>
          <input
            className="input w-full text-sm font-mono bg-slate-100 text-slate-500 cursor-not-allowed"
            value={codigo || 'Automático (POD-/BAR-/FIS-…)'}
            readOnly
            disabled
          />
        </div>
        <div>
          <label className="block text-xs font-semibold text-slate-500 mb-1">Área *</label>
          <select className="input w-full text-sm" value={unidadNegocioId} onChange={e => setUnidadNegocioId(e.target.value)}>
            <option value="">Seleccionar área…</option>
            {unidades.map(u => <option key={u.id} value={u.id}>{u.nombre}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-xs font-semibold text-slate-500 mb-1">Duración (min) *</label>
          <input
            className="input w-full text-sm"
            type="number" min="5" max="240"
            value={duracionMinutos}
            onChange={e => setDuracionMinutos(e.target.value)}
          />
          <div className="flex gap-1 mt-1.5 flex-wrap">
            {DURACIONES.map(d => (
              <button
                key={d}
                type="button"
                onClick={() => setDuracionMinutos(String(d))}
                className={cn(
                  'text-xxs px-2 py-0.5 rounded-full border transition-all',
                  String(d) === duracionMinutos
                    ? 'bg-limablue-600 text-white border-limablue-600'
                    : 'bg-white text-slate-600 border-slate-200 hover:border-limablue-400'
                )}
              >{d}m</button>
            ))}
          </div>
        </div>
        <div>
          <label className="block text-xs font-semibold text-slate-500 mb-1">Precio ref. S/ (opcional)</label>
          <input
            className="input w-full text-sm"
            type="number" min="0" step="0.01" placeholder="0.00"
            value={precioReferencial}
            onChange={e => setPrecioReferencial(e.target.value)}
          />
        </div>
        <div className="col-span-2">
          <label className="block text-xs font-semibold text-slate-500 mb-1.5">Color en agenda</label>
          <div className="flex items-center gap-3">
            <input type="color" value={color} onChange={e => setColor(e.target.value)} className="w-8 h-8 rounded cursor-pointer border border-slate-200" />
            <div className="flex gap-2 flex-wrap">
              {['#3B82F6','#8B5CF6','#EC4899','#F59E0B','#10B981','#EF4444','#06B6D4','#F97316'].map(c => (
                <button key={c} type="button" onClick={() => setColor(c)}
                  className={cn('w-6 h-6 rounded-full border-2 transition-all', color === c ? 'border-slate-800 scale-110' : 'border-transparent')}
                  style={{ backgroundColor: c }}
                />
              ))}
            </div>
            <span className="text-xs px-2 py-0.5 rounded font-medium text-white" style={{ backgroundColor: color }}>{nombre || 'Vista previa'}</span>
          </div>
        </div>
      </div>
      <div className="flex gap-2 pt-1">
        <button onClick={submit} disabled={guardando} className="btn btn-primary btn-sm">
          {guardando ? 'Guardando…' : (inicial?.nombre ? 'Guardar cambios' : 'Crear servicio')}
        </button>
        <button onClick={onCancelar} className="btn btn-secondary btn-sm">Cancelar</button>
      </div>
    </div>
  );
}

function GestionServicios() {
  const qc = useQueryClient();
  const [creando, setCreando] = useState(false);
  const [editandoId, setEditandoId] = useState<string | null>(null);
  const [subcatDe, setSubcatDe] = useState<string | null>(null); // servicioId con panel de subcategorías abierto
  const [mostrarInactivos, setMostrarInactivos] = useState(false);

  const { data: servicios, isLoading } = useQuery({
    queryKey: ['servicios-admin'],
    queryFn: () => serviciosApi.listar(),
  });
  const { data: sedes } = useQuery({ queryKey: ['sedes'], queryFn: sedesApi.listar });

  const unidades = [...new Map(
    (sedes ?? []).flatMap(s => s.unidadesNegocio).map(u => [u.id, u])
  ).values()];

  const crearMut = useMutation({
    mutationFn: (data: FormServicio) => serviciosApi.crear({
      nombre: data.nombre,
      // El código lo genera el backend (POD-/BAR-/FIS-NN). Solo se envía si el
      // usuario escribió uno; vacío → se omite (el esquema pide min 2).
      ...(data.codigo.trim() ? { codigo: data.codigo.trim() } : {}),
      duracionMinutos: parseInt(data.duracionMinutos),
      color: data.color,
      unidadNegocioId: data.unidadNegocioId,
      // Precio opcional: 0 / vacío = sin precio → se omite (el esquema pide > 0).
      ...(parseFloat(data.precioReferencial) > 0 ? { precioReferencial: parseFloat(data.precioReferencial) } : {}),
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['servicios'] });
      qc.invalidateQueries({ queryKey: ['servicios-admin'] });
      qc.invalidateQueries({ queryKey: ['servicios-todos'] });
      setCreando(false);
      toast.success('Servicio creado');
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const editarMut = useMutation({
    mutationFn: ({ id, data }: { id: string; data: FormServicio }) => serviciosApi.editar(id, {
      nombre: data.nombre,
      ...(data.codigo.trim() ? { codigo: data.codigo.trim() } : {}),
      duracionMinutos: parseInt(data.duracionMinutos),
      color: data.color,
      unidadNegocioId: data.unidadNegocioId,
      ...(parseFloat(data.precioReferencial) > 0 ? { precioReferencial: parseFloat(data.precioReferencial) } : {}),
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['servicios'] });
      qc.invalidateQueries({ queryKey: ['servicios-admin'] });
      qc.invalidateQueries({ queryKey: ['servicios-todos'] });
      setEditandoId(null);
      toast.success('Servicio actualizado');
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const toggleActivoMut = useMutation({
    mutationFn: ({ id, activo }: { id: string; activo: boolean }) => serviciosApi.editar(id, { activo }),
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: ['servicios'] });
      qc.invalidateQueries({ queryKey: ['servicios-admin'] });
      qc.invalidateQueries({ queryKey: ['servicios-todos'] });
      toast.success(vars.activo ? 'Servicio activado' : 'Servicio desactivado');
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const listaFiltrada = (servicios ?? []).filter(s => mostrarInactivos ? !s.activo : s.activo);

  const serviciosPorUnidad = listaFiltrada.reduce((acc, s) => {
    const nombre = s.unidadNegocio.nombre;
    if (!acc[nombre]) acc[nombre] = [];
    acc[nombre].push(s);
    return acc;
  }, {} as Record<string, Servicio[]>);

  return (
    <div className="p-6 space-y-5 max-w-4xl">
      {/* Controles */}
      <div className="flex items-center justify-between">
        <div className="flex gap-2">
          <button
            onClick={() => setMostrarInactivos(false)}
            className={cn('px-3 py-1.5 rounded-lg text-sm font-medium border transition-all',
              !mostrarInactivos ? 'bg-limablue-600 text-white border-limablue-600' : 'border-slate-200 text-slate-600 hover:bg-slate-50')}
          >
            Activos ({(servicios ?? []).filter(s => s.activo).length})
          </button>
          <button
            onClick={() => setMostrarInactivos(true)}
            className={cn('px-3 py-1.5 rounded-lg text-sm font-medium border transition-all',
              mostrarInactivos ? 'bg-slate-700 text-white border-slate-700' : 'border-slate-200 text-slate-600 hover:bg-slate-50')}
          >
            Inactivos ({(servicios ?? []).filter(s => !s.activo).length})
          </button>
        </div>
        <button
          onClick={() => { setCreando(true); setEditandoId(null); }}
          className="btn btn-primary btn-sm"
        >
          + Nuevo servicio
        </button>
      </div>

      {/* Formulario creación */}
      {creando && (
        <FormularioServicio
          unidades={unidades}
          onGuardar={(data) => crearMut.mutate(data)}
          onCancelar={() => setCreando(false)}
          guardando={crearMut.isPending}
        />
      )}

      {/* Tabla por área */}
      {isLoading ? (
        <div className="flex items-center justify-center py-16">
          <div className="w-8 h-8 border-2 border-limablue-500 border-t-transparent rounded-full animate-spin" />
        </div>
      ) : Object.entries(serviciosPorUnidad).length === 0 ? (
        <div className="bg-white rounded-xl border border-dashed border-slate-300 p-12 text-center text-slate-400">
          <p className="text-3xl mb-2">📋</p>
          <p className="font-medium">Sin servicios {mostrarInactivos ? 'inactivos' : 'activos'}</p>
        </div>
      ) : (
        Object.entries(serviciosPorUnidad).map(([unidad, lista]) => (
          <div key={unidad} className="bg-white rounded-xl border border-slate-200 overflow-hidden">
            <div className="px-5 py-3 border-b border-slate-100 bg-slate-50">
              <h3 className="font-semibold text-slate-800">{unidad}</h3>
            </div>
            <table className="w-full text-sm">
              <thead>
                <tr className="text-xs text-slate-500 border-b border-slate-100">
                  <th className="px-5 py-2 text-left font-semibold">Servicio</th>
                  <th className="px-4 py-2 text-left font-semibold">Código</th>
                  <th className="px-4 py-2 text-left font-semibold">Duración</th>
                  <th className="px-4 py-2 text-left font-semibold">Precio ref.</th>
                  <th className="px-4 py-2 text-left font-semibold">Acciones</th>
                </tr>
              </thead>
              <tbody>
                {lista.map(s => (
                  <>
                    <tr key={s.id} className="border-b border-slate-50 hover:bg-slate-50/70">
                      <td className="px-5 py-2.5">
                        <div className="flex items-center gap-2">
                          <div className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: s.color }} />
                          <span className="font-medium text-slate-800">{s.nombre}</span>
                        </div>
                      </td>
                      <td className="px-4 py-2.5 font-mono text-xs text-slate-500">{s.codigo}</td>
                      <td className="px-4 py-2.5 text-slate-600">{s.duracionMinutos} min</td>
                      <td className="px-4 py-2.5 text-slate-600">
                        {s.precioReferencial ? `S/ ${Number(s.precioReferencial).toFixed(2)}` : '—'}
                      </td>
                      <td className="px-4 py-2.5">
                        <div className="flex gap-2">
                          <button
                            onClick={() => { setEditandoId(s.id); setCreando(false); }}
                            className="text-xs px-2.5 py-1 rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50 transition-colors"
                          >
                            Editar
                          </button>
                          <button
                            onClick={() => setSubcatDe(prev => prev === s.id ? null : s.id)}
                            className={cn('text-xs px-2.5 py-1 rounded-lg border transition-colors',
                              subcatDe === s.id ? 'border-violet-300 bg-violet-50 text-violet-700' : 'border-slate-200 text-slate-600 hover:bg-slate-50')}
                            title="Subcategorías (ej. Profilaxis → Regular/Premium/…)"
                          >
                            Tipos{(s.subcategorias?.length ?? 0) > 0 ? ` (${s.subcategorias!.length})` : ''}
                          </button>
                          <button
                            onClick={() => toggleActivoMut.mutate({ id: s.id, activo: !s.activo })}
                            disabled={toggleActivoMut.isPending}
                            className={cn(
                              'text-xs px-2.5 py-1 rounded-lg border transition-colors',
                              s.activo
                                ? 'border-red-200 text-red-500 hover:bg-red-50'
                                : 'border-green-200 text-green-600 hover:bg-green-50'
                            )}
                          >
                            {s.activo ? 'Desactivar' : 'Activar'}
                          </button>
                        </div>
                      </td>
                    </tr>
                    {editandoId === s.id && (
                      <tr key={`${s.id}-form`} className="bg-slate-50/50">
                        <td colSpan={5} className="px-5 py-4">
                          <FormularioServicio
                            inicial={{
                              nombre: s.nombre,
                              codigo: s.codigo,
                              duracionMinutos: String(s.duracionMinutos),
                              color: s.color,
                              precioReferencial: s.precioReferencial ? String(Number(s.precioReferencial)) : '',
                              unidadNegocioId: s.unidadNegocioId,
                            }}
                            unidades={unidades}
                            onGuardar={(data) => editarMut.mutate({ id: s.id, data })}
                            onCancelar={() => setEditandoId(null)}
                            guardando={editarMut.isPending}
                          />
                        </td>
                      </tr>
                    )}
                    {subcatDe === s.id && (
                      <tr key={`${s.id}-subcat`} className="bg-violet-50/40">
                        <td colSpan={5} className="px-5 py-4">
                          <GestionSubcategorias servicioId={s.id} servicioNombre={s.nombre} />
                        </td>
                      </tr>
                    )}
                  </>
                ))}
              </tbody>
            </table>
          </div>
        ))
      )}
    </div>
  );
}

// ─── Gestión de subcategorías de un servicio (ej. Profilaxis → Regular/Premium/…) ──
// Precio propio por subcategoría; misma duración que el servicio. Elegir una es
// obligatorio al agendar y se fija al vender membresías. Soft-delete (desactivar).

function GestionSubcategorias({ servicioId, servicioNombre }: { servicioId: string; servicioNombre: string }) {
  const qc = useQueryClient();
  const KEY = ['subcategorias', servicioId];
  const invalidarTodo = () => {
    qc.invalidateQueries({ queryKey: KEY });
    qc.invalidateQueries({ queryKey: ['servicios'] });
    qc.invalidateQueries({ queryKey: ['servicios-admin'] });
    qc.invalidateQueries({ queryKey: ['servicios-todos'] });
    qc.invalidateQueries({ queryKey: ['servicios-all'] });
  };
  const { data: subs, isLoading } = useQuery({ queryKey: KEY, queryFn: () => serviciosApi.listarSubcategorias(servicioId) });

  const [nuevoNombre, setNuevoNombre] = useState('');
  const [nuevoPrecio, setNuevoPrecio] = useState('');

  const crearMut = useMutation({
    mutationFn: () => serviciosApi.crearSubcategoria(servicioId, {
      nombre: nuevoNombre.trim(),
      ...(parseFloat(nuevoPrecio) > 0 ? { precioReferencial: parseFloat(nuevoPrecio) } : {}),
      orden: (subs?.length ?? 0) + 1,
    }),
    onSuccess: () => { invalidarTodo(); setNuevoNombre(''); setNuevoPrecio(''); toast.success('Subcategoría creada'); },
    onError: (e: Error) => toast.error(e.message),
  });
  const editarMut = useMutation({
    mutationFn: ({ id, data }: { id: string; data: { nombre?: string; precioReferencial?: number | null; activo?: boolean } }) => serviciosApi.editarSubcategoria(id, data),
    onSuccess: () => { invalidarTodo(); toast.success('Subcategoría actualizada'); },
    onError: (e: Error) => toast.error(e.message),
  });
  const eliminarMut = useMutation({
    mutationFn: (id: string) => serviciosApi.eliminarSubcategoria(id),
    onSuccess: () => { invalidarTodo(); toast.success('Subcategoría eliminada'); },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="space-y-3">
      <p className="text-xs font-semibold text-violet-800">Subcategorías de {servicioNombre}</p>
      {isLoading ? (
        <p className="text-xs text-slate-400">Cargando…</p>
      ) : (
        <div className="space-y-1.5">
          {(subs ?? []).map(sc => (
            <FilaSubcategoria
              key={sc.id}
              sub={sc}
              onGuardar={(data) => editarMut.mutate({ id: sc.id, data })}
              onToggle={() => editarMut.mutate({ id: sc.id, data: { activo: !sc.activo } })}
              onEliminar={() => { if (confirm(`¿Eliminar la subcategoría "${sc.nombre}"?`)) eliminarMut.mutate(sc.id); }}
              guardando={editarMut.isPending}
            />
          ))}
          {(subs ?? []).length === 0 && <p className="text-xs text-slate-400">Sin subcategorías. Agrega la primera abajo.</p>}
        </div>
      )}
      {/* Alta */}
      <div className="flex items-center gap-2 pt-1">
        <input className="input text-xs flex-1" placeholder="Nombre (ej. Premium)" value={nuevoNombre} onChange={e => setNuevoNombre(e.target.value)} />
        <div className="flex items-center gap-1">
          <span className="text-xs text-slate-400">S/</span>
          <input className="input text-xs w-20" type="number" min="0" step="0.5" placeholder="Precio" value={nuevoPrecio} onChange={e => setNuevoPrecio(e.target.value)} />
        </div>
        <button
          onClick={() => crearMut.mutate()}
          disabled={crearMut.isPending || nuevoNombre.trim().length < 2}
          className="btn btn-primary btn-sm disabled:opacity-50"
        >
          + Agregar
        </button>
      </div>
    </div>
  );
}

function FilaSubcategoria({ sub, onGuardar, onToggle, onEliminar, guardando }: {
  sub: { id: string; nombre: string; precioReferencial: number | null; activo?: boolean };
  onGuardar: (data: { nombre?: string; precioReferencial?: number | null }) => void;
  onToggle: () => void;
  onEliminar: () => void;
  guardando: boolean;
}) {
  const [nombre, setNombre] = useState(sub.nombre);
  const [precio, setPrecio] = useState(sub.precioReferencial != null ? String(Number(sub.precioReferencial)) : '');
  const cambiado = nombre.trim() !== sub.nombre || precio !== (sub.precioReferencial != null ? String(Number(sub.precioReferencial)) : '');
  return (
    <div className={cn('flex items-center gap-2 rounded-lg border px-2 py-1.5 bg-white', sub.activo === false ? 'opacity-50 border-slate-200' : 'border-violet-200')}>
      <input className="input text-xs flex-1" value={nombre} onChange={e => setNombre(e.target.value)} />
      <div className="flex items-center gap-1">
        <span className="text-xs text-slate-400">S/</span>
        <input className="input text-xs w-20" type="number" min="0" step="0.5" value={precio} onChange={e => setPrecio(e.target.value)} />
      </div>
      <button
        onClick={() => onGuardar({ nombre: nombre.trim(), precioReferencial: parseFloat(precio) > 0 ? parseFloat(precio) : null })}
        disabled={guardando || !cambiado || nombre.trim().length < 2}
        className="text-xs px-2.5 py-1 rounded-lg border border-limablue-200 text-limablue-600 hover:bg-limablue-50 disabled:opacity-40"
      >
        Guardar
      </button>
      <button onClick={onToggle} className={cn('text-xs px-2.5 py-1 rounded-lg border', sub.activo === false ? 'border-green-200 text-green-600 hover:bg-green-50' : 'border-amber-200 text-amber-600 hover:bg-amber-50')}>
        {sub.activo === false ? 'Activar' : 'Desactivar'}
      </button>
      <button onClick={onEliminar} className="text-xs px-2.5 py-1 rounded-lg border border-red-200 text-red-500 hover:bg-red-50">Eliminar</button>
    </div>
  );
}

// ─── Visor de Auditoría ───────────────────────────────────────────────────────

function VisorAuditoria() {
  const [desde, setDesde] = useState(format(new Date(), 'yyyy-MM-dd'));
  const [hasta, setHasta] = useState(format(new Date(), 'yyyy-MM-dd'));

  const { data } = useQuery({
    queryKey: ['audit', desde, hasta],
    queryFn: () => {
      const { api } = require('../api');
      return api.get('/audit', { desde, hasta, limit: '100' });
    },
  });

  const accionIcon: Record<string, string> = {
    crear: '➕', mover: '↕️', cambiar_estado: '🔄', cancelar: '❌', redistribuir: '🔀',
  };

  return (
    <div className="p-6">
      <div className="flex gap-3 mb-4 items-end">
        <div>
          <label className="block text-xs font-semibold text-slate-600 mb-1">Desde</label>
          <input type="date" className="input text-sm w-36" value={desde} onChange={e => setDesde(e.target.value)} />
        </div>
        <div>
          <label className="block text-xs font-semibold text-slate-600 mb-1">Hasta</label>
          <input type="date" className="input text-sm w-36" value={hasta} onChange={e => setHasta(e.target.value)} />
        </div>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-xs text-slate-500 border-b border-slate-100 bg-slate-50">
              <th className="px-5 py-2 text-left font-semibold">Fecha/Hora</th>
              <th className="px-5 py-2 text-left font-semibold">Acción</th>
              <th className="px-5 py-2 text-left font-semibold">Entidad</th>
              <th className="px-5 py-2 text-left font-semibold">Usuario</th>
            </tr>
          </thead>
          <tbody>
            {(data as { data: { id: string; creadoEn: string; accion: string; entidad: string; entidadId: string; usuario: { nombre: string } | null }[] })?.data?.map(log => (
              <tr key={log.id} className="border-b border-slate-50 hover:bg-slate-50">
                <td className="px-5 py-2.5 text-xs text-slate-500 whitespace-nowrap">
                  {format(new Date(log.creadoEn), 'd/MM/yyyy HH:mm:ss')}
                </td>
                <td className="px-5 py-2.5">
                  <span className="flex items-center gap-1.5">
                    <span>{accionIcon[log.accion] ?? '•'}</span>
                    <span className="font-medium capitalize text-slate-700">{log.accion.replace('_', ' ')}</span>
                  </span>
                </td>
                <td className="px-5 py-2.5 text-slate-600">
                  <span className="capitalize">{log.entidad}</span>
                  <span className="ml-2 font-mono text-xs text-slate-400">{log.entidadId.slice(0,8)}…</span>
                </td>
                <td className="px-5 py-2.5 text-slate-600">{log.usuario?.nombre ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {!(data as { data: unknown[] })?.data?.length && (
          <div className="text-center py-8 text-slate-400 text-sm">
            Sin registros de auditoría en este rango
          </div>
        )}
      </div>
    </div>
  );
}
