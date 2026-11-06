import { test, expect, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { createProject, evidence, freshApp, planToScreen, show, strokeMm, tap, touchSession } from './helpers';

const tapMm = async (page: Page, x: number, y: number, touch: Awaited<ReturnType<typeof touchSession>>) => tap(page, await planToScreen(page, x, y), touch);
const fillCommit = async (page: Page, testId: string, value: string, nth = 0) => {
  const el = page.getByTestId(testId).nth(nth);
  await el.fill(value);
  await el.press('Enter');
};

test.describe('Phase 4 自動積算', () => {
  test.beforeEach(async ({ page }) => freshApp(page));

  test('実測長入力 → 単価登録 → 見積合計が手計算と一致 → PDF・Excel を保存', async ({ page }) => {
    await createProject(page, '積算テスト', { blank: true });
    await show(page, '2D');
    const touch = await touchSession(page);
    await page.getByTestId('tool-pipe').click();
    await strokeMm(page, [[0, 0], [3000, 0], [3000, 2000]], touch);

    // 1本目の区間に実測長 3100mm
    await page.getByTestId('tool-select').click();
    await tapMm(page, 1500, 0, touch);
    await fillCommit(page, 'seg-measured', '3100');
    await expect(page.getByTestId('seg-used')).toContainText('実測 3100mm');

    await page.getByTestId('open-estimate').click();
    await expect(page.getByTestId('estimate-screen')).toBeVisible();
    // 使用長 3100+2000 = 5100mm → 定尺4m で 2本
    await expect(page.getByTestId('qty-used').first()).toHaveText('5100mm');
    await expect(page.getByTestId('qty-order').first()).toHaveText('2本');
    await page.getByTestId('tab-parts').click();
    await expect(page.getByTestId('parts-table')).toContainText('90°エルボ');

    // 単価: 材料 1000円/本、施工 500円/m
    await page.getByTestId('tab-price').click();
    await fillCommit(page, 'price-material', '1000');
    await fillCommit(page, 'price-labor', '500');
    // 材料 2本×1000=2000、施工 5.1m×500=2550 → 小計 4550、税 455、合計 5005
    await page.getByTestId('tab-quote').click();
    await expect(page.getByTestId('t-subtotal')).toHaveText('¥4,550');
    await expect(page.getByTestId('t-tax')).toHaveText('¥455');
    await expect(page.getByTestId('t-total')).toHaveText('¥5,005');
    await fillCommit(page, 'q-client', '沖縄 太郎');
    await page.screenshot({ path: evidence('p4-01-quote') });

    const [pdf] = await Promise.all([page.waitForEvent('download'), page.getByTestId('export-pdf').click()]);
    expect(pdf.suggestedFilename()).toMatch(/^積算テスト_見積書_\d{8}\.pdf$/);
    const pdfBytes = readFileSync(await pdf.path());
    expect(pdfBytes.subarray(0, 5).toString()).toBe('%PDF-');
    const [xlsx] = await Promise.all([page.waitForEvent('download'), page.getByTestId('export-xlsx').click()]);
    expect(xlsx.suggestedFilename()).toMatch(/\.xlsx$/);
    expect(readFileSync(await xlsx.path()).subarray(0, 2).toString()).toBe('PK');

    // 図面へ戻って Undo（宛名・施工単価の入力も履歴の1件ずつ）
    await page.getByTestId('close-estimate').click();
    await page.getByTestId('undo').click();
    await page.getByTestId('undo').click();
    await page.getByTestId('open-estimate').click();
    await page.getByTestId('tab-quote').click();
    await expect(page.getByTestId('t-total')).toHaveText('¥2,200'); // 施工単価が消え 材料2000＋税200
    await expect(page.getByTestId('q-client')).toHaveValue('');
  });

  test('要確認の点を図面で選び、部品を確定すると要確認が消える', async ({ page }) => {
    await createProject(page, '確定テスト', { blank: true });
    await show(page, '2D');
    // 30°の曲がり（直角補正なしの手描きに相当）
    await page.evaluate(() => (window as any).__pc.getState().drawPolyline([{ x: 0, y: 0, z: 100 }, { x: 2000, y: 0, z: 100 }, { x: 3732, y: 1000, z: 100 }]));
    await page.getByTestId('open-estimate').click();
    await page.getByTestId('tab-issues').click();
    const confirmIssue = page.getByTestId('issues').locator('li', { hasText: '部品の確定' });
    await expect(confirmIssue).toHaveCount(1);
    await confirmIssue.getByTestId('issue-go').click();
    await expect(page.getByTestId('estimate-screen')).toBeHidden();
    await expect(page.getByTestId('fitting-confirm')).toBeVisible();
    await page.getByTestId('node-fitting').selectOption('elbow45');
    await expect(page.getByTestId('fitting-confirm')).toBeHidden();
    await page.screenshot({ path: evidence('p4-02-fitting') });
    await page.getByTestId('open-estimate').click();
    await page.getByTestId('tab-parts').click();
    await expect(page.getByTestId('parts-table')).toContainText('45°エルボ');
    await page.getByTestId('tab-issues').click();
    await expect(page.getByTestId('issues').locator('li', { hasText: '部品の確定' })).toHaveCount(0);
  });

  test('積算設定は保存され、再読み込み後も合計が同じ', async ({ page }) => {
    await createProject(page, '保存テスト', { blank: true });
    await show(page, '2D');
    const touch = await touchSession(page);
    await page.getByTestId('tool-pipe').click();
    await strokeMm(page, [[0, 0], [3700, 0]], touch);
    await page.getByTestId('open-estimate').click();
    await page.getByTestId('tab-price').click();
    await page.getByTestId('default-extra').selectOption('0.1');
    await fillCommit(page, 'price-material', '1200');
    await page.getByTestId('tab-qty').click();
    await expect(page.getByTestId('qty-order').first()).toHaveText('2本'); // 3700×1.1=4070 → 2本
    await page.getByTestId('tab-quote').click();
    await expect(page.getByTestId('t-total')).toHaveText('¥2,640'); // 2400 + 税240
    await page.getByTestId('close-estimate').click();
    await expect(page.getByTestId('save-state')).toHaveText('保存済み', { timeout: 10_000 });
    await page.reload();
    await page.getByText('保存テスト').first().click();
    await expect(page.getByTestId('editor')).toBeVisible();
    await page.getByTestId('open-estimate').click();
    await page.getByTestId('tab-quote').click();
    await expect(page.getByTestId('t-total')).toHaveText('¥2,640');
  });
});
