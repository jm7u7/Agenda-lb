import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { pacientesApi, sedesApi } from '../../api';
import { useAgendaStore } from '../../stores/agendaStore';
import { cn } from '../../utils/cn';

export function CommandPalette() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [selectedIdx, setSelectedIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const navigate = useNavigate();
  const { setSedeId, setFecha } = useAgendaStore();

  // Abrir con Ctrl+K / Cmd+K
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setOpen(o => !o);
        setQuery('');
        setSelectedIdx(0);
      }
      if (e.key === 'Escape') setOpen(false);
      if (e.key === '?' && !['INPUT', 'TEXTAREA'].includes((e.target as HTMLElement).tagName)) {
        setOpen(true);
      }
      // Atajos rápidos (cuando no hay modal abierto)
      if (!open) {
        if (e.key === 'n' || e.key === 'N') {
          if (!['INPUT', 'TEXTAREA'].includes((e.target as HTMLElement).tagName)) {
            // Emitir evento para abrir drawer de nueva cita
            document.dispatchEvent(new CustomEvent('agenda:nueva-cita'));
          }
        }
        if (e.key === 't' || e.key === 'T') {
          if (!['INPUT', 'TEXTAREA'].includes((e.target as HTMLElement).tagName)) {
            setFecha(new Date());
          }
        }
        // 1-5 para cambiar de sede
        if (['1','2','3','4','5'].includes(e.key) && !['INPUT', 'TEXTAREA'].includes((e.target as HTMLElement).tagName)) {
          document.dispatchEvent(new CustomEvent('agenda:sede', { detail: { index: Number(e.key) - 1 } }));
        }
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [open, setFecha]);

  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 50);
  }, [open]);

  const { data: pacientes } = useQuery({
    queryKey: ['buscar-pacientes-cmd', query],
    queryFn: () => pacientesApi.buscar(query),
    enabled: open && query.length >= 2,
  });

  const { data: sedes } = useQuery({
    queryKey: ['sedes-cmd'],
    queryFn: sedesApi.listar,
    enabled: open,
  });

  type Cmd = { type: 'paciente'; label: string; sub: string; action: () => void }
           | { type: 'sede'; label: string; sub: string; action: () => void }
           | { type: 'nav'; label: string; sub: string; action: () => void };

  const commands: Cmd[] = [
    ...(pacientes?.map(p => ({
      type: 'paciente' as const,
      label: p.nombreCompleto,
      sub: `${p.tipoDocumento} ${p.numeroDocumento} · ${p.telefono}`,
      action: () => { navigate(`/pacientes/${p.id}`); setOpen(false); },
    })) ?? []),
    ...(query.length < 2 && sedes ? sedes.map(s => ({
      type: 'sede' as const,
      label: s.nombre,
      sub: s.direccion,
      action: () => { setSedeId(s.id); navigate('/'); setOpen(false); },
    })) : []),
    ...(!query ? [
      { type: 'nav' as const, label: 'Ir a hoy', sub: 'Navegar a la fecha de hoy', action: () => { setFecha(new Date()); setOpen(false); } },
      { type: 'nav' as const, label: 'Pacientes', sub: 'Abrir lista de pacientes', action: () => { navigate('/pacientes'); setOpen(false); } },
      { type: 'nav' as const, label: 'Administración', sub: 'Panel de administración', action: () => { navigate('/admin'); setOpen(false); } },
    ] : []),
  ];

  const icons: Record<string, string> = { paciente: '👤', sede: '📍', nav: '→' };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setSelectedIdx(i => Math.min(i + 1, commands.length - 1)); }
    if (e.key === 'ArrowUp') { e.preventDefault(); setSelectedIdx(i => Math.max(i - 1, 0)); }
    if (e.key === 'Enter' && commands[selectedIdx]) { commands[selectedIdx].action(); }
  };

  if (!open) return null;

  return (
    <div className="command-palette" onClick={() => setOpen(false)}>
      <div className="command-box" onClick={e => e.stopPropagation()}>
        {/* Buscador */}
        <div className="flex items-center gap-3 px-4 py-3 border-b border-slate-200">
          <svg className="w-4 h-4 text-slate-400 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <input
            ref={inputRef}
            value={query}
            onChange={e => { setQuery(e.target.value); setSelectedIdx(0); }}
            onKeyDown={handleKeyDown}
            placeholder="Buscar paciente, sede, navegar..."
            className="flex-1 text-sm outline-none text-slate-900 placeholder:text-slate-400"
          />
          <kbd className="px-2 py-0.5 text-xs bg-slate-100 rounded border border-slate-200 text-slate-500">Esc</kbd>
        </div>

        {/* Resultados */}
        <div className="max-h-80 overflow-y-auto py-1">
          {commands.length === 0 && (
            <div className="px-4 py-8 text-center text-sm text-slate-400">
              Sin resultados para "{query}"
            </div>
          )}
          {commands.map((cmd, i) => (
            <button
              key={i}
              onClick={cmd.action}
              className={cn(
                'w-full flex items-center gap-3 px-4 py-2.5 text-left transition-colors',
                i === selectedIdx ? 'bg-limablue-50' : 'hover:bg-slate-50'
              )}
            >
              <span className="text-base">{icons[cmd.type]}</span>
              <div className="flex flex-col min-w-0">
                <span className="text-sm font-medium text-slate-900 truncate">{cmd.label}</span>
                <span className="text-xs text-slate-500 truncate">{cmd.sub}</span>
              </div>
            </button>
          ))}
        </div>

        {/* Atajos */}
        <div className="border-t border-slate-100 px-4 py-2 flex gap-4 text-xxs text-slate-400">
          <span><kbd className="bg-slate-100 px-1 rounded">N</kbd> Nueva cita</span>
          <span><kbd className="bg-slate-100 px-1 rounded">T</kbd> Hoy</span>
          <span><kbd className="bg-slate-100 px-1 rounded">1–5</kbd> Cambiar sede</span>
          <span><kbd className="bg-slate-100 px-1 rounded">↑↓ Enter</kbd> Navegar</span>
        </div>
      </div>
    </div>
  );
}
