import { defineConfig, devices } from '@playwright/test';
import path from 'node:path';
import { STORAGE_STATE } from './storage-state';

const REPO = path.resolve(__dirname, '..');

// Suite E2E de la capa visual (recepción) contra un ENTORNO AISLADO:
// API :3003 (BD limablue_agenda_e2e, Redis db 3, worker OFF) + web :5181 (vite dev, proxy → :3003).
// Nunca toca producción (:3002/:5180 ni limablue_agenda). Ver e2e/README.md.
export default defineConfig({
  testDir: './tests',
  fullyParallel: false,       // BD compartida + reset por test → serie
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: [['list'], ['html', { outputFolder: 'playwright-report', open: 'never' }]],
  timeout: 30_000,
  globalSetup: require.resolve('./global-setup.ts'),

  use: {
    baseURL: 'http://localhost:5181',
    trace: 'retain-on-failure',
    video: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },

  projects: [
    { name: 'setup', testMatch: /auth\.setup\.ts/ },
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'], storageState: STORAGE_STATE },
      dependencies: ['setup'],
    },
  ],

  webServer: [
    {
      // API compilada en caliente con ts-node, cargando .env.e2e (aislado, worker off).
      command: 'npx ts-node --transpile-only src/index.ts',
      cwd: path.join(REPO, 'apps/api'),
      env: { ENV_FILE: '.env.e2e' },
      url: 'http://localhost:3003/api/docs',
      timeout: 90_000,
      reuseExistingServer: true,
      stdout: 'ignore',
      stderr: 'pipe',
    },
    {
      // Frontend en dev (fuente → testids en vivo), proxy /api,/socket.io → :3003.
      command: 'npx vite',
      cwd: path.join(REPO, 'apps/web'),
      env: { PORT: '5181', VITE_PROXY_TARGET: 'http://localhost:3003' },
      url: 'http://localhost:5181',
      timeout: 90_000,
      reuseExistingServer: true,
      stdout: 'ignore',
      stderr: 'pipe',
    },
  ],
});
