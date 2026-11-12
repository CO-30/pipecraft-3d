/**
 * 共通の要望欄（使い方の画面の下）。受付先が空なら押せない。受付先を入れると送れて、工事名・住所が中身に入らない。
 */
import { test, expect } from '@playwright/test';
import { evidence, freshApp } from './helpers';

test.describe('要望欄', () => {
  test.beforeEach(async ({ page }) => { await freshApp(page); });

  test('ホームと作業画面の「使い方」から開けて、送る中身に工事名が入らない', async ({ page }) => {
    let posted: any = null;
    await page.route('https://example.test/exec', (r) => { posted = JSON.parse(r.request().postData() || '{}'); return r.fulfill({ status: 200, body: '{"ok":true}' }); });

    await page.getByTestId('open-help').click();
    const box = page.getByTestId('feedback-box');
    await box.scrollIntoViewIfNeeded();
    await expect(box).toContainText('ご要望・不具合の報告');
    await expect(box.getByRole('button', { name: '送信する' })).toBeDisabled();
    await expect(box).toContainText('受付先がまだ設定されていません');
    await page.getByTestId('help-close').click();

    await page.getByTestId('open-sample').click();
    await expect(page.getByTestId('editor')).toBeVisible();
    await page.getByTestId('open-help-editor').click();
    await expect(page.getByTestId('feedback-box')).toContainText('ご要望・不具合の報告');
    // 受付先を入れた状態にして送る（本物の受付には送らない）
    await page.evaluate(() => { const fw = (window as any).FeedbackWidget; fw.init({ endpoint: 'https://example.test/exec' }); fw.render('[data-testid="feedback-box"]'); });
    const b = page.getByTestId('feedback-box');
    await b.locator('textarea').fill('E2E の送信テスト');
    await b.scrollIntoViewIfNeeded();
    await page.screenshot({ path: evidence('feedback-01-editor') });
    await b.getByRole('button', { name: '送信する' }).click();
    await expect(b).toContainText('送信しました');
    expect(posted.app).toBe('水道見積');
    expect(posted.text).toBe('E2E の送信テスト');
    expect(posted.context.画面).toBe('作業');
    expect(posted.context.配管).toBeGreaterThan(0);
    expect(posted.log.map((l: any) => l.a)).toContain('押した: 使い方');
    const all = JSON.stringify(posted);
    expect(all).not.toContain('練習用'); // 工事名「サンプル工事（練習用）」は送らない
  });
});
