# 初心者向け UI/UX 改善 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 初めての人が説明なしで「工事作成→間取り→設備→配管→長さ→集計→見積」まで進めるよう、入口・手順ガイド・道具バー・案内表示を作り直す。

**Architecture:** 保存データ（schema v5）とストア操作は変えず、UI 層と純関数（`guide.ts`）・サンプル生成（`sample.ts`）を追加する。手順の完了判定は doc から毎回計算し、保存しない。

**Tech Stack:** React 19 / TypeScript / Zustand / Vitest / Playwright（PC・iPhone 13・Pixel 7 エミュ）

**Spec:** `docs/superpowers/specs/2026-11-08-beginner-ux-design.md`

## Global Constraints
- 保存データの形式を変えない（例外: 器具 enum に `roofTank` を追加、base に `'roof'` を追加）。
- 既存機能を削除しない。入口の位置変更のみ。既存 `data-testid` は残す。
- 表示文言は「現場」→「工事」。専門用語には一言説明を添える。
- スマホ幅（390px）で道具バー・ヘッダーが横にはみ出さない。
- 内部単位 mm。2D/3D は共通ストアのみ読み書き。

## Review Focus
1. 既存の工事（壁・配管あり）を開いた時、ガイドが正しい工程（⑤以降）を指す — Task 2 の単体テストで pin。
2. サンプルを2回作っても別の工事になり、元のサンプルを壊さない — Task 3 の単体テストで pin。
3. 建物サブ行を開いたままツールを切り替えてもサブ行が残って図面を隠さない — Task 4 の E2E で pin。
4. スマホで「戻す」「やり直し」が常に画面内 — Task 6 の E2E（boundingBox が viewport 内）で pin。
5. 古いデータ（器具に roofTank が無い）がそのまま読める — Task 1 の単体テスト（既存 fixture の parse）で pin。

---

### Task 1: 屋上タンク・器具の見出し
**Files:** Modify `src/model/fixtures.ts`, `src/model/schema.ts:69`, `src/ui/Panels.tsx`(FixturePicker); Test `src/model/fixtures.test.ts`
**Interfaces:** Produces `FixtureType` に `'roofTank'`、`FixtureDef.base: number | 'ceiling' | 'roof'`、`FIXTURE_GROUPS: { label: string; types: FixtureType[] }[]`
- [ ] テスト: `roofTank` を2階建ての最上階に置くと、入口 z = 屋上面 + 1100、出口 z = 屋上面 + 100、どちらも給水。`FIXTURE_GROUPS` が `FIXTURE_TYPES` を過不足なく含む。旧 enum のデータが `projectSchema` を通る。
- [ ] 実装: `roofTank: { label: '屋上タンク（高置水槽）', size: { w: 1500, d: 1000, h: 1200 }, base: 'roof', ports: [P('in','water',20,-600,0,1100,'入口','threadSocket'), P('out','water',25,600,0,100,'出口','threadSocket')] }`。`'roof'` は `floor.elevation + floor.height`。グループ: 水まわり／水栓／メーター・タンク・ポンプ／給湯・設備／電気。
- [ ] `npx vitest run src/model` 合格 → commit

### Task 2: 作業手順ガイドの判定
**Files:** Create `src/model/guide.ts`, `src/model/guide.test.ts`
**Interfaces:** Produces
```ts
export type GuideStepId = 'info'|'drawing'|'layout'|'fixtures'|'pipes'|'lengths'|'quantities'|'quote';
export type GuideStep = { id: GuideStepId; no: number; title: string; hint: string; optional: boolean; done: boolean; progress?: string };
export function guideSteps(doc: Doc): GuideStep[];
export function currentStep(steps: GuideStep[]): GuideStep; // 最初の未完了の必須工程。全部済みなら 'quote'
```
- [ ] テスト: 空 doc → current=`layout`（info 済み、drawing は任意で未完了でも飛ばす）。壁あり → `fixtures`。器具あり → `pipes`。区間あり → `quantities`、lengths.progress = `実測 0/2区間`。
- [ ] 実装（done: info=常に true、drawing=下敷きあり、layout=壁あり、fixtures=器具あり、pipes=区間あり、lengths=全区間に実測、quantities/quote=区間あり）
- [ ] テスト合格 → commit

### Task 3: ホーム・サンプル・使い方・新規作成
**Files:** Create `src/sample/sample.ts`, `src/sample/sample.test.ts`, `src/ui/HelpDialog.tsx`; Modify `src/ui/HomeScreen.tsx`, `src/ui/NewProjectDialog.tsx`, `src/App.tsx`, `src/App.css`
**Interfaces:** Consumes store actions (`newDoc`, `setActiveFloor`, `setFixtureType`, `placeFixtureAt`, `setDrawAttrs`, `drawPolyline`, `branch`)。Produces `buildSample(): void`（現在のストアにサンプルを作り、履歴を空にする）、`NewProjectInput.mode` に `'photo'` を追加、`HelpDialog({ onClose })`
- [ ] テスト: `buildSample()` 後、壁>0、器具に waterMeter・roofTank・toilet・washbasin・kitchen、区間>0、分岐（次数3のノード）≥1、`validateNetwork` エラーなし、`computeEstimate` の配管総延長>0、`past` が空。
- [ ] 実装: 2階建て 9100×7280。1階: メーター（屋外）・トイレ・洗面台・キッチン、2階（最上階）: 屋上タンク。メーター出口→屋上タンク入口（立て管）、タンク出口→1階へ下りて本管、本管から各器具へ分岐。
- [ ] Home: 説明1行＋入口カード4つ（`new-project`／`open-sample`／`open-help`／バックアップ読込）。一覧見出し「保存済みの工事」。
- [ ] NewProjectDialog: 作り方カード（なぞる＝おすすめ／寸法／図面・写真 `np-mode-photo`）＋「白紙から（上級者向け）」リンク。photo は sketch と同じ空の階を作り tool=`underlay`。
- [ ] HelpDialog: 8工程の説明＋基本操作（拡大縮小・取り消し）＋用語集（口径・系統・立て管・立面図・継手・実測長）。
- [ ] `npx tsc -b && npx vitest run` 合格 → commit

