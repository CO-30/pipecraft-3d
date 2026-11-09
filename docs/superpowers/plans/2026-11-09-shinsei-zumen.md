# 申請図面（排水縦断図・給水立面図）＋自治体プロファイル 実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 配管データから、自治体プロファイル（JSON）に従った排水縦断図と給水立面図（系統図）を SVG プレビュー／PDF で出力する「申請図面」画面を追加する。

**Architecture:** 計算は純粋関数（`src/model/`）、描画は「用紙 mm 座標の描画命令列（Sheet）」を作ってから SVG（プレビュー）と pdf-lib（PDF）の2つに変換する。データは既存の共通ストア（`Doc`）にのみ追加し、2D/3D/積算は既存のまま。自治体差は `MunicipalityProfile`（Zod 検証）で吸収し、同梱 `standard` ＋ ユーザー分（IndexedDB）を使う。

**Tech Stack:** React 19 / TypeScript / Zustand / Zod 4 / Dexie 4 / pdf-lib（既存フォント `public/fonts/NotoSansJP-JIS.ttf`）/ Vitest / Playwright

**Spec:** `docs/superpowers/specs/2026-11-09-shinsei-zumen-design.md`

## Global Constraints

- 内部単位 mm。表示は m（小数3位）または mm（プロファイル `profileTable.unit`、既定 `'m'`）。
- 保存形式: `SCHEMA_VERSION` は 5 のまま。追加フィールドはすべて省略可（旧データがそのまま開ける）。
- 排水系（`isDrain`）のノード Z ＝管底高。給水系は従来どおり（管中心）。
- **仕様からの調整**: 区間の `slope` は既存どおり **比率**（0.01 = 1/100）で保存する（既存の `applySlope`・積算と互換）。UI・プロファイル表の表示だけ `1/n` に変換する。`slopeLocked` を追加。
- 同梱プロファイルは `standard` のみ。個別自治体は追加しない。`unverified` の項目は図面欄外に「要確認」と表示する。
- 本機能は作図支援。図面の表題欄に既存と同じ免責（「自治体の審査基準への適合を保証しません」）を入れる。
- main へ直接コミットしない。ブランチ `feat/shinsei-zumen`。コミット末尾に Co-Authored-By / Claude-Session。
- 単体 323件・E2E 115件の既存テストを壊さない。

## Review Focus

1. **GL 未入力（`designGL` undefined）** の現場で縦断図を出す → エラーにせず GL 0 で生成し、表の GL 欄と欄外に「仮」を表示する（Task 5 のテスト `GL未入力は仮表示`）。
2. **逆勾配（下流の管底が上流より高い）** → 生成は止めず、その区間を警告（`reverseSlope`）にして赤表示（Task 4 のテスト）。
3. **経路に閉路・未接続を含む**（公共マスから上流へたどって同じノードへ戻る／選んだ終点にたどり着けない） → `extractRoute` が `{ error }` を返し画面にメッセージ、図面は生成しない（Task 4 のテスト）。
4. **勾配固定の区間の下流端を手で動かす** → `slopeLocked=false` に戻り、固定の再計算で上流側を巻き込まない（Task 1 のテスト）。
5. **プロファイル JSON の読み込みで必須項目が欠ける／同梱 ID と同じ ID** → Zod エラーをメッセージ表示、同梱分は上書きしない（Task 3 のテスト）。

---

### Task 1: データ追加（現場設定・勾配固定・ノード地盤高）

**Files:**
- Modify: `src/model/doc.ts`（`site?: SiteSettings`）
- Modify: `src/model/schema.ts`（`siteSchema`、`segmentSchema.slopeLocked`、`nodeSchema.groundLevel`、`projectSchema.site`）
- Modify: `src/model/network.ts`（`Segment.slopeLocked?: boolean`、`PipeNode.groundLevel?: number`）
- Modify: `src/model/slope.ts`（勾配固定の関数を追加）
- Modify: `src/state/store.ts`（`openProject` / `toProjectData` / `emptyDoc` に site、`updateSite`、`setSegmentSlope`、`setSegmentSlopeLocked`、`setNodeHeight` と `dragNode` で固定勾配を伝播）
- Test: `src/model/slope.test.ts`（新規）、`src/model/schema.test.ts`（既存があれば追記、なければ新規）

**Interfaces:**
- Produces:
  - `type SiteSettings = { designGL?: number; municipalityProfileId?: string }`（`src/model/doc.ts`）。`Doc.site?: SiteSettings`
  - `downstreamEnd(net: Network, seg: Segment): 'a' | 'b'` — Z が低い端。同じなら `'b'`
  - `setSlopeRatio(net: Network, segId: string, ratio: number): Network` — `slope=ratio, slopeLocked=true` にし、下流端 Z ＝ 上流端 Z − ratio×水平距離 へ `moveNode`。失敗（`validateNetwork` エラー）なら元の net
  - `propagateLockedSlopes(net: Network, movedNodeId: string): Network` — movedNode を上流端とする `slopeLocked` 区間の下流端を順に再計算（BFS、訪問済みは再訪しない）。movedNode を下流端とする `slopeLocked` 区間は `slopeLocked: false` にする
  - `computedSlope(net, seg): number | null` ＝ 既存 `actualSlope`（別名不要、既存を使う）
  - store: `updateSite(patch: Partial<SiteSettings>): void`（履歴1件）、`setSegmentSlope(segId: string, denominator: number): void`（`setSlopeRatio(net, segId, 1/denominator)`、だめなら notice「勾配をつけると配管がつながらなくなります」）、`setSegmentSlopeLocked(segId: string, locked: boolean): void`

