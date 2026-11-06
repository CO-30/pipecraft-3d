# Phase 1 建物作成 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (Native; user's rule: no approval stops). Steps use checkbox (`- [ ]`) syntax.

**Goal:** スマホとPCで、現場（プロジェクト）を作成し、数値入力または2D作図で建物（階・壁・部屋・ドア・窓）を作り、3D自動生成・表示切替を行い、保存・再読み込みできる。

**Architecture:** 建物も配管と同じく「共通座標(mm)の純粋データ＋純粋関数」で管理し、2D(SVG)/3D(R3F)はそこから生成する。建物と配管は1つの `ProjectDoc` にまとめ、1本の Undo/Redo 履歴・1つの保存単位にする。3D形状は純粋関数で箱(Box)リストに変換し単体テストする。

**Tech Stack:** React 19 / TS / Vite 8 / three 0.187 + R3F 9 / Zustand 5 / Dexie 4 / Zod 4 / Vitest 5 / Playwright 1.65

**Spec:** Claudeプロジェクト資料 `docs/PipeCraft3D_最終実装設計書.md`（§3, §4, §5, §11, §13 Phase 1）

## Global Constraints
- 内部単位 mm、面積 ㎡。共通座標 x:東 y:北 z:高さ。3D変換 (x, z, -y)/1000。
- 2D/3D でデータを二重管理しない（ストアは `ProjectDoc` のみ保持）。
- 重要な削除（現場・階・壁一括）は確認ダイアログ。
- スマホはPC画面の縮小にしない（900px未満は下部大ボタン＋単一ビュー、以上は左一覧・中央ビュー・右プロパティ）。
- 既存保存データ（schemaVersion 1）を読み込めること（マイグレーション）。データ消失禁止。
- テスト用フック（window.__pc 等）は `import.meta.env.MODE === 'e2e'` のときだけ公開。

## Review Focus
1. 壁端点が既存の角(コーナー)に近い位置で描かれる → 同じ角に接続され、角を動かすと両方の壁が追従する（Task 1 テスト）。
2. 壁の途中から壁を描く(T字) → 既存壁が分割され、開口部(ドア等)は正しい側の壁に残る（Task 1 テスト）。
3. 開口部が壁長を超える・壁端からはみ出す → 壁内に収まるようクランプ、収まらない幅は拒否（Task 1 テスト）。
4. 壁を削除 → その壁の開口部も消え、孤立した角が残らない（Task 1 テスト）。
5. 旧形式(v1)データ・壊れたJSONの読み込み → v1は配管を保持して変換、壊れたものは拒否しバックアップから復旧（Task 3 テスト）。

---

### Task 1: 建物モデル `src/model/building.ts`

**Files:** Create `src/model/building.ts`, `src/model/building.test.ts`

**Interfaces (Produces):**
```ts
type Floor = { id; name: string; elevation: number; height: number; slabThickness: number };
type Corner = { id; floorId; x: number; y: number };
type WallKind = 'exterior' | 'interior';
type Wall = { id; floorId; a: string; b: string; thickness: number; kind: WallKind };
type OpeningType = 'door' | 'window';
type Opening = { id; wallId; type: OpeningType; offset: number /*a端から開口中心まで*/; width: number; height: number; sill: number };
type Room = { id; floorId; name: string; polygon: {x:number;y:number}[] };
type Building = { floors: Floor[]; corners: Record<string,Corner>; walls: Record<string,Wall>; openings: Record<string,Opening>; rooms: Record<string,Room> };
emptyBuilding(): Building
createBuildingFromDims(d: { width; depth; floors; floorHeight; wallThickness; slabThickness }): Building  // 各階に外壁4枚＋部屋1つ
addFloor(b, opts?: { copyExteriorFrom?: string }): { b; floorId }
updateFloor(b, floorId, patch: Partial<Pick<Floor,'name'|'height'|'slabThickness'>>): Building  // 上階 elevation を再計算
deleteFloor(b, floorId): Building  // 最後の1階は削除しない
addWall(b, floorId, p, q, opts?: { thickness?; kind? }): { b; wallIds: string[] }  // 端点が角から SNAP_CORNER_MM=150 以内なら接続、壁上なら分割(T字)
moveCorner(b, cornerId, p): Building
moveWall(b, wallId, dx, dy): Building
deleteWall(b, wallId): Building
addOpening(b, wallId, type, offset, overrides?): { b; openingId: string | null }  // door 既定 w800 h2000 sill0, window w1200 h1000 sill900
moveOpening(b, openingId, offset): Building
deleteOpening(b, openingId): Building
addRoomRect(b, floorId, p, q, name?): { b; roomId }
renameRoom / deleteRoom
wallLength(b, wallId): number; roomArea(room): number /*㎡*/
validateBuilding(b): string[]
```

- [ ] Step 1: テスト作成（数値作成: 2階・幅8000×奥行6000 → 外壁8枚・部屋2・2階elevation=1階height+slab；角共有と追従；T字分割で開口部が分割後の正しい壁へ移り offset 再計算；開口クランプ/拒否；壁削除で開口と孤立角が消える；階高変更で上階elevation再計算；最後の階は削除不可；roomArea 8×6=48㎡；ランダム操作50回で validateBuilding が空）
- [ ] Step 2: `npx vitest run src/model/building.test.ts` → FAIL
- [ ] Step 3: 実装（network.ts と同じ純粋関数スタイル、ID は `newId`）
- [ ] Step 4: PASS 確認 → コミット

