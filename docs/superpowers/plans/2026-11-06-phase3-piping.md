# Phase 3 配管・配線（立て管・設備機器の配置を含む） Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Phase 0 の配管試作を本実装にする。描画・分岐・接続・移動・切断・削除（全体/区間/分岐/部品）・高さ/種類/色/管径/材質変更・複製・Undo/Redo に加え、立て管（階をまたぐ縦配管）と設備機器（接続口つき）の配置を実装し、「分岐・削除・移動を繰り返しても接続情報が壊れない」ことをテストで保証する。

**Architecture:** 配管は従来どおり `src/model/network.ts` の純粋関数（ノード＋区間）で操作し、新操作も同じ不変条件（`validateNetwork`）を守る。設備機器は Doc に `fixtures` を追加し、接続口は `fixedKind: true, kind: 'fixture', fixtureId, portId` を持つネットワークノードとして表現する（配管の始点・終点にそのまま使える＝二重管理なし）。器具の移動・回転は接続口ノードを `moveNode` で動かし、削除時は接続口ノードを通常の端点に戻す（配管を消さない）。階高の変更・階の削除では、その階より上のノード高さを床高の差分だけ平行移動する（`src/model/pipeFloors.ts`）。

**Tech Stack:** React 19 / TypeScript / Zustand / React Three Fiber / Zod / Vitest / Playwright（既存のみ。新規依存なし）

**Spec:** Claudeプロジェクト資料 `docs/PipeCraft3D_最終実装設計書.md` 第6・7・9章、第13章 Phase 3、第14章（配管テスト）。運用ルール: `CLAUDE.md`

## Global Constraints

- 内部単位は mm。座標は x: 東, y: 北, z: 高さ（絶対高さ）。
- 2D/3D は `src/state/store.ts` の Doc だけを読み書きする。表示用データと経路データを分離。
- 実測長（`measuredLength`）は図面・モデル値で上書きしない。区間を分ける操作では長さ比で按分し `measuredApprox: true`。
- 区間長 < `MIN_SEGMENT_MM`(1mm)・自己ループ・重複区間・孤立ノード（fixedKind 除く）を作る操作は拒否して元の Network を返す。
- 1つのユーザー操作 = 履歴1件（ドラッグ＋ドロップ接続も1件）。
- 重要な削除（配管全体・枝管・接続中の器具）は確認ダイアログを出す。
- スマホは大きなボタン、2本指は拡大縮小のみ（編集と干渉させない）。
- 自動補正は強制しない（直角補正オフで斜め・自由に描ける。既存機能）。
- 保存形式 `schemaVersion` 3（`fixtures` 追加）。v1/v2 は自動変換。

## 決定事項（設計書の余白を埋める判断）

| 項目 | 決定 |
|---|---|
| 切断 | タップ位置で区間を2本に分け、間に 50mm の隙間を作って端点を2つにする（見た目で切れていると分かる）。区間が 150mm 未満なら拒否 |
| 接続解除 | ノードにつながる区間をそれぞれ 30mm 手前に新しい端点を作って切り離す |
| 接続 | 選択ツールで端点をドラッグして別のノード／区間に落とすと結合（区間なら分割して結合）。隣接ノードへの結合など不変条件を壊すものは拒否 |
| 部品単位の削除 | バルブ→バルブだけ外して直管に戻す。次数2のノード（エルボ・ソケット）→ 前後の区間を1本の直線でつなぐ。端点→その区間を削除。分岐点（次数3以上）→ 拒否（枝管削除を使う） |
| 区間の移動 | 選択済みの区間をもう一度ドラッグすると両端を平行移動（つながった区間は追従して伸縮） |
| 配管全体 | つながっている区間すべて（連結成分）。全体の選択表示・削除・複製（東へ+500mm ずらす）・高さ一括変更 |
| 長さ変更 | 区間の数値入力。a 端を固定して b 端を方向に沿って移動 |
| 立て管 | ノードを選び「上の階へ／下の階へ／高さ指定」で、同じ x,y に縦区間を追加。上の階へ = 上の階の床高 + 現在の描画高さ（相対）。2D では立て管の位置に◎記号を、縦区間が通るすべての階で表示 |
| 2D の階表示 | 区間の高さ範囲が階の範囲 [床高−1000, 床高+階高) と重なれば濃く表示・タップ可能。他の階のものは薄く・タップ不可 |
| 配管の階追従 | 階高変更・階削除で、変更した階より上の階に属するノードを床高の差分だけ移動。ノードの所属階 = `elevation ≤ z + 1000` を満たす最も上の階 |
| 設備機器 | 13種（設計書第9章）。種類ごとに寸法・設置高さ・接続口（系統・相対位置）をカタログで持つ。配置は「器具」ツールで図面をタップ（50mm グリッド）。回転は 90° 単位。簡易な箱で3D表示 |
| 表示切替 | カテゴリに「設備機器」を追加（表示/半透明/非表示） |
| 3D の見やすさ | 配管の最小半径 25mm（表示）、選択区間は発光＋太さ1.6倍、選択中の配管全体は薄く強調 |

