// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { emptyDoc, useStore } from '../state/store';
import { ShinseiScreen } from './ShinseiScreen';
import { repo } from '../storage/instance';
import { CONTRACTOR_KEY } from '../forms/formSets';
import { EMPTY_CONTRACTOR } from '../forms/types';

const s = () => useStore.getState();
const open = async () => {
  render(<ShinseiScreen onClose={() => {}} />);
  fireEvent.click(await screen.findByTestId('shinsei-docs'));
  return screen.findByTestId('doc-center');
};
const ids = () => screen.getAllByTestId(/^doc-row-/).map((e) => e.getAttribute('data-testid')!.replace('doc-row-', ''));

describe('提出書類一式（書類センター）', () => {
  afterEach(async () => { cleanup(); await repo.setSetting(CONTRACTOR_KEY, EMPTY_CONTRACTOR); });

  it('南風原町: 必要な書類が状態つきで並ぶ。未入力があれば「確認が必要」で理由が見え、申請書の入力へ行ける', async () => {
    s().newDoc(emptyDoc(), { id: 'p', name: 'テスト工事', createdAt: 1 });
    s().updateSite({ municipalityProfileId: 'haebaru' });
    await open();
    await waitFor(() => expect(ids()).toEqual(['nanbu', 'nanbuProducts', 'haebaruSewer', 'road', 'drawings']));
    const row = screen.getByTestId('doc-row-nanbu');
    await waitFor(() => expect(row.textContent).toContain('確認が必要'));
    expect(row.textContent).toContain('工事店の情報が未入力');
    // 配管が無い工事: 図面は作れないので最初から外れていて、選べない
    const draw = within(screen.getByTestId('doc-row-drawings')).getByRole('checkbox') as HTMLInputElement;
    expect(draw.disabled).toBe(true);
    expect((screen.getByTestId('doc-zip') as HTMLButtonElement).textContent).toContain('4');
    fireEvent.click(within(row).getByRole('button', { name: /直す/ }));
    expect(screen.queryByTestId('doc-center')).toBeNull();
    expect(await screen.findByTestId('shinsei-forms')).toBeTruthy();
  });

  it('工事店が入っていれば製品一覧表の理由は「製品が無い」だけ。様式が未登録の町は申請書を出さない', async () => {
    await repo.setSetting(CONTRACTOR_KEY, { ...EMPTY_CONTRACTOR, name: 'テスト設備' });
    s().newDoc(emptyDoc(), { id: 'p', name: 'テスト工事', createdAt: 1 });
    s().updateSite({ municipalityProfileId: 'haebaru' });
    await open();
    await waitFor(() => expect(screen.getByTestId('doc-row-nanbuProducts').textContent).toContain('載せる製品がありません'));
    expect(screen.getByTestId('doc-row-nanbuProducts').textContent).not.toContain('工事店の情報');
    expect(screen.getByTestId('doc-check-summary').textContent).toContain('確認が必要な書類が');
    cleanup();
    s().updateSite({ municipalityProfileId: 'standard' });
    await open();
    await waitFor(() => expect(ids()).toEqual(['unregistered', 'road', 'drawings']));
    expect(screen.getByTestId('doc-row-road').textContent).toContain('まだ選ばれていません');
    expect(screen.getByTestId('doc-row-unregistered').textContent).toContain('まだ登録していません');
  });
});
