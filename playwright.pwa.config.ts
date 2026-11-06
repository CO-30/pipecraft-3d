import { defineConfig } from '@playwright/test';

/** PWA（オフライン起動）の検証。Service Worker を含む本番ビルドを /pipecraft-3d/ 相当のサブパスなしで配信 */
export default defineConfig({
  testDir: './e2e-pwa',
  outputDir: './test-results-pwa',
  workers: 1,
  reporter: [['list'], ['json', { outputFile: 'test-evidence/e2e-pwa-results.json' }]],
  use: { baseURL: 'http://localhost:4174/', channel: 'chrome', viewport: { width: 1400, height: 860 },
    launchOptions: { args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] } },
  webServer: { command: 'npx tsc -b && npx vite build --outDir dist-pwa && npx vite preview --outDir dist-pwa --port 4174 --strictPort', port: 4174, reuseExistingServer: false, timeout: 120_000 },
  projects: [{ name: 'pc-chrome-pwa' }],
});