## Review Focus

1. 器具を回転・移動したとき、接続口につながった配管の端が器具についてくる（区間が長さ0になる移動は拒否）。→ Task 4 `moveFixture rejects zero-length`
2. 階高を変えたとき上の階の配管・立て管が一緒に動き、立て管の上端だけがずれない。→ Task 3 `riser spanning floors stays connected after floor height change`
3. 他の階の配管をタップして誤って編集しない（2D で薄い配管は当たり判定なし）。→ Task 5 E2E `other floor pipes are not hit`
4. 切断・接続解除の直後に Undo すると元のつながりに完全に戻る（ノードIDを含めて）。→ Task 2 `cut then undo restores identical network`
5. 不正な fixtureId（存在しない器具を指す接続口）を含むJSONの読み込みは拒否される。→ Task 4 `parseProject rejects dangling fixture port`

---

### Task 1: ネットワーク操作の追加（切断・接続・解除・部品削除・移動・長さ・全体）

**Files:**
- Modify: `src/model/network.ts`
- Test: `src/model/network.test.ts`

**Interfaces:**
- Produces:
  - `cutSegment(net, segId, p: Vec3, gap = 50): { net; nodeIds: [string, string] } | null`
  - `detachNode(net, nodeId, pull = 30): Network`
  - `mergeNodes(net, targetId, sourceId): Network` — source の区間を target へ付け替え（拒否時は元の net）
  - `connectNodeToSegment(net, nodeId, segId): Network` — 区間を分割して nodeId と結合
  - `deleteFitting(net, nodeId): Network`
  - `translateNodes(net, nodeIds: string[], d: Vec3): Network`
  - `setSegmentLength(net, segId, length): Network`
  - `connectedComponent(net, segId): { segmentIds: string[]; nodeIds: string[] }`
  - `deleteSegments(net, ids: string[]): Network`
  - `duplicateSegments(net, ids, offset: Vec3): { net; segmentIds: string[] }`（fixture ノードは複製先で通常ノード）
  - `insertValve(net, segId, p): { net; nodeId } `／`removeValve` は `deleteFitting` が担う
  - `addRiser(net, fromNodeId, z: number): { net; nodeId; segmentId } | null`
  - `fuzz` 用: 既存 `validateNetwork`

- [ ] Step 1: テストを書く（各関数ごとに: 正常系・拒否系・`validateNetwork(result)` が空・実測長の按分）。必須ケース:
  - `cutSegment` 3000mm の区間を 1000mm で切断 → 区間2・端点4・`segmentLength` が 975 と 1975、元が実測 3100 なら 1033.3/2066.7 で `measuredApprox`
  - `cutSegment` 100mm の区間 → null
  - `detachNode` T字の中心 → 3本がばらばら、tee なし、各区間長が 30mm 短い
  - `mergeNodes` 隣接ノード同士 → 元の net（拒否）、離れた端点同士 → 端点1つ減・次数2
  - `deleteFitting` エルボ → 2区間が1区間に（直線で結ぶ）、tee → 元の net
  - `translateNodes` 隣と重なる移動 → 元の net
  - `addRiser` 同じ z → null、+3000 → 縦区間（x,y 同一）
  - ランダム操作 fuzz: 200 回ランダムに 描画/分岐/切断/結合/部品削除/移動/枝削除 を行い毎回 `validateNetwork` が空（seed 固定）