- [ ] **Step 1: 失敗するテストを書く** `src/model/slope.test.ts`

```ts
// 直線 1 本: a(0,0,z=0) → b(5000,0,z=0)
test('setSlopeRatio は下流端を下げて slopeLocked にする', () => {
  const net = line(5000); // a→b, system 'drain', φ100
  const out = setSlopeRatio(net, 's1', 1 / 100);
  expect(out.nodes.b.pos.z).toBeCloseTo(-50, 5);
  expect(out.segments.s1).toMatchObject({ slope: 0.01, slopeLocked: true });
});
test('propagateLockedSlopes: 上流端を上げると下流端が追従する', () => {
  const net = setSlopeRatio(line(5000), 's1', 1 / 50);
  const moved = moveNode(net, 'a', { x: 0, y: 0, z: 200 });
  expect(propagateLockedSlopes(moved, 'a').nodes.b.pos.z).toBeCloseTo(100, 5);
});
test('propagateLockedSlopes: 下流端を手で動かすと固定が外れる', () => {
  const net = setSlopeRatio(line(5000), 's1', 1 / 50);
  const moved = moveNode(net, 'b', { x: 5000, y: 0, z: -30 });
  const out = propagateLockedSlopes(moved, 'b');
  expect(out.segments.s1.slopeLocked).toBe(false);
  expect(out.nodes.b.pos.z).toBe(-30);
});
test('2 区間の連鎖: 上流を動かすと 2 つ先まで再計算', ...); // a→b→c 各 1/100、a を +100 → c は +100
```

- [ ] **Step 2: 失敗を確認** `npx vitest run src/model/slope.test.ts` → `setSlopeRatio is not a function`
- [ ] **Step 3: `network.ts` / `doc.ts` / `schema.ts` に型とスキーマを追加**（`slopeLocked: z.boolean().optional()`、`groundLevel: z.number().finite().optional()`、`siteSchema = z.object({ designGL: z.number().finite().optional(), municipalityProfileId: z.string().min(1).optional() })`、`projectSchema.site: siteSchema.optional()`）
- [ ] **Step 4: `slope.ts` に `downstreamEnd` / `setSlopeRatio` / `propagateLockedSlopes` を実装**。`propagateLockedSlopes` は `moveNode` を使い、器具の接続口（`fixtureId`）が下流端なら動かさず `slopeLocked:false` にする
- [ ] **Step 5: テスト合格を確認** `npx vitest run src/model/slope.test.ts`
- [ ] **Step 6: store を変更**: `openProject` で `site: p.site`、`toProjectData` で `site: doc.site`、`emptyDoc` に `site: {}`。`updateSite`・`setSegmentSlope`・`setSegmentSlopeLocked` を追加。`setNodeHeight` と `dragNode` の `moveNode` 結果に `propagateLockedSlopes(next, nodeId)` をかける。`src/state/store.test.ts` に `updateSite が履歴に残る`・`setSegmentSlope が下流端を下げる` を追加
- [ ] **Step 7: スキーマの後方互換テスト**: `projectSchema` が `site`・`slopeLocked`・`groundLevel` なしの v5 データを受け付ける／`site: { designGL: -450 }` 付きを往復できる
- [ ] **Step 8: 全単体テスト** `npx vitest run` → 全件合格。`npx tsc -b && npx oxlint` エラーなし
- [ ] **Step 9: Commit** `feat(data): 現場の設計GL・自治体プロファイルID、区間の勾配固定、ノード地盤高を追加`

---

### Task 2: 器具「マス」

**Files:**
- Modify: `src/model/fixtures.ts`（種類追加、`params`、`fixtureSize`、`portWorldPos` の管底高対応、`isManhole`、`MANHOLE_TYPES`、`manholeDepth`）
- Modify: `src/model/schema.ts`（`fixtureSchema.type` に追加、`params` 省略可）
- Modify: `src/ui/View3D.tsx:22`、`src/ui/Panels.tsx:214`、`src/export/drawing.ts`（`FIXTURE_CATALOG[f.type].size` → `fixtureSize(f)`）
- Modify: `src/ui/PlanView.tsx`（マスは丸/角＋略号で描く）
- Modify: `src/state/store.ts`（`updateFixtureParams`、`placeFixtureAt` でマスの既定管底高）
- Modify: `src/ui/Panels.tsx`（器具パネル: マスの口径・形状・管底高（FL基準）入力と深さ表示）
- Test: `src/model/fixtures.test.ts`（追記）

**Interfaces:**
- Produces:
  - `FixtureType` に `'manholeSewage' | 'manholeRain' | 'manholeTrap' | 'manholeInvert' | 'publicSewage' | 'publicRain'`。ラベル: 汚水マス・雨水マス・トラップマス・インバートマス・公共汚水マス・公共雨水マス。`FIXTURE_GROUPS` に `{ label: 'マス（排水）', types: [...6種] }` を先頭グループの次に追加
  - 各マスの catalog: `size: { w: 300, d: 300, h: 600 }`, `base: 0`, `ports: [P('pipe', system, 100, 0, 0, 0, '管底')]`（system: 雨水系2種は `'drain'`、他は `'sewage'`。thread なし）
  - `type FixtureParams = { diameter?: number; shape?: 'round' | 'square'; invertZ?: number }`。`Fixture.params?: FixtureParams`（schema: `z.object({ diameter: z.number().positive().optional(), shape: z.enum(['round','square']).optional(), invertZ: z.number().finite().optional() }).optional()`）
  - `MANHOLE_TYPES: FixtureType[]`、`isManhole(t: FixtureType): boolean`
  - `fixtureSize(f: Fixture): { w: number; d: number; h: number }` — マスは `w=d=params.diameter ?? 300`、`h = 深さ`（下記）。他は catalog の size
  - `groundZ(floor: Floor, site?: SiteSettings): number` ＝ `floor.elevation + (site?.designGL ?? 0)`
  - `portWorldPos(f, floor, port, site?)` — マスなら `z = f.params?.invertZ ?? groundZ(floor, site) - 600`（`site` 引数を追加。呼び出し元 `placeFixture` / `syncPorts` / `validateFixtures` は `doc.site` を渡す）
  - `manholeDepth(f: Fixture, floor: Floor, site?: SiteSettings): number` ＝ `groundZ − 管底Z`
  - store: `updateFixtureParams(id: string, patch: Partial<FixtureParams>): void`（履歴1件。`invertZ` 変更は `syncPorts` 相当で接続口ノードを動かす → `moveFixture` を流用するため `moveFixture(doc, id, p, rotation, params?)` に params を追加）

