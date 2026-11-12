// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { emptyDoc, useStore } from '../state/store';
import { HelpDialog } from '../ui/HelpDialog';
import './feedback-widget.fixture.js'; // 本番は公開 URL から読む部品の写し
import { FEEDBACK_URL, fbError, feedbackContext, feedbackWidget, initFeedback } from './feedback';

const s = () => useStore.getState();
beforeEach(() => { initFeedback(); s().newDoc(emptyDoc(), { id: 'p', name: '山田様邸新築工事', address: '宜野湾市大山1-2-3', createdAt: 1 }); });
afterEach(cleanup);

describe('要望欄', () => {
  it('使い方の画面に要望欄が出て、共通の受付へ送れる状態になる', async () => {
    render(<HelpDialog onClose={() => {}} />);
    expect(await screen.findByText('ご要望・不具合の報告')).toBeTruthy();
    const go = screen.getByRole('button', { name: '送信する' }) as HTMLButtonElement;
    expect(go.disabled).toBe(false);
    expect(FEEDBACK_URL).toMatch(/^https:\/\/script\.google\.com\/macros\/s\/.+\/exec$/);
  });

  it('送る中身に工事名・住所が入らない', () => {
    const p = feedbackWidget()!.payload('テスト');
    expect(p.app).toBe('給水');
    const all = JSON.stringify(p);
    expect(all).not.toContain('山田');
    expect(all).not.toContain('宜野湾市大山');
    expect(feedbackContext()).toMatchObject({ 画面: '作業', 階数: 1 });
  });

  it('工事の一覧・メモの一覧のボタンは名前でなく決まった記録名になる', () => {
    const d = document.createElement('div');
    d.innerHTML = '<button data-fb="工事を開く"><span class="pname">山田様邸新築工事</span></button>';
    document.body.appendChild(d);
    expect(feedbackWidget()!._labelOf(d.querySelector('.pname')!)).toBe('押した: 工事を開く');
    d.remove();
  });

  it('要望を書いている途中の Esc（入力欄・日本語の変換の取り消し）では使い方の画面を閉じない', async () => {
    const close = vi.fn();
    render(<HelpDialog onClose={close} />);
    const ta = (await screen.findByPlaceholderText(/○○の画面/)) as HTMLTextAreaElement;
    fireEvent.keyDown(ta, { key: 'Escape' });
    fireEvent.keyDown(window, { key: 'Escape', isComposing: true });
    expect(close).not.toHaveBeenCalled();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(close).toHaveBeenCalledTimes(1);
  });

  it('ファイル名・住所・名前が入るボタンと選択肢は、決まった記録名か記録しない印がある', () => {
    const must: [string, string][] = [
      ['src/ui/HomeScreen.tsx', 'className="pmain" data-fb="工事を開く"'],
      ['src/ui/Notes.tsx', 'data-fb="メモの一覧から選ぶ"'],
      ['src/ui/NewProjectDialog.tsx', 'data-fb="図面ファイルを外す"'],
      ['src/ui/UnderlayPanel.tsx', 'data-fb="下敷きを選ぶ"'],
      ['src/ui/Panels.tsx', 'data-testid="floor-chip" data-fb="階を選ぶ"'],
      ['src/ui/Panels.tsx', 'data-testid="elev-chip" data-fb="立面を選ぶ"'],
      ['src/ui/LocationPanel.tsx', 'data-testid="mitori-place" data-fb-skip'],
      ['src/ui/SiteImportDialog.tsx', 'data-testid="site-fp" data-fb-skip'],
      ['src/ui/ShinseiScreen.tsx', 'data-testid="shinsei-profile" data-fb-skip'],
      ['src/ui/ShinseiScreen.tsx', 'data-testid="shinsei-outlet" data-fb-skip'],
      ['src/ui/ShinseiScreen.tsx', 'data-testid="shinsei-root" data-fb-skip'],
      ['src/ui/ShinseiScreen.tsx', '`shinsei-branch-${b.nodeId}`} data-fb-skip'],
    ];
    for (const [f, t] of must) expect(readFileSync(f, 'utf8'), `${f}: ${t}`).toContain(t);
  });

  it('画面に出したエラーは「：」「（」より前だけ記録する（ファイル名・サーバーの文言を残さない）', () => {
    fbError('PDF を開けませんでした（山田邸_平面図.pdf）。PDF のファイルを選んでください');
    fbError('工事を開けませんでした: QuotaExceededError 山田邸');
    const errs = feedbackWidget()!.payload('x').errors.map((e) => e.m);
    expect(errs.slice(-2)).toEqual(['表示: PDF を開けませんでした', '表示: 工事を開けませんでした']);
    expect(JSON.stringify(errs)).not.toContain('山田');
  });
});