- [ ] Step 2: `npx vitest run src/model/network.test.ts` → 失敗を確認
- [ ] Step 3: 実装
- [ ] Step 4: テスト合格を確認
- [ ] Step 5: commit `feat(phase3): 配管ネットワークの切断・接続・部品削除・立て管操作`

### Task 2: ストアの配管操作・選択拡張

**Files:**
- Modify: `src/state/store.ts`, `src/state/store.test.ts`

**Interfaces:**
- Consumes: Task 1 の関数
- Produces（State に追加）:
  - `Selection` に任意の `at?: Vec3`（区間をタップした位置）。`SelKind` に `'fixture'` 追加
  - `cutSelected()`, `detachSelectedNode()`, `deleteSelectedFitting()`, `insertValveAtSelection()`
  - `deleteRun(segId)`, `duplicateRun(segId)`, `setRunHeightDelta(segId, dz)`, `setSegmentHeight(segId, z)`, `setSegmentLength(segId, len)`
  - `addRiserFromNode(nodeId, target: 'up' | 'down' | number)`
  - `dragSegment(segId, d: Vec3)`（dragBase 基準の平行移動）、`dropNode(nodeId, target: { type: 'node' | 'segment'; id: string } | null)`（ドラッグ中に結合し、endDrag で履歴1件）
- [ ] Step 1: テスト: `cut then undo restores identical network`（`toEqual` で doc.network 一致）、ドラッグ→ドロップ結合が履歴1件、`addRiserFromNode('up')` が上の階の床高+drawHeight、最上階で 'up' は何もしない
- [ ] Step 2〜4: 失敗確認→実装→合格
- [ ] Step 5: commit

### Task 3: 配管の階追従（pipeFloors）

**Files:**
- Create: `src/model/pipeFloors.ts`, `src/model/pipeFloors.test.ts`
- Modify: `src/state/store.ts`（`updateFloor`・`deleteFloor` で適用）

**Interfaces:**
- Produces: `floorIndexForZ(floors: Floor[], z: number): number`、`followFloors(net: Network, oldFloors: Floor[], newFloors: Floor[]): Network`（ID で対応づけ。削除された階に属していたノードは移動しない）
- [ ] Step 1: テスト: 1F 階高 3000→3500 で 2F のノード z+500・1F は不変、`riser spanning floors stays connected after floor height change`（立て管の上端だけ+500・validate 空）、2F 削除で 3F のノードが −階高、`measuredLength` は変えない
- [ ] Step 2〜4
- [ ] Step 5: commit

### Task 4: 設備機器（モデル・カタログ・保存 v3）

**Files:**
- Create: `src/model/fixtures.ts`, `src/model/fixtures.test.ts`
- Modify: `src/model/schema.ts`（v3、`fixtures`、node の `fixtureId`/`portId`、v2→v3 変換）, `src/model/network.ts`（PipeNode に `fixtureId?`, `portId?`）, `src/storage/repository.ts`（`validateFixtures` 呼び出し）, `src/state/store.ts`（Doc に `fixtures`、`placeFixture`・`moveFixture`（ドラッグ）・`rotateFixture`・`deleteFixture`）, `src/App.tsx`, 既存テストの Doc 生成箇所

