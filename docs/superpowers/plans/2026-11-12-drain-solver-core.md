# 排水の自動計算の核（solveDrain）と自治体の排水ルール Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 平面ルートを引くだけで、排水の管底高・勾配・桝深が毎回計算され、自治体の基準で検査される。

**Architecture:** 純粋関数 `solveDrain(doc, rules)` が「平面ルート＋区間の属性＋ピン」から全排水点の z とマスの管底を計算し、doc の写し（pos.z・params.invertZ）を上書きして返す。ストアの `commit` と読み込みで毎回呼ぶ。ルールは `MunicipalityProfile.drainage`（値ごとに状態と出典）から `DrainRuleSet` に解決して渡す。

**Tech Stack:** TypeScript, zod, Vitest, Playwright, zustand

**Spec:** `docs/superpowers/specs/2026-11-12-drain-auto-slope-design.md`（§2.1・2.2・2.3・2.5、§3 の 2 と 4）

## Global Constraints
- 内部単位は mm。排水の node.pos.z は管底（絶対、1 階 FL 基準）。勾配は比率（0.02 = 2/100）
- 保存形式は互換を保つ（追加の項目はすべて optional）。既存の `slopeLocked` は `slopePin` と同じ意味に読む
- 器具の接続口（fixtureId を持つ点。マスを除く）の高さは計算で動かさない
- 共通の下限: 勾配 1/100 以上（下水道法施行令 第8条）、直線部の桝は内径の 120 倍以内
- 那覇市 ✅: 最小/最大勾配（最大は未満）φ100 2/100・10/100、φ125 1.7・8.3、φ150 1.5・6.5、φ200 1.2・4.5、φ250 1.0・3.4。宅地内土かぶり 200・私道 450。桝の内径 150 以上。φ75 3/100 は 🟡。桝深上限・落差は ❓（落差の既定 20mm 🟡）
- 宜野湾市・豊見城市は ❓（国の基準＋一般値で計算し「未確認」）。宜野湾市の問い合わせ先 098-892-4156
- 屋外の勾配の既定 = 最小勾配 + 0.2/100（φ100 → 2.2/100）。床下は 2/100、床下が低ければ 1.5/100（どちらも自治体の最小勾配を下回らない）
- 最大勾配: 自治体の値、無ければ流速 1.5m/秒（`maxSlope`）
- 文字は日本語、使う人の言葉（「流末」より「下流の出口」など、既存の画面に合わせる）

## Review Focus
- 公共ますが無い工事（描きかけ）: 根は一番下流の外の端・マス。計算は止まらず、検査に「公共ますがありません」
- 輪になった配管（ループ）: 木にできない区間は計算せず、検査に「配管が輪になっています」。z は元のまま
- 古い保存データ（z だけ持ち、slope 無し）: 読み込みで計算し直しても器具の接続口は動かない・壊れない
- ピンどうしが矛盾（上流のピンが下流のピンより低い）: ピンは守り、間の区間に「逆勾配」の検査
- 雨水（drain）と汚水（sewage）が同じマスへ: 系統は別々に計算しない（同じ木）。雨水ますは泥だめ 150 で管底が流出管底より 150 下

---

### Task 1: 自治体の排水ルール（データ）

**Files:**
- Create: `src/model/drainRules.ts`
- Modify: `src/model/municipality.ts`（schema に `drainage` optional、那覇・宜野湾・豊見城に値）
- Test: `src/model/drainRules.test.ts`

**Interfaces:**
- Produces:
  - `type RuleStatus = 'verified' | 'general' | 'unverified'`
  - `type RuleValue<T> = { value: T; status: RuleStatus; source?: string }`
  - `drainageSchema`（zod）: `minSlope: Record<string(mm), RuleValue<number>>`（比率）, `maxSlope?: Record<string, RuleValue<number>>`, `coverPrivate: RuleValue<number>`, `coverPrivateRoad?: RuleValue<number>`, `manholeSpacingTimes: RuleValue<number>`, `manholeMinInner: RuleValue<number>`, `manholeMaxDepth?: RuleValue<number>`, `manholeDrop: RuleValue<number>`, `branch75: RuleValue<{ maxLength: number; slope: number }>`
  - `type DrainRuleSet = { city: string; minSlope(d: number): number; maxSlope(d: number): number; defaultSlope(d: number): number; underfloorSlope(d: number, low: boolean): number; cover: number; spacing(d: number): number; drop: number; maxDepth?: number; unverified: string[] }`
  - `resolveDrainRules(profile: MunicipalityProfile): DrainRuleSet`

