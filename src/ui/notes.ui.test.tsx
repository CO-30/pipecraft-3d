// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { emptyDoc, useStore } from '../state/store';
import { PropertyPanel } from './Panels';

const s = () => useStore.getState();
const text = () => Object.values(s().doc.notes ?? {})[0]?.text;

beforeEach(() => s().newDoc(emptyDoc(), { id: 'p', name: 't', createdAt: 1 }));
afterEach(cleanup);

describe('メモの編集欄', () => {
  it('書いている途中で図面をタップして選択が変わっても、本文は消えない（欄が消えるときに保存）', () => {
    act(() => s().placeNoteAt({ x: 0, y: 0 }));
    render(<PropertyPanel />);
    fireEvent.change(screen.getByTestId('note-text'), { target: { value: '梁を避ける' } });
    act(() => s().select(null)); // 図面のタップ（blur は起きない）
    expect(text()).toBe('梁を避ける');
  });

  it('保存してから元に戻すと、欄が消えても戻した本文のまま（書き直さない）', () => {
    act(() => s().placeNoteAt({ x: 0, y: 0 }));
    render(<PropertyPanel />);
    const ta = screen.getByTestId('note-text');
    fireEvent.change(ta, { target: { value: 'あ' } });
    fireEvent.blur(ta);
    expect(text()).toBe('あ');
    act(() => s().undo()); // 選択も外れて欄が消える
    expect(text()).toBe('');
  });
});
