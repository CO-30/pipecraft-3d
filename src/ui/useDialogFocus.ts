import { useCallback, useEffect, useState } from 'react';

/**
 * 画面の上に開く窓（ダイアログ）のフォーカスの扱い。返す ref を窓の外枠に付ける。
 * - 開いたら窓そのもの（tabIndex=-1）へフォーカスを移す。入力欄へは移さない（スマホでキーボードを勝手に出さない）。
 *   autoFocus などで中にフォーカス済みならそのまま。
 * - Tab / Shift+Tab は窓の中で回す（後ろの図面のボタンへ出ていかない）。窓が重なったら いちばん上の窓だけ。
 * - 閉じたら開く前の要素へ戻す（その要素がもう無ければ何もしない）。
 * - 同じ窓の中で外枠が入れ替わったとき（一覧⇔編集）は、新しい外枠で同じことをする。
 */
const stack: HTMLElement[] = [];

const FOCUSABLE = 'a[href],button:not([disabled]),input:not([disabled]):not([type="hidden"]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"]),summary,[contenteditable="true"]';

type CheckVis = (o?: { visibilityProperty?: boolean }) => boolean;

function focusables(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((el) => {
    if (el.closest('[hidden],[inert]')) return false;
    // 閉じた details の中身は飛ばす（summary だけ押せる）
    const det = el.parentElement?.closest('details');
    if (det && !det.open && el.tagName !== 'SUMMARY') return false;
    // 見えない物は飛ばす（古い iOS Safari には checkVisibility が無いので、そのときは数える）
    const cv = (el as HTMLElement & { checkVisibility?: CheckVis }).checkVisibility;
    return cv ? cv.call(el, { visibilityProperty: true }) : true;
  });
}

function onKey(e: KeyboardEvent) {
  if (e.key !== 'Tab' || e.isComposing) return;
  const top = stack[stack.length - 1];
  if (!top || !top.isConnected) return;
  const active = document.activeElement as HTMLElement | null;
  const inside = !!active && top.contains(active);
  if (!inside && active) {
    // この仕組みを使っていない別の窓の中なら、その窓に任せる
    const host = active.closest<HTMLElement>('[role="dialog"],[aria-modal="true"]');
    if (host && !stack.includes(host) && !host.contains(top)) return;
  }
  const list = focusables(top);
  if (list.length === 0) { e.preventDefault(); top.focus({ preventScroll: true }); return; }
  const first = list[0], last = list[list.length - 1];
  if (e.shiftKey) {
    if (!inside || active === first || active === top) { e.preventDefault(); last.focus({ preventScroll: true }); }
  } else if (!inside || active === last) {
    e.preventDefault(); first.focus({ preventScroll: true });
  }
}

export function useDialogFocus(): (el: HTMLElement | null) => void {
  // 開く前にフォーカスがあった要素（描画の前に取る。autoFocus より先）
  const [opener] = useState<HTMLElement | null>(() => (typeof document === 'undefined' ? null : (document.activeElement as HTMLElement | null)));
  const [el, setEl] = useState<HTMLElement | null>(null);
  const ref = useCallback((node: HTMLElement | null) => { if (node) setEl(node); }, []);
  useEffect(() => {
    if (!el) return;
    if (!el.hasAttribute('tabindex')) el.tabIndex = -1;
    // 中の窓が先に開いている（同時に開くと子の方が先に動く）なら、その下に入れる
    const below = stack.findIndex((s) => el.contains(s));
    if (below >= 0) stack.splice(below, 0, el); else stack.push(el);
    if (stack.length === 1) document.addEventListener('keydown', onKey);
    if (!el.contains(document.activeElement)) el.focus({ preventScroll: true });
    return () => {
      const i = stack.lastIndexOf(el);
      if (i >= 0) stack.splice(i, 1);
      if (stack.length === 0) document.removeEventListener('keydown', onKey);
      const a = document.activeElement;
      // 閉じる時に窓の中（か どこにも無い）ときだけ戻す。ほかの所へ移した後なら奪わない
      const lost = !a || a === document.body || el.contains(a) || !a.isConnected;
      if (lost && opener && opener !== document.body && opener.isConnected) opener.focus({ preventScroll: true });
    };
  }, [el, opener]);
  return ref;
}
