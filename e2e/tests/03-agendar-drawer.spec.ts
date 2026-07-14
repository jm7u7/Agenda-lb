import { test, expect } from '@playwright/test';
import { resetMutables, psql } from '../fixtures/db';
import { catalogo, crearPaciente, fechaConSlot, Catalogo } from '../fixtures/api';
import { irAAgenda } from '../helpers/agenda';

// FLUJO 3 — DRAWER: crear una cita end-to-end desde la UI (buscar paciente existente,
// elegir servicio y hora, agendar) y verificar que quedó creada en la BD.
test.describe('Agendar cita (drawer)', () => {
  let cat: Catalogo;
  test.beforeEach(async () => {
    resetMutables();
    cat = await catalogo();
  });

  test('crear una cita completa desde el drawer', async ({ page }) => {
    const { fecha, horaInicio } = await fechaConSlot(cat);
    // Paciente ya registrado (se busca por DNI en el drawer).
    const pac = await crearPaciente(cat.token, { apellidoPaterno: 'ZZTESTDRAWER' });

    await irAAgenda(page, cat, fecha);

    // Abrir el drawer.
    await page.getByTestId('btn-nueva-cita').click();
    // Paciente existente → buscar por DNI → seleccionar.
    await page.getByTestId('drawer-paciente-existente').click();
    await page.getByTestId('drawer-paciente-buscar').fill(pac.numeroDocumento);
    await page.getByTestId(`drawer-paciente-result-${pac.id}`).click();

    // Servicio + hora (el profesional queda en auto-asignación para preferencia_opcional).
    await page.getByTestId('drawer-servicio').selectOption(cat.servicio30.id);
    await page.getByTestId('drawer-hora').selectOption(horaInicio);

    // Agendar.
    await page.getByTestId('drawer-submit').click();

    // La cita quedó creada en la BD para ese paciente y fecha.
    await expect.poll(
      () => psql(`SELECT count(*) FROM citas WHERE "pacienteId"='${pac.id}' AND fecha::date='${fecha}' AND estado NOT IN ('cancelada') AND "deletedAt" IS NULL`),
      { timeout: 10000 },
    ).toBe('1');

    // Y aparece en la grilla (el drawer se cerró tras crear).
    await expect(page.getByTestId('agenda-grid')).toBeVisible();
    expect(psql(`SELECT "horaInicio" FROM citas WHERE "pacienteId"='${pac.id}' AND "deletedAt" IS NULL`)).toBe(horaInicio);
  });
});