**Interfaces:**
- Produces:
  - `type FixtureType = 'toilet'|'washbasin'|'kitchen'|'bathtub'|'shower'|'washer'|'waterHeater'|'waterMeter'|'pump'|'panel'|'outlet'|'light'|'aircon'`
  - `type Fixture = { id; floorId; type: FixtureType; x; y; rotation: 0|90|180|270 }`
  - `FIXTURE_CATALOG: Record<FixtureType, { label; size: {w,d,h}; base: number /*床からの設置高さ*/; ports: { id; system: SystemType; dx; dy; dz; label }[] }>`
  - `portWorldPos(f, floorElevation, port): Vec3`
  - `placeFixture(doc, floorId, type, p): { doc; fixtureId }`
  - `moveFixture(doc, id, p, rotation?): Doc`（接続口ノードを moveNode。どれか拒否なら元の doc）
  - `deleteFixture(doc, id): Doc`（接続口ノード: 区間なし→削除、区間あり→ fixedKind/fixtureId を外し通常ノード）
  - `validateFixtures(doc): string[]`（器具が存在しない階・接続口ノードの欠落・存在しない器具を指すノード）
- [ ] Step 1: テスト: トイレ配置で給水・排水の接続口ノード2つ（kind 'fixture'）、回転90°で接続口が回る、接続口から描いた配管が移動に追従、`moveFixture rejects zero-length`、削除で配管は残り端点に、`parseProject rejects dangling fixture port`、v2 JSON が v3 に変換される
- [ ] Step 2〜4
- [ ] Step 5: commit

### Task 5: 2D 平面図の配管編集UI

**Files:**
- Modify: `src/ui/PlanView.tsx`, `src/model/geometry.ts`（`hitTestPlan(net, p, tol, filter?: (z0, z1) => boolean)`）

**内容:** 階外の配管は当たり判定なし／立て管◎記号／器具の描画（回転した矩形＋名前、接続口は既存ノード描画）・器具ツールでタップ配置・選択ツールで器具ドラッグ移動／選択済み区間の再ドラッグで区間移動／端点ドラッグを別ノード・区間に落とすと結合（落とし先をハイライト）／終点を既存区間に落とした描画は分割して接続（`addPolyline` 後に `connectNodeToSegment`）／選択区間の長さラベル／配管全体の強調。
- [ ] E2E は Task 7 で。ここでは `npx tsc -b` と既存 E2E が通ることを確認して commit

### Task 6: プロパティパネル・ツールバー・3D

**Files:**
- Modify: `src/ui/Panels.tsx`, `src/ui/View3D.tsx`, `src/ui/colors.ts`（色のユーザー変更: `systemColor` を Doc 外の設定 `colorOverrides`（localStorage、try/catch）で上書き）, `src/store` の `VIS_CATEGORIES` に `fixtures`

**内容:**
- 区間: 長さ(数値)・高さ(両端)・種類・口径・材質・色・「ここで切断」「バルブを入れる」「ここから分岐」「区間削除」「枝管ごと削除」「配管全体: 高さ±100／複製／削除（確認）」
- ノード: 既存＋「立て管: 上の階へ／下の階へ／高さ指定」「接続解除」「この部品を削除」
- 器具: 種類名・回転・削除（接続中なら確認）・接続口一覧
- 器具ツール: 種類選択（大きなボタン）
- ツールバーに「器具」を追加。スマホでは横スクロール可
- 3D: 器具の箱（選択可・表示切替）、配管の最小半径 25mm、選択強調
- [ ] `npx tsc -b`、既存テスト合格で commit

### Task 7: E2E・独立レビュー・記録

**Files:**
- Create: `e2e/phase3.spec.ts`

- [ ] E2E（PC / iPhone / Android エミュ）:
  - 描画→切断→端点ドラッグで再接続→Undo 2回で切断直後・元に戻る
  - 立て管: 2階建てで1Fのノードから「上の階へ」→ 2Fに切替えても◎が見え、2Fでその上端から配管を描ける
  - 器具: トイレ配置→接続口から給水管を描く→器具を回転→配管の端が追従→器具削除で配管が残る
  - 部品削除: エルボを消すと直線に、バルブ挿入→削除
  - `other floor pipes are not hit`
  - 3D で器具・配管が表示されるスクリーンショット
- [ ] `npm test`、`npx playwright test`、`npm run test:pwa`、`npm run lint`
- [ ] 独立レビュー（別モデルの reviewer subagent）→ 指摘修正
- [ ] PROGRESS 更新・`test-evidence/` 保存・push・ドラフトPR・gh-pages 更新
