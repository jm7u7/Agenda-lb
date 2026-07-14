/**
 * Fix B-1: sub-cuota reservada para reenvíos manuales de correo.
 * Los envíos AUTOMÁTICOS (recordatorios en masa) se detienen dejando un colchón
 * (RESERVA_MANUAL); los envíos MANUALES (botón de recepción) pueden usar ese
 * colchón hasta el tope absoluto del proveedor (LIMITE_DIARIO). Así un reenvío
 * manual urgente nunca queda bloqueado por la cuota que ya gastaron los automáticos.
 *
 * Se mockea Redis con un contador en memoria (INCR/DECR atómicos por naturaleza
 * secuencial del test) para verificar la lógica pura de dos topes.
 */

// Contador en memoria compartido por el mock de Redis.
const store: Record<string, number> = {};
jest.mock('../src/redis', () => ({
  redis: {
    incr: async (k: string) => (store[k] = (store[k] ?? 0) + 1),
    decr: async (k: string) => (store[k] = (store[k] ?? 0) - 1),
    expire: async () => 1,
    get: async (k: string) => (store[k] != null ? String(store[k]) : null),
  },
}));

function cargarModulo(limite: string, reserva: string) {
  jest.resetModules();
  for (const k of Object.keys(store)) delete store[k];
  process.env.MAIL_LIMITE_DIARIO = limite;
  process.env.MAIL_RESERVA_MANUAL = reserva;
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  return require('../src/services/mailQuota') as typeof import('../src/services/mailQuota');
}

describe('Sub-cuota de correos: automático vs manual (B-1)', () => {
  it('el automático se detiene en LIMITE_DIARIO - RESERVA_MANUAL; el manual llega hasta LIMITE_DIARIO', async () => {
    const q = cargarModulo('10', '3'); // tope auto = 7, tope manual = 10
    expect(q.LIMITE_DIARIO).toBe(10);
    expect(q.RESERVA_MANUAL).toBe(3);
    expect(q.LIMITE_AUTOMATICO).toBe(7);

    // 7 automáticos entran…
    for (let i = 0; i < 7; i++) expect(await q.reservarCupoEnvio('auto')).toBe(true);
    // …el 8º automático NO (dejaría solo 2 libres, invade la reserva de 3).
    expect(await q.reservarCupoEnvio('auto')).toBe(false);
    expect(await q.enviosHoy()).toBe(7); // el DECR devolvió el cupo no usado

    // Los 3 de la reserva SÍ los puede usar un envío manual.
    for (let i = 0; i < 3; i++) expect(await q.reservarCupoEnvio('manual')).toBe(true);
    // Ya en el tope absoluto: ni manual ni auto entran.
    expect(await q.reservarCupoEnvio('manual')).toBe(false);
    expect(await q.reservarCupoEnvio('auto')).toBe(false);
    expect(await q.enviosHoy()).toBe(10);
  });

  it('asegurarCupoEnvio lanza QuotaExcedidaError solo al superar el tope del tipo', async () => {
    const q = cargarModulo('5', '2'); // auto=3, manual=5
    for (let i = 0; i < 3; i++) await expect(q.asegurarCupoEnvio('auto')).resolves.toBeUndefined();
    await expect(q.asegurarCupoEnvio('auto')).rejects.toBeInstanceOf(q.QuotaExcedidaError);
    // El manual todavía tiene la reserva.
    await expect(q.asegurarCupoEnvio('manual')).resolves.toBeUndefined();
    await expect(q.asegurarCupoEnvio('manual')).resolves.toBeUndefined();
    await expect(q.asegurarCupoEnvio('manual')).rejects.toBeInstanceOf(q.QuotaExcedidaError);
  });

  it('estadoCuota reporta restantes por tipo', async () => {
    const q = cargarModulo('10', '3');
    for (let i = 0; i < 5; i++) await q.reservarCupoEnvio('auto');
    const e = await q.estadoCuota();
    expect(e).toMatchObject({
      usados: 5, limiteDiario: 10, reservaManual: 3, limiteAutomatico: 7,
      restanteAutomatico: 2, restanteManual: 5,
    });
  });

  it('acota una reserva mal configurada para que el tope automático nunca sea 0 ni negativo', async () => {
    const q = cargarModulo('10', '100'); // reserva absurda → se acota a limite-1 = 9
    expect(q.RESERVA_MANUAL).toBe(9);
    expect(q.LIMITE_AUTOMATICO).toBe(1);
    expect(await q.reservarCupoEnvio('auto')).toBe(true);
    expect(await q.reservarCupoEnvio('auto')).toBe(false); // solo 1 automático
    // pero el manual sí llega al tope
    for (let i = 0; i < 9; i++) expect(await q.reservarCupoEnvio('manual')).toBe(true);
    expect(await q.reservarCupoEnvio('manual')).toBe(false);
  });
});
