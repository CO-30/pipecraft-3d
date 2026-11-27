# 申請の手順ガイド Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans.

**Goal:** 手順ガイドに「申請の書類までの手順」（図面を入れる→器具を置く→自動でつなぐ→確認の質問→書類を出す）を足し、ボタン 1 つで各工程を始められるようにする。

**Architecture:** `guide.ts` に純関数 `shinseiSteps(doc, ctx)`・`currentShinseiStep`（既存の guideSteps は変えない）。数（つなぎ忘れ・質問）は画面側 `shinseiCtx` で書類センターと同じ関数で数える。prefs に `guideMode`（端末ごと、既定は見積）。「自動でつなぐ」は配管の欄のボタンと同じ `runAutoConnect` を共有。「質問」「書類」は申請画面を提出書類一式を開いた状態で開く（`ShinseiScreen initialDocs`）。

## Review Focus
- 既定は見積の手順のまま（既存の初心者シナリオを変えない）
- ガイドを隠した設定は申請の手順でも効く
- 自治体が未選択なら質問を済みにしない
- 書類はいつも最後の工程（出したかを保存していないので「済み」にしない）

### Task 1: guide.ts（guide.test.ts） ／ Task 2: GuideBar・prefs・Editor・ShinseiScreen（guideBar.test.tsx） ／ Task 3: E2E（shinsei.spec.ts）・記録
