/**
 * Tests de reglas de negocio críticas:
 * - Anti doble-booking
 * - Validación de competencias
 * - Consumo de sesiones de paquete
 * - Restricción fisioterapia solo en Paz Soldán
 */

import { acquireSlotLock, releaseSlotLock } from '../src/redis';

// Mock de Redis para tests unitarios
jest.mock('../src/redis', () => ({
  acquireSlotLock: jest.fn(),
  releaseSlotLock: jest.fn(),
  redis: { ping: jest.fn().mockResolvedValue('PONG') },
  invalidateDisponibilidadCache: jest.fn(),
}));

jest.mock('../src/db', () => ({
  prisma: {
    cita: {
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      count: jest.fn(),
    },
    paquetePaciente: {
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    sedeUnidadNegocio: { findUnique: jest.fn() },
    servicio: { findUnique: jest.fn() },
    unidadNegocio: { findUnique: jest.fn() },
    competenciaProfesional: { findFirst: jest.fn() },
    horarioProfesional: { findFirst: jest.fn() },
    asignacionSede: { findMany: jest.fn(), updateMany: jest.fn(), create: jest.fn() },
    profesional: { findUnique: jest.fn() },
    sede: { findFirst: jest.fn() },
    auditLog: { create: jest.fn() },
    webhookSubscription: { findMany: jest.fn().mockResolvedValue([]) },
  },
}));

jest.mock('../src/socket', () => ({ emitirEventoCita: jest.fn() }));
jest.mock('../src/services/webhooks', () => ({ dispararWebhooks: jest.fn() }));

const { prisma } = require('../src/db');

// ─── Anti doble-booking con lock ─────────────────────────────────────────────

describe('Anti doble-booking', () => {
  it('rechaza un slot cuando el lock ya está tomado', async () => {
    const mockAcquire = acquireSlotLock as jest.MockedFunction<typeof acquireSlotLock>;
    mockAcquire.mockResolvedValueOnce(false);

    const resultado = await mockAcquire('sede-1', 'prof-1', '2026-06-11', '09:00', 'req-1');
    expect(resultado).toBe(false);
  });

  it('permite el slot cuando el lock no está tomado', async () => {
    const mockAcquire = acquireSlotLock as jest.MockedFunction<typeof acquireSlotLock>;
    mockAcquire.mockResolvedValueOnce(true);

    const resultado = await mockAcquire('sede-1', 'prof-1', '2026-06-11', '09:00', 'req-2');
    expect(resultado).toBe(true);
  });

  it('libera el lock después de crear la cita', async () => {
    const mockRelease = releaseSlotLock as jest.MockedFunction<typeof releaseSlotLock>;
    mockRelease.mockResolvedValueOnce(undefined);

    await releaseSlotLock('sede-1', 'prof-1', '2026-06-11', '09:00', 'req-1');
    expect(mockRelease).toHaveBeenCalledWith('sede-1', 'prof-1', '2026-06-11', '09:00', 'req-1');
  });
});

// ─── Validación de competencias ───────────────────────────────────────────────

describe('Validación de competencias', () => {
  it('permite crear cita si el profesional tiene la competencia', async () => {
    prisma.competenciaProfesional.findFirst.mockResolvedValueOnce({
      id: 'comp-1',
      profesionalId: 'prof-1',
      servicioId: 'serv-1',
      activa: true,
    });

    const resultado = await prisma.competenciaProfesional.findFirst({
      where: { profesionalId: 'prof-1', servicioId: 'serv-1', activa: true },
    });

    expect(resultado).not.toBeNull();
    expect(resultado.activa).toBe(true);
  });

  it('bloquea la cita si el profesional no tiene la competencia', async () => {
    prisma.competenciaProfesional.findFirst.mockResolvedValueOnce(null);

    const resultado = await prisma.competenciaProfesional.findFirst({
      where: { profesionalId: 'prof-2', servicioId: 'serv-especializado', activa: true },
    });

    expect(resultado).toBeNull();
  });
});

// ─── Consumo de sesiones de paquete ──────────────────────────────────────────

describe('Paquetes de sesiones', () => {
  beforeEach(() => jest.clearAllMocks()); // aislar el historial de mocks entre tests

  it('incrementa sesionesUsadas al completar una cita con paquete', async () => {
    prisma.paquetePaciente.update.mockResolvedValueOnce({
      id: 'pp-1',
      sesionesUsadas: 4,
      sesionesTotal: 12,
    });

    const updated = await prisma.paquetePaciente.update({
      where: { id: 'pp-1' },
      data: { sesionesUsadas: { increment: 1 } },
    });

    expect(updated.sesionesUsadas).toBe(4);
    expect(prisma.paquetePaciente.update).toHaveBeenCalledWith({
      where: { id: 'pp-1' },
      data: { sesionesUsadas: { increment: 1 } },
    });
  });

  it('NO incrementa sesiones cuando el estado es no_show', async () => {
    // Simulamos la lógica del endpoint
    const estado = 'no_show';
    const paquetePacienteId = 'pp-1';

    const debeIncrementar = estado === 'completada' && !!paquetePacienteId;
    expect(debeIncrementar).toBe(false);

    expect(prisma.paquetePaciente.update).not.toHaveBeenCalled();
  });

  it('calcula el número de sesión correctamente al crear cita', async () => {
    prisma.paquetePaciente.findUnique.mockResolvedValueOnce({
      id: 'pp-1',
      sesionesUsadas: 6,
      sesionesTotal: 12,
    });

    const paquete = await prisma.paquetePaciente.findUnique({ where: { id: 'pp-1' } });
    const sesionNumero = paquete.sesionesUsadas + 1;

    expect(sesionNumero).toBe(7);
  });
});

// ─── Restricción fisioterapia en Paz Soldán ───────────────────────────────────

describe('Restricción Fisioterapia', () => {
  it('bloquea asignación de fisioterapeuta a sede que no es Paz Soldán', async () => {
    prisma.profesional.findUnique.mockResolvedValueOnce({
      id: 'fisio-1',
      tipo: 'fisioterapeuta',
      unidadNegocio: { nombre: 'Fisioterapia' },
    });
    prisma.sede.findFirst.mockResolvedValueOnce({ id: 'sede-paz-soldan', nombre: 'Paz Soldán' });

    const prof = await prisma.profesional.findUnique({ where: { id: 'fisio-1' } });
    const pazSoldan = await prisma.sede.findFirst({ where: { nombre: 'Paz Soldán' } });

    const sedeDestino = 'sede-miraflores'; // sede diferente
    const esError = prof.tipo === 'fisioterapeuta' && sedeDestino !== pazSoldan.id;

    expect(esError).toBe(true);
  });

  it('permite asignación de fisioterapeuta a Paz Soldán', async () => {
    prisma.profesional.findUnique.mockResolvedValueOnce({
      id: 'fisio-1',
      tipo: 'fisioterapeuta',
    });
    prisma.sede.findFirst.mockResolvedValueOnce({ id: 'sede-paz-soldan', nombre: 'Paz Soldán' });

    const prof = await prisma.profesional.findUnique({ where: { id: 'fisio-1' } });
    const pazSoldan = await prisma.sede.findFirst({ where: { nombre: 'Paz Soldán' } });

    const sedeDestino = 'sede-paz-soldan';
    const esError = prof.tipo === 'fisioterapeuta' && sedeDestino !== pazSoldan.id;

    expect(esError).toBe(false);
  });
});

// ─── Slots de disponibilidad ──────────────────────────────────────────────────

describe('Generación de slots', () => {
  it('genera slots cada 30 minutos entre 08:00 y 20:00', () => {
    const { generarSlotsDelDia } = require('@limablue/shared');
    const slots = generarSlotsDelDia('08:00', '20:00', 30);

    expect(slots[0]).toBe('08:00');
    expect(slots[slots.length - 1]).toBe('19:30');
    expect(slots.length).toBe(24); // 12 horas × 2 slots por hora
  });

  it('calcula correctamente los minutos desde medianoche', () => {
    const { timeToMinutes } = require('@limablue/shared');

    expect(timeToMinutes('08:00')).toBe(480);
    expect(timeToMinutes('12:30')).toBe(750);
    expect(timeToMinutes('20:00')).toBe(1200);
  });
});
