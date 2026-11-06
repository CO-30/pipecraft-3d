# Phase 2 2D・3D編集連動 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans（Native 実行。ユーザー指定の自動進行ルールにより計画承認待ちはしない）. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 3Dで壁・角を直接編集でき、断面表示の基礎・部屋の結合/分割・外壁出隅の処理・PWA（オフライン起動）を備え、どちらの画面で変更しても同じモデルに反映される状態にする。

**Architecture:** 編集はすべて既存の純粋関数（`src/model/building.ts`）＋共通ストア（`src/state/store.ts`）経由。3D はストアの `beginDrag/dragWall/dragCorner/endDrag` を再利用し、表示専用の断面・階フィルタ状態はストアの非履歴フィールドに置く。部屋の多角形演算は `polyclip-ts` に閉じ込めた `src/model/roomOps.ts` で行う。

**Tech Stack:** 既存（React 19 / R3F 9 / three 0.187 / Zustand 5 / Vitest / Playwright）＋ `polyclip-ts@0.16.8`（MIT, 多角形 union/intersection）＋ `vite-plugin-pwa@2.0.0`（MIT, vite 8 対応, generateSW）

**Spec:** Claudeプロジェクト資料 `docs/PipeCraft3D_最終実装設計書.md`（第4-4, 5, 13 Phase 2, 11 オフライン）、`docs/progress/PROGRESS.md` の Phase 1 既知の制約

## Global Constraints
- 内部単位は mm。2D/3D は共通ストアだけを読み書きし、データを二重管理しない。
- 不変条件を壊す操作は元の Building を返す（既存方針）。
- 回転・拡大縮小と編集が干渉しないこと（設計書12）：3Dでは**選択済み**の壁/角だけがドラッグで動く。未選択要素の上の1本指ドラッグは従来通り回転。
- スマホでPC画面を縮小しただけの設計は禁止。追加UIはスマホでも押せる大きさ。
- 依存は版を固定（`^` なし）。
- GitHub Pages のサブパス（`/pipecraft-3d/`）で動くよう `base: './'`。

## Review Focus
1. 部屋の分割線が部屋に掛からない／端をかするだけ → 何も変わらない（履歴も増えない）。→ Task 1 テスト `split: line missing room is no-op`
2. 離れた部屋（辺を共有しない）や別の階の部屋の結合 → 拒否。→ Task 1 `merge: disjoint / other floor rejected`
3. 角を動かして壁が短すぎ等で拒否された時、部屋だけ動いてしまう → 部屋も動かない。→ Task 2 `rejected corner move leaves rooms`
4. 3Dで選択済み壁をタップしただけ（移動0）→ 履歴が増えない。→ Task 4 E2E `tap selected wall in 3D adds no history`
5. 断面の高さが建物外（負・最上階より上）→ 全表示/全非表示にならず値は範囲に丸める。→ Task 5 `clampSection`

---

### Task 1: 部屋の結合・分割（モデル）

**Files:** Create `src/model/roomOps.ts`, `src/model/roomOps.test.ts`; Modify `package.json`（`polyclip-ts` 0.16.8）

**Interfaces:**
- Produces: `mergeRooms(b: Building, aId: string, bId: string): { b: Building; roomId: string | null }` — 同じ階・辺を共有（union が単一多角形）の場合のみ。名前は a の名前、id は新規。
- Produces: `splitRoom(b: Building, roomId: string, p: Vec2, q: Vec2): { b: Building; roomIds: string[]; cut: [Vec2, Vec2] | null }` — p→q を通る直線で切断。2片以上に分かれた時だけ置換（各片 面積 ≥ 0.1㎡）。名前 `<元名>-1`, `-2`…。`cut` は直線と部屋の交差区間（最小/最大パラメータ）。
- 結果多角形は 1mm に丸め、重複点・一直線上の中間点を除去。

- [ ] テスト: 2部屋 4000×3000 が x=4000 で接する→ merge で 1部屋 24㎡・頂点4; L字の結合で 6頂点; 離れた部屋/別階は `roomId=null` かつ `b` 同一参照; split 横線 y=1500 で 12㎡×2・cut=[(0,1500),(4000,1500)]; 部屋外の線は no-op; L字を切ると3片になりうる（各片が返る）
- [ ] 実装→ `npx vitest run src/model/roomOps.test.ts` PASS → commit

### Task 2: 部屋を壁に追従させる・外壁出隅（モデル）

**Files:** Modify `src/model/building.ts`（`moveCorner`, `moveWall`）, `src/model/building3d.ts`; Tests 既存 test ファイルへ追加

**Interfaces:**
- `moveCorner`/`moveWall`: 移動が受理された時のみ、同じ階の部屋の頂点で移動前の角位置から 1mm 以内のものを同じだけ動かす。
- `building3d.wallPieces`: 角に非平行（|外積| > 0.1）の他の壁がある端を、それらの最大 `thickness/2` だけ延長（開口部オフセットは延長前の a 端基準を保つ）。

- [ ] テスト: 矩形の建物で角を動かすと部屋の頂点も動く; 拒否された移動では部屋不変; 出隅で壁箱の長さ = 芯長 + 厚さ（両端延長）; 一直線に続く壁は延長しない
- [ ] 実装→ vitest PASS → commit

