import { test, expect } from '@playwright/test';
import { resetMutables, psql } from '../fixtures/db';
import { catalogo, crearPaciente, crearCita, fechaConSlot, dosSlotsMismoProf, Catalogo } from '../fixtures/api';
import { irAAgenda, dragCitaASlot } from '../helpers/agenda';

// FLUJO 4 — DRAG & DROP: arrastrar una cita a otro slot la reprograma; se verifica en BD
// que la cita quedó en la hora destino.
test.describe('Reprogramar por drag & drop', () => {
  let cat: Catalogo;
  test.beforeEach(async () => {
    resetMutables();
    cat = await catalogo();
  });

  test('arrastrar una cita a otra hora la reprograma (verificado en BD)', async ({ page }) => {
    const { fecha } = await fechaConSlot(cat);
    const { profesionalId, horaX, horaY } = await dosSlotsMismoProf(cat, fecha);
    const pac = await crearPaciente(cat.token, { apellidoPaterno: 'ZZTESTDND' });
    const cita = await crearCita(cat, pac.id, profesionalId, fecha, horaX);

    await irAAgenda(page, cat, fecha);
    await expect(page.getByTestId(`cita-${cita.id}`)).toBeVisible();

    // Estado inicial en BD.
    expect(psql(`SELECT "horaInicio" FROM citas WHERE id='${cita.id}'`)).toBe(horaX);

    // Arrastrar la cita al slot libre de la hora destino (mismo profesional).
    await dragCitaASlot(page, cita.id, `slot-${profesionalId}-${horaY}`);

    // La cita quedó reprogramada a horaY en la BD.
    await expect.poll(() => psql(`SELECT "horaInicio" FROM citas WHERE id='${cita.id}'`), { timeout: 8000 })
      .toBe(horaY);
    // Y sigue con el mismo profesional.
    expect(psql(`SELECT "profesionalId" FROM citas WHERE id='${cita.id}'`)).toBe(profesionalId);
  });
});
