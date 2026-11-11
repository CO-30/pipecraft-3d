# 給水の水理計算書 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 描いた給水配管から、直結直圧式の水理計算（口径決定）と申請用の水理計算書（PDF/SVG）を自動で作り、足りなければ口径の提案をワンタップで反映する。

**Architecture:** 計算は画面から切り離した純粋関数（`src/model/hydraulics/`）。自治体の値はデータ（状態 ✅/🟡/❓・出典つき）。設定は `site.application` の `suiri.*` に保存し保存形式は変えない。出力は既存の Sheet 命令列（`src/export/sheet.ts`）で、申請画面に「水理計算書」を足す。

**Tech Stack:** TypeScript・React・zustand ストア・Vitest・Playwright・pdf-lib（既存）

**Spec:** `docs/superpowers/specs/2026-11-12-suiri-keisan-design.md`

## Global Constraints
- 触らない: `network.ts`・`schema.ts`・`municipality.ts`・`slope.ts`・`drainRoute.ts`・`underfloorSlope.ts`・`profileDrawing.ts`・`profileSheet.ts`、ストアの `commit`（排水チャットの作業範囲）
- 内部の長さは mm、計算書の表示は m。1 MPa = 102.0 m。ウエストン公式は口径 50 以下、それより太いとヘーゼン・ウィリアムス C=150。d は呼び径
- 管の損失 = I × L × 1.1。器具の損失 = I × 直管換算長。余裕水頭 3.0 m。流速の上限 2.0 m/s。配水管はメーターより 0.9 m 下。引込の既定 3.0 m
- 同時使用数: 1→1、2〜4→2、5〜10→3、11〜15→4、16〜20→5、21〜30→6、31〜40→7 …（10 栓ごとに +1）
- 使用水量の既定: 口径 13 → 12 L/min（洗面台 8）、口径 20 以上 → 20 L/min、給湯器 20 L/min
- 図面の文字は LabelPlacer で置き、`noOverlap.test.ts` で重なり 0
- 画面の言葉は使う人向けの平易な日本語。要確認は橙

## Review Focus
- 給水の配管がメーターにつながっていない・器具が 1 つも無い → 計算しない理由を 1 文で出す（落ちない）
- 輪になった給水配管 → 一度だけたどり「輪を省略」と警告（無限ループしない）
- 実測長がある区間 → 実測長で計算（図面の長さで上書きしない）
- 給水ヘッダーの出口・給湯器の先 → ヘッダーは通り抜け、給湯器の先（給湯）は数えない
- `suiri.use` に消えた器具の id が残っている → 無視して自動で選び直す

---

### Task 1: 公式と自治体の値

**Files:**
- Create: `src/model/hydraulics/formulas.ts`、`src/model/hydraulics/supplyRules.ts`
- Test: `src/model/hydraulics/formulas.test.ts`、`src/model/hydraulics/supplyRules.test.ts`

**Interfaces:**
- Produces:
  - `velocity(qLmin: number, dMm: number): number`（m/s）、`westonGradient(qLmin, dMm): number`（‰）、`hazenGradient(qLmin, dMm, c = 150): number`（‰）、`gradient(qLmin, dMm): number`（q ≤ 0 → 0）、`MPA_HEAD = 102.0`
  - `type RuleStatus = 'ok' | 'general' | 'unknown'`、`type RuleVal = { v: number; status: RuleStatus; source: string }`
  - `type EquivItem = 'faucet' | 'meter' | 'stopValve' | 'tap' | 'checkValve' | 'valve'`、`EQUIV_LABEL: Record<EquivItem, string>`
  - `equivLength(item: EquivItem, dia: number): number`（m。13/20/25 は表、13 未満は 13、30 以上は 25 の値 × dia/25）
  - `simultaneousCount(total: number): number`
  - `defaultFlow(type: FixtureType, portDia: number): number`
  - `type SupplyRules = { city: string | null; designPressure: RuleVal; margin: RuleVal; lengthFactor: RuleVal; maxVelocity: RuleVal; mainDrop: RuleVal; serviceLength: RuleVal; serviceItems: EquivItem[]; notes: { text: string; status: RuleStatus; source: string }[] }`
  - `resolveSupplyRules(input: { profileName?: string; address?: string }): SupplyRules`（市町村は `cityOf` で取り出す）