- [ ] **Step 1: 失敗するテストを書く**（`fixtures.test.ts` に追記）

```ts
test('マスを置くと接続口の高さは GL−600（designGL 反映）', () => {
  const doc0 = { ...baseDoc(), site: { designGL: -400 } }; // 1F elevation 0
  const { doc, fixtureId } = placeFixture(doc0, floorId, 'manholeSewage', { x: 1000, y: 0 });
  const port = portNodes(doc.network, fixtureId!)[0];
  expect(port.pos.z).toBe(-1000);
  expect(manholeDepth(doc.fixtures[fixtureId!], floor, doc.site)).toBe(600);
});
test('invertZ を変えると接続口ノードと深さが変わる', ...); // moveFixture(doc, id, f, undefined, { invertZ: -1200 }) → port z -1200, depth 800
test('fixtureSize: マスは口径で、トイレは catalog', ...);
test('validateFixtures はマスの params 付きデータを通す', ...);
```

- [ ] **Step 2: 失敗を確認** `npx vitest run src/model/fixtures.test.ts`
- [ ] **Step 3: `fixtures.ts` / `schema.ts` を実装**。`FIXTURE_TYPES` の末尾に6種を追加
- [ ] **Step 4: 合格を確認**
- [ ] **Step 5: 表示の差し替え**: `View3D.tsx` は `fixtureSize(f)` を使い、マスは `cylinderGeometry`（shape 'round' 既定）／box、中心 z は `groundZ − h/2`（地面から下へ）。`PlanView.tsx` のマス表示: 丸は `<circle>`、角は `<rect>`、中央に略号（汚・雨・ト・イ・公汚・公雨）。`Panels.tsx:214` と `drawing.ts` は `fixtureSize`
- [ ] **Step 6: Panels の器具パネル**: マス選択時に `口径`（NumField）、`形状`（丸/角）、`管底高 FL±`（NumField、入力は `invertZ − floor.elevation`）、`深さ`（読み取り専用 `manholeDepth`）。`data-testid="manhole-invert"`, `"manhole-depth"`
- [ ] **Step 7: store**: `updateFixtureParams`、`placeFixtureAt` はそのまま（`placeFixture` 内で既定）。`store.test.ts` に `updateFixtureParams で invertZ を変えると接続口が動き履歴1件`
- [ ] **Step 8: 全単体テスト・tsc・lint 合格**。既存 E2E の器具一覧テストが FIXTURE_TYPES の件数に依存していないか `grep -n "fixture" e2e/*.ts` で確認し、依存していれば期待値を更新
- [ ] **Step 9: Commit** `feat(fixtures): 排水のマス（汚水・雨水・トラップ・インバート・公共）を追加、口径と管底高を編集可能に`

---

### Task 3: 自治体プロファイル（型・Zod・standard・保存）

**Files:**
- Create: `src/model/municipality.ts`
- Create: `src/model/municipality.test.ts`
- Modify: `src/storage/repository.ts`（Dexie version 2 に `profiles` テーブル、`ProfileRepository` 実装、exportJson/importJson でプロファイル同梱）
- Modify: `src/storage/repository.test.ts`
- Modify: `src/model/schema.ts`（`projectSchema.bundledProfile: municipalityProfileSchema.optional()`）

