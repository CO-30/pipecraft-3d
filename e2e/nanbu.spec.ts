/**
 * 南部水道企業団（南風原町・八重瀬町）の給水申請: 申請書タブで南風原町を選ぶ → 確認申請書（作り物の PDF）から入れる
 * → 穿孔時の確認・製品一覧表の表 → 給水申請書類一式 (PDF)。名前・住所はすべて作り物。
 */
import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { evidence, freshApp } from './helpers';

/** 確認申請書・確認済証の文字だけを入れた PDF（pdf-lib で作る。実物と同じ行の並び） */
async function kakuninPdf(): Promise<Buffer> {
  const { PDFDocument } = await import('pdf-lib');
  const fontkit = (await import('@pdf-lib/fontkit')).default;
  const pdf = await PDFDocument.create();
  pdf.registerFontkit(fontkit);
  const font = await pdf.embedFont(await readFile('public/fonts/NotoSansJP-JIS.ttf'));
  const page = pdf.addPage([595, 842]);
  const lines: [number, string][] = [
    [40, '確認済証'], [60, '水野　太郎 様'], [80, '第 ABC-26-00000-1 号'], [96, '令和 8年9月30日'],
    [130, '〔1.建築主〕'], [146, '〔ｲ.氏名のﾌﾘｶﾞﾅ〕 ミズノ タロウ'], [162, '〔ﾛ.氏 名〕 水野 太郎'], [178, '〔ﾊ.郵便番号〕 901-0000'],
    [194, '〔ﾆ.住 所〕 沖縄県島尻郡南風原町字テスト1-2'], [210, '〔ﾎ.電話番号〕 090-0000-1111'], [226, '〔2.代理者〕'], [242, '〔ﾛ.氏 名〕 設計 一郎'],
    [270, '〔1.地名地番〕沖縄県島尻郡南風原町字テスト宇原100-1'], [286, '〔ｲ.幅 員〕 4.500 m'], [302, '〔ﾖ.延べ面積〕 88.20 ㎡'],
    [318, '〔4.構 造〕 木造(軸組工法)'], [334, '〔ｲ.地階を除く階数〕 2階'], [350, '〔ﾛ.地階の階数〕 0階'], [366, '〔16.工事完了予定年月日〕 令和 9 年 02 月 20 日'],
  ];
  for (const [y, s] of lines) page.drawText(s, { x: 40, y: 842 - y, size: 10, font });
  return Buffer.from(await pdf.save());
}

test.describe('南部水道企業団の給水申請', () => {
  test.beforeEach(async ({ page }) => freshApp(page));

  test('確認申請書から入れる → 穿孔時の確認 → 給水申請書類一式 (PDF)', async ({ page }) => {
    await page.getByTestId('open-sample').click();
    await expect(page.getByTestId('editor')).toBeVisible();
    await page.getByTestId('open-shinsei').click();
    await page.getByTestId('shinsei-profile').selectOption('haebaru');
    await page.getByTestId('shinsei-kind-forms').click();
    await expect(page.getByTestId('forms-nanbu')).toBeVisible();
    await expect(page.getByTestId('forms-water')).toHaveCount(0);
    await expect(page.getByTestId('forms-drill').locator('li')).toHaveCount(10);

    // 確認申請書（作り物）から: 建築主・確認番号・延べ面積・道路の幅員が空欄に入る
    await page.getByTestId('forms-kakunin-file').setInputFiles({ name: '確認申請書.pdf', mimeType: 'application/pdf', buffer: await kakuninPdf() });
    await expect(page.getByTestId('forms-msg')).toContainText('確認申請書から');
    await expect(page.getByTestId('app-ownerName')).toHaveValue('水野 太郎');
    await expect(page.getByTestId('app-ownerKana')).toHaveValue('ミズノ タロウ');
    await expect(page.getByTestId('app-confirmNo')).toHaveValue('ABC-26-00000-1');
    await expect(page.getByTestId('app-totalArea')).toHaveValue('88.20');
    await expect(page.getByTestId('app-tempUntil')).toHaveValue('2027-02-20');
    // 2 回目は入力済みを変えない
    await page.getByTestId('app-ownerName').fill('水野 次郎');
    await page.getByTestId('forms-kakunin-file').setInputFiles({ name: '確認申請書.pdf', mimeType: 'application/pdf', buffer: await kakuninPdf() });
    await expect(page.getByTestId('forms-msg')).toContainText('入力済み');
    await expect(page.getByTestId('app-ownerName')).toHaveValue('水野 次郎');

    // 工事店の情報
    await page.getByTestId('forms-contractor-toggle').click();
    await page.getByTestId('contractor-name').fill('テスト設備');
    await page.getByTestId('contractor-chiefEngineerNo').fill('123456');
    await page.getByTestId('contractor-save').click();
    await expect(page.getByTestId('forms-msg')).toContainText('保存しました');
    await page.getByTestId('forms-contractor-toggle').click();

    await page.getByTestId('forms-drill').scrollIntoViewIfNeeded();
    await page.screenshot({ path: evidence('nanbu-01-forms') });
    const [pdf] = await Promise.all([page.waitForEvent('download'), page.getByTestId('forms-nanbu').click()]);
    expect(pdf.suggestedFilename()).toContain('給水申請書類一式.pdf');
    const { PDFDocument } = await import('pdf-lib');
    const d = await PDFDocument.load(await readFile((await pdf.path())!));
    // チェック表 2・申込書・誓約書・様式第6号・横断面図・竣工検査・立面図・製品一覧表
    expect(d.getPageCount()).toBeGreaterThanOrEqual(8);
    await expect(page.getByTestId('forms-msg')).toContainText('まとめてPDF');

    // 南風原町の下水道: 排水設備計画確認申請書（4 面）＋実寸の平面図・縦断面図
    const [sewer] = await Promise.all([page.waitForEvent('download'), page.getByTestId('forms-haebaru-sewer').click()]);
    expect(sewer.suggestedFilename()).toContain('排水設備計画確認申請書.pdf');
    const sd = await PDFDocument.load(await readFile((await sewer.path())!));
    expect(sd.getPageCount()).toBeGreaterThanOrEqual(4);
    // 申請図面の「排水平面図」タブ
    await page.getByTestId('shinsei-kind-plan').click();
    await expect(page.getByTestId('shinsei-preview').locator('svg').first()).toBeVisible();
    await page.screenshot({ path: evidence('haebaru-sewer-01-plan') });
  });
});
