import { defineConfig, devices } from '@playwright/test';

/**
 * E2E 検証。iPhone Safari(WebKit) はこの環境に無いため、Chromium のモバイルエミュレーション
 * （タッチ有効）で代替し、実機テストは別途行う。
 */
export default defineConfig({
  testDir: './e2e',
  outputDir: './test-results',
  fullyParallel: false,
  workers: 1,
  reporter: [['list'], ['json', { outputFile: 'test-evidence/e2e-results.json' }]],
  use: {
    baseURL: 'http://localhost:4173',
    channel: 'chrome',
    screenshot: 'only-on-failure',
    launchOptions: { args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] },
  },
  webServer: { command: 'npm run build && npx vite preview --port 4173 --strictPort', port: 4173, reuseExistingServer: true, timeout: 120_000 },
  projects: [
    { name: 'pc-chrome', use: { viewport: { width: 1400, height: 860 } } },
    { name: 'mobile-iphone-emu', use: { ...devices['iPhone 13'], defaultBrowserType: 'chromium', channel: 'chrome' } },
    { name: 'mobile-android-emu', use: { ...devices['Pixel 7'], channel: 'chrome' } },
  ],
});
