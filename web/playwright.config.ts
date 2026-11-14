import { defineConfig } from '@playwright/test';
import { CAMERA_FEED } from './e2e/fixtures';

const PORT = 4173;

export default defineConfig({
  testDir: 'e2e',
  globalSetup: './e2e/fixtures.ts',
  timeout: 120_000,
  expect: { timeout: 30_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: `http://localhost:${PORT}/`,
    viewport: { width: 412, height: 892 },
    hasTouch: true,
    acceptDownloads: true,
    trace: 'off',
    launchOptions: {
      // Set to a Chromium binary to use it instead of Playwright's own.
      executablePath: process.env.PW_CHROMIUM_PATH,
      args: [
        // Chromium's built-in fake camera, playing the test scene.
        '--use-fake-device-for-media-stream',
        '--use-fake-ui-for-media-stream',
        `--use-file-for-fake-video-capture=${CAMERA_FEED}`,
      ],
    },
  },
  webServer: {
    command: `npm run preview -- --port ${PORT} --strictPort`,
    port: PORT,
    reuseExistingServer: !process.env.CI,
  },
});
