# 器具の候補を直し方から覚える Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans（ユーザーの標準指示: 使用量を抑える・最終監査は独立）。Steps use `- [ ]`.

**Goal:** 部屋の名前から置いた器具の候補を使う人が直したら、その直し方を端末に覚え、次に図面を読んだとき同じ特徴の置き場所に置く。
**Architecture:** 部屋の箱とスロット（純関数）→ 候補に部屋の情報を付ける → 記録の点数付けで候補を置き直す（純関数）→ localStorage と共通ストアの購読で記録を作る。
**Tech Stack:** React / TypeScript / zustand / Vitest / Playwright
**Spec:** `docs/superpowers/specs/2026-11-11-fixture-learning-design.md`

## Global Constraints
- 内部単位 mm。工事データ（Doc・保存スキーマ）は変えない。記録は localStorage `pipecraft3d.fixtureLearn.v1` のみ。localStorage が使えないときは例外を出さず今回のみ。
- 記録が無いときの候補の位置・向きは今までと 1mm も変えない（既存テストがそのまま通る）。
- 点数: door 3・wall 2・pos 2・label 1・同じ部屋の名前 +1。記録は種類ごと新しい順 20 件を使う、保存は種類ごと最大 50 件、見張り最大 300 件。
- スロットの当てはまり: 同じ向きの軸、中心距離 ≤ max(400, 箱の短辺/4)。辺いっぱい: 辺の内法 − 器具の幅 < 300。

## Review Focus
- 部屋の箱が作れない（壁が途切れる・斜め）→ 今までどおりの候補（Task 1 のテスト）。
- 器具が部屋に入らない（幅 > 内法 + 100）→ そのスロットは作らない／全スロット無しなら今まで通り（Task 1）。
- ドラッグ中（`dragFixture` で doc が毎回変わる）に localStorage へ書きすぎない → 記録が変わったときだけ書く（Task 3）。
- 取り消しで最初の位置に戻った → 記録を消す（Task 3）。
- 2 つ器具のある部屋（洗面: 洗面台・洗濯機）で同じスロットに 2 つ置かない（Task 2）。

---

### Task 1: 部屋の箱とスロット `roomSlots.ts`
**Files:** Create `src/model/planRead/roomSlots.ts`, `src/model/planRead/roomSlots.test.ts`
**Interfaces (Produces):**
- `type Side = 'L'|'R'|'B'|'T'`; `type SlotFeatures = { wall: 'long'|'short'|'square'; door: 'on'|'opposite'|'beside'|'none'; pos: 'nearDoor'|'farDoor'|'center'|'full'|'corner'; label: boolean }`
- `type Slot = { key: string; side: Side; x: number; y: number; rotation: Rotation; f: SlotFeatures }`（key 例 `L-center`）
- `type RoomBox = { x0: number; x1: number; y0: number; y1: number }`
- `roomBox(p: Vec2, walls: WallLine[]): RoomBox | null`（軸に平行な壁だけ、各方向 4000mm 以内、内法 600〜8000）
- `roomSlots(box: RoomBox, size: {w:number; d:number}, walls: WallLine[], label: Vec2): Slot[]`（奥を壁に付ける。回転は `facing` と同じ規則: L→90, R→270, B→180, T→0）
- `matchSlot(slots: Slot[], x: number, y: number, rotation: Rotation): { slot: Slot; flip: boolean } | null`
- `WallLine` に `doors?: number[]` を追加（fixtureGuess.ts）

- [ ] テスト: 2000×1600 の箱・下の壁に出入口 → 浴槽(1600×800) のスロットに `B-*` は無い? — 具体: 左右の辺(1600)は `full`、上下の辺(2000)は端 2 つ+真ん中。下の辺 `door:'on'`、上 `opposite`、左右 `beside`。出入口なしは `none`/`corner`。壁が 1 本欠けると `roomBox` が null。`matchSlot` は 180° 回した器具を `flip:true` で当てる・500mm 外れたら null（箱の短辺/4 未満のとき）。
- [ ] 実装 → `npx vitest run src/model/planRead/roomSlots.test.ts` 合格 → commit

### Task 2: 候補に部屋の情報・記録の適用 `fixtureLearning.ts`
**Files:** Modify `fixtureGuess.ts`（`FixtureCandidate.room?: { name: string; slots: Slot[]; first: string | null }`、name は部屋の文字から数字を除き NFKC 大文字）, `assemble.ts`（door 開口部 → `doors`）; Create `src/learn/fixtureLearning.ts`, `.test.ts`
**Interfaces (Produces):**
- `type LearnSample = { id: string; type: FixtureType; room: string; f: SlotFeatures; flip: boolean; at: number }`
- `applyLearned<T extends FixtureCandidate & { floorId?: string }>(cands: T[], samples: LearnSample[]): (T & { learned?: number })[]`
- `sampleFor(id: string, type: FixtureType, room: { name: string; slots: Slot[]; first: string | null }, fx: { x: number; y: number; rotation: Rotation }, at: number): LearnSample | null`（最初のスロットと同じ・flip なし、または当てはまらない → null）
- [ ] テスト: 記録 0 件 → 入力と同じ。浴槽の記録 1 件（左の辺・出入口の横・full）→ 左右反転した別の浴室で出入口の横の辺に置き `learned:1`、回転は flip を反映。洗面（洗面台・洗濯機）が同じスロットを望むとき 2 つ目は次点。`guessFixtures` の既存テストは位置不変。
- [ ] 実装 → `npx vitest run src/learn src/model/planRead` 合格 → commit

### Task 3: 端末への保存と見張り `learnStore.ts`
**Files:** Create `src/learn/learnStore.ts`, `.test.ts`; Modify `src/state/store.ts`（`placeFixtureCandidates` → `(string|null)[]`）
**Interfaces (Produces):** `loadSamples(): LearnSample[]`, `clearSamples(): void`, `sampleCount(): number`, `watchPlaced(entries: { id: string; type: FixtureType; room: NonNullable<FixtureCandidate['room']> }[]): void`, `startFixtureLearning(store: typeof useStore): () => void`
- [ ] テスト（jsdom の localStorage）: 見張り中の器具を別スロットへ動かす → 記録 1 件。もう一度動かす → 上書きで 1 件。最初の位置に戻す・消す → 0 件。見張りでない器具 → 0 件。localStorage が投げても例外なし。記録が変わらない doc 更新では setItem を呼ばない。
- [ ] 実装 → テスト合格 → commit

### Task 4: 画面と E2E
**Files:** Modify `src/App.tsx`（読み取り後 `applyLearned(auto.fixtures, loadSamples())`、置いたら `watchPlaced`、起動時 `startFixtureLearning(useStore)`）, `src/ui/ImportReportDialog.tsx`; Create `e2e/fixturelearn.spec.ts`
- 文言: 候補 `（これまでの直し方 N 件に合わせた位置）`、ヒント `向き・位置を直すと、この端末が覚えて次から合わせます。`、ボタン `覚えた直し方を消す（N 件）` (testid `ir-forget`)、消したら候補を今までの置き方に戻す。
- [ ] E2E: UB の部屋がある作り物の平面図 → 浴槽を置く → `__pc` で回して別の壁へ動かす → 新しい工事で同じ図面を読む → その壁に置かれ「直し方 1 件」→「覚えた直し方を消す」で元へ。3 端末。
- [ ] `npx vitest run`、`npx playwright test`、lint、build → commit → 独立レビュー → 修正 → PROGRESS 更新・証拠 → PR