**Interfaces:**
- Produces（`municipality.ts`）:
  ```ts
  export type ProfileRowKey = 'distance' | 'cumDistance' | 'groundLevel' | 'invertLevel' | 'cover' | 'slope' | 'pipeSpec' | 'manhole';
  export const municipalityProfileSchema = z.object({
    id: z.string().min(1), name: z.string().min(1), version: z.string().min(1),
    source: z.object({ title: z.string(), url: z.string().optional(), checkedAt: z.string().optional() }),
    unverified: z.array(z.string()),
    symbols: z.record(z.string(), z.string()),           // 器具/マスの種類 → SVG シンボルID（'circle' | 'square' | 'circleDot' | 'squareCross' | 'triangle' | 'meter' | 'valve' | 'faucet'）
    profileTable: z.object({
      rows: z.array(z.object({ key: z.enum([...ProfileRowKey]), label: z.string() })).min(1),
      slopeFormat: z.enum(['ratio', 'permille', 'percent']),
      hScale: z.number().positive(), vScale: z.number().positive(),
      minSlopeByDiameter: z.record(z.string(), z.number().positive()),   // 口径 → 分母
      minCover: z.number().nonnegative(),
      unit: z.enum(['m', 'mm']).default('m'),
    }),
    riser: z.object({ lineStyle: z.literal('single'), diameterLabelPos: z.enum(['above', 'side']), showFloorLines: z.boolean(), heightLabel: z.enum(['FL+', 'GL+']) }),
    paper: z.object({ size: z.enum(['A3', 'A4']), orientation: z.enum(['landscape', 'portrait']), titleBlockFields: z.array(z.string()) }),
  });
  export type MunicipalityProfile = z.infer<typeof municipalityProfileSchema>;
  export const STANDARD_PROFILE: MunicipalityProfile;   // id 'standard', name '標準（下水道協会方式を参考）', rows: 累加距離・距離・勾配・管種口径・地盤高・管底高・土被り・マス, slopeFormat 'ratio', hScale 100, vScale 50, minSlopeByDiameter {65:50,75:100,100:100,125:150,150:200}, minCover 200, paper A3 landscape, titleBlockFields ['工事名','申請者','施工者','図面名','縮尺','作成日']
  export const BUILTIN_PROFILES: MunicipalityProfile[] = [STANDARD_PROFILE];
  export const isBuiltinProfile = (id: string) => BUILTIN_PROFILES.some((p) => p.id === id);
  export function resolveProfile(id: string | undefined, user: MunicipalityProfile[]): MunicipalityProfile; // 見つからなければ STANDARD
  export function parseProfileJson(json: string): { profile: MunicipalityProfile } | { error: string };
  export function duplicateProfile(p: MunicipalityProfile, newName: string): MunicipalityProfile; // id = newId('mp'), name
  export function formatSlope(ratio: number, format: MunicipalityProfile['profileTable']['slopeFormat']): string; // 0.01 → '1/100' | '10.0‰' | '1.00%'; 0 → '水平'
  export function minSlopeFor(profile, diameter: number): number | undefined; // 分母→比率。口径表に無ければ最も近い下の口径、無ければ undefined
  ```
- Produces（`repository.ts`）:
  ```ts
  export interface ProfileRepository { listProfiles(): Promise<MunicipalityProfile[]>; saveProfile(p: MunicipalityProfile): Promise<void>; deleteProfile(id: string): Promise<void>; }
  // DexieProjectRepository が ProfileRepository も実装。saveProfile は isBuiltinProfile(id) なら例外 InvalidProjectError('同梱のプロファイルは上書きできません')
  // exportJson(id): 現場の municipalityProfileId がユーザー分なら bundledProfile を付ける
  // importJson/importAny: bundledProfile があり、同梱でなく未保存なら saveProfile。保存する ProjectData からは bundledProfile を除く
  ```

- [ ] **Step 1: 失敗するテスト** `municipality.test.ts`: `STANDARD_PROFILE が schema を通る`、`parseProfileJson は rows が空ならエラー文字列`、`formatSlope(0.01,'ratio')==='1/100'`・`permille → '10.0‰'`・`percent → '1.00%'`、`minSlopeFor(STANDARD, 100) === 1/100`・`(STANDARD, 90) === 1/100`（下の口径 75）・`(STANDARD, 50) === undefined`、`duplicateProfile は id が変わり同梱でない`
- [ ] **Step 2: 失敗を確認**
- [ ] **Step 3: `municipality.ts` を実装**
- [ ] **Step 4: 合格を確認**
- [ ] **Step 5: repository の失敗するテスト**（fake-indexeddb）: `saveProfile → listProfiles に出る`、`同梱 id の saveProfile は例外`、`exportJson にユーザープロファイルが同梱され importJson で復元される（未保存なら保存、保存済みなら上書きしない）`、`bundledProfile 付き JSON を importJson しても保存した ProjectData に bundledProfile が残らない`
- [ ] **Step 6: 失敗を確認 → repository を実装**（`this.version(2).stores({ projects: 'id, updatedAt, name', profiles: 'id, name' })`）
- [ ] **Step 7: 全単体テスト・tsc・lint 合格**
- [ ] **Step 8: Commit** `feat(profile): 自治体プロファイルの型・Zod・standard・IndexedDB 保存と現場 JSON への同梱`

---

### Task 4: 排水縦断図の計算モデル

**Files:**
- Create: `src/model/profileDrawing.ts`
- Create: `src/model/profileDrawing.test.ts`

**Interfaces:**
- Consumes: `isDrain`, `planLength`（slope.ts）、`adjacency`（network.ts）、`isManhole`, `manholeDepth`, `fixtureSize`, `groundZ`（fixtures.ts）、`minSlopeFor`, `formatSlope`（municipality.ts）
- Produces:
  ```ts
  export type RouteResult = { route: string[]; branches: { atNodeId: string; nodeIds: string[] }[] } | { error: string };
  /** 下流端 outletId から上流へ排水系の区間をたどる。choice: 分岐点ごとに進む隣ノード（未指定の分岐は最長経路を本線、他を branches に） */
  export function extractRoute(net: Network, outletId: string, choice?: Record<string, string>): RouteResult;
  // error: outletId が存在しない／排水系の区間がつながっていない → '排水の配管がつながっていません'；閉路 → '経路が輪になっています'
  export function branchPoints(net: Network, outletId: string): { nodeId: string; options: string[] }[]; // 上流側へ 2 本以上に分かれる点とその隣ノード
  export const OUTER_DIAMETER: Record<number, number> = { 40: 48, 50: 60, 65: 76, 75: 89, 100: 114, 125: 140, 150: 165, 200: 216 }; // VU/VP 外径 mm
  export const outerDiameter = (nominal: number) => OUTER_DIAMETER[nominal] ?? Math.round(nominal * 1.1);
  export type ProfileWarning = { kind: 'minSlope' | 'reverseSlope' | 'cover' | 'tentativeGL'; segId?: string; nodeId?: string; message: string };
  export type ProfileNode = { nodeId: string; cumDistance: number; groundLevel: number; invertLevel: number; cover: number; manhole?: { type: FixtureType; label: string; diameter: number; depth: number; symbol: string } };
  export type ProfileSegment = { segId: string; distance: number; slope: number | null; slopeText: string; diameter: number; material: string; pipeSpec: string };
  export type ProfileModel = { nodes: ProfileNode[]; segments: ProfileSegment[]; warnings: ProfileWarning[]; tentativeGL: boolean; profile: MunicipalityProfile; title: string };
  /** route は下流→上流の順。図は上流を左、下流を右に描くので nodes は反転して上流→下流で返す */
  export function buildProfile(doc: Doc, route: string[], profile: MunicipalityProfile, title: string): ProfileModel;
  ```
  - GL ＝ `node.groundLevel ?? groundZ(floorOf(node), doc.site)`（`floorId` が無いノードは最初の階）。`doc.site?.designGL === undefined` なら `tentativeGL: true` と warning `tentativeGL`
  - 土被り ＝ GL − (管底高 + 外径)。`< profile.profileTable.minCover` → `cover` 警告
  - 勾配 ＝ (上流Z − 下流Z)/水平距離。水平距離 < 1 の区間（立て管）は `slope: null, slopeText: '立管'`。負 → `reverseSlope`。`minSlopeFor` 未満 → `minSlope`
  - `pipeSpec` ＝ `${material || 'VU'}φ${diameter}`

