/**
 * Tests anti-regresión de la auditoría:
 *  - Timezone central (America/Lima) sin desfase de día.
 *  - Conteo de sesiones de paquete: idempotente, no_show no consume, reembolso al revertir.
 */
import { fechaDb, fechaAStr, citaInicioUtc, LIMA_OFFSET_H } from '../src/utils/fechaLima';

// ─── Mock de prisma para el service de sesiones (fuente de verdad: ConsumoSesion) ──
jest.mock('../src/db', () => {
  const mock = {
    cita: { findUnique: jest.fn(), update: jest.fn() },
    paquetePaciente: { findUnique: jest.fn(), update: jest.fn() },
    consumoSesion: { findFirst: jest.fn(), count: jest.fn(), create: jest.fn(), update: jest.fn() },
    auditLog: { create: jest.fn() },
    $transaction: jest.fn(),
  };
  mock.$transaction.mockImplementation((fn: (tx: unknown) => unknown) => fn(mock));
  return { prisma: mock };
});
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

describe('Conteo de sesiones de paquete (fuente de verdad: ConsumoSesion)', () => {
  beforeEach(() => jest.clearAllMocks());

  const CITA = { id: 'c1', paquetePacienteId: 'p1', sesionConsumida: false, servicioId: 's1', fecha: new Date('2026-07-05T12:00:00Z') };

  it('completada sin consumo vivo → crea ConsumoSesion (origen CITA) y sincroniza contador', async () => {
    prisma.cita.findUnique.mockResolvedValue({ ...CITA, estado: 'completada' });
    prisma.consumoSesion.findFirst.mockResolvedValue(null);
    prisma.paquetePaciente.findUnique
      .mockResolvedValueOnce({ sesionesTotal: 12, composicion: null }) // chequeo de cupo
      .mockResolvedValueOnce({ sesionesTotal: 12, vigenciaFin: null, estado: 'ACTIVO' }); // recalcular
    prisma.consumoSesion.count
      .mockResolvedValueOnce(2) // vivos antes de crear
      .mockResolvedValueOnce(3); // vivos al recalcular
    const r = await sincronizarSesionPaquete('c1');
    expect(r).toBe('consumida');
    expect(prisma.consumoSesion.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ paqueteId: 'p1', citaId: 'c1', origen: 'CITA' }) })
    );
    // write-through: contador legacy = count(consumos vivos)
    expect(prisma.paquetePaciente.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ sesionesUsadas: 3 }) })
    );
  });

  it('IDEMPOTENTE: completada con consumo vivo ya registrado → sin cambio', async () => {
    prisma.cita.findUnique.mockResolvedValue({ ...CITA, estado: 'completada', sesionConsumida: true });
    prisma.consumoSesion.findFirst.mockResolvedValue({ id: 'k1', paqueteId: 'p1' });
    expect(await sincronizarSesionPaquete('c1')).toBe('sin_cambio');
    expect(prisma.consumoSesion.create).not.toHaveBeenCalled();
  });

  it('NO_SHOW no consume sesión', async () => {
    prisma.cita.findUnique.mockResolvedValue({ ...CITA, estado: 'no_show' });
    prisma.consumoSesion.findFirst.mockResolvedValue(null);
    expect(await sincronizarSesionPaquete('c1')).toBe('sin_cambio');
    expect(prisma.consumoSesion.create).not.toHaveBeenCalled();
  });

  it('CANCELADA no consume sesión', async () => {
    prisma.cita.findUnique.mockResolvedValue({ ...CITA, estado: 'cancelada' });
    prisma.consumoSesion.findFirst.mockResolvedValue(null);
    expect(await sincronizarSesionPaquete('c1')).toBe('sin_cambio');
    expect(prisma.consumoSesion.create).not.toHaveBeenCalled();
  });

  it('ANULAR la cita consumidora → devolución automática (soft-delete del consumo)', async () => {
    prisma.cita.findUnique.mockResolvedValue({ ...CITA, estado: 'cancelada', sesionConsumida: true });
    prisma.consumoSesion.findFirst.mockResolvedValue({ id: 'k1', paqueteId: 'p1' });
    prisma.paquetePaciente.findUnique.mockResolvedValue({ sesionesTotal: 12, vigenciaFin: null, estado: 'AGOTADO' });
    prisma.consumoSesion.count.mockResolvedValue(11); // vivos tras la devolución
    const r = await sincronizarSesionPaquete('c1');
    expect(r).toBe('reembolsada');
    expect(prisma.consumoSesion.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'k1' }, data: expect.objectContaining({ deletedAt: expect.any(Date) }) })
    );
    // El paquete vuelve a ACTIVO con el contador sincronizado — jamás editando números.
    expect(prisma.paquetePaciente.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ sesionesUsadas: 11, estado: 'ACTIVO' }) })
    );
  });

  it('REVERTIR a en_atencion NO reembolsa (el paciente SÍ llegó — regla llego=Sí)', async () => {
    prisma.cita.findUnique.mockResolvedValue({ ...CITA, estado: 'en_atencion', sesionConsumida: true });
    prisma.consumoSesion.findFirst.mockResolvedValue({ id: 'k1', paqueteId: 'p1' });
    expect(await sincronizarSesionPaquete('c1')).toBe('sin_cambio');
    expect(prisma.consumoSesion.update).not.toHaveBeenCalled();
  });

  it('el contador nunca baja de 0 (write-through = count de vivos, ≥0 por construcción)', async () => {
    prisma.cita.findUnique.mockResolvedValue({ ...CITA, estado: 'cancelada', sesionConsumida: true });
    prisma.consumoSesion.findFirst.mockResolvedValue({ id: 'k1', paqueteId: 'p1' });
    prisma.paquetePaciente.findUnique.mockResolvedValue({ sesionesTotal: 12, vigenciaFin: null, estado: 'ACTIVO' });
    prisma.consumoSesion.count.mockResolvedValue(0);
    await sincronizarSesionPaquete('c1');
    expect(prisma.paquetePaciente.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ sesionesUsadas: 0 }) })
    );
  });

  it('paquete lleno: completada extra NO sobre-consume', async () => {
    prisma.cita.findUnique.mockResolvedValue({ ...CITA, estado: 'completada' });
    prisma.consumoSesion.findFirst.mockResolvedValue(null);
    prisma.paquetePaciente.findUnique.mockResolvedValue({ sesionesTotal: 12, composicion: null });
    prisma.consumoSesion.count.mockResolvedValue(12); // ya lleno
    expect(await sincronizarSesionPaquete('c1')).toBe('sin_cambio');
    expect(prisma.consumoSesion.create).not.toHaveBeenCalled();
  });

  it('cita SIN paquete → no toca nada', async () => {
    prisma.cita.findUnique.mockResolvedValue({ ...CITA, paquetePacienteId: null, estado: 'completada' });
    expect(await sincronizarSesionPaquete('c1')).toBe('sin_cambio');
    expect(prisma.consumoSesion.findFirst).not.toHaveBeenCalled();
  });
});