- [ ] **Step 1: 失敗するテストを書く** — `westonGradient`: 川崎市の例 (12,13)→230、(12,20)→34、(20,20)→80、(32,25)→65 に ±6%。`velocity(12,13)` ≈ 1.51（±0.01）。`gradient(0,20)`=0。`hazenGradient(300,75)` が `westonGradient(300,75)` の 0.5〜2 倍（公式の取り違え防止）。`simultaneousCount`: 1→1, 4→2, 5→3, 10→3, 11→4, 20→5, 30→6, 31→7, 45→8。`equivLength('faucet',13)`=3.0、`('meter',20)`=11、`('meter',40)`=24、`('valve',10)`=0.12。`defaultFlow('kitchen',13)`=12、`('washbasin',13)`=8、`('waterHeater',20)`=20、`('faucet',20)`=20。`resolveSupplyRules({address:'沖縄県宜野湾市大山1-1'})` → city '宜野湾市'、designPressure.status 'unknown'、v 0.15、notes に status 'ok' の行あり、serviceItems = ['tap','stopValve','meter','checkValve']。`resolveSupplyRules({})` → city null、designPressure.status 'general'
- [ ] **Step 2: 失敗を確かめる** `npx vitest run src/model/hydraulics` → FAIL（モジュールが無い）
- [ ] **Step 3: 実装** ウエストン: `h/L = (0.0126 + (0.01739 − 0.1087 d)/√v) · (1/d) · v²/(2g)`、g = 9.8、d[m]。ヘーゼン: `h/L = 10.666 C^−1.85 D^−4.87 Q^1.85`。値と出典 URL は spec §3・§5 のとおり。沖縄の市町村（那覇市・沖縄市・宜野湾市・浦添市・豊見城市・糸満市・南城市・うるま市・名護市・宮古島市・石垣市・南風原町・与那原町・八重瀬町・西原町・北谷町・嘉手納町・読谷村・中城村・北中城村）は設計水圧 ❓ 0.15。宜野湾市だけ notes に規程（✅）: 「メーターの上流に鍵付き伸縮止水栓・下流に逆流防止」「給水管の埋設深度 0.6m 以上」「規程に設計水圧の数値なし → 水道局に確認」
- [ ] **Step 4: 通す** 同コマンド → PASS
- [ ] **Step 5: Commit** `feat(suiri): 公式と自治体の給水の値`

### Task 2: 設定の読み書きと給水の木

**Files:**
- Create: `src/model/hydraulics/settings.ts`、`src/model/hydraulics/supplyTree.ts`
- Test: `src/model/hydraulics/supplyTree.test.ts`（設定の往復も）、テスト用の現場 `src/model/hydraulics/testSupply.ts`

**Interfaces:**
- Consumes: なし（`Doc`・`FIXTURE_CATALOG`・`segmentLength`）
- Produces:
  - `type SuiriSettings = { pressure?: number; margin?: number; serviceLen?: number; drop?: number; use?: string[]; flows: Record<string, number> }`
  - `readSuiriSettings(app?: Record<string, string>): SuiriSettings`、`writeSuiriSettings(app: Record<string, string> | undefined, patch: Partial<SuiriSettings>): Record<string, string>`（undefined・空配列・空 flows のキーは消す。他のキーは残す）
  - `type SupplyOutlet = { fixtureId: string; nodeId: string; type: FixtureType; dia: number; z: number }`
  - `type SupplyEdge = { from: string; to: string; segIds: string[]; length: number /* mm、実測長優先 */; diameter: number; toFixture: boolean }`（from = 上流の点の nodeId）
  - `type SupplyTree = { rootNodeId: string; meterId: string; meterDia: number; meterZ: number; edges: SupplyEdge[]; parentEdge: Record<string, number>; valves: string[]; outlets: SupplyOutlet[]; service: { length: number; diameter: number; drawn: boolean }; warnings: string[] }`
  - `buildSupplyTree(doc: Doc): SupplyTree | { error: string }`
  - `testSupply.ts`: `kawasakiLike(): { doc: Doc; ids: { kitchen: string; heater: string; washbasin: string; toilet: string; meter: string } }`（メーター → 25 で 4.5 m → 分岐 F → 20 で 3.5 m → 分岐 E → 13 で台所・洗面台・トイレ／F → 20 で 1.5 m → 給湯器。器具の高さは既定）

- [ ] **Step 1: 失敗するテストを書く** — 設定: `writeSuiriSettings({x:'1'}, {pressure:0.2, use:['a','b'], flows:{f1:24}})` → `{x:'1','suiri.pressure':'0.2','suiri.use':'a,b','suiri.flow.f1':'24'}`、`read` で戻る、`write(…, {use: []})` で `suiri.use` が消える。木: `kawasakiLike` で outlets 4（給湯器を含み、給湯の先は含まない）、区間の区切りは分岐・器具・バルブ・口径の変わり目、`edges` の長さの和 = 給水管の長さの和、実測長を入れた区間はその長さ。ヘッダーを通る現場で、ヘッダーの出口の先の器具が outlets に入る。メーターなし → `{error}`（文に「水道メーター」）。メーター 2 個・ポンプ → warnings に「対象外」。輪 → warnings に「輪」、無限ループしない。メーターの入口の上流に 2 m の管 → `service.drawn` true・length 2000、無ければ false・length 0
- [ ] **Step 2: 失敗を確かめる** → FAIL
- [ ] **Step 3: 実装** 起点はメーターの出口の点。たどるのは system 'water' の区間だけ。器具の点に着いたら: メーター・ヘッダーは同じ器具の他の口（メーターは 'out' 以外に戻らない、ヘッダーは 'out*'）から続ける、給湯器は 'in' で止めて outlets、他の器具は給水口で止めて outlets。区間の長さは `measuredLength ?? segmentLength`
- [ ] **Step 4: 通す** → PASS
- [ ] **Step 5: Commit** `feat(suiri): 給水の木と設定`

