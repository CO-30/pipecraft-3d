/**
 * DXF。申請画面の図面を DXF（R12・Shift_JIS）に書き出す／DXF を下敷きに取り込む（実寸）。
 */
import { expect, test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { createProject, evidence, freshApp, isMobile, show, useTool } from './helpers';
import { drainHouse } from '../src/model/testDrainHouse';

const full = (page: Page) => page.evaluate(() => (window as any).__pc.getState().doc);

/** 9100 × 7280 の外形と部屋名（UTF-8、R2013） */
function sampleDxf(): Buffer {
  const L = (x1: number, y1: number, x2: number, y2: number) => ['0', 'LINE', '8', 'WALL', '10', String(x1), '20', String(y1), '11', String(x2), '21', String(y2)];
  const s = ['0', 'SECTION', '2', 'HEADER', '9', '$ACADVER', '1', 'AC1027', '9', '$INSUNITS', '70', '4', '0', 'ENDSEC',
    '0', 'SECTION', '2', 'ENTITIES', ...L(0, 0, 9100, 0), ...L(9100, 0, 9100, 7280), ...L(9100, 7280, 0, 7280), ...L(0, 7280, 0, 0),
    '0', 'TEXT', '8', 'TEXT', '10', '3000', '20', '3000', '40', '300', '1', '洗面所',
    '0', 'ENDSEC', '0', 'EOF'].join('\r\n');
  return Buffer.from(s, 'utf-8');
}

test.describe('DXF', () => {
  test.beforeEach(async ({ page }) => freshApp(page));

  test('申請画面の縦断図を DXF に書き出す', async ({ page }) => {
    await createProject(page, 'DXF書き出し');
    await page.evaluate((d) => { const s = (window as any).__pc.getState(); s.newDoc(d, s.meta); }, drainHouse().doc);
    await page.getByTestId('open-shinsei').click();
    await expect(page.getByTestId('shinsei-preview')).toContainText('排水設備 縦断図');
    await expect(page.getByTestId('shinsei-dxf')).toBeEnabled();
    if (isMobile()) return;
    const [dl] = await Promise.all([page.waitForEvent('download'), page.getByTestId('shinsei-dxf').click()]);
    expect(dl.suggestedFilename()).toMatch(/縦断図.*\.dxf$/);
    const bytes = readFileSync((await dl.path())!);
    const s = new TextDecoder('shift_jis').decode(bytes);
    expect(s).toContain('AC1009');
    expect(s).toContain('排水設備 縦断図');
    if (test.info().project.name === 'pc-chrome') await dl.saveAs('test-evidence/pc-chrome-dxf-01-profile.dxf');
  });

  test('DXF を下敷きに取り込むと実寸（mm）の線画になる', async ({ page }) => {
    await createProject(page, 'DXF取込', { blank: true });
    await show(page, '2D');
    await useTool(page, 'underlay');
    await expect(page.getByTestId('ul-cad')).toContainText('DXF');
    await page.getByTestId('ul-cad-file').setInputFiles({ name: '1階平面図.dxf', mimeType: '', buffer: sampleDxf() });
    await expect(page.locator('[data-underlay]')).toHaveCount(1, { timeout: 20_000 });
    const u = Object.values((await full(page)).underlays)[0] as any;
    expect(u.label).toBe('1階平面図（DXF・実寸）');
    expect(u.widthPx * u.mmPerPx).toBeGreaterThan(9100);
    expect(u.widthPx * u.mmPerPx).toBeLessThan(9100 * 1.08);
    await page.screenshot({ path: evidence('dxf-02-underlay') });
    // DWG は読めないので DXF に保存し直すよう案内
    await page.getByTestId('ul-cad-file').setInputFiles({ name: '図面.dwg', mimeType: '', buffer: Buffer.from('AC1027') });
    await expect(page.getByRole('alert')).toContainText('DXF');
  });
});
