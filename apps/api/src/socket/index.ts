import { Server as HttpServer } from 'http';
import { Server as SocketServer } from 'socket.io';
import { WSEvent } from '@limablue/shared';
import { corsOrigin } from '../cors';

let io: SocketServer;

export function initSocket(server: HttpServer): void {
  io = new SocketServer(server, {
    cors: {
      origin: corsOrigin,
      credentials: true,
    },
    path: '/socket.io',
  });

  io.on('connection', (socket) => {
    // Cliente se suscribe a los eventos de una sede
    socket.on('suscribir:sede', (sedeId: string) => {
      socket.join(`sede:${sedeId}`);
    });

    socket.on('desuscribir:sede', (sedeId: string) => {
      socket.leave(`sede:${sedeId}`);
    });

    socket.on('disconnect', () => {
      // noop
    });
  });
}

export function emitirEventoCita(event: WSEvent): void {
  if (!io) return;
  io.to(`sede:${event.sedeId}`).emit('agenda:actualizada', event);
}

export function getIO(): SocketServer {
  return io;
}