### Task 3: 水理計算

**Files:**
- Create: `src/model/hydraulics/calc.ts`
- Test: `src/model/hydraulics/calc.test.ts`

**Interfaces:**
- Consumes: Task 1・2
- Produces:
  - `type CalcRow = { kind: 'pipe' | 'item'; label: string; flow: number; diameter: number; velocity: number; gradient: number; length: number /* m、係数込み。item は 0 */; equiv: number; loss: number; rise: number; head: number; over: boolean; edge?: number /* SupplyTree.edges の添字 */; critical: boolean }`
  - `type OutletUse = { fixtureId: string; letter: string; label: string; dia: number; flow: number; used: boolean; pathHead: number }`
  - `type SupplyCalc = { ok: boolean; total: number; required: number; available: number; pressure: number; margin: number; plannedFlow: number; totalOutlets: number; simultaneous: number; outlets: OutletUse[]; rows: CalcRow[]; letters: Record<string, string>; criticalFixtureId: string; warnings: string[]; unverified: string[]; tree: SupplyTree; rules: SupplyRules }`
  - `calcSupply(doc: Doc, rules: SupplyRules, settings: SuiriSettings): SupplyCalc | { error: string }`
- 記号: 器具 A, B, …（木の深さ優先の順）、続けて分岐・バルブ・メーター。配水管の分岐点は最後の記号
- 行の順: 末端ごとに 末端の器具（item）→ 下流から上流の管（pipe）、2 本目からは合流点までの行だけ。最後に メーター下流側の逆止弁 → メーター → 止水栓 → 引込管 → 分水栓（`serviceItems` の逆順）
- `ok` = `required ≤ available` かつ 流速超過なし。`unverified` = 状態 'unknown' の値の説明（例「設計水圧 0.15MPa（宜野湾市: 未確認。水道局に確認）」）

- [ ] **Step 1: 失敗するテストを書く** — `kawasakiLike`・標準: totalOutlets 4・simultaneous 2、使う器具は 台所（いちばん遠い）と給湯器（20 L/min）、plannedFlow 32、メーター〜F の行の flow 32・diameter 25、gradient は `westonGradient(32,25)` と一致、管の行の loss = gradient × length / 1000 かつ length = 実長 × 1.1、total = max(pathHead) + 引込の行の head の和、required = total + 3、available = 0.15 × 102、ok true。`pressure: 0.05` → ok false。`use: [washbasin, toilet]` → その 2 つが used。`use` に無い id → 無視して自動。`flows: {heater: 24}` → plannedFlow 36。13 の管に 40 L/min（`flows`）→ 該当行 over true・ok false。立上り: 全行の rise の和（いちばん条件の悪い末端の道筋）= 末端の z − (メーターの z − 900) を m で。宜野湾市の住所 → unverified に「宜野湾市」
- [ ] **Step 2: 失敗を確かめる** → FAIL
- [ ] **Step 3: 実装** 同時に使う器具: `use` が有効ならそれ、無ければ ①各末端を自分の使用水量だけで流したときの所要水頭が最大のもの ②残りを使用水量の大きい順（同じなら所要水頭）。区間の流量は下流の使う器具の和。末端の pathHead = 器具の行 ＋ 道筋の管の行（損失 ＋ 立上り）＋ 途中のバルブの行
- [ ] **Step 4: 通す** → PASS
- [ ] **Step 5: Commit** `feat(suiri): 水理計算`

### Task 4: 口径の提案とストアの一括変更

**Files:**
- Create: `src/model/hydraulics/suggest.ts`
- Modify: `src/state/store.ts`（`updateSegment` の型の下に `updateSegments` を、実装を `updateSegment` の下に足すだけ）
- Test: `src/model/hydraulics/suggest.test.ts`、`src/state/suiri.store.test.ts`

**Interfaces:**
- Consumes: Task 3
- Produces: `type DiameterChange = { segId: string; from: number; to: number }`、`suggestDiameters(doc: Doc, rules: SupplyRules, settings: SuiriSettings): { changes: DiameterChange[]; ok: boolean; message?: string }`、ストア `updateSegments(patches: Record<string, Partial<SegmentAttrs>>): void`（1 回の commit。無い区間は無視、diameter ≤ 0 があれば何もしない）
- 口径の段: 13, 20, 25, 30, 40, 50

