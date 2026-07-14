/**
 * Gate 0 (2026-07-11) — regresión: un deadlock 40P01 que agota los reintentos de
 * `withDeadlockRetry` se re-lanza como `PrismaClientUnknownRequestError` / `ConnectorError`
 * con code "40P01" (SQLSTATE crudo), NO como `PrismaClientKnownRequestError` P2034. El catch
 * de POST /citas mapeaba a 409 SOLO si era un KnownRequestError P2002/P2034, así que ese
 * 40P01 crudo se colaba al `throw err` → HTTP 500 (2 de ~25 casos).
 *
 * `esConflictoDeSlot` es el clasificador que ahora usan los catch de POST /citas y
 * POST /citas/combinada. Este test fija que reconoce las DOS caras del "slot ocupado"
 * (unicidad P2002 + deadlock exhausto en todas sus formas) y que NO se traga errores ajenos.
 */
import { Prisma } from '@prisma/client';
import { esDeadlockTransitorio, esConflictoDeSlot } from '../src/utils/dbRetry';

const known = (code: string) =>
  new Prisma.PrismaClientKnownRequestError('boom', { code, clientVersion: 'test' });

// Reproduce lo que Prisma re-lanza cuando agota los reintentos de un deadlock: NO es un
// KnownRequestError; es un error con el SQLSTATE crudo en `.code` y/o el mensaje del driver.
class ConnectorErrorFake extends Error {
  constructor(public code: string, message: string) {
    super(message);
    this.name = 'PrismaClientUnknownRequestError';
  }
}

describe('esDeadlockTransitorio', () => {
  it('reconoce el 40P01 CRUDO no-KnownRequestError (el bug de Gate 0)', () => {
    const err = new ConnectorErrorFake('40P01', 'deadlock detected');
    expect(err).not.toBeInstanceOf(Prisma.PrismaClientKnownRequestError);
    expect(esDeadlockTransitorio(err)).toBe(true);
  });

  it('reconoce el 40001 crudo (serialization_failure)', () => {
    expect(esDeadlockTransitorio(new ConnectorErrorFake('40001', 'could not serialize access'))).toBe(true);
  });

  it('reconoce por mensaje aunque no venga el code (regex de red de seguridad)', () => {
    expect(esDeadlockTransitorio(new Error('Transaction failed: deadlock detected'))).toBe(true);
  });

  it('reconoce el P2034 clasificado por Prisma', () => {
    expect(esDeadlockTransitorio(known('P2034'))).toBe(true);
  });

  it('NO reintenta un P2002 (unicidad = decisión final, no transitoria)', () => {
    expect(esDeadlockTransitorio(known('P2002'))).toBe(false);
  });

  it('NO reintenta errores de negocio ni genéricos', () => {
    expect(esDeadlockTransitorio(new Error('horario inválido'))).toBe(false);
    expect(esDeadlockTransitorio(known('P2025'))).toBe(false);
    expect(esDeadlockTransitorio(null)).toBe(false);
    expect(esDeadlockTransitorio(undefined)).toBe(false);
  });
});

describe('esConflictoDeSlot (→ 409 SLOT_OCUPADO)', () => {
  it('mapea el 40P01 CRUDO a 409 — la regresión concreta de Gate 0', () => {
    expect(esConflictoDeSlot(new ConnectorErrorFake('40P01', 'deadlock detected'))).toBe(true);
  });

  it('mapea el 40001 crudo a 409', () => {
    expect(esConflictoDeSlot(new ConnectorErrorFake('40001', 'could not serialize access'))).toBe(true);
  });

  it('mapea el P2034 clasificado por Prisma a 409', () => {
    expect(esConflictoDeSlot(known('P2034'))).toBe(true);
  });

  it('mapea el P2002 (índice único parcial anti-doble-booking) a 409', () => {
    expect(esConflictoDeSlot(known('P2002'))).toBe(true);
  });

  it('NO disfraza un AppError de negocio ni otros errores de SLOT_OCUPADO', () => {
    expect(esConflictoDeSlot(new Error('sin sesiones disponibles'))).toBe(false);
    expect(esConflictoDeSlot(known('P2025'))).toBe(false); // record not found
    expect(esConflictoDeSlot({ statusCode: 400, code: 'HORARIO_INVALIDO' })).toBe(false);
    expect(esConflictoDeSlot(null)).toBe(false);
  });
});
