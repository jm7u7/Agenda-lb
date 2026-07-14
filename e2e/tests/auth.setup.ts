// Proyecto "setup": inicia sesión una vez vía la UI y guarda el storageState (token en
// localStorage `limablue-auth`) para que el resto de specs lo reusen sin re-loguearse.
import { test as setup, expect } from '@playwright/test';
import { STORAGE_STATE } from '../storage-state';

setup('login como admin', async ({ page }) => {
  await page.goto('/login');
  await page.locator('input[type="email"]').fill('admin@limablue.pe');
  await page.locator('input[type="password"]').fill('Admin1234!');
  await page.getByRole('button', { name: 'Ingresar' }).click();
  // Al autenticar, la app redirige fuera de /login.
  await expect(page).not.toHaveURL(/\/login/, { timeout: 15000 });
  await page.context().storageState({ path: STORAGE_STATE });
});
