# 干渉・スリーブ表 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans.

**Spec:** docs/superpowers/specs/2026-11-12-clash-sleeve-design.md

## Global Constraints
- 排水系のファイル・スキーマ・ストアの commit に触れない。文字は LabelPlacer／表は fitText、noOverlap に追加。PDF の字形は JIS。

## Review Focus
1. つながっている区間（同じ点・T 字の分岐）を干渉にしない
2. 壁の端・角を通る配管を二重に数えない（1 本の区間が同じ壁を 1 回）
3. 立て管が 2 階の床と基礎スラブを両方通る → 2 行
4. スリーブが無い現場 → 申請画面で「スリーブはありません」、PDF は出さない
5. 行が多い階（30 行以上）→ 続きのページ、番号が位置図と表で一致

### Task 1: `src/model/clash.ts` `findPipeClashes(doc) → PipeClash[]`、estimate の要確認 'clash'
### Task 2: `src/model/sleeves.ts` `sleeveSize(od, system)`、`sleeveSchedule(doc) → SleeveRow[]`
### Task 3: `src/export/sleeveSheet.ts` `renderSleeveSheets(doc, rows, meta) → Sheet[]`、noOverlap
### Task 4: 申請画面の「スリーブ表」、E2E
