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
  - ~~テスト用フック `window.__pc` 等~~ → Phase 1 で e2e ビルド限定にした
  - `measuredApprox`（実測長の按分）の警告表示は Phase 4 で UI 化

## Phase 1 建物作成 — 完了（2026-11-06）
- 計画: `docs/superpowers/plans/2026-11-06-phase1-building.md`／ブランチ: `phase1/building`（phase0 から派生）
- 実装した機能
  - 現場管理: 一覧（更新日順）・検索・新規（寸法から／白紙）・開く・複製・削除（確認）・JSON書き出し/読み込み（常に新規追加）
  - 建物: 階（追加は外壁コピー・階高変更で上階の高さ自動再計算・削除は確認）、壁（なぞり描画、角150mmスナップ、T字で既存壁を分割、50mmグリッド、角/壁ドラッグ、厚さ・外壁/内壁）、ドア・窓（壁タップ、寸法編集、重なり・天井高超えは拒否）、矩形の部屋（名前・面積）
  - 3D 自動生成（開口部で分割した壁、階ごとの床・天井）、カテゴリ別 表示/半透明/非表示、要素ごとの「この部分だけ非表示」「半透明」
  - 保存: プロジェクト v2（建物＋配管）、v1 からの自動変換、保存失敗時は未保存のまま5秒ごとに再試行、未保存で一覧へ戻る時は確認
  - レイアウト: PC=左（階・表示）/中央（2D・3D・2D+3D）/右（設定）、スマホ=単一ビュー＋下部の大きなツール
- 主な変更ファイル: `src/model/{building,building3d,buildingHit,schema}.ts`、`src/state/store.ts`、`src/storage/{repository,instance}.ts`、`src/ui/*`、`src/App.tsx`、`e2e/*`
- テスト: 単体 80件 合格 / E2E 15件 合格・3件対象外（PCでのピンチ、スマホでのファイル操作）。証拠: `test-evidence/`（`*-p1-*.png`、`e2e-results.json`）
- 独立レビュー（Sonnet）: Critical 0 / Important 3（保存失敗時の消失リスク・開口部の重なり・空ドラッグで履歴が増える）→ **修正・回帰テスト追加済み**。Minor のうち 階0件検出・階数の整数チェック・ホーム画面のエラー表示も対応
- 既知の制約（後続Phaseで対応）
  - 部屋は矩形のみ・壁を動かしても部屋は追従しない（Phase 2: 部屋の結合・分割と合わせて）
  - 3D の外壁の出隅に壁厚/2 の欠け（Phase 2 の3D編集で端部処理）
  - 階の削除・階高変更に配管は追従しない（配管は絶対高さ。Phase 3 で階との関連付けを検討）
  - 3Dでの壁の直接編集・断面表示は Phase 2
  - PWA（オフライン起動）は未導入（Phase 5 予定だが、完成条件13に関わるため Phase 2 で前倒し検討）
  - 実機（iPhone Safari / Android Chrome）での確認は未実施

## 公開・main 反映（2026-11-06）
- Phase 1 を main にマージ（ユーザー承認、`8939d81`）
- リポジトリを公開（ユーザー操作）。GitHub Pages: `gh-pages` ブランチを配信 → https://co-30.github.io/pipecraft-3d/ （実機確認用。ユーザー承認済み）
- `gh-pages` はビルド成果物のみ。各Phase完了時（PR作成時点）に更新する

## Phase 2 2D・3D編集連動 — 完了（2026-11-06）
- 計画: `docs/superpowers/plans/2026-11-06-phase2-edit-sync.md`／ブランチ: `phase2/edit-sync`（main `8939d81` から派生）
- 実装した機能
  - 部屋の分割（✂：部屋を横切る線、切断線に内壁も作成・凹んだ部屋は内側の区間ごと）と結合（辺を共有する同じ階の部屋）。`src/model/roomOps.ts`（polyclip-ts 0.16.8）
  - 壁・角を動かすと部屋の頂点も追従（部屋がねじれる・0.1㎡未満になる移動は拒否）
  - 3Dで**選択済み**の壁をドラッグ移動、壁の両端の角ハンドルで角を移動（50mm単位、1操作=履歴1件）。未選択要素の上のドラッグは従来通り回転。つかんだ指以外は無視、OrbitControls を同期停止
  - 断面表示の基礎（水平／縦 東西／縦 南北＋位置スライダー。建物・配管とも切る。切られて見えない部分はタップ対象外）、3Dで表示する階（全部／この階まで／この階だけ）
  - 外壁の出隅・T字の足の欠けを解消（壁端を相手壁の厚さ/2 延長）
  - 3D初期カメラを画面の縦横比に合わせて建物全体が入るように
  - PWA（vite-plugin-pwa 2.0.0）: オフライン起動、ホーム画面追加用 manifest・アイコン、新版通知。`base: './'` で Pages のサブパス対応
- 主な変更ファイル: `src/model/{roomOps,section,building,building3d}.ts`、`src/state/store.ts`、`src/ui/{View3D,PlanView,Panels,UpdatePrompt}.tsx`、`vite.config.ts`、`e2e/phase2.spec.ts`、`e2e-pwa/offline.spec.ts`、`playwright.pwa.config.ts`
- テスト: 単体 102件 合格 / E2E 27件 合格・3件対象外 / PWA E2E 1件 合格（本番ビルドでオフライン再読み込み→現場作成・保存）。証拠: `test-evidence/`（`*-p2-*.png`、`e2e-results.json`、`e2e-pwa-results.json`）
- 独立レビュー（Sonnet）: Critical 0 / Important 3（分割で無関係な部屋が切られる、3Dドラッグの多指・リスナー解除・Undo中ドラッグ）→ **修正・回帰テスト追加済み**。Minor のうち 結合モード解除・凹部屋の切断壁・部屋のねじれ・角ハンドルのずれ・配管への断面/階フィルタ・断面値の再丸め・manifest も対応
- 既知の制約（後続Phaseで対応）
  - 壁の端の延長は単純な箱の重なり（半透明時に角が濃く見える）
  - 3Dでの開口部（ドア・窓）のドラッグ移動は未対応（数値・2Dで編集）
  - 配管は絶対高さで階に追従しない（Phase 3）
  - バンドル約1.5MB（Phase 5 で分割）
  - 実機（iPhone Safari / Android Chrome）確認はユーザー待ち

## 次の作業: Phase 3（配管・配線）
- 描画・分岐・接続・移動・切断・削除・高さ/種類/色/管径変更・Undo/Redo の完成度向上（Phase 0 の試作を本実装へ）、配管の階への関連付け、3Dでの配管の太さ・選択強調