- [ ] **Step 1: 失敗するテスト**（手計算ケース）

```ts
// ケース A 直線1本: マス A(0,0) invert -700 → 公共マス B(10000,0) invert -800、GL -100（designGL）、φ100 VU
//   累加距離 [0, 10000]、勾配 0.01 → '1/100'、土被り A = -100 - (-700 + 114) = 486
// ケース B 折れ2区間: A(0,0,-600) → C(4000,0,-640) → B(4000,3000,-700)：距離 4000・3000、勾配 1/100・1/50、累加 [0,4000,7000]
// ケース C 分岐: B から上流に A1・A2 → branchPoints が C の options 2 つ、choice で A1 を選ぶと branches に A2 側
// 逆勾配・最小勾配未満（φ100 で 1/150）・土被り不足（minCover 200、土被り 150）→ warnings の kind
// 閉路（A→C→D→A）→ error '経路が輪になっています'；排水以外しかつながらない outlet → error
// designGL 未設定 → tentativeGL true、GL は floor.elevation
```

- [ ] **Step 2: 失敗を確認** `npx vitest run src/model/profileDrawing.test.ts`
- [ ] **Step 3: 実装**。経路抽出は outlet から上流へ DFS（排水系の区間のみ、器具の接続口は通過しない＝マスは経路のノードとして含むが先へは広がらない。マスの接続口ノードは `fixtureId` を持つが `isManhole` なら通過可）
- [ ] **Step 4: 合格を確認**
- [ ] **Step 5: Commit** `feat(profile): 排水縦断図の経路抽出と計算モデル（累加距離・勾配・土被り・警告）`

---

### Task 5: 用紙描画（Sheet → SVG / PDF）と縦断図の描画

**Files:**
- Create: `src/export/sheet.ts`（描画命令と SVG/PDF 変換）
- Create: `src/export/profileSheet.ts`（縦断図の描画）
- Create: `src/export/sheet.test.ts`、`src/export/profileSheet.test.ts`（SVG スナップショット）

**Interfaces:**
- Produces（`sheet.ts`）:
  ```ts
  export type Op =
    | { t: 'line'; x1: number; y1: number; x2: number; y2: number; w?: number; color?: string; dash?: boolean }
    | { t: 'poly'; pts: [number, number][]; w?: number; color?: string; close?: boolean; fill?: string }
    | { t: 'rect'; x: number; y: number; w: number; h: number; stroke?: string; fill?: string }
    | { t: 'circle'; cx: number; cy: number; r: number; stroke?: string; fill?: string }
    | { t: 'text'; x: number; y: number; s: string; size: number; anchor?: 'start' | 'middle' | 'end'; color?: string; rotate?: -90 | 0 };
  export type Sheet = { width: number; height: number; ops: Op[] };  // 用紙 mm、原点左上、y 下向き
  export const PAPER_MM = { A3: [420, 297], A4: [297, 210] } as const;
  export function paperSize(p: MunicipalityProfile['paper']): { width: number; height: number };
  export function sheetToSvg(sheet: Sheet): string;                  // viewBox="0 0 W H"、単位 mm、font-family sans-serif
  export async function sheetsToPdf(sheets: Sheet[], fontBytes: Uint8Array | ArrayBuffer): Promise<Uint8Array>; // 1 Sheet = 1 ページ、mm→pt（72/25.4）、y 反転
  export function drawTitleBlock(sheet: Sheet, fields: { label: string; value: string }[], disclaimer: string): void; // 右下 120×(8×行) mm の表題欄
  export function drawSymbol(sheet: Sheet, id: string, x: number, y: number, r: number): void; // 'circle' | 'square' | 'circleDot' | 'squareCross' | 'triangle' | 'meter' | 'valve' | 'faucet'；不明は circle
  ```
