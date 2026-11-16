/**
 * 道路の手続き（本管からの取出し）: 申請書タブの欄を開く → 要る手続きのチェックリスト → 入力 → 書類一式の PDF。
 * 取出しを両方「しない」にすると PDF は作れず「要りません」になる。入力は現場に保存される。
 */
import { expect, test } from '@playwright/test';
import { evidence, freshApp } from './helpers';

test.describe('道路の手続き', () => {
  test.beforeEach(async ({ page }) => freshApp(page));

  test('チェックリスト → 入力 → 道路の申請書類一式 (PDF)', async ({ page }) => {
    await page.getByTestId('open-sample').click();
    await expect(page.getByTestId('editor')).toBeVisible();
    await page.getByTestId('open-shinsei').click();
    await page.getByTestId('shinsei-kind-forms').click();
    // 様式の無い自治体（標準）でも工事店の情報を入れられ、申請者（会社）の欄に入る
    await page.getByTestId('forms-contractor-toggle').click();
    await page.getByTestId('contractor-name').fill('テスト設備');
    await page.getByTestId('contractor-save').click();
    await expect(page.getByTestId('forms-msg')).toContainText('保存しました');
    await page.getByTestId('road-toggle').click();
    await expect(page.getByTestId('road-applicantName')).toHaveValue('テスト設備');
    await expect(page.getByTestId('road-checklist')).toContainText('道路占用許可申請書');
    await expect(page.getByTestId('road-warnings')).toContainText('道路の種類が未選択です');
    await page.getByTestId('road-roadKind').selectOption('町道');
    await page.getByTestId('road-routeName').fill('町道与那原1号線');
    await page.getByTestId('road-roadWidth').fill('6');
    await page.getByTestId('road-waterMainAt').fill('3');
    await page.getByTestId('road-roadAdmin').fill('与那原町長');
    await page.getByTestId('road-start').fill('2099-12-01');
    await expect(page.getByTestId('road-checklist')).toContainText('2099-11-10');
    await expect(page.getByTestId('road-checklist')).toContainText('与那原町長');
    await page.getByTestId('road-toggle').scrollIntoViewIfNeeded();
    await page.screenshot({ path: evidence('road-01-panel') });
    const [pdf] = await Promise.all([page.waitForEvent('download'), page.getByTestId('road-pdf').click()]);
    expect(pdf.suggestedFilename()).toContain('道路の申請書類.pdf');
    const { PDFDocument } = await import('pdf-lib');
    const { readFile } = await import('node:fs/promises');
    const d = await PDFDocument.load(await readFile((await pdf.path())!));
    expect(d.getPageCount()).toBeGreaterThanOrEqual(9);
    if (test.info().project.name === 'pc-chrome') await pdf.saveAs('test-evidence/pc-chrome-road-permit.pdf');
    // 取出しを両方しない → PDF は作れない
    await page.getByTestId('road-water').selectOption('しない');
    await page.getByTestId('road-sewer').selectOption('しない');
    await expect(page.getByTestId('road-checklist')).toContainText('要りません');
    await expect(page.getByTestId('road-pdf')).toBeDisabled();
    // 入力は現場に保存される
    await page.getByTestId('close-shinsei').click();
    await expect(page.getByTestId('save-state')).toHaveText('保存済み');
    await page.reload();
    await page.getByTestId('project-item').first().locator('.pmain').click();
    await page.getByTestId('open-shinsei').click();
    await page.getByTestId('shinsei-kind-forms').click();
    await page.getByTestId('road-toggle').click();
    await expect(page.getByTestId('road-routeName')).toHaveValue('町道与那原1号線');
  });
});