- [ ] **Step 1: 失敗するテストを書く** — 足りている現場 → changes []・ok true。`pressure: 0.06` の `kawasakiLike` → changes が空でなく、反映した doc で `calcSupply` が ok、どの変更も to > from、反映後に上流の口径 ≥ 下流の口径。器具につながる区間は他を太くしても足りないときだけ変わる。`pressure: 0.01` → ok false・message に「メーター」。ストア: 2 区間を `updateSegments` → 両方変わり、`undo` 1 回で両方戻る
- [ ] **Step 2: 失敗を確かめる** → FAIL
- [ ] **Step 3: 実装** 最大 60 回: 計算して ok なら終わり。流速超過の行があればその区間、無ければいちばん条件の悪い末端の道筋の管の行で loss 最大の区間（器具につながる区間は後回し）を 1 段太くし、そこからメーターまでの上流で細い区間も同じ口径に。50 で太くできる区間が無くなったら ok false
- [ ] **Step 4: 通す** → PASS
- [ ] **Step 5: Commit** `feat(suiri): 口径の提案と一括変更`

### Task 5: 水理計算書（Sheet）

**Files:**
- Create: `src/export/suiriSheet.ts`
- Modify: `src/export/noOverlap.test.ts`（水理計算書を加える）
- Test: `src/export/suiriSheet.test.ts`

**Interfaces:**
- Consumes: Task 3 `SupplyCalc`
- Produces: `renderSuiriSheets(calc: SupplyCalc, meta: { siteName: string; date: Date }): Sheet[]`（A4 縦 210×297）

- [ ] **Step 1: 失敗するテストを書く** — 1 枚目に「給水装置 水理計算書」・工事名・「直結直圧式」・設計水圧の文字・使う器具の記号、系統図に全部の記号、表に全部の行のラベル（ページをまたいでよい）、判定の文字（「適当」/「不適当」）。要確認があれば「要確認」の文字が橙。行を 60 にしても全部の行がどこかのページにあり、用紙からはみ出さない。`findTextOverlaps` が全ページで 0（器具 12 個の現場、noOverlap にも追加）
- [ ] **Step 2: 失敗を確かめる** → FAIL
- [ ] **Step 3: 実装** 表は固定の列幅（文字は列幅に収まるよう小さくする）、行の高さ 5.2 mm、ページ下端で次の用紙へ（見出しを繰り返す）。系統図は 深さ優先で 1 本目の子は同じ段の右、2 本目からは下の段。点の記号と「口径-延長」は LabelPlacer
- [ ] **Step 4: 通す** `npx vitest run src/export` → PASS
- [ ] **Step 5: Commit** `feat(suiri): 水理計算書の用紙`

### Task 6: 申請画面

**Files:**
- Create: `src/ui/SuiriPanel.tsx`
- Modify: `src/ui/ShinseiScreen.tsx`（`Kind` に 'suiri'、切り替えのボタン、`built` の分岐、ファイル名「水理計算書」、パネルの表示）
- Test: `e2e/suiri.spec.ts`

**Interfaces:**
- Consumes: Task 1〜5、ストア `updateSite`・`updateSegments`
- Produces: `SuiriPanel({ calc, settings, onChange, suggestion, onApply })`

- [ ] **Step 1: E2E を書く** — 現場を作り（e2e の既存の作り方に合わせる）メーター → 給水管 → キッチン・洗面台。申請画面 → `shinsei-kind-suiri` → 判定 `suiri-verdict` に「適当」、設計水圧の欄に入力 0.03 → 「不適当」と `suiri-apply` が出る → 押すと「適当」、図面に戻って取り消し 1 回で口径が戻る。PDF のダウンロード。PC・iPhone・Android
- [ ] **Step 2: 失敗を確かめる** `npx playwright test e2e/suiri.spec.ts` → FAIL
- [ ] **Step 3: 実装** パネル: 判定（緑/赤）・「全所要水頭 ○m ＋余裕 ○m ／ 設計水圧 ○MPa（○m）」、数値の欄（空なら自動の値を placeholder）、同時に使う器具のチェックと「自動に戻す」、提案のボタン「口径を提案どおりにする（n か所）」、警告・要確認の一覧（橙）
- [ ] **Step 4: 通す** → PASS（3 端末）。単体全体 `npx vitest run`、`npm run lint`（警告数は main と同じ）、`npm run build`
- [ ] **Step 5: Commit** `feat(suiri): 申請画面に水理計算書`

### Task 7: 仕上げ
- [ ] 独立レビュー（実装していない reviewer subagent）→ 指摘を直す
- [ ] `docs/progress/PROGRESS.md` に記録、テスト証拠を `test-evidence/`
- [ ] push・PR（main へのマージはユーザー）