- Produces（`profileSheet.ts`）:
  ```ts
  export function renderProfileSheet(model: ProfileModel, meta: { siteName: string; date: Date }): Sheet;
  export const renderProfileSvg = (model: ProfileModel, meta): string => sheetToSvg(renderProfileSheet(model, meta));
  ```
  - 上段: 左余白 25mm に行ラベル、横軸 累加距離 /hScale、縦軸 高さ /vScale。基準線（DL）は最小管底高を 10mm 下に丸めた値。GL 線（実線）、管底線（太線）、各ノードにマス記号（`profile.symbols[type]`）。図が用紙幅を超えるときは hScale を SCALES（drawingPdf.ts の `SCALES`）から収まる値に上げ、表題欄の縮尺に表示
  - 下段: `profileTable.rows` の順で行。ノード列（distance/slope/pipeSpec は区間列＝ノード間の中央）。値: 距離・累加距離・GL・管底高・土被りは `unit` に従い m 小数3位（`(v/1000).toFixed(3)`）または mm 整数
  - 警告: 該当の区間/ノードを赤、欄外（表題欄の左）に「⚠ 警告」一覧。`tentativeGL` なら GL 行ラベルに「（仮）」、欄外に「設計GL 未入力のため仮の地盤高で描いています」。`profile.unverified` があれば「要確認: …」を欄外に
  - 表題欄: `paper.titleBlockFields` の順。工事名=siteName、図面名='排水設備 縦断図'、縮尺=`H 1/${hScale} V 1/${vScale}`、作成日=`dateJa`、その他は空欄。免責: 「本図は作図支援ツールの出力です。自治体の審査基準への適合を保証しません」

- [ ] **Step 1: 失敗するテスト** `sheet.test.ts`: `sheetToSvg` が `viewBox="0 0 420 297"` と `<line`/`<text` を含む、`sheetsToPdf` が `%PDF` で始まり 2 Sheet で 2 ページ（`PDFDocument.load` で `getPageCount()`）、`drawSymbol('square')` が rect を追加
- [ ] **Step 2: 失敗を確認 → `sheet.ts` を実装 → 合格**
- [ ] **Step 3: 失敗するテスト** `profileSheet.test.ts`: ケース A/B の `renderProfileSvg` を `toMatchSnapshot()`、SVG に `1/100`・`10.000`（累加距離 m）・`0.486`（土被り）・`排水設備 縦断図` が含まれる、警告ケースで `⚠` と赤（`#d`〜）が含まれる、`tentativeGL` で `（仮）`、`GL未入力は仮表示` テスト
- [ ] **Step 4: 失敗を確認 → `profileSheet.ts` を実装 → 合格**（スナップショット初回作成後、目で SVG をブラウザ/`test-evidence/` に保存して形を確認: `node -e` で SVG を書き出し、Playwright で PNG 化して `test-evidence/shinsei-profile-A.png`）
- [ ] **Step 5: 全単体テスト・tsc・lint 合格**
- [ ] **Step 6: Commit** `feat(export): 用紙描画（SVG/PDF 共通）と排水縦断図の描画`

---

### Task 6: 給水立面図（系統図）の計算と描画

**Files:**
- Create: `src/model/riser.ts`、`src/model/riser.test.ts`
- Create: `src/export/riserSheet.ts`、`src/export/riserSheet.test.ts`

**Interfaces:**
- Consumes: `canJoin`（systems.ts）、`FIXTURE_CATALOG`、`floorById`、`groundZ`、`drawSymbol`/`drawTitleBlock`/`sheetToSvg`
- Produces:
  ```ts
  export type RiserNode = { nodeId: string; x: number; z: number; floorName: string; heightLabel: string; fixture?: { type: FixtureType; label: string; symbol: string }; valve?: boolean; children: RiserEdge[] };
  export type RiserEdge = { segId: string; diameter: number; system: 'water' | 'hotWater'; material: string; to: RiserNode };
  export type RiserModel = { root: RiserNode; floors: { name: string; z: number }[]; columns: number; profile: MunicipalityProfile; title: string; warnings: string[] };
  /** 起点候補: 水道メーターの出口 → 止水栓(kind 'valve' で給水) → なし */
  export function defaultRiserRoot(doc: Doc): string | null;
  export function buildRiser(doc: Doc, rootNodeId: string, profile: MunicipalityProfile, title: string): RiserModel;
  // 給水・給湯の区間だけを root から幹→枝に木構造化（訪問済みノードへの区間は無視し warnings に '輪になった配管を省略しました'）。給湯器の接続口は通過可（給湯の枝）。
  // レイアウト: 深さ優先で葉に左から列番号 x（0,1,2…）、親は最初の子と同じ列。heightLabel: 'FL+' なら `FL+${z - floor.elevation}`、'GL+' なら `GL+${z - groundZ}`（mm 整数、負は '−'）
  export function renderRiserSheet(model: RiserModel, meta: { siteName: string; date: Date }): Sheet;
  export const renderRiserSvg = (model, meta) => sheetToSvg(renderRiserSheet(model, meta));
  ```
  - 描画: 列間 30mm、高さは vScale（profile.profileTable.vScale）で mm→用紙 mm、`showFloorLines` で各階の FL に薄い横線と階名。単線。口径ラベル `φ20` を区間中央の `diameterLabelPos`（above=線の上、side=右）。器具は `profile.symbols[type]`（無ければ faucet）、ラベルは catalog の label。表題欄の図面名='給水装置 立面図'

- [ ] **Step 1: 失敗するテスト** `riser.test.ts`: 2階建て給水（メーター→1F 水栓、立て管→2F 水栓）で `root.children.length===1`、葉 2 つ、2F の葉の `heightLabel==='FL+1000'`（床 3000 の階で z 4000）、`columns===2`；`defaultRiserRoot` がメーター出口ノードを返す、メーター無しで止水栓（valve）を返す；輪を含む配管で warnings 1 件
- [ ] **Step 2: 失敗を確認 → `riser.ts` 実装 → 合格**
- [ ] **Step 3: 失敗するテスト** `riserSheet.test.ts`: スナップショット、`φ20`・`FL+1000`・`給水装置 立面図` を含む、`showFloorLines:false` で階名が無い
- [ ] **Step 4: 失敗を確認 → `riserSheet.ts` 実装 → 合格**（PNG を `test-evidence/shinsei-riser-A.png`）
- [ ] **Step 5: 全単体テスト・tsc・lint 合格**
- [ ] **Step 6: Commit** `feat(riser): 給水立面図（系統図）の木構造化と描画`

