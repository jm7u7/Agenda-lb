/**
 * Tests anti-regresión del blindaje del núcleo (PASO 2).
 * Cubre las funciones PURAS introducidas/afectadas por los fixes:
 *  - Normalización de pacientes (mala transcripción: tildes, ñ, espacios, mayúsculas).
 *  - Mapeo de conflictos de unicidad P2002 a códigos/mensajes claros.
 *  - Anclaje de fechas a UTC (fechaDb) — una fecha guardada se lee el MISMO día.
 */

import { normalizarPaciente, tituloNombre } from '../src/utils/normalizarPaciente';
import { conflictoUnicidad } from '../src/middleware/errorHandler';
import { fechaDb, fechaAStr } from '../src/utils/fechaLima';

describe('Normalización de pacientes (anti mala transcripción)', () => {
  it('capitaliza nombres respetando tildes y ñ', () => {
    expect(tituloNombre('josé maría peña')).toBe('José María Peña');
    expect(tituloNombre('  MARÍA   FERNÁNDEZ ')).toBe('María Fernández');
  });

  it('capitaliza nombres compuestos con guion y apóstrofo', () => {
    expect(tituloNombre("ana-maría d'angelo")).toBe("Ana-María D'Angelo");
  });

  it('colapsa espacios y limpia documento/teléfono; email a minúsculas', () => {
    const out = normalizarPaciente({
      nombres: '  juan  carlos ',
      apellidoPaterno: 'ÑAÑEZ',
      apellidoMaterno: 'soto',
      numeroDocumento: ' 7012 3456 ',
      telefono: '  999  888  777 ',
      email: '  Juan.Perez@Gmail.COM ',
    });
    expect(out.nombres).toBe('Juan Carlos');
    expect(out.apellidoPaterno).toBe('Ñañez');
    expect(out.apellidoMaterno).toBe('Soto');
    expect(out.numeroDocumento).toBe('70123456');
    expect(out.telefono).toBe('999 888 777');
    expect(out.email).toBe('juan.perez@gmail.com');
  });

  it('NO inventa campos no enviados (update parcial seguro)', () => {
    const out = normalizarPaciente({ telefono: '987654321' });
    expect(out).toEqual({ telefono: '987654321' });
    expect('nombres' in out).toBe(false);
    expect('email' in out).toBe(false);
  });
});

describe('Mapeo de conflictos de unicidad (P2002 → mensaje claro)', () => {
  it('reconoce slot ocupado (por índice o por columnas)', () => {
    expect(conflictoUnicidad('citas_slot_activo_unique').error).toBe('SLOT_OCUPADO');
    // Prisma reporta las COLUMNAS del índice crudo, no su nombre:
    expect(conflictoUnicidad('profesionalId,fecha,horaInicio').error).toBe('SLOT_OCUPADO');
  });
  it('reconoce documento duplicado (por índice o por columnas)', () => {
    expect(conflictoUnicidad('pacientes_documento_unico').error).toBe('PACIENTE_DUPLICADO');
    expect(conflictoUnicidad('tipoDocumento,numeroDocumento').error).toBe('PACIENTE_DUPLICADO');
  });
  it('reconoce idempotencia y asignación abierta', () => {
    expect(conflictoUnicidad('citas_idempotency_unico').error).toBe('OPERACION_DUPLICADA');
    expect(conflictoUnicidad('idempotencyKey').error).toBe('OPERACION_DUPLICADA');
    expect(conflictoUnicidad('asignaciones_sede_una_abierta').error).toBe('CONFLICTO_ASIGNACION');
    // Asignación abierta crudo → solo columna profesionalId (no debe confundirse con slot):
    expect(conflictoUnicidad('profesionalId').error).toBe('CONFLICTO_ASIGNACION');
  });
  it('cae a genérico para índices desconocidos', () => {
    expect(conflictoUnicidad('algo_raro').error).toBe('CONFLICT');
  });
});

describe('Fechas ancladas a UTC (sin desfase de ±1 día)', () => {
  it('una fecha guardada se lee el MISMO día (mediodía UTC)', () => {
    expect(fechaAStr(fechaDb('2026-06-21'))).toBe('2026-06-21');
  });
  it('caso borde: primer y último día del mes', () => {
    expect(fechaAStr(fechaDb('2026-02-01'))).toBe('2026-02-01');
    expect(fechaAStr(fechaDb('2026-12-31'))).toBe('2026-12-31');
  });
  it('caso borde: medianoche no cruza de día con el offset Lima', () => {
    // 00:00 Lima = 05:00 UTC del MISMO día; el día permanece estable.
    expect(fechaAStr(fechaDb('2026-01-01'))).toBe('2026-01-01');
  });
});
