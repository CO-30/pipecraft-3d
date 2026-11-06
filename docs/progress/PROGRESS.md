# PipeCraft 3D 進捗記録

再開手順: このファイル → `CLAUDE.md` → 該当Phaseの計画 (`docs/superpowers/plans/`) の順に読む。完了済みPhaseは再実装しない。

## Phase 0 技術検証 — 完了（2026-11-06）
- ブランチ: `phase0/tech-spike`（main は README のみの初期コミット `23900fc`）
- 結論: 2D/3D共通データ連動・スマホでの3D操作・配管の描画/分岐/削除・IndexedDB保存は**技術的に成立**。
- 実装: `src/model/network.ts`（ノード＋区間ネットワーク、不変条件を壊す操作は拒否）、`geometry.ts`（手描き単純化・直角補正・ヒット判定）、`state/store.ts`（共通ストア・Undo/Redo）、`storage/repository.ts`（Dexie＋Zod＋保存時検証＋直前版バックアップ）、`ui/PlanView.tsx`・`View3D.tsx`
- テスト: 単体 43件 合格 / E2E 11件 合格・1件対象外（PC Chrome・iPhone/Android は Chromium エミュレーション＋CDPタッチ）。証拠: `test-evidence/`
- 独立レビュー（Sonnet）: Critical 1（隣接点への移動で長さ0区間→保存後に読めない）、Important 5 → **すべて修正・回帰テスト追加済み**
- 技術的リスク / 既知の問題
  - iPhone Safari(WebKit) はこの環境で未検証 → 実機テストが必要（Phase 1 合格時にGitHub Pages等のプレビューURLを用意する案はユーザー確認事項＝公開に当たるため保留）
  - 3D の配管が細く見えにくい（Phase 3 で太さ・選択強調を調整）
  - バンドル 1.37MB（Phase 5 で分割）
  - テスト用フック `window.__pc` 等は Phase 1 で e2e モード限定にする
  - `measuredApprox`（実測長の按分）の警告表示は Phase 4 で UI 化

## Phase 1 建物作成 — 着手
- 計画: `docs/superpowers/plans/2026-11-06-phase1-building.md`
- ブランチ: `phase1/building`（phase0 から派生）