---

### Task 7: 「申請図面」画面・器具/配管パネル・プロファイル設定

**Files:**
- Create: `src/ui/ShinseiScreen.tsx`（申請図面の全画面。EstimateScreen と同じ `screen` クラスの作り）
- Create: `src/ui/ProfileSettingsDialog.tsx`
- Create: `src/ui/useProfiles.ts`（Zustand: `profiles: MunicipalityProfile[]`, `load()`, `save(p)`, `remove(id)`。repository を使う）
- Modify: `src/ui/Editor.tsx`（ヘッダーに `📐 申請図面` ボタン `data-testid="open-shinsei"`、`showShinsei` 状態）
- Modify: `src/ui/Panels.tsx`（区間パネル: 排水区間に「勾配 1/[n]」入力 `data-testid="seg-slope-input"` と「勾配を固定」トグル `data-testid="seg-slope-lock"`。Task 2 のマス項目）
- Modify: `src/ui/HelpDialog.tsx`（用語に「縦断図」「立面図（系統図）」「自治体プロファイル」を1行ずつ）
- Modify: `src/App.css`（`.shinsei-preview` ピンチズーム: `touch-action: pan-x pan-y pinch-zoom; overflow: auto`、スマホは全画面）
- Test: `src/ui/shinsei.test.tsx`（@testing-library/react: 候補の一覧と生成）

**Interfaces:**
- Consumes: Task 1〜6 の全 export、`downloadBytes`/`safeName`（download.ts）、フォント fetch（EstimateScreen.tsx:414 と同じ URL）
- Produces（`ShinseiScreen.tsx`）:
  - props `{ onClose: () => void }`
  - 上から: ①自治体プロファイル `<select data-testid="shinsei-profile">`（同梱＋ユーザー、変更は `updateSite({ municipalityProfileId })`）＋「プロファイルを管理」ボタン → `ProfileSettingsDialog`。設計GL `NumField data-testid="shinsei-gl"`（`updateSite({ designGL })`、未入力なら「仮」バッジ）
  - ②図面種類 ラジオ `data-testid="shinsei-kind-profile" / "shinsei-kind-riser"`
  - ③経路: 縦断図は下流端候補 `<select data-testid="shinsei-outlet">`（公共マス → 他のマス → 排水の端点 の順、ラベル「公共汚水マス（1F）」等）。`branchPoints` が 1 つ以上なら各分岐に `<select data-testid="shinsei-branch-{nodeId}">`（枝の先の器具名/ノード、＋「全部（枝は別図）」）。立面図は起点 `<select data-testid="shinsei-root">`（既定 `defaultRiserRoot`）
  - ④プレビュー `<div className="shinsei-preview" data-testid="shinsei-preview" dangerouslySetInnerHTML={svg}>`、拡大/縮小/等倍ボタン。警告一覧 `data-testid="shinsei-warnings"`。生成できない時は `data-testid="shinsei-error"` にメッセージ
  - ⑤出力: 「PDF」`data-testid="shinsei-pdf"`（`sheetsToPdf`、ファイル名 `${safeName(name)}_縦断図_${dateStamp}.pdf` / `_立面図_`）、「SVG」`data-testid="shinsei-svg"`（`downloadBytes(new TextEncoder().encode(svg), …, 'image/svg+xml')`）。「全部」のときは本線＋枝ごとの Sheet を 1 PDF に
  - 配管・器具の変更で `useMemo([doc, 選択])` により自動再生成
- Produces（`ProfileSettingsDialog.tsx`）: 一覧（同梱に「同梱」バッジ）、複製 `data-testid="profile-dup-{id}"`、編集フォーム（name / source.title / source.url / unverified（改行区切り）/ rows の並べ替え（↑↓）とラベル / slopeFormat / hScale / vScale / minSlopeByDiameter（口径:分母 の行）/ minCover / unit / riser.* / paper.* / symbols（種類ごとに `<select>` で記号ID）。同梱は読み取り専用で「複製して編集」のみ）、JSON 読み込み `<input type=file data-testid="profile-import">`（`parseProfileJson`、エラーは表示）、書き出し `data-testid="profile-export-{id}"`、削除（ユーザー分のみ、`confirm`）

- [ ] **Step 1: 失敗するテスト** `shinsei.test.tsx`: サンプル工事＋マス2つ＋排水1本の doc をストアに入れ `render(<ShinseiScreen onClose={()=>{}}/>)` → `shinsei-outlet` に公共マスが先頭、`shinsei-preview` 内に `<svg`、`shinsei-kind-riser` を押すと `給水装置 立面図` を含む；排水の無い doc では `shinsei-error` に「排水の配管がありません」
- [ ] **Step 2: 失敗を確認 → `useProfiles.ts`・`ShinseiScreen.tsx` を実装 → 合格**
- [ ] **Step 3: `Editor.tsx` にボタンと表示を追加**（積算ボタンの隣。スマホはアイコンのみ `aria-label="申請図面"`）
- [ ] **Step 4: `Panels.tsx` の区間パネル**: 排水区間に `勾配 1/` ＋ 数値入力（Enter/blur で `setSegmentSlope`）、`固定` チェック（`setSegmentSlopeLocked`）。固定中は `🔒`。既存の `seg-slope` 表示は残す
- [ ] **Step 5: `ProfileSettingsDialog.tsx` を実装**。単体テスト `profileSettings.test.tsx`: 同梱の複製で一覧が 2 件、不正 JSON の読み込みでエラー表示、同梱の削除ボタンが無い
- [ ] **Step 6: HelpDialog・App.css・サンプル工事（`src/sample/sample.ts`）に「トイレの汚水 → 汚水マス → 公共汚水マス（勾配 1/100、designGL −450）」を追加**（E2E で縦断図がすぐ出せるように。`sample.test.ts` があれば件数更新）
- [ ] **Step 7: 全単体テスト・tsc・lint 合格**、`npm run build` 成功
- [ ] **Step 8: Commit** `feat(ui): 申請図面タブ（縦断図・立面図のプレビューと PDF/SVG）、勾配入力、自治体プロファイル設定`

