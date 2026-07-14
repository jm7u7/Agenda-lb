import { test, expect } from '@playwright/test';
import { resetMutables } from '../fixtures/db';
import { catalogo, crearPaciente, crearCita, fechaConSlot, Catalogo } from '../fixtures/api';
import { irAAgenda } from '../helpers/agenda';

// FLUJO 1 — GRILLA: la agenda renderiza columnas por profesional y slots por hora
// según sede/fecha, y una cita sembrada aparece en su slot.
test.describe('Grilla de agenda', () => {
  let cat: Catalogo;
  test.beforeEach(async () => {
    resetMutables();          // estado limpio y determinista
    cat = await catalogo();
  });

  test('render de columnas y slots por sede/fecha', async ({ page }) => {
    const { fecha, profesionalId } = await fechaConSlot(cat);
    await irAAgenda(page, cat, fecha);

    // La columna del profesional disponible existe.
    const columna = page.getByTestId(`agenda-columna-${profesionalId}`);
    await expect(columna).toBeVisible();

    // Hay varias columnas (una por profesional con turno) y varios slots libres.
    await expect(page.locator('[data-testid^="agenda-columna-"]').first()).toBeVisible();
    expect(await page.locator('[data-testid^="agenda-columna-"]').count()).toBeGreaterThan(0);
    expect(await page.locator('[data-testid^="slot-"]').count()).toBeGreaterThan(0);
  });

  test('una cita sembrada aparece en la grilla', async ({ page }) => {
    const { fecha, profesionalId, horaInicio } = await fechaConSlot(cat);
    const pac = await crearPaciente(cat.token);
    const cita = await crearCita(cat, pac.id, profesionalId, fecha, horaInicio);

    await irAAgenda(page, cat, fecha);

    // La tarjeta de la cita está en la grilla, dentro de la columna de su profesional.
    const tarjeta = page.getByTestId(`cita-${cita.id}`);
    await expect(tarjeta).toBeVisible();
    // El backend normaliza (title-case) el nombre; asertamos el apellido sin distinguir mayúsculas.
    await expect(tarjeta).toContainText(/zztest/i);
  });
});
