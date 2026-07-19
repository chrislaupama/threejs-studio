import { defineConfig, devices } from '@playwright/test';

const artifactName = process.env.PLAYWRIGHT_ARTIFACT_NAME ?? 'playwright';

export default defineConfig({
  testDir: './tests',
  testIgnore: ['production-preview.spec.ts'],
  forbidOnly: Boolean(process.env.CI),
  failOnFlakyTests: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI
    ? [
        ['line'],
        ['html', { open: 'never', outputFolder: `playwright-report/${artifactName}` }],
        ['junit', { outputFile: `test-results/${artifactName}.xml` }],
      ]
    : 'list',
  outputDir: `test-results/${artifactName}`,
  // One worker: parallel headless WebGL contexts share the software
  // rasterizer, and the frame-time collapse makes game time drift from wall
  // time, flaking timed gameplay phases and screenshot baselines.
  workers: 1,
  timeout: 30_000,
  expect: {
    timeout: 5_000,
  },
  use: {
    baseURL: 'http://127.0.0.1:5188',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: process.env.CI ? 'on-first-retry' : 'off',
  },
  webServer: {
    command: 'npm run dev',
    url: 'http://127.0.0.1:5188',
    reuseExistingServer: false,
    timeout: 20_000,
  },
  projects: [
    {
      name: 'desktop-chrome',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1280, height: 720 },
      },
    },
    {
      name: 'mobile-safari',
      use: {
        ...devices['iPhone 13'],
      },
    },
  ],
});
