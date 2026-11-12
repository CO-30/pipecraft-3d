# 給水・給湯を床下でつなぐ（案） Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** ボタン 1 つで、メーター → 床下の給水ヘッダー → 各器具、給湯器 → 床下の給湯ヘッダー → 各器具 の配管案を作る。

**Architecture:** 純粋関数 `routeSupplies(doc)` が床下の形（壁・立上り・建物の中）を作り、既存の `findFloorRoute` で器具ごとにヘッダーまでの道を探して配管を足す。ストアは 1 回の commit。

**Tech Stack:** TypeScript・zustand・Vitest・Playwright

**Spec:** `docs/superpowers/specs/2026-11-12-supply-route-design.md`

## Global Constraints
- 床下の配管の高さ = 1 階の床 −300。床下のヘッダーは mountZ −400（出口 −300）。給水ヘッダーの出口 6、給湯ヘッダー 4
- 埋設深さ: 標準 300（GL から）、宜野湾市 600
- 触らない: `drainRoute.ts`・`network.ts`・`schema.ts`・`municipality.ts`・`slope.ts`・`underfloorSlope.ts`・`fixtures.ts`・ストアの `commit`
- 既存の `findFloorRoute`・`assignAutoMaterials`・`addPolyline`・`addRiser`・`placeFixture` を使う

## Review Focus
- 外壁が 1 周つながっていない・壁の無い工事 → 何もせず、理由を知らせる（落ちない）
- 器具が建物の中でも、立上りに囲まれて出口から届かない → その器具だけ残して知らせる
- 給湯器が無い → 給湯はつながず知らせる（給水は進める）
- メーターの出口にすでに配管がある → 引込は足さない（ヘッダーへの給水は既存の配管に任せる）と知らせる
- 2 階の器具・屋外の水栓 → つながず知らせる

---

### Task 1: routeSupplies（純粋関数）

**Files:**
- Create: `src/model/supplyRoute.ts`、テスト用の家 `src/model/testSupplyHouse.ts`
- Modify: `src/model/hydraulics/supplyRules.ts`（`burial: RuleVal` を足す。標準 300 general、宜野湾市 600 ok）
- Test: `src/model/supplyRoute.test.ts`

**Interfaces:**
- Produces: `routeSupplies(doc: Doc, opts?: { burial?: number }): SupplyRouteResult`、`type SupplyRouteResult = { doc: Doc; pipes: number; headers: number; sleeves: number; crossings: number; connected: { water: number; hot: number }; notes: string[]; error?: string }`、`UNDERFLOOR_Z = -300`
- `testSupplyHouse.ts`: `supplyHouse(opts?: { extraWater?: number; header?: boolean; meter?: boolean }): { doc: Doc; ids: { meter?: string; heater: string; kitchen: string; washbasin: string; toilet: string; header?: string } }`（8000×6000・壁厚 150、外周の立上りと、x=4000 の内部の立上り（y 2500〜3100 は人通口）、メーターは西の外、給湯器は南の外壁ぎわ）

- [ ] **Step 1: 失敗するテストを書く** — 上の家で: `buildSupplyTree` の outlets が キッチン・洗面台・トイレ・給湯器、`connected` {water 4, hot 2}、給湯器の出口から hotWater の区間をたどってキッチン・洗面台の給湯口に着く、給水ヘッダーと給湯ヘッダーが mountZ −400、`crossings` 0、`sleeves` 3、床下（z = −300 の水平）の給水管は PB、地中の管は HIVP。もう一度 → pipes 0。床下のヘッダーがあれば `headers` 0。給水口 7（給湯器を含む）→ 給水ヘッダー 2 台・outlets 7。メーターなし → `error` に「水道メーター」・doc は同じ
- [ ] **Step 2: 失敗を確かめる** `npx vitest run src/model/supplyRoute.test.ts` → FAIL
- [ ] **Step 3: 実装** 外周の壁・立上りから「建物の中・壁から離れた所（roomy）」「内部の立上りの上（footing）」を作る（drainRoute の考え方の写し）。外の点 → 入口: 外周の壁へ直角に下ろした足（壁の端から 300 以上）がいちばん近い壁。床下の点 → ヘッダーの出口: `findFloorRoute`（終点は出口の点・4 方向）。先に引いた給水・給湯の床下の管から 40mm 離す
- [ ] **Step 4: 通す** → PASS
- [ ] **Step 5: Commit** `feat(supply-route): 給水・給湯を床下でつなぐ（案）`

### Task 2: ストアと画面

**Files:**
- Modify: `src/state/store.ts`（`routeSupplies(): number` を足す）、`src/ui/Panels.tsx`（「器具の真下に配管を落とす」の欄にボタン `supply-route`）
- Test: `src/state/supplyRoute.store.test.ts`、`e2e/supplyroute.spec.ts`

**Interfaces:**
- Consumes: Task 1、`calcSupply`・`resolveSupplyRules`・`readSuiriSettings`
- 知らせ: 「給水 n 本・給湯 m 本を床下のヘッダーでつなぎました（案）」＋ヘッダーを置いた数・外周の貫通・水理計算の判定（適当／不適当 → 申請画面の水理計算書で口径の提案）＋ notes

- [ ] **Step 1: 失敗するテストを書く** — ストア: 1 回の取り消しで元の doc、知らせに「給水」「水理計算」。E2E: 家を入れて器具の道具 → ボタン → 知らせ → 取り消しで区間の数が戻る（3 端末）
- [ ] **Step 2: 失敗を確かめる** → FAIL
- [ ] **Step 3: 実装**
- [ ] **Step 4: 通す** → 単体全体・E2E 全体・lint・build
- [ ] **Step 5: Commit** `feat(supply-route): ボタンと知らせ`

### Task 3: 仕上げ
- [ ] 独立レビュー → 指摘を直す → PROGRESS・テスト証拠 → push・PR（#53 の上）
