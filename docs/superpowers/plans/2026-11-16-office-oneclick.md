# 事務作業のクリック削減 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans（使用量節約のため Native。最後に独立監査 1 回）

**Goal:** 申請図面 7 種を 2 クリックで 1 つの PDF にまとめる。提出書類チェックリストのチェックを保存する。
**Architecture:** ShinseiScreen の作図 useMemo の中身を純粋関数 `buildShinsei(kind, ctx)` と `stampAsBuiltBuild(built, asBuilt)` に切り出し（`src/ui/shinseiBuild.ts`）、タブ表示と新しい `ShinseiBundleDialog` の両方で使う。
**Tech Stack:** React 19 / TypeScript / Vitest(jsdom) / Playwright
**Spec:** docs/superpowers/specs/2026-11-16-office-oneclick-design.md

## Global Constraints
- 既存のボタン・testid・出力ファイル名を変えない。スキーマ変更なし（`doc.site.application` の文字列キーのみ）。
- 並び順: 見取図 → 排水縦断図 → ます表 → 給水立面図 → 水理計算書 → スリーブ表 → 材料表。
- まとめ PDF のファイル名: `<工事名>_(竣工)申請図面一式_<日付>.pdf`。

## Review Focus
- 配管ゼロの工事: 全行が「作れません」で PDF ボタンは押せない。
- 見取図未設定（緯度なし）: 見取図は未チェック・理由表示、他は出せる。
- 竣工図オン: 縦断図・立面図・ます表に竣工の表題と印が入る（タブと同じ）。
- 分岐の選択・下流端の選択がまとめ出力にも効く。
- チェックリストの項目文言が変わっても古いキーで壊れない（無いキーは未チェック扱い）。

---

### Task 1: 作図処理の切り出し（挙動を変えない）
**Files:** Create `src/ui/shinseiBuild.ts`; Modify `src/ui/ShinseiScreen.tsx`
**Produces:** `type ShinseiKind`, `type ShinseiCtx`, `buildShinsei(kind, ctx): ShinseiBuild`, `stampAsBuiltBuild(b, asBuilt): ShinseiBuild`, `BUNDLE_KINDS`, `KIND_LABEL`
- [ ] 既存 `shinsei.test.tsx` と関連 E2E が通ることを確認（回帰テストが保護）
- [ ] 切り出し → `npx vitest run src/ui` PASS → commit

### Task 2: まとめて PDF
**Files:** Create `src/ui/ShinseiBundleDialog.tsx`; Modify `ShinseiScreen.tsx`, `App.css`; Test `src/ui/shinseiBundle.test.tsx`, `e2e/shinsei.spec.ts`
- [ ] テスト: `shinsei-bundle` を押すと `shinsei-bundle-row-<kind>` が並び順どおり、縦断図・立面図はチェック済み、見取図は「作れません」で未チェック；配管ゼロなら `shinsei-bundle-pdf` disabled；「見る」でタブが切り替わる
- [ ] RED 確認 → 実装 → GREEN → E2E でダウンロード名 `申請図面一式.*\.pdf` → commit

### Task 3: チェックリストを保存
**Files:** Modify `src/ui/ShinseiForms.tsx`; Test `src/ui/shinseiForms.test.tsx`
- [ ] テスト: チェック → `doc.site.application['checklist:<label>'] === '1'`、画面を作り直してもチェック済み
- [ ] RED → 実装 → GREEN → commit

### Task 4: 記録・監査・マージ
- [ ] 全単体・E2E、`docs/progress/log/2026-11-16-feat-office-oneclick.md`、test-evidence、独立監査、指摘修正、PR・mergeable 確認・マージ
