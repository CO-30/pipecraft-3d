# スキャン図面から壁を読み取る Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** 下敷き（スキャン PDF・画像）から壁の候補を読み取ってこの階に入れる。
**Architecture:** 画素 → インクの印 → 水平・垂直の線 → 既存の detectStrips/buildingStrips/wallsFromStrips → 下敷きの画素座標 → pxToWorld で図面へ。
**Tech Stack:** TypeScript / Vitest / Playwright
**Spec:** `docs/superpowers/specs/2026-11-17-scan-wall-read-design.md`

## Global Constraints
- 内部単位 mm。下敷きの縮尺が決まっていないときは読まない
- 赤・青の書き込み（色の濃い画素）はインクにしない
- 既存のベクター図面の読み取りの結果は変えない

## Review Focus
- 白紙・真っ黒・文字だけの画像 → 壁 0 本で「読めませんでした」（Task 1）
- 下敷きが回転している → 壁も回転して下敷きに重なる（Task 2）
- この階に壁がある → 置き換えを選ぶまで消さない（Task 2）
- 縮尺が仮（未確定）→ ボタンを出さず、縮尺を決めるよう案内（Task 3）
- 薄いスキャン（灰色の線）→ 大津の閾値で拾える（Task 1）

### Task 1: raster.ts
- `inkMask(rgba: Uint8ClampedArray, w: number, h: number): Uint8Array`
- `rasterLines(mask: Uint8Array, w: number, h: number, minRun: number): PxLine[]`（`PxLine = { dir: 'h'|'v'; c: number; lo: number; hi: number; t: number }`）
- `rasterWalls(mask: Uint8Array, w: number, h: number, mmPerPx: number, paperMmPerPx: number): PxWall[]`（`PxWall = { a: Vec2; b: Vec2 /* 画素 */; thickness: number /* mm */; kind; openings }`）
- [ ] テスト（作り物の画像: 1/50 で 9100×6370 の外壁（二重線 120mm）・内壁 1 本・ドアの切れ目・赤い線・文字のような点）→ 外壁 4・内壁 1、外形の寸法 ±40mm、開口 1、赤い線は壁にならない、薄い灰色でも読む、白紙・真っ黒は []
### Task 2: ストアに入れる
- `readUnderlayWalls(underlayId: string, walls: PxWall[], replace: boolean): { walls: number; exterior: number; openings: number } | null`
- [ ] テスト: 回転した下敷きで壁の端が pxToWorld と一致、replace=false で壁があれば null、replace=true で置き換え・元に戻せる
### Task 3: 画面・E2E
- [ ] 下敷きのパネルに「🧱 壁を読み取る」（縮尺が決まった PDF・画像）、置き換えの確認、結果の文。SCAN_NOTE の案内を更新
- [ ] E2E（PC・iPhone・Android）: 作り物のスキャン PDF（画像だけ）を下敷き → 縮尺 1/50 → 壁を読み取る → 壁の本数の文
### Task 4: 仕上げ
- [ ] 全テスト・build・lint、独立監査、記録、PR・マージ・公開
