# 道路の手続き書類 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 本管からの取出しに要る道路の手続きのチェックリスト・期限の目安と、道路の申請書類一式 PDF を作る。

**Architecture:** 入力は `doc.site.application` の `road.*` キー（文字列）。純関数で数量・チェックリストを出し、各書類を `Sheet`（用紙 mm の描画命令）で描いて既存の `sheetsToPdf` で 1 つの PDF にする。画面は「申請書」タブに欄を足す。

**Tech Stack:** React + TypeScript, Vitest, Playwright, pdf-lib（既存）

**Spec:** `docs/superpowers/specs/2026-11-16-road-permit-design.md`

## Global Constraints
- 内部単位は mm（入力欄は m で見せてよいが、計算は mm）
- 文字は `fitText`・`spread1D` 等で置き、全シートを `noOverlap.test.ts` に加えて重なり 0
- 調べていない値（窓口名・期間・手数料）は「目安」「要確認」と書く
- 既存の沖縄市の給水 Excel・下水 PDF の出力を変えない
- スキーマ（`schema.ts`）は変えない

## Review Focus
- 何も入力していない状態で PDF を押す → 空欄のまま全書類が出る（落ちない）。テスト: Task 3/4 で空の値で描く
- 給水も下水も「しない」→ チェックリストは「道路を掘らないので不要」だけ、PDF ボタンは押せない。テスト: Task 2
- 私道 → 占用・使用許可ではなく「所有者の承諾」。テスト: Task 2
- 数値欄に「1.5m」「１．５」など → 全角・単位付きでも数として読む。テスト: Task 1 `num()`
- 長い路線名・住所 → 欄からはみ出さない（fitText）。テスト: Task 3/4 の重なり・はみ出し

---

### Task 1: 項目定義と既定値

**Files:** Create `src/road/fields.ts`, Test `src/road/road.test.ts`

**Interfaces — Produces:**
- `ROAD_FIELDS: FormField[]`（id は `road.` 始まり。group = 質問のまとまり: 道路 / 給水の取出し / 下水の取付管 / 掘る・戻す / 交通 / 日程 / 提出先・申請者）
- `type RoadOffices = Record<string, { roadAdmin?: string; police?: string }>`、`ROAD_OFFICES_KEY = 'roadOffices'`
- `roadDefaults(doc: Doc, meta: { name: string; address?: string }, c: Contractor, offices: RoadOffices): ApplicationValues`
- `roadValues(doc, meta, c, offices): ApplicationValues` = 既定値に `doc.site.application` の `road.*` を重ねる
- `num(s: string | undefined): number | undefined`（全角・m/mm 単位なしの数。m 単位の入力を返す）

- [ ] 失敗するテスト: `num('１．５')===1.5`, `num('1.5m')===1.5`, `num('')===undefined`; メーター入口の管 20mm の doc で `roadDefaults(...)['road.waterPipeDia']==='20'`; 住所「与那原町字…」で offices `{与那原町:{roadAdmin:'与那原町長',police:'与那原警察署長'}}` → `road.roadAdmin==='与那原町長'`; `road.applicantName` = 工事店名; 入力済み `road.roadAdmin:''` は既定値で上書きされない
- [ ] 実装。既定: 給水する=する、下水=公共汚水マスがあればする、掘削幅 0.6、余裕 0、取付管 150、作業時間 9:00〜17:00、規制=片側交互通行、誘導員 2、各作業日数 準備1・掘削1・分岐1・埋戻し1・仮復旧1・本復旧1、現場責任者=主任技術者
- [ ] テスト通過 → commit

### Task 2: 数量・チェックリスト・注意

**Files:** Create `src/road/model.ts`, Test `src/road/road.test.ts`

