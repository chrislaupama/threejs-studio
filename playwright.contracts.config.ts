import { defineConfig } from '@playwright/test';

const artifactName = process.env.PLAYWRIGHT_ARTIFACT_NAME ?? 'contracts';

export default defineConfig({
  testDir: './tests',
  testMatch: [
    'agent-game-tools.spec.ts',
    'agent-tools.spec.ts',
    'agent-v5-tools.spec.ts',
    'cloudflare-www-redirect.spec.ts',
    'collect-escape.spec.ts',
    'editor-preferences.spec.ts',
    'game-authoring.spec.ts',
    'game-project.spec.ts',
    'game-state.spec.ts',
    'gameplay-systems.spec.ts',
    'input-actions.spec.ts',
    'model.spec.ts',
    'offline-runtime-bundle.spec.ts',
    'project-commands.spec.ts',
    'project-v5.spec.ts',
    'runtime-kernel.spec.ts',
    'studio-sdk-contract.spec.ts',
    'workspace-shell.spec.ts',
  ],
  grepInvert: /Monaco reports zero semantic diagnostics/u,
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
});
