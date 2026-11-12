import { defineConfig, devices } from '@playwright/test'
import path from 'node:path'

// E2E runs against the real FastAPI backend (no mocks). Reuses dev servers if they are already up.
const backendDir = path.resolve(import.meta.dirname, '../backend')
const python =
  process.env.DEFECTFORGE_PYTHON ??
  (process.platform === 'win32' ? path.join(backendDir, '.venv', 'Scripts', 'python.exe') : path.join(backendDir, '.venv', 'bin', 'python'))

export default defineConfig({
  testDir: './tests',
  timeout: 90_000,
  expect: { timeout: 20_000 },
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: 'http://127.0.0.1:5173',
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'], viewport: { width: 1600, height: 960 } } }],
  webServer: [
    {
      command: `"${python}" -m uvicorn app.main:app --host 127.0.0.1 --port 8000`,
      cwd: backendDir,
      url: 'http://127.0.0.1:8000/api/v1/health',
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
    },
    {
      command: 'npm run dev',
      url: 'http://127.0.0.1:5173',
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
    },
  ],
})