**Interfaces — Produces:**
- `type Takeoff = { kind: 'water' | 'sewer'; label: string; pipe: string; dia: number; length: number; width: number; depth: number; digArea: number; restoreArea: number }`（mm・mm²）
- `roadTakeoffs(v: ApplicationValues): Takeoff[]`
- `type CheckItem = { label: string; to: string; app: boolean; due?: string; late?: boolean; note?: string }`
- `roadChecklist(v: ApplicationValues, today: string): CheckItem[]`（due は YYYY-MM-DD。目安日数 占用 21・使用 7・着手届 3）
- `roadWarnings(v: ApplicationValues): string[]`
- `pavementLayers(kind: string, phase: 'temp' | 'final'): { name: string; t: number }[]`（既定の層。`road.layersTemp`/`road.layersFinal` の「名前 厚さ」改行区切りで上書き）

- [ ] 失敗するテスト: 本管位置 3.0m・幅 0.6m → length 3000, digArea 1.8e6; 余裕 0.1 → restoreArea (3200×800); 両方しない → checklist は 1 件「道路を掘らない…」; 私道 → 「所有者の承諾書」があり占用は無い; 側溝を壊す=はい → 「道路工事施行承認」あり; 着工 2026-12-01・today 2026-11-16 → 占用の due 2026-11-10 で late=true; 本管位置 > 幅員 で警告
- [ ] 実装 → 通過 → commit

### Task 3: 申請書・届・内訳調書のシート

**Files:** Create `src/road/formSheets.ts`, Modify `src/export/noOverlap.test.ts`, Test `src/road/road.test.ts`

**Interfaces — Produces:** `type RoadMeta = { siteName: string; address: string; date: Date }`、`renderOccupancyForm(v, takeoffs, m): Sheet`、`renderUseForm(v, m): Sheet`、`renderNoticeForms(v, m): Sheet[]`（着手届・完了届）、`renderTakeoffTable(takeoffs, v, m): Sheet`。全部 A4 縦 210×297。

- [ ] テスト: 各シートに見出し（「道路占用許可申請書」「道路使用許可申請書」「工事着手届」「工事完了届」「占用内訳調書」）がある; 値の文字（路線名など）が入る; 空の値でも落ちない; noOverlap に全シートを入れて重なり 0
- [ ] 実装（枠つき表。欄の文字は fitText）→ 通過 → commit

### Task 4: 図面のシート（平面・断面・交通規制・工程）

**Files:** Create `src/road/drawSheets.ts`, Modify `src/export/noOverlap.test.ts`, Test `src/road/road.test.ts`

**Interfaces — Produces:** `renderRoadPlan(v, takeoffs, m): Sheet`、`renderRoadSection(v, takeoffs, m): Sheet`、`renderTrafficPlan(v, m): Sheet`（規制方法 3 種で絵が変わる）、`renderSchedule(v, m): Sheet`、`roadSheets(v, m): Sheet[]` = 1〜9 の順（位置図は呼ぶ側で挿入）。A4 横 297×210。

- [ ] テスト: 平面図に寸法の文字（「3.00」等）と面積表; 断面図に層の名前; 交通規制図は 3 種で `誘導員` の数が人数どおり・通行止めは「通行止」; 工程表は着工日から各作業の棒; 規制 3 種 × 給水/下水の有無で重なり 0
- [ ] 実装 → 通過 → commit

### Task 5: 画面と PDF 出力

**Files:** Create `src/ui/RoadPermitPanel.tsx`, Modify `src/ui/ShinseiForms.tsx`（様式が無い自治体でもパネルを出す）, `src/App.css`（必要なら）, Test `e2e/roadpermit.spec.ts`

- [ ] パネル: チェックリスト（期限・遅れは赤）→ 注意 → 質問グループ → 「道路の申請書類一式 (PDF)」。PDF は `roadSheets` に見取図（`buildLocationSheet`、取れたら 3 番目に）を入れて `sheetsToPdf`。出したとき提出先を `roadOffices[city]` に保存
- [ ] e2e: 申請書タブ → 道路の手続き → 路線名入力 → PDF ダウンロードされる（ファイル名 `_道路の申請書類.pdf`）; 両方しない → ボタン無効
- [ ] `npm run lint && npx tsc -b && npm test && npx playwright test e2e/roadpermit.spec.ts e2e/shinsei.spec.ts` 通過 → commit

### Task 6: 記録
- [ ] `docs/progress/log/2026-11-16-feat-road-permit.md`、`test-evidence/` に PDF の画像と結果 → commit
