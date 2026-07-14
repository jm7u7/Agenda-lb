import { test, expect } from '@playwright/test';
import { resetMutables, psql } from '../fixtures/db';
import { catalogo, crearPaciente, crearCita, fechaConSlot, Catalogo } from '../fixtures/api';
import { irAAgenda } from '../helpers/agenda';

// FLUJO 2 — POPOVER: click en una cita abre el detalle, muestra datos, y una acción
// (marcar "Llegó") cambia el estado (verificado en BD).
test.describe('Popover de cita', () => {
  let cat: Catalogo;
  test.beforeEach(async () => {
    resetMutables();
    cat = await catalogo();
  });

  test('abrir, ver datos y ejecutar una acción (Llegó)', async ({ page }) => {
    const { fecha, profesionalId, horaInicio } = await fechaConSlot(cat);
    const pac = await crearPaciente(cat.token, { apellidoPaterno: 'ZZTESTPOP' });
    const cita = await crearCita(cat, pac.id, profesionalId, fecha, horaInicio);

    await irAAgenda(page, cat, fecha);

    // Abrir el popover con click en la tarjeta.
    await page.getByTestId(`cita-${cita.id}`).click();
    const popover = page.getByTestId('popover-cita');
    await expect(popover).toBeVisible();

    // Muestra los datos del paciente.
    await expect(page.getByTestId('popover-cita-nombre')).toContainText(/zztestpop/i);

    // Acción: marcar "Llegó" → el estado cambia en BD.
    expect(psql(`SELECT estado FROM citas WHERE id='${cita.id}'`)).toBe('agendada');
    await page.getByTestId('popover-cita-btn-llego').click();
    await expect.poll(() => psql(`SELECT estado FROM citas WHERE id='${cita.id}'`), { timeout: 8000 })
      .toBe('llego');
  });
});
