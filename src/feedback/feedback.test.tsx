// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { emptyDoc, useStore } from '../state/store';
import { HelpDialog } from '../ui/HelpDialog';
import { feedbackContext, feedbackWidget, initFeedback } from './feedback';

const s = () => useStore.getState();
beforeEach(() => { initFeedback(); s().newDoc(emptyDoc(), { id: 'p', name: '山田様邸新築工事', address: '宜野湾市大山1-2-3', createdAt: 1 }); });
afterEach(cleanup);

describe('要望欄', () => {
  it('使い方の画面に要望欄が出る。受付先が空のあいだは送れない', () => {
    render(<HelpDialog onClose={() => {}} />);
    expect(screen.getByText('ご要望・不具合の報告')).toBeTruthy();
    const go = screen.getByRole('button', { name: '送信する' }) as HTMLButtonElement;
    expect(go.disabled).toBe(true);
  });

  it('送る中身に工事名・住所が入らない', () => {
    const p = feedbackWidget()!.payload('テスト');
    expect(p.app).toBe('水道見積');
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
});
