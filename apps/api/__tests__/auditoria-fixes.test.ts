/**
 * Tests anti-regresión de la auditoría:
 *  - Timezone central (America/Lima) sin desfase de día.
 *  - Conteo de sesiones de paquete: idempotente, no_show no consume, reembolso al revertir.
 */
import { fechaDb, fechaAStr, citaInicioUtc, LIMA_OFFSET_H } from '../src/utils/fechaLima';

// ─── Mock de prisma para el service de sesiones ───────────────────────────────
jest.mock('../src/db', () => ({
  prisma: {
    cita: { findUnique: jest.fn(), updateMany: jest.fn() },
    paquetePaciente: { findUnique: jest.fn(), update: jest.fn() },
  },
}));
const { prisma } = require('../src/db');
import { sincronizarSesionPaquete } from '../src/services/paqueteSesionService';

describe('Timezone central (fechaLima)', () => {
  it('fechaDb guarda el día correcto sin importar la zona del servidor (mediodía UTC)', () => {
    const d = fechaDb('2026-06-20');
    expect(fechaAStr(d)).toBe('2026-06-20');
    expect(d.getUTCHours()).toBe(12); // mediodía → ±12h de buffer, nunca cambia de día
  });

  it('una fecha guardada se lee como la MISMA fecha (ida y vuelta)', () => {
    for (const f of ['2026-01-01', '2026-12-31', '2026-06-20']) {
      expect(fechaAStr(fechaDb(f))).toBe(f);
    }
  });

  it('citaInicioUtc convierte hora local de Lima a UTC (+5h)', () => {
    const inicio = citaInicioUtc(fechaDb('2026-06-20'), '10:00');
    expect(inicio.toISOString()).toBe('2026-06-20T15:00:00.000Z'); // 10:00 Lima = 15:00 UTC
    expect(LIMA_OFFSET_H).toBe(5);
  });

  it('caso borde: cita a medianoche local no salta de día', () => {
    const inicio = citaInicioUtc(fechaDb('2026-06-20'), '00:00');
    expect(inicio.toISOString()).toBe('2026-06-20T05:00:00.000Z'); // sigue siendo el día 20
  });
});

describe('Conteo de sesiones de paquete (idempotente)', () => {
  beforeEach(() => jest.clearAllMocks());

  it('completada y no consumida → descuenta 1 (incrementa + marca bandera)', async () => {
    prisma.cita.findUnique.mockResolvedValue({ paquetePacienteId: 'p1', estado: 'completada', sesionConsumida: false });
    prisma.cita.updateMany.mockResolvedValue({ count: 1 });
    const r = await sincronizarSesionPaquete('c1');
    expect(r).toBe('consumida');
    expect(prisma.cita.updateMany).toHaveBeenCalledWith({ where: { id: 'c1', sesionConsumida: false }, data: { sesionConsumida: true } });
    expect(prisma.paquetePaciente.update).toHaveBeenCalledWith({ where: { id: 'p1' }, data: { sesionesUsadas: { increment: 1 } } });
  });

  it('IDEMPOTENTE: completada pero YA consumida → no vuelve a descontar', async () => {
    prisma.cita.findUnique.mockResolvedValue({ paquetePacienteId: 'p1', estado: 'completada', sesionConsumida: true });
    const r = await sincronizarSesionPaquete('c1');
    expect(r).toBe('sin_cambio');
    expect(prisma.paquetePaciente.update).not.toHaveBeenCalled();
  });

  it('NO_SHOW no consume sesión', async () => {
    prisma.cita.findUnique.mockResolvedValue({ paquetePacienteId: 'p1', estado: 'no_show', sesionConsumida: false });
    const r = await sincronizarSesionPaquete('c1');
    expect(r).toBe('sin_cambio');
    expect(prisma.paquetePaciente.update).not.toHaveBeenCalled();
  });

  it('CANCELADA no consume sesión', async () => {
    prisma.cita.findUnique.mockResolvedValue({ paquetePacienteId: 'p1', estado: 'cancelada', sesionConsumida: false });
    expect(await sincronizarSesionPaquete('c1')).toBe('sin_cambio');
    expect(prisma.paquetePaciente.update).not.toHaveBeenCalled();
  });

  it('REVERTIR ATENDIDA: ya no está completada pero había consumido → reembolsa 1', async () => {
    prisma.cita.findUnique.mockResolvedValue({ paquetePacienteId: 'p1', estado: 'en_atencion', sesionConsumida: true });
    prisma.cita.updateMany.mockResolvedValue({ count: 1 });
    prisma.paquetePaciente.findUnique.mockResolvedValue({ sesionesUsadas: 2 });
    const r = await sincronizarSesionPaquete('c1');
    expect(r).toBe('reembolsada');
    expect(prisma.paquetePaciente.update).toHaveBeenCalledWith({ where: { id: 'p1' }, data: { sesionesUsadas: { decrement: 1 } } });
  });

  it('reembolso nunca baja de 0', async () => {
    prisma.cita.findUnique.mockResolvedValue({ paquetePacienteId: 'p1', estado: 'en_atencion', sesionConsumida: true });
    prisma.cita.updateMany.mockResolvedValue({ count: 1 });
    prisma.paquetePaciente.findUnique.mockResolvedValue({ sesionesUsadas: 0 });
    const r = await sincronizarSesionPaquete('c1');
    expect(r).toBe('reembolsada');
    expect(prisma.paquetePaciente.update).not.toHaveBeenCalled(); // no decrementa si ya está en 0
  });

  it('cita SIN paquete → no toca nada', async () => {
    prisma.cita.findUnique.mockResolvedValue({ paquetePacienteId: null, estado: 'completada', sesionConsumida: false });
    expect(await sincronizarSesionPaquete('c1')).toBe('sin_cambio');
    expect(prisma.cita.updateMany).not.toHaveBeenCalled();
  });
});
