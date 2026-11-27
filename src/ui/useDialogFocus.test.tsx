// @vitest-environment jsdom
import { cleanup, fireEvent, render } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { useDialogFocus } from './useDialogFocus';

function Dialog({ id, children }: { id: string; children?: React.ReactNode }) {
  const ref = useDialogFocus();
  return <div ref={ref} role="dialog" data-testid={id}>{children}</div>;
}

function Host({ inner }: { inner?: boolean }) {
  const [open, setOpen] = useState(false);
  const [open2, setOpen2] = useState(false);
  return (
    <div>
      <button data-testid="opener" onClick={() => setOpen(true)}>開く</button>
      {open && (
        <Dialog id="d1">
          <button data-testid="a">A</button>
          <button data-testid="open2" onClick={() => setOpen2(true)}>上に開く</button>
          <button data-testid="close" onClick={() => setOpen(false)}>閉じる</button>
          {inner && open2 && (
            <Dialog id="d2">
              <button data-testid="x">X</button>
              <button data-testid="close2" onClick={() => setOpen2(false)}>閉じる</button>
            </Dialog>
          )}
        </Dialog>
      )}
    </div>
  );
}

const tab = (shift = false) => fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Tab', shiftKey: shift });

describe('useDialogFocus（窓を開いたらフォーカスを中へ）', () => {
  afterEach(cleanup);

  it('開くと窓そのものにフォーカスが移る（入力欄へ移してキーボードを出さない）', () => {
    const r = render(<Host />);
    r.getByTestId('opener').focus();
    fireEvent.click(r.getByTestId('opener'));
    expect(document.activeElement).toBe(r.getByTestId('d1'));
    expect(r.getByTestId('d1').getAttribute('tabindex')).toBe('-1');
  });

  it('autoFocus で中の入力欄にフォーカス済みなら動かさない', () => {
    function A() { const ref = useDialogFocus(); return <div ref={ref}><input data-testid="in" autoFocus /></div>; }
    const r = render(<A />);
    expect(document.activeElement).toBe(r.getByTestId('in'));
  });

  it('Tab は窓の中で回る（最後→最初、最初で Shift+Tab→最後）', () => {
    const r = render(<Host />);
    fireEvent.click(r.getByTestId('opener'));
    r.getByTestId('close').focus();
    tab();
    expect(document.activeElement).toBe(r.getByTestId('a'));
    tab(true);
    expect(document.activeElement).toBe(r.getByTestId('close'));
    // 窓そのものにフォーカスがあるときの Shift+Tab も外へ出ない
    r.getByTestId('d1').focus();
    tab(true);
    expect(document.activeElement).toBe(r.getByTestId('close'));
  });

  it('閉じると開く前のボタンへ戻る', () => {
    const r = render(<Host />);
    r.getByTestId('opener').focus();
    fireEvent.click(r.getByTestId('opener'));
    fireEvent.click(r.getByTestId('close'));
    expect(document.activeElement).toBe(r.getByTestId('opener'));
  });

  it('2 枚重なったら上の窓だけで回り、上を閉じると下の窓の元のボタンへ戻る', () => {
    const r = render(<Host inner />);
    fireEvent.click(r.getByTestId('opener'));
    r.getByTestId('open2').focus();
    fireEvent.click(r.getByTestId('open2'));
    expect(document.activeElement).toBe(r.getByTestId('d2'));
    r.getByTestId('close2').focus();
    tab();
    expect(document.activeElement).toBe(r.getByTestId('x'));
    fireEvent.click(r.getByTestId('close2'));
    expect(document.activeElement).toBe(r.getByTestId('open2'));
    r.getByTestId('close').focus();
    tab();
    expect(document.activeElement).toBe(r.getByTestId('a'));
  });

  it('下の窓と上の窓が同時に開いても（中の窓が先に動く）、上の窓で回る', () => {
    function Both() {
      return (
        <Dialog id="outer">
          <button data-testid="o1">O</button>
          <Dialog id="inner"><button data-testid="i1">I1</button><button data-testid="i2">I2</button></Dialog>
        </Dialog>
      );
    }
    const r = render(<Both />);
    expect(document.activeElement).toBe(r.getByTestId('inner'));
    r.getByTestId('i2').focus();
    tab();
    expect(document.activeElement).toBe(r.getByTestId('i1'));
  });

  it('中に押せる物が無くても窓に留まる・開く前の要素が消えていても止まらない', () => {
    function B() {
      const [show, setShow] = useState(true);
      const [open, setOpen] = useState(false);
      return (
        <div>
          {show && <button data-testid="gone" onClick={() => setOpen(true)}>開く</button>}
          {open && <Dialog id="empty" />}
          <button data-testid="ctl" onClick={() => { setShow(false); }}>消す</button>
          <button data-testid="shut" onClick={() => setOpen(false)}>閉じる</button>
        </div>
      );
    }
    const r = render(<B />);
    r.getByTestId('gone').focus();
    fireEvent.click(r.getByTestId('gone'));
    tab();
    expect(document.activeElement).toBe(r.getByTestId('empty'));
    fireEvent.click(r.getByTestId('ctl'));
    expect(() => fireEvent.click(r.getByTestId('shut'))).not.toThrow();
  });

  it('文字を変換中（isComposing）の Tab は奪わない', () => {
    const r = render(<Host />);
    fireEvent.click(r.getByTestId('opener'));
    r.getByTestId('close').focus();
    const ev = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true, isComposing: true });
    r.getByTestId('close').dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(false);
  });
  it('同じ窓の中身が別の枠に入れ替わっても（編集の画面→一覧へ戻る）、新しい枠で回る', () => {
    function Swap() {
      const ref = useDialogFocus();
      const [edit, setEdit] = useState(false);
      if (edit) return <div ref={ref} data-testid="form"><button data-testid="back" onClick={() => setEdit(false)}>戻る</button></div>;
      return <div ref={ref} data-testid="list"><button data-testid="e" onClick={() => setEdit(true)}>編集</button><button data-testid="z">Z</button></div>;
    }
    const r = render(<Swap />);
    fireEvent.click(r.getByTestId('e'));
    expect(document.activeElement).toBe(r.getByTestId('form'));
    fireEvent.click(r.getByTestId('back'));
    expect(document.activeElement).toBe(r.getByTestId('list'));
    r.getByTestId('z').focus();
    tab();
    expect(document.activeElement).toBe(r.getByTestId('e'));
  });

  it('この仕組みを使っていない別の窓の中の Tab は奪わない', () => {
    const r = render(<div><Dialog id="d"><button>A</button></Dialog><div role="dialog" aria-modal="true"><button data-testid="other">B</button></div></div>);
    r.getByTestId('other').focus();
    const ev = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true });
    r.getByTestId('other').dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(false);
  });
});
