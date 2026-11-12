import { expect, test, type Page } from '@playwright/test';
import { newJwwDocument, toJwwBytes } from 'ezjww';
import { createProject, evidence, show, useTool } from './helpers';

const full = (page: Page) => page.evaluate(() => (window as any).__pc.getState().doc);
const base = { group: 0, pen_style: 1, pen_color: 1, pen_width: 0, layer: 0, layer_group: 0, flag: 0 };

/** 1/100 の図面: 用紙上 91mm × 72.8mm の四角（実寸 9100 × 7280）と文字 */
function sampleJww(): Buffer {
  const w = newJwwDocument();
  w.options.layer_groups[0].scale = 100;
  const pts = [[-45.5, -36.4], [45.5, -36.4], [45.5, 36.4], [-45.5, 36.4]];
  pts.forEach(([x, y], i) => {
    const [x2, y2] = pts[(i + 1) % 4];
    w.entities.push({ type: 'LINE', base, start_x: x, start_y: y, end_x: x2, end_y: y2 });
  });
  w.entities.push({ type: 'TEXT', base, start_x: -10, start_y: 0, end_x: 10, end_y: 0, text_type: 0, size_x: 4, size_y: 4, spacing: 0, angle: 0, font_name: 'ＭＳ ゴシック', content: '台所' });
  return Buffer.from(toJwwBytes(w));
}

test.describe('Jw_cad 図面の取り込み', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
  });

  test('下敷きパネルから .jww を取り込むと、縮尺確定済みの下敷きになる', async ({ page }) => {
    await createProject(page, 'JWWテスト', { blank: true });
    await show(page, '2D');
    await useTool(page, 'underlay');
    await page.getByTestId('ul-cad-file').setInputFiles({ name: '1階平面図.jww', mimeType: 'application/octet-stream', buffer: sampleJww() });
    await expect(page.locator('[data-underlay]')).toHaveCount(1, { timeout: 20_000 });
    const u = Object.values((await full(page)).underlays)[0] as any;
    expect(u.label).toBe('1階平面図（1/100）');
    expect(u.scaled).toBe(true);
    expect(u.src.startsWith('data:image/png;base64,')).toBe(true);
    // 図形の幅 9100mm ＋ 両側の余白 3% → 画像の幅
    expect(u.widthPx * u.mmPerPx).toBeGreaterThan(9100);
    expect(u.widthPx * u.mmPerPx).toBeLessThan(9100 * 1.08);
    await expect(page.getByTestId('ul-status')).toContainText('縮尺: 1px =');
    // 取り込んだ図面の全体が画面に入っている
    const box = await page.locator('[data-underlay]').boundingBox();
    const view = page.viewportSize()!;
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(view.width + 1);
    await page.screenshot({ path: evidence('cad-01-jww-underlay') });
    // 元に戻せる
    await page.getByTestId('undo').click();
    await expect(page.locator('[data-underlay]')).toHaveCount(0);
  });

  test('新しい工事で図面ファイルを選ぶと、作成後すぐ下敷きになる', async ({ page }) => {
    await page.getByTestId('new-project').click();
    await page.getByTestId('np-name').fill('新築 山田様邸');
    await page.getByTestId('np-mode-photo').click();
    await page.getByTestId('np-file').setInputFiles({ name: '配置図.jww', mimeType: '', buffer: sampleJww() });
    await page.getByTestId('np-create').click();
    await expect(page.getByTestId('editor')).toBeVisible();
    await expect(page.locator('[data-underlay]')).toHaveCount(1, { timeout: 20_000 });
    const u = Object.values((await full(page)).underlays)[0] as any;
    expect(u.label).toBe('配置図（1/100）');
    expect(u.scaled).toBe(true);
    await page.screenshot({ path: evidence('cad-02-new-project') });
  });

  test('.jww でないファイル・未対応の形式は分かる言葉で断る', async ({ page }) => {
    await createProject(page, '形式テスト', { blank: true });
    await show(page, '2D');
    await useTool(page, 'underlay');
    await page.getByTestId('ul-cad-file').setInputFiles({ name: 'こわれた.jww', mimeType: '', buffer: Buffer.from('これは図面ではありません') });
    await expect(page.getByRole('alert')).toContainText('Jw_cad の図面（.jww）ではない');
    // DXF は読める。中身の無い DXF は「線や文字が無い」と知らせる。DWG は DXF に保存し直すよう案内
    await page.getByTestId('ul-cad-file').setInputFiles({ name: '図面.dxf', mimeType: '', buffer: Buffer.from('0\nSECTION\n') });
    await expect(page.getByRole("alert")).toContainText("線や文字が見つかりませんでした");
    await page.getByTestId('ul-cad-file').setInputFiles({ name: '図面.dwg', mimeType: '', buffer: Buffer.from('AC1027') });
    await expect(page.getByRole("alert")).toContainText("DXF");
    await page.getByTestId("ul-cad-file").setInputFiles({ name: "古い.jwc", mimeType: "", buffer: Buffer.from("x") });
    await expect(page.getByRole("alert")).toContainText("Jw_cad");
    await expect(page.locator('[data-underlay]')).toHaveCount(0);
  });
});