### Task 3: ストアと 2D UI（結合・分割ツール）

**Files:** Modify `src/state/store.ts`, `src/ui/PlanView.tsx`, `src/ui/Panels.tsx`, `src/state/store.test.ts`

**Interfaces:**
- `Tool` に `'split'` を追加。`splitRoomAt(roomId: string, p: Vec2, q: Vec2, withWall: boolean): void`（withWall なら `cut` 区間に内壁を `B.addWall` で追加。壁と部屋の分割は1つの履歴）。`mergeRoomWith(otherId: string): void`（選択中の部屋と結合、成功時に結合後の部屋を選択）。
- 部屋プロパティに「隣の部屋と結合」→ 次にタップした部屋と結合するモード（`pendingMerge: string | null`、非履歴）。
- PlanView: `split` ツールはなぞり→始点・終点の直線で、始点が乗っている部屋（無ければ線が交差する最初の部屋）を分割。プレビュー線表示。ツールバーに「✂ 分割」。

- [ ] ストアテスト: splitRoomAt(withWall) 後 undo 1回で元に戻る; mergeRoomWith 成功で選択が新部屋
- [ ] 実装→ vitest PASS → commit

### Task 4: 3Dでの壁・角の直接編集

**Files:** Modify `src/ui/View3D.tsx`, `e2e/phase2.spec.ts`（新規）, `e2e/helpers.ts`

**Interfaces:**
- 選択ツールで、選択済み壁の箱を pointerdown → その階の床面（elevation）の水平面でドラッグ、50mm 丸めの dx,dy で `dragWall`。選択済み壁の両端の角に操作用ハンドル（直径 0.25m の円柱、高さは天井高）を表示し、ドラッグで `dragCorner`（50mm 丸め）。開始時 `beginDrag`、終了時 `endDrag`、ドラッグ中は OrbitControls 無効。
- e2e フック `__pc3d.projectPoint(x,y,z)` を追加。

- [ ] E2E（pc-chrome＋mobile 2種）: 2Dで壁選択→3Dで壁をドラッグ→ストアの角座標が変化し 2D の `data-wall` 線も移動; 角ハンドルのドラッグで壁長が変化; 選択済み壁をタップのみ → `past.length` 不変
- [ ] 実装→ `npx playwright test e2e/phase2.spec.ts` PASS → commit

### Task 5: 断面表示の基礎・階ごとの3D表示

**Files:** Create `src/model/section.ts`（+test）; Modify `src/state/store.ts`, `src/ui/View3D.tsx`, `src/ui/Panels.tsx`

**Interfaces:**
- ストア（非履歴）: `section: { mode: 'off' | 'z' | 'x' | 'y'; value: number }`, `floorFilter: 'all' | 'upToActive' | 'activeOnly'`; `setSection(s)`, `setFloorFilter(f)`。
- `clampSection(b: Building, s): Section` — z: 0〜最上階上端、x/y: 角の範囲 ±1000mm。
- `sectionPlane(s): { normal: Vec3; constant: number } | null` — z 断面は z > value を切る（下を残す）、x/y は value より大きい側を切る。建物の材質だけに `clippingPlanes`（配管は切らない）。`gl.localClippingEnabled = true`。
- 階フィルタは building 箱の `floorId` で判定（`Box` に `floorId` を追加）。
- 表示パネルに「断面: なし/水平/縦X/縦Y」＋スライダー、「階: 全部/この階まで/この階だけ」。

- [ ] テスト: clampSection の範囲丸め; sectionPlane の符号; buildingBoxes の floorId
- [ ] E2E: 断面 水平 を選ぶとスクリーンショット差分なしで落ちない（UI 状態とストア値の確認）
- [ ] 実装→ PASS → commit

### Task 6: PWA（オフライン起動）と Pages 用ビルド

**Files:** Modify `vite.config.ts`, `package.json`, `index.html`, `src/main.tsx`; Create `public/icon-192.png`, `public/icon-512.png`

**Interfaces:**
- `VitePWA({ registerType: 'autoUpdate', manifest: { name: 'PipeCraft 3D', short_name: 'PipeCraft', display: 'standalone', start_url: '.', scope: '.', theme_color: '#1e3a8a', icons } , workbox: { globPatterns: ['**/*.{js,css,html,png,svg,webmanifest}'], maximumFileSizeToCacheInBytes: 5_000_000 } })`; e2e モードでは `disable: true`。`base: './'`。
- 更新適用: 新版検出時に「新しい版があります・再読み込み」トースト（保存中データは IndexedDB なので消えない）。

- [ ] 検証: `npx vite build` で `dist/sw.js`・`manifest.webmanifest` 生成; preview でSW登録後、オフライン化して再読み込みしても起動（Playwright `context.setOffline(true)`、E2E 1件、pc-chrome のみ）
- [ ] commit

### Task 7: 仕上げ
- [ ] 全単体・全E2E → `test-evidence/` 更新
- [ ] 独立レビュー（Sonnet reviewer subagent）→ 指摘修正
- [ ] PROGRESS 更新、push、PR 作成、`gh-pages` を Phase 2 ビルドで更新（ブランチ版プレビュー）
