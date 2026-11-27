# ダイアログのフォーカス移動 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** 画面の上に開く窓（ダイアログ）を開いたら中へフォーカスを移し、Tab で外へ出ず、閉じたら開く前のボタンへ戻す。

**Architecture:** `src/ui/useDialogFocus.ts` に React フック 1 つ。モジュール内のスタックで「いちばん上の窓」だけが Tab を閉じ込める（申請図面の画面の上に提出書類一式が重なる場合）。各ダイアログの外枠 div に ref を付けるだけ（中身・testid・Escape の処理は変えない）。

**Tech Stack:** React 18, TypeScript, Vitest + @testing-library/react (jsdom), Playwright

## Global Constraints
- 既存機能を壊さない（testid・Escape・外側タップで閉じる はそのまま）
- autoFocus の入力欄があればそれを優先（すでに中にフォーカスがあれば動かさない）
- スマホでキーボードを勝手に出さない（入力欄へは移さず、窓そのもの（tabIndex=-1）へ移す）
- フォーカス移動で画面をスクロールさせない（preventScroll）

## Review Focus
- 窓が 2 枚重なる（ShinseiScreen → DocCenter）: Tab は上の窓だけ、上を閉じたら下の窓の元のボタンへ戻る
- 開く前の要素が閉じる間に消えた（DOM から外れた）: 戻さずエラーも出さない
- 中に押せる物が 1 つも無い: Tab で窓そのものに留まる
- 入力中の IME（isComposing）の Tab は奪わない
- 開いた時点で autoFocus 済み: そのまま

---

### Task 1: useDialogFocus フック

**Files:** Create `src/ui/useDialogFocus.ts`, Test `src/ui/useDialogFocus.test.tsx`

**Interfaces:** Produces `useDialogFocus(ref: RefObject<HTMLElement>): void`（ref 先に tabIndex が無ければ -1 を付ける）

- [ ] テスト: 開くと窓にフォーカス／autoFocus 済みなら動かさない／最後の要素で Tab→最初、最初で Shift+Tab→最後／閉じると元のボタンへ戻る／2 枚重ねで上だけ閉じ込め、上を閉じると下の中の元の要素へ／元の要素が消えていても例外なし
- [ ] 失敗を確認 → 実装 → 合格

### Task 2: 各ダイアログへ適用

**Files:** Modify DocCenterDialog, ShinseiBundleDialog, HelpDialog, ImportReportDialog, NewProjectDialog, GuideBar(工事名・現場情報), ProfileSettingsDialog(2 つ), EstimateScreen, ShinseiScreen
- [ ] 外枠（role="dialog" の要素）に ref を付ける
- [ ] 既存テスト（全 Vitest）と E2E 全体を実行
- [ ] docCenterDialog.test.tsx に「開くと中へ・閉じると申請図面の『提出書類一式』ボタンへ戻る」を追加