- [ ] **Step 1: テスト** `drainRules.test.ts`
  - 那覇市: `minSlope(100)=0.02`, `maxSlope(100)=0.1`, `maxSlope(150)=0.065`, `minSlope(125)=0.017`, `defaultSlope(100)=0.022`, `cover=200`, `spacing(100)=12000`, `spacing(150)=18000`, `unverified` に「桝の深さの上限」「ます内の落差」を含み「最小勾配」を含まない
  - 宜野湾市: `city='宜野湾市'`、`minSlope(100)=0.02`（一般値）、`unverified` に「宜野湾市：未確認（098-892-4156）」を含む
  - 標準: `minSlope(50)>=0.01`（施行令の下限）、`maxSlope(100)` = `maxSlope`（流速）の値
  - `underfloorSlope(100,false)=0.02`, `underfloorSlope(100,true)=0.02`（那覇は最小 2/100 を下回らない）、標準で `underfloorSlope(100,true)=0.015`
- [ ] **Step 2: 失敗を確かめる** `npx vitest run src/model/drainRules.test.ts` → FAIL
- [ ] **Step 3: 実装**。口径の引き当ては「その口径以下で一番近い表の口径」（`minSlopeFor` と同じ）。表に無い小口径は `defaultSlope`（管径別）と 0.01 の大きい方。`profileTable.minSlopeByDiameter`（縦断図の検査で使用中）は `drainage.minSlope` があればそれと揃える。那覇・宜野湾（新規プロファイル `ginowan`）・豊見城に値と出典 URL（資料の「出典」）を入れる
- [ ] **Step 4: 通す** 同コマンド → PASS。`npx vitest run src/model/municipality.test.ts` も PASS
- [ ] **Step 5: コミット**

### Task 2: ピンの保存形式

**Files:**
- Modify: `src/model/network.ts`（Segment に `slopePin?`・`diameterPin?`、PipeNode に `zPin?`）、`src/model/schema.ts`、`src/model/fixtures.ts`（FixtureParams に `invertPin?`）
- Test: `src/model/schema.test.ts`

**Interfaces:**
- Produces: `isSlopePinned(s: Segment): boolean`（`slopePin || slopeLocked`）を `src/model/slope.ts` に
- [ ] テスト: 新しい項目つきの工事が schema を通り、無い古い工事もそのまま通る。`slopeLocked: true` の区間で `isSlopePinned` が true
- [ ] 失敗確認 → 実装 → PASS → コミット

### Task 3: 系統の木（drainTree）

**Files:**
- Create: `src/model/drainSolve/tree.ts`
- Test: `src/model/drainSolve/tree.test.ts`

**Interfaces:**
- Produces: `type DrainTree = { root: string; parent: Map<string, string /*segId*/>; order: string[] /* 根から上流へ */; manholeNodes: Set<string>; loops: string[] /*segIds*/ }`
- `buildDrainTrees(doc: Doc): DrainTree[]`。根の選び方: 公共ます（publicSewage/publicRain）の接続口 → 無ければ外のマスで下流側にマスが無いもの → 無ければ外壁に一番近い端（`underfloorSlope` の exitOf と同じ考え）
- [ ] テスト: 一直線（器具→床下→マス→公共ます）で root が公共ますの接続口・order の先頭が root。合流ありで 2 本とも同じ木。輪をつくると `loops` にその区間・木は残りで作る。公共ます無しで root が下流のマス
- [ ] 失敗確認 → 実装（BFS。立て管も含む全排水区間）→ PASS → コミット

### Task 4: 高さの計算（solveHeights）

**Files:**
- Create: `src/model/drainSolve/heights.ts`
- Test: `src/model/drainSolve/heights.test.ts`

**Interfaces:**
- Consumes: Task 1 `DrainRuleSet`、Task 3 `buildDrainTrees`、`underfloorLevels`・`isUnderfloorDrain`（`src/model/underfloorSlope.ts`）
- Produces: `solveHeights(doc: Doc, rules: DrainRuleSet): { doc: Doc; segSlopes: Record<string, number> }`

順番（spec §2.2 の 3〜7）:
1. 屋外: 根（公共ますの管底。マスなら `params.invertZ`）から上流へ。区間の勾配 = ピンがあればそれ、無ければ `rules.defaultSlope(d)`。マスを通るごとに流入側を `rules.drop` 上げる（`node.dropIn` は使う人の落差桝のときだけ。自動の段差は流入区間の下端 z に足す）
2. 起点（基礎の外で地中へ下ろす点の上の点 = 床下の点で、下に立て管がある所）に着いたら、床下は `slopeUnderfloor` と同じ決まり（土間から `rules.underfloorSlope`）
3. 合流ますは一番深い流入に合わせる（流出の管底 = 流入のうち最も低いもの − drop）
4. ピンの点（`zPin`）・ピンのマス（`invertPin`）はその値。ピンの下流側を先に計算し、ピンが下流より低ければ逆勾配として残す（Task 5 の検査）
5. 両端固定（根とピンの点の間）で勾配を割り振る: 間の区間の勾配 = (上の z − 下の z − 段差の合計) / 平面長の合計。ただし各区間のピンは守る

