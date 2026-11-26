# 排水の注意から場所へ移動・直し方のボタン Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** 「📂 提出書類一式」に排水の注意の一覧を出し、1 件ずつ「図面で見る」（その配管・マスを選んで図面へ戻る）と直し方（store の `applyDrainFix`）のボタンを付ける。自動でつなぐ後のお知らせ（store.ts）を実際の場所に合わせる。

**Architecture:** 純関数 `src/ui/drainLocate.ts`（注意の並び・場所の解決）＋ `DocCenterDialog` に一覧の節と `onLocate` を追加。`ShinseiScreen` が `onLocate` で申請画面ごと閉じる。保存データは変えない。

**Tech Stack:** React / zustand / Vitest / Playwright

**Spec:** スケジュール指示 (b)・`docs/progress/log/2026-11-26-auto-feat-doc-center-inspection.md`「次の候補」

## Global Constraints
- 既存のボタン・保存データを変えない。info（お知らせ）は一覧に出さない（inspection.ts と同じ基準）。
- 言葉は初めての人にも分かるもの。色だけで区別しない（⚠ と「直す」「見る」の文字）。

## Review Focus
- 対象が消えた配管（id が無い）→「図面で見る」は出さない（押しても何も起きないボタンを出さない）
- target が site → 見るボタン無し
- 直したあと一覧の index がずれる → 毎回ストアの最新の drainIssues の index で applyDrainFix（表示は filter 前の index を持つ）
- 器具（マス）が対象 → その器具の階に切り替えて選ぶ
- 注意が多い → 一覧は 6 件まで表示し「ほか N 件」

### Task 1: drainLocate.ts
- `drainRows(issues): { index: number; issue: DrainIssue }[]`（level !== 'info'）
- `locateTarget(doc, target): { floorId?: string; selection: { kind: 'segment'|'node'|'fixture'; id: string } } | null`
- テスト `src/ui/drainLocate.test.ts`: info 除外と index 保持／segment は a 端の階／fixture は floorId／存在しない id と site は null

### Task 2: 書類センターの一覧
- `DocCenterDialog` に `onLocate?: () => void`。注意があれば `data-testid="doc-drain-issues"` の節。各行 `doc-drain-go`（図面で見る）・`doc-drain-fix`（fix.label）
- 見る: setActiveFloor → setTool('select') → select → onLocate
- テスト（docCenterDialog.test.tsx）: 見るで選択されて画面が閉じる／直すで applyDrainFix が呼ばれ注意が消える
- store.ts のお知らせ文: 「申請の「📂 提出書類一式」で場所へ移動・直せます」

### Task 3: E2E・記録
- shinsei.spec.ts に勾配不足を作って一覧→見る→選択の確認（PC・スマホ）
