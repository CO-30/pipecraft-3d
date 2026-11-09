// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { ProfileSettingsDialog } from './ProfileSettingsDialog';
import { useProfiles } from './useProfiles';

describe('自治体プロファイルの管理', () => {
  afterEach(() => cleanup());

  it('同梱の standard は削除ボタンが無く、複製すると一覧が 2 件になり編集フォームが開く', async () => {
    render(<ProfileSettingsDialog onClose={() => {}} />);
    await screen.findByTestId('profile-row-standard');
    expect(screen.queryByTestId('profile-delete-standard')).toBeNull();
    fireEvent.click(screen.getByTestId('profile-dup-standard'));
    await screen.findByTestId('profile-form');
    expect((screen.getByTestId('pf-name') as HTMLInputElement).value).toContain('のコピー');
    fireEvent.change(screen.getByTestId('pf-name'), { target: { value: '那覇市（仮）' } });
    fireEvent.click(screen.getByTestId('pf-save'));
    await waitFor(() => expect(screen.getAllByTestId(/^profile-row-/)).toHaveLength(8)); // 同梱 7 ＋ 複製 1
    expect(useProfiles.getState().user[0].name).toBe('那覇市（仮）');
  });

  it('最小勾配の書き方が不正なら保存せずエラー', async () => {
    render(<ProfileSettingsDialog onClose={() => {}} />);
    await screen.findByTestId('profile-row-standard');
    fireEvent.click(screen.getByTestId('profile-dup-standard'));
    await screen.findByTestId('profile-form');
    fireEvent.change(screen.getByTestId('pf-minslope'), { target: { value: 'abc' } });
    fireEvent.click(screen.getByTestId('pf-save'));
    expect((await screen.findByTestId('profile-form-error')).textContent).toContain('最小勾配');
  });

  it('不正な JSON の読み込みはエラー表示', async () => {
    render(<ProfileSettingsDialog onClose={() => {}} />);
    await screen.findByTestId('profile-row-standard');
    const input = screen.getByTestId('profile-import') as HTMLInputElement;
    const file = new File(['{"id":"x"}'], 'x.json', { type: 'application/json' });
    fireEvent.change(input, { target: { files: [file] } });
    expect((await screen.findByTestId('profile-msg')).textContent).toContain('形式が正しくありません');
  });
});
