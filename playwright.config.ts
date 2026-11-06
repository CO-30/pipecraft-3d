import { defineConfig, devices } from '@playwright/test';

/**
 * E2E 検証。iPhone Safari(WebKit) はこの環境に無いため、Chromium のモバイルエミュレーション
 * （タッチ有効）で代替し、実機テストは別途行う。
 */
// ロケール未設定（POSIX）だと Chrome が日本語のダウンロードファイル名を "download" にするため UTF-8 を指定
if (!process.env.LANG) process.env.LANG = 'C.UTF-8';

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
  webServer: { command: 'npx tsc -b && npx vite build --mode e2e --outDir dist-e2e && npx vite preview --outDir dist-e2e --port 4173 --strictPort', port: 4173, reuseExistingServer: false, timeout: 120_000 },
  projects: [
    { name: 'pc-chrome', use: { viewport: { width: 1400, height: 860 } } },
    { name: 'mobile-iphone-emu', use: { ...devices['iPhone 13'], defaultBrowserType: 'chromium', channel: 'chrome' } },
    { name: 'mobile-android-emu', use: { ...devices['Pixel 7'], channel: 'chrome' } },
  ],
});