- [ ] テスト（すべて手計算の値）:
  - 一直線: 公共ます管底 −1200、屋外 φ100 10m → 起点の地中の点 −1200 + 20 + 10000×0.022 = −960 … 床下は土間 −550 から器具へ 2/100
  - 合流あり: 2 本の流入のうち深い方に流出を合わせる
  - 両端固定で勾配が足りない: 公共ます −700、地中の点を zPin −690・平面 10m → 割り振った勾配 0.001 が `segSlopes` に（検査は Task 5）
  - 急勾配: 公共ます −2500・ピン −600・10m → 勾配 0.19（検査で最大超え）
  - ユーザー固定値: `slopePin` の区間 3/100 は 3/100 のまま
  - 桝の追加・削除後: マスを足す（区間を分ける）と流入側が drop 上がる。消す（つなぎ直す）と元に戻る
  - 器具の接続口の z は変わらない・`validateNetwork` が空
- [ ] 失敗確認 → 実装 → PASS → コミット

### Task 5: 検査と直し方の候補（checkDrain）

**Files:**
- Create: `src/model/drainSolve/checks.ts`
- Test: `src/model/drainSolve/checks.test.ts`

**Interfaces:**
- Produces:
  - `type DrainIssueKind = 'minSlope' | 'maxSlope' | 'cover' | 'depthMax' | 'depthMin' | 'diameterReverse' | 'footingPenetration' | 'underfloorTooHigh' | 'reverse' | 'noPublic' | 'loop' | 'unverifiedRule'`
  - `type DrainFix = { label: string; apply: (doc: Doc) => Doc }`（ラベル例: 「マスを足す」「勾配を緩める（○/100）」「起点を深くする」「管径を上げる（φ○）」）
  - `type DrainIssue = { kind: DrainIssueKind; target: { kind: 'segment' | 'node' | 'fixture'; id: string }; message: string; fixes: DrainFix[] }`
  - `checkDrain(doc: Doc, rules: DrainRuleSet, solved: { segSlopes: Record<string, number> }): DrainIssue[]`
- [ ] テスト: Task 4 の 4 ケースで、勾配が足りない → `minSlope` と fix「勾配を…」、急すぎる → `maxSlope` と fix「マスを足す（落差）」、土かぶり 200 未満 → `cover`、口径が下流で細い → `diameterReverse` と fix「管径を上げる（φ100）」、輪 → `loop`、公共ます無し → `noPublic`、宜野湾市 → `unverifiedRule`（1 件）。fix の `apply` を当てると、その検査が消える（minSlope・diameterReverse・maxSlope の 3 つで確かめる）
- [ ] 失敗確認 → 実装 → PASS → コミット

### Task 6: solveDrain と毎回の計算

**Files:**
- Create: `src/model/drainSolve/index.ts`（`solveDrain`）
- Modify: `src/state/store.ts`（`commit` で排水・マス・建物・自治体が変わったら `solveDrain`。読み込み `newDoc`/`loadDoc` でも）、`src/App.tsx`（`setUnderfloorRulesSource` を `setDrainRulesSource((doc) => resolveDrainRules(profile))` に置き換え）、`src/model/drainRoute.ts`（自前の高さ決めをやめ、`solveDrain` に任せる）、`src/model/underfloorSlope.ts`（`solveDrain` の床下の手順として残す。ストアの `autoUnderfloorSlope` スイッチと「付け直す」ボタンは削除）
- Test: `src/state/drainSolve.store.test.ts`、既存の `drainRoute.test.ts`・`underfloor.store.test.ts`・`slope.test.ts` の更新

**Interfaces:**
- Produces: `solveDrain(doc: Doc, rules: DrainRuleSet): { doc: Doc; issues: DrainIssue[] }`、ストアの `drainIssues: DrainIssue[]`、`applyDrainFix(issueIndex: number, fixIndex: number): void`
- [ ] テスト（ストア）: 床下に排水を描く → 管底が土間から上がる。マスを置いてつなぐ → 屋外が計算され `drainIssues` が更新。区間の勾配をピン（`setSlopeRatio`）→ 再計算で変わらない。ピンを外す（「自動に戻す」）→ 既定に戻る。Undo 1 回で描く前に戻る（計算は同じ履歴に入る）
- [ ] 既存テストの期待値を新しい規則に合わせて直す（変えた理由をテスト名か注記に）
- [ ] `npx vitest run` 全部 PASS、`npm run build` OK、`npx oxlint` の警告数が main と同じ
- [ ] E2E: `npx playwright test e2e/underfloor.spec.ts e2e/planauto.spec.ts e2e/supports.spec.ts e2e/shinsei.spec.ts` PASS
- [ ] コミット

### Task 7: 仕上げ
- [ ] 独立レビュー（実装していない reviewer subagent）→ 指摘を直す
- [ ] `docs/progress/PROGRESS.md` 更新、`test-evidence/` に証拠
- [ ] push・PR（main へのマージはユーザーの指示まで待つ）
