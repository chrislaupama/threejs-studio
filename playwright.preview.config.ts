import { defineConfig, devices } from '@playwright/test';

const artifactName = process.env.PLAYWRIGHT_ARTIFACT_NAME ?? 'production-preview';

export default defineConfig({
  testDir: './tests',
  testMatch: ['production-preview.spec.ts'],
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
  workers: 1,
  timeout: 30_000,
  expect: {
    timeout: 5_000,
  },
  use: {
    baseURL: 'http://127.0.0.1:4188',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: process.env.CI ? 'on-first-retry' : 'off',
  },
  webServer: {
    command: 'npm run preview',
    url: 'http://127.0.0.1:4188',
    reuseExistingServer: false,
    timeout: 20_000,
  },
  projects: [
    {
      name: 'production-preview-chromium',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1280, height: 720 },
      },
    },
  ],
});