### Task 4: 作業画面（ガイドバー・道具バー・ヘッダー・案内）
**Files:** Create `src/ui/GuideBar.tsx`; Modify `src/ui/Editor.tsx`, `src/ui/Panels.tsx`(Toolbar, FloorBar, TOOL_HELP), `src/ui/PlanView.tsx`(上部の説明行→案内カード・空の時の案内), `src/ui/prefs.ts`, `src/App.css`
**Interfaces:** Consumes `guideSteps`/`currentStep`。Produces `usePrefs().guideHidden/setGuideHidden`、`GuideBar({ onOpenEstimate(tab?) })`、`EstimateScreen({ onClose, initialTab? })`
- [ ] GuideBar: `data-testid="guide-bar"`、現在工程 `guide-current`、実行ボタン `guide-do`、一覧 `guide-list` の各行 `guide-step-<id>`、隠す `guide-hide`、再表示はヘッダーの「？手順」`guide-show`。`guide-do` の動作: drawing→tool underlay、layout→壁なし: outline／あり: wall、fixtures→fixture、pipes→pipe、lengths→select＋お知らせ「配管をタップして『実測長』を入力」、quantities→積算 qty、quote→積算 quote。
- [ ] Toolbar: 選択／建物▾（`tool-building`）／器具／配管／戻す／やり直し。建物サブ行 `building-tools` に外形・壁・部屋・ドア・窓・下敷き（既存 testid）。サブ行の道具を押したら閉じる。
- [ ] ヘッダー: nowrap、スマホは保存状態を点＋短い文字、「？」でヘルプ。
- [ ] FloorBar: スマホは「階の設定⚙」`floor-settings` を押した時だけ階高・削除を表示。
- [ ] PlanView: 説明を左上カード `plan-coach`（折り返し）。壁0・器具0・区間0なら中央に `plan-empty`（外形を描く／図面を取り込む）。
- [ ] commit

### Task 5: 配管設定・選択表示・表示プリセット・積算の説明
**Files:** Modify `src/ui/Panels.tsx`, `src/ui/EstimateScreen.tsx`, `src/state/store.ts`（`setVisibilityPreset`）, `src/App.css`; Test `src/state/store.test.ts`
**Interfaces:** Produces `setVisibilityPreset(p: 'all'|'building'|'pipes'|'fixtures'): void`
- [ ] テスト: `pipes` → pipes=show、fixtures=ghost、壁・床など=ghost、天井=hide。`all` → 天井以外 show。
- [ ] 配管: 種類ボタン `sys-<id>`（給水・給湯・排水・汚水・通気 + その他 select）＋描き方3行。
- [ ] 選択帯 `sel-bar`（選択中: 種類と名前、`sel-clear`）。配管区間に `jump-measure`（実測欄へスクロール＋フォーカス）。
- [ ] 表示: プリセット `vis-preset-<id>`、詳細は `<details>`（PC）。
- [ ] 積算: タブごとの1行説明 `tab-help`。
- [ ] `npx vitest run` 合格 → commit

### Task 6: E2E（既存の修正＋初心者シナリオ）
**Files:** Modify `e2e/helpers.ts`（`useTool(page, id)`：建物系はサブ行を開いてから押す）、既存 spec の `tool-outline|wall|room|door|window|underlay` 直押しを `useTool` に置換；Create `e2e/beginner.spec.ts`
- [ ] beginner.spec（3端末）: T1 新規作成→ガイドが「間取り」 / T2 写真モード→下敷きパネル（PNG 読込） / T3 外形をなぞる→壁 / T4 メーター / T5 屋上タンク・器具 / T6 メーター→タンク→器具を配管（接続口から描画、ノード接続を検証） / T7 分岐・削除・Undo / T8 実測長 / T9 積算の数量（手計算と一致） / T10 3D 表示 / T11 再読込で保持 / T12 スマホで戻す・やり直しが画面内・ガイドのボタンで工程移動 / T13 削除→戻す。サンプル工事を開いて積算が出る。改善後の画面を `test-evidence/ux-after-*.png`。
- [ ] `npx playwright test` 全件合格 → commit

### Task 7: 監査・記録
- [ ] 独立レビュー（別エージェント、Sonnet）→ 指摘修正 → 再テスト
- [ ] `docs/progress/PROGRESS.md` に記録、commit、`git bundle` を作成