---

### Task 8: E2E・証拠・後方互換

**Files:**
- Create: `e2e/shinsei.spec.ts`
- Modify: `e2e/*.spec.ts`（器具数など期待値が変わっていれば）
- Create: `test-evidence/*-shinsei-*.png`

**Interfaces:**
- Consumes: Task 7 の `data-testid`、既存 E2E のヘルパー（`e2e/` の既存 spec の書き方に合わせる。3 端末プロジェクト = PC Chrome・スマホ縦・横）

- [ ] **Step 1: 既存 E2E を実行してベースライン** `npx playwright test 2>&1 | tail -5`（115 件合格・11 件対象外のはず）。失敗があれば期待値を更新（器具一覧の件数など）
- [ ] **Step 2: `e2e/shinsei.spec.ts`**（3 端末）: ① サンプル工事を開く → `open-shinsei` → `shinsei-outlet` の先頭が公共マス → プレビューに svg → 警告なし → `shinsei-pdf` で download イベント（ファイル名に `縦断図`）→ スクリーンショット `test-evidence/{project}-shinsei-01-profile.png`。② `shinsei-kind-riser` → svg に `給水装置 立面図` → PDF download → スクリーンショット。③ 設計GL を空にして「仮」バッジとプレビューの `（仮）`。④ 配管の区間を選び `seg-slope-input` に 50 → `seg-slope` に `1/50`、`seg-slope-lock` がチェック済み。⑤ 「プロファイルを管理」→ 複製 → 一覧 2 件 → 閉じて `shinsei-profile` に複製が出る
- [ ] **Step 3: 後方互換 E2E**: `e2e/` の既存の「JSON 読み込み」テストに倣い、`site`・マスなしの v5 JSON（`test-evidence/` か `e2e/fixtures/` の既存ファイル）を読み込み → 申請図面を開き → `shinsei-error` または `（仮）` のどちらかが出てクラッシュしない
- [ ] **Step 4: 実行** `npx playwright test` → 全件合格。`npm run test:pwa` 合格
- [ ] **Step 5: Commit** `test(e2e): 申請図面（縦断図・立面図・勾配・プロファイル）と後方互換`

---

### Task 9: 独立レビュー → 修正 → PROGRESS・仕様の更新

**Files:**
- Modify: `docs/progress/PROGRESS.md`（「追加: 申請図面」節＋「次の作業」）
- Modify: `docs/superpowers/specs/2026-11-09-shinsei-zumen-design.md`（「7. 決定事項」に slope 比率保存・設定画面の場所・マスの接続口1つ を追記）
- Modify: `README.md`（機能一覧に1行）

- [ ] **Step 1: superpowers:requesting-code-review で、実装を見ていない別モデル（Sonnet）の reviewer subagent にブランチ全体（`git diff main...HEAD`）と仕様を渡してレビュー**。観点: 仕様との差、Review Focus 1〜5、mm/m の取り違え、旧データ互換、スマホ表示
- [ ] **Step 2: Critical/Important を修正し、単体・E2E を再実行（証拠を更新）**。Minor は可能なら対応、残りは PROGRESS の既知の制限へ
- [ ] **Step 3: PROGRESS.md に** 設計・計画のパス、ブランチ、実装の要点（データ・マス・プロファイル・縦断図・立面図・画面）、テスト件数、レビュー結果、既知の制限（勾配は比率保存／個別自治体は未同梱／マスの接続口は1つ／枝は別図）、未確認（実機・自治体手引きとの照合）、次の作業（Excel 差し込み C 案、本管図、Supabase）
- [ ] **Step 4: push と PR 作成**（`gh pr create`、本文に機能・テスト件数・証拠・注意。末尾に Generated with 行）。main へのマージはユーザー確認待ち（停止条件4）
- [ ] **Step 5: Commit** `docs: 申請図面の進捗・決定事項を記録`

---

## Self-review（作成時）

- 仕様 1-1〜1-4 → Task 1・2・3。2-1〜2-3 → Task 4・5。3-1〜3-3 → Task 6。4-1〜4-3 → Task 7。5 → 各 Task のテスト＋Task 8。6 → Task 順。7 → Global Constraints。
- 仕様との差（意図的）: `slope` は比率で保存（互換）。設定画面は「申請図面」画面内の「プロファイルを管理」から開く（ホームの設定は無いため）。マスの接続口は中心 1 つ（流入・流出とも同じ管底高。落差は次段階）。`groundLevel` はフィールドのみ。
- 型の整合: `SiteSettings`（Task 1）を `groundZ`（Task 2）・`buildProfile`（Task 4）・`buildRiser`（Task 6）が `doc.site` 経由で使う。`MunicipalityProfile`（Task 3）を Task 4〜7 が使う。`Sheet`（Task 5）を Task 6・7 が使う。
