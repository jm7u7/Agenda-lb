import { Page, expect } from '@playwright/test';
import { Catalogo } from '../fixtures/api';

/**
 * Navega a la Agenda y fija sede + unidad + fecha deterministas.
 * `fecha` en formato yyyy-MM-dd (usar una fecha RELATIVA a hoy, no hardcodeada).
 */
export async function irAAgenda(page: Page, cat: Catalogo, fecha: string) {
  await page.goto('/');
  // Seleccionar la sede del catálogo (auto-selecciona la 1ra; forzamos la nuestra).
  await page.getByTestId(`sede-btn-${cat.sede.id}`).click();
  // Fijar la fecha del día del test.
  await page.getByTestId('agenda-fecha-input').fill(fecha);
  // Esperar a que la grilla renderice.
  await expect(page.getByTestId('agenda-grid')).toBeVisible({ timeout: 15000 });
}

/**
 * Arrastra la tarjeta de una cita a un slot destino, respetando dnd-kit:
 * el PointerSensor tiene activationConstraint distance:8 (hay que mover >8px para iniciar el
 * arrastre) y la collisionDetection es pointerWithin (el puntero debe quedar DENTRO del destino).
 */
export async function dragCitaASlot(page: Page, citaId: string, slotTestId: string) {
  const src = await page.getByTestId(`cita-${citaId}`).boundingBox();
  const dst = await page.getByTestId(slotTestId).boundingBox();
  if (!src || !dst) throw new Error(`sin boundingBox (cita=${!!src} slot=${!!dst})`);
  const sx = src.x + src.width / 2, sy = src.y + src.height / 2;
  const tx = dst.x + dst.width / 2, ty = dst.y + dst.height / 2;

  // dnd-kit (PointerSensor, distance:8, collision pointerWithin) requiere PointerEvents reales
  // con huecos de requestAnimationFrame para que procese el arrastre y recalcule `over`.
  await page.evaluate(async ({ srcTestId, sx, sy, tx, ty }) => {
    const el = document.querySelector(`[data-testid="${srcTestId}"]`);
    if (!el) throw new Error('cita no encontrada en el DOM');
    const raf = () => new Promise((r) => requestAnimationFrame(() => r(null)));
    const pe = (type: string, x: number, y: number, buttons: number) =>
      new PointerEvent(type, { bubbles: true, cancelable: true, composed: true, pointerId: 1, pointerType: 'mouse', isPrimary: true, button: 0, buttons, clientX: x, clientY: y });
    el.dispatchEvent(pe('pointerdown', sx, sy, 1));
    await raf();
    // Supera el umbral de 8px → activa el drag.
    document.dispatchEvent(pe('pointermove', sx + 20, sy + 20, 1)); await raf(); await raf();
    document.dispatchEvent(pe('pointermove', (sx + tx) / 2, (sy + ty) / 2, 1)); await raf(); await raf();
    document.dispatchEvent(pe('pointermove', tx, ty, 1)); await raf(); await raf();
    document.dispatchEvent(pe('pointermove', tx, ty + 1, 1)); await raf(); await raf();
    document.dispatchEvent(pe('pointerup', tx, ty, 0));
  }, { srcTestId: `cita-${citaId}`, sx, sy, tx, ty });
}
