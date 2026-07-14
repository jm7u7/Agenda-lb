import { useEffect, useRef } from 'react';
import { io, Socket } from 'socket.io-client';
import { useQueryClient } from '@tanstack/react-query';
import { addDays, format } from 'date-fns';
import toast from 'react-hot-toast';

let socket: Socket | null = null;

export function useSocket(sedeId: string | null) {
  const qc = useQueryClient();
  const sedeRef = useRef<string | null>(null);

  useEffect(() => {
    if (!socket) {
      socket = io({ path: '/socket.io', transports: ['websocket'] });
    }

    if (sedeId && sedeId !== sedeRef.current) {
      if (sedeRef.current) socket.emit('desuscribir:sede', sedeRef.current);
      socket.emit('suscribir:sede', sedeId);
      sedeRef.current = sedeId;
    }

    const citaHandler = (event: { tipo: string; sedeId: string; fecha: string; cita: unknown; cambiadoPor: string }) => {
      if (event.sedeId !== sedeId) return;
      // Refresca TODO lo que depende de las citas de esa sede+fecha:
      // la grilla (citas), los contadores de cabecera (stats), la
      // disponibilidad de horarios y los bloqueos/permisos. Así cualquier
      // cambio hecho por otro usuario (recepción / contact center) se ve al
      // instante, sin tener que refrescar manualmente.
      const claves = ['citas', 'stats', 'disponibilidad', 'bloqueos-almuerzo', 'permisos-agenda'];
      qc.invalidateQueries({
        predicate: (q) => {
          const k = q.queryKey;
          return Array.isArray(k)
            && typeof k[0] === 'string'
            && claves.includes(k[0])
            && k.includes(event.sedeId)
            && k.includes(event.fecha);
        },
      });

      const mensajes: Record<string, string> = {
        'cita:creada': 'Nueva cita agendada',
        'cita:movida': 'Cita reprogramada',
        'cita:estadoCambiado': 'Estado de cita actualizado',
        'cita:cancelada': 'Cita cancelada',
      };
      const msg = mensajes[event.tipo];
      if (msg) toast(msg, { icon: '🔄', duration: 3000 });
    };

    const movimientoHandler = (event: {
      profesionalId: string;
      sedeId: string;
      sedeAnteriorId: string | null;
      fechaInicio: string;
      fechaFin: string | null;
    }) => {
      const inicio = new Date(event.fechaInicio + 'T12:00:00');
      const fin = event.fechaFin ? new Date(event.fechaFin + 'T12:00:00') : addDays(inicio, 90);
      for (let d = new Date(inicio); d <= fin; d = addDays(d, 1)) {
        const f = format(d, 'yyyy-MM-dd');
        qc.invalidateQueries({ queryKey: ['profesionales-sede', event.sedeId] });
        qc.invalidateQueries({ queryKey: ['profesionales-sede'] });
        if (event.sedeAnteriorId) {
          qc.invalidateQueries({ queryKey: ['profesionales-sede', event.sedeAnteriorId] });
        }
        // También invalida keys específicas de fecha
        qc.invalidateQueries({ predicate: (q) => {
          const k = q.queryKey;
          return Array.isArray(k) && k[0] === 'profesionales-sede' && k.includes(f);
        }});
      }
      qc.invalidateQueries({ queryKey: ['movimientos'] });
      toast('Asignación de sede actualizada', { icon: '🔄', duration: 3000 });
    };

    // Cambio de horario del personal (base semanal u override por fecha). El backend lo
    // emite de forma centralizada (horarioService) — aquí basta refrescar todo lo que
    // depende del turno: columnas de agenda, slots y las pantallas de gestión de horarios.
    const horarioHandler = () => {
      const claves = ['profesionales-sede', 'disponibilidad', 'horarios-entrada', 'personal-excepcion', 'horario-semanal', 'dia-especial'];
      qc.invalidateQueries({
        predicate: (q) => Array.isArray(q.queryKey) && typeof q.queryKey[0] === 'string' && claves.includes(q.queryKey[0]),
      });
    };

    socket.on('agenda:actualizada', citaHandler);
    socket.on('movimiento:guardado', movimientoHandler);
    socket.on('horario:actualizado', horarioHandler);
    return () => {
      socket?.off('agenda:actualizada', citaHandler);
      socket?.off('movimiento:guardado', movimientoHandler);
      socket?.off('horario:actualizado', horarioHandler);
    };
  }, [sedeId, qc]);
}