### Task 2: 3D形状生成 `src/model/building3d.ts`

**Interfaces (Produces):**
```ts
type Box = { key: string; elementId: string; category: 'exteriorWall'|'interiorWall'|'floor'|'ceiling'|'door'|'window';
  center: Vec3 /*mm*/; size: { x: number; y: number; z: number } /*mm, x=壁長方向*/; rotationZ: number /*rad*/ };
buildingBoxes(b: Building): Box[]
```
- 壁は開口部の左右・上・下(窓台)に分割した箱。ドア/窓自体も薄い箱（category door/window）。床スラブ・天井は部屋ポリゴンの外接矩形（Phase 1 は矩形部屋のみ）。
- [ ] テスト: 開口なし壁=1箱、ドア1つ=左・右・上の3箱、窓1つ=左・右・上・下の4箱、箱の長さ合計＝壁長、2階の箱の z が elevation 基準 → 実装 → PASS → コミット

### Task 3: プロジェクト v2・マイグレーション・リポジトリ

**Files:** Modify `src/model/schema.ts`, `src/storage/repository.ts`(+test)
**Produces:** `ProjectData` v2 = `{ schemaVersion: 2, id, name, address?, createdAt, updatedAt, building: Building, network: Network }`；`migrate(raw): ProjectData`（v1→v2: building=emptyBuilding に1階追加）；Repository に `delete(id)`, `duplicate(id, newName)`, `exportJson(id)`, `importJson(json)`（新IDで取り込み、上書きしない）。
- [ ] テスト: v1データ読込で配管保持、v2往復、建物整合性違反は InvalidProjectError、duplicate は別ID・同内容、import は既存を上書きしない → 実装 → PASS → コミット

### Task 4: ストア再構成 `src/state/store.ts`

**Produces:** `doc: { building; network }` を単一履歴で管理。`projectMeta`, `activeFloorId`, `tool: 'select'|'pipe'|'wall'|'room'|'door'|'window'`, `selection: { kind: 'segment'|'node'|'wall'|'corner'|'opening'|'room'; id } | null`, `visibility: Record<Category|'pipes', 'show'|'ghost'|'hide'>`, `hiddenIds: Set<string>`, 建物操作アクション（Task 1 関数のラッパー）、`openProject(p)`, `toProjectData()`。既存配管アクションは `doc.network` を対象に維持。
- [ ] 既存 store.test を新形に更新＋建物操作の Undo/Redo・個別非表示テスト → 実装 → PASS → コミット

### Task 5: ホーム画面

**Files:** Create `src/ui/HomeScreen.tsx`, `src/ui/NewProjectDialog.tsx`; Modify `src/App.tsx`（home/editor 切替）, `src/ui/useAutosave.ts`（現在のプロジェクトIDで保存）
- 現場一覧（更新日順）・現場名検索・新規作成（現場名・住所・数値入力: 幅/奥行/階数/階高/壁厚/床厚、既定 8000/6000/1/2700/150/200、「空から作る」も可）・開く・複製・削除（確認）・JSON書き出し/読み込み。

### Task 6: 建物編集UI

**Files:** Modify `src/ui/PlanView.tsx`, `src/ui/View3D.tsx`, `src/App.tsx`; Create `src/ui/BuildingLayer2D.tsx`, `src/ui/Building3D.tsx`, `src/ui/VisibilityPanel.tsx`, `src/ui/PropertyPanel.tsx`, `src/ui/FloorBar.tsx`
- 2D: 選択階の部屋(面積表示)・壁(厚み付き)・開口・寸法(選択壁の長さ)を描画。壁ツール=なぞって壁(直角補正共通)、部屋ツール=対角ドラッグで矩形、ドア/窓ツール=壁をタップ。選択で角ドラッグ・壁ドラッグ移動・削除。
- 3D: buildingBoxes を描画。カテゴリごと show/ghost(opacity 0.25)/hide、選択要素「この部分だけ非表示」「半透明」。3Dで壁タップ選択。
- 階バー: 階切替・追加・階高編集・削除(確認)。
- PCレイアウト: 左=階/部屋/壁/配管一覧、中央=2D+3D、右=プロパティ。スマホ: 下部ツール大ボタン、プロパティはボトムシート。
- [ ] `npm run build` 成功、手動スクショ確認 → コミット

### Task 7: Phase 1 受入E2E・レビュー・記録

**Files:** Create `e2e/phase1.spec.ts`; update `docs/progress/PROGRESS.md`, `test-evidence/`
- [ ] E2E（PC・iPhone/Androidエミュ）: 新規作成(数値)→3Dに外壁が出る→2Dで内壁を描く→ドア・窓追加→2階追加→外壁を半透明/非表示→ホームに戻る→再読み込み→開いて同じ建物、複製・JSON書出読込。spike E2E も維持。
- [ ] reviewer subagent（別モデル）でブランチ全体レビュー → 指摘修正 → 全テスト再実行
- [ ] PROGRESS 更新・push・PR 作成（main マージはユーザー確認）

## 残す（Phase 2 以降）
部屋の結合・分割、非矩形部屋の床生成、屋根・階段・基礎・シャフト、断面表示、図面読込(Phase 5)。
