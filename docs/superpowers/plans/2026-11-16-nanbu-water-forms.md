# 南部水道企業団の給水申請一式 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 南風原町・八重瀬町の給水申請（南部水道企業団）の書類一式を実物と同じ並びで出せるようにし、実物から分かった HT 不可・製品一覧表の中身・確認申請書の写しの手間を直す。

**Architecture:** 様式は道路の書類と同じく Sheet（用紙 mm の描画命令）で描き起こし、`sheetsToPdf` で 1 つの PDF にする。入力は `doc.site.application` の文字列、端末の覚えは `repo.setSetting`。確認申請書の読み込みは pdf.js の文字を行にまとめてから純粋関数で読む。

**Tech Stack:** React 19 / TypeScript / zustand / pdf-lib / pdfjs-dist / Vitest / Playwright

**Spec:** `docs/superpowers/specs/2026-11-16-nanbu-water-forms-design.md`

## Global Constraints

- 個人情報: 実物は `bench-data/` だけ。テスト・証拠は作り物の名前
- 新しい全シート: 文字の重なり 0（`findTextOverlaps`）・はみ出し 0（用紙の端 5mm 以内に文字を出さない）、A4 縦 210×297
- 沖縄市の様式（Excel・下水道 PDF・管と継手の一覧表）と道路の書類の出力は変えない
- スキーマ変更なし。入力済みの値（キーがあれば空でも）は既定値・読み込みで上書きしない
- 図面の文字は `label`/`wrap`/`table`（`src/road/draw.ts`）で置き、欄の幅で縮める・折り返す

## Review Focus

- 確認申請書の PDF がスキャン（文字なし）・別の書類・2 回目の読み込み → 何も壊さず「読めた項目なし」を知らせる（Task 3 にテスト）
- 名前・住所がとても長い → 欄の中で縮む／折り返す、重なり・はみ出し 0（Task 4 にテスト）
- 器具が 0 個・ヘッダーが無い現場の製品一覧表 → 空の表 1 枚（Task 5 にテスト）
- 既存の工事で給湯の屋外が HTVP のまま／材質空欄 → 要確認に出るが、ガス給湯器が無ければ出ない（Task 1 にテスト）
- 臨時給水「無し」 → 誓約書のページを入れない（Task 4 にテスト）

---

### Task 1: HT の不可（自動の屋外給湯を PB、残った HT を要確認に）

**Files:** Modify `src/model/materials.ts`, `src/model/estimate.ts`, `src/ui/EstimateScreen.tsx`（新しい kind の表示）, `src/state/store.ts`（コメント）. Test: `src/model/materials.test.ts`, `src/model/htGasHeater.test.ts`

**Interfaces:** Produces `htWithGasHeater(doc: Doc): string[]`（`src/model/materials.ts`。給湯の区間で、材質が HTVP、または材質が空欄で建物の外周の外にある区間の id。給湯器が無ければ []）. `Issue.kind` に `'material'` を足す。

- [ ] 失敗するテスト: `AUTO_MATERIAL.outdoor.hotWater === 'PB保温10mm'`; 外周をまたぐ給湯の自動区間は内外とも PB。`htWithGasHeater` は給湯器＋HTVP の給湯区間を返し、給湯器が無ければ []・HIVP の給水は返さない。`computeEstimate(doc).issues` に kind `'material'` の「ガス給湯器があるのに給湯管が HT（耐熱塩ビ）です…」が区間ごとに出る
- [ ] 実装 → テスト合格 → 既存の materials/compare/consumables のテストで HTVP を前提にした所を直す → コミット

### Task 2: プロファイル（南風原町の給水図面を実例に、八重瀬町を追加）

**Files:** Modify `src/model/municipality.ts`. Test: `src/model/municipality.test.ts`

- [ ] 失敗するテスト: `profileForAddress('沖縄県島尻郡八重瀬町字東風平1', BUILTIN_PROFILES).profile?.id === 'yaese'`; haebaru と yaese は `paper` A4 縦・`headerFields` 受付番号/水道番号/縮尺・`titleBlockFields` 申請地/申請者/指定工事店・`riser.lineStyle` isometric、`source.title` に「南部水道企業団」
- [ ] 実装（共通の `NANBU_WATER` を両方に）→ 合格 → noOverlap（全プロファイル）が通ること → コミット

### Task 3: 確認申請書・確認済証の読み込み

**Files:** Create `src/forms/kakunin.ts`（読む）, `src/import/pdfText.ts`（pdf.js → 行）. Test: `src/forms/kakunin.test.ts`

**Interfaces:**
- `pdfTextLines(data: ArrayBuffer): Promise<string[]>`（ページ順、行は y で束ね x で並べ、項目間は空白 2 つ）
- `type KakuninInfo = { ownerName?; ownerKana?; ownerZip?; ownerAddress?; ownerTel?; siteAddress?; confirmNo?; confirmDate?: string /* YYYY-MM-DD */; totalArea?; floorsAbove?; floorsBelow?; structure?; use?; workKind?; roadWidth?; workStart?; workEnd?; designer? }`（すべて string）
- `parseKakunin(lines: string[]): KakuninInfo`
- `applyKakunin(info: KakuninInfo, fields: string[], current: ApplicationValues, map: Partial<Record<keyof KakuninInfo, string>>): { values: ApplicationValues; filled: string[] }`（current にキーがある項目は入れない）
- 各 FormSet に `kakunin?: Partial<Record<keyof KakuninInfo, string>>`（情報 → 項目 id）。道路は `roadWidth → road.roadWidth` を共通で

- [ ] 失敗するテスト（作り物の名前で、pdftotext の行と同じ形の固定データ 2 種: 確認申請書の 第二面・第三面・第四面、確認済証）: 氏名・フリガナ（半角ｶﾅ → 全角）・〒・住所・電話・地名地番・延べ面積 `88.20`・地上 `2`・地下 `0`・構造 `木造`（「木造(軸組工法)」から）・用途 `一戸建ての住宅`・幅員 `4.500`・着手/完了 `2026-12-01`/`2027-02-20`・確認番号 `ABC-26-00000-1`・確認日 `2026-09-30`（令和 8 年）。空の行・関係ない書類 → `{}`。2 回目の applyKakunin は入力済みを上書きしない
- [ ] 実装 → 合格 → 実物（bench-data）を pdf.js で読んで同じ値になることを手元で確認（コミットしない）→ コミット

### Task 4: 南部水道企業団の様式セットと PDF 一式

**Files:** Create `src/forms/nanbu.ts`（項目・既定値・チェック表・穿孔時の自動判定）, `src/forms/nanbuSheets.ts`（シート）. Modify `src/forms/formSets.ts`（haebaru・yaese → NANBU_FORMS）, `src/forms/types.ts`（`FormSet.kakunin?`、`FormSet.output?: 'okinawa' | 'nanbu'`）. Test: `src/forms/nanbu.test.ts`, `src/export/noOverlap.test.ts`

**Interfaces:**
- `NANBU_FORMS: FormSet`（profileId 'haebaru'）、`FORM_SETS.yaese = { ...NANBU_FORMS, profileId: 'yaese' }`
- `drillChecks(doc: Doc, v: ApplicationValues): { label: string; status: 'ok' | 'warn' | 'manual'; note?: string }[]`（実物の 10 項目の順）
- `nanbuSheets(v: ApplicationValues, c: Contractor, o: { siteName: string; date: Date; map?: Sheet; roadSection?: Sheet; products: Sheet[] }): Sheet[]`（順: チェック表 2 枚 → 申込書 → 誓約書（`v.supplyKind` が臨時給水を含む／`v.tempSupply==='有り'` のときだけ）→ 様式第6号 → 横断面図・オフセット → 竣工検査項目 → products）

- [ ] 失敗するテスト: 既定値（メーター口径・階数・公共ます→公共下水道・設置場所は住所から町名を除いた字以下）；チェック表は 14 項目；drillChecks — HT＋給湯器で ⚠、PB なら ✓、`road.roadKind` 県道で引込管 HIVP なら ⚠（PE）、私道で ⚠、日付ありで ✓、水圧の設定 0.2 以外で ⚠；`nanbuSheets` の枚数（臨時あり 8＋一覧、無し 7＋一覧）、見出しの文字（給水申込書・委任状・給水装置工事申請書及び設計書・横断面図・オフセット・竣工検査項目・給水装置工事申請書類チェック表・穿孔時書類確認）、値が入る（氏名・確認番号・延べ面積）、長い名前と住所でも全シート重なり 0・はみ出し 0、入力なしでも描ける
- [ ] 実装 → 合格 → noOverlap に追加 → コミット

### Task 5: 製品一覧表を器具から（南部の様式）

**Files:** Create `src/forms/fixtureProducts.ts`. Test: `src/forms/fixtureProducts.test.ts`

**Interfaces:**
- `type FixtureProduct = { key: string; name: string; qty: string; maker: string; cert: Cert }`、`type Cert = 'jwwa' | 'self' | 'jis' | ''`
- `fixtureProducts(doc: Doc, v: ApplicationValues, memory: ProductMemory): FixtureProduct[]`（ヘッダー → `PB管継手 ヘッダー{n}P`、n はつながった出口の数（無ければ出口の数）。給水・給湯の口を持つ器具を種類ごとに数える。名前と単位は実物どおり: トイレ=洋風大便器/台、洗面台=洗面化粧台/台、キッチン=流し用混合水栓/個、給湯器/台、シャワー・浴槽=シャワー水栓 混合水栓/個（どちらかあれば 1 行）、洗濯機=洗濯用水栓/個、立水栓・水栓=散水栓/個、混合水栓=混合水栓/個、メーター・ポンプ・タンクは出さない。認証の初期値: 器具=jwwa、ヘッダー・水栓類=jis。値の優先: `v['product.<key>.maker'|'.cert']` → memory → 初期値）
- `type ProductMemory = Record<string, { maker?: string; cert?: Cert }>`、`PRODUCT_MEMORY_KEY = 'productMakers'`
- `renderNanbuProductSheets(rows: FixtureProduct[], meta: { date: Date }, c: Contractor): Sheet[]`（A4 横、16 行で 1 枚。列: 番号・製品名・個数・延長・製品メーカー名・日水協検査合格品又は第三者認証品・自己認証品・JIS表示品・鉛新浸出性能基準適合・備考。選んだ認証の欄に ○、鉛は「ア・適合する」に ○）

- [ ] 失敗するテスト: トイレ 2・洗面台・キッチン・給湯器・シャワー・洗濯機・立水栓 2・ヘッダー の現場で行と個数（`洋風大便器 2台` など）、ヘッダーの口数、memory と入力の優先、器具 0 個でも 1 枚・重なり 0・はみ出し 0、17 行で 2 枚
- [ ] 実装 → 合格 → コミット

### Task 6: 画面（申請書タブ）

**Files:** Modify `src/ui/ShinseiForms.tsx`, `src/App.css`. Create `src/ui/KakuninImport.tsx`, `src/ui/ProductMakers.tsx`. Test: `src/ui/shinseiForms.test.tsx`, `e2e/nanbu.spec.ts`

- [ ] 南部のとき: ボタン「給水申請書一式 (PDF)」「製品一覧表 (PDF)」、穿孔時の確認（✓/⚠/□）、製品一覧表のメーカー・認証の表（変えたらこの端末に覚える）、チェック表のチェック（今までの保存方式）。全自治体: 「📄 確認申請書から入れる」（PDF を選ぶ → 入れた項目の一覧、スキャンなら「文字が入っていない PDF です」）
- [ ] 画面テスト（jsdom）: 南風原町のプロファイルでボタンと穿孔時の確認が出る、製品の表にトイレの行。E2E（PC・iPhone・Android エミュ）: 南風原町の工事を作り、申請書タブで一式の PDF を保存できる・確認申請書（作り物の PDF を pdf-lib で作る）を読み込むと氏名が入る。証拠 `test-evidence/*-nanbu-*.png`
- [ ] コミット

### Task 7: 仕上げ

- [ ] 単体全件・E2E 全体・build・lint
- [ ] 独立監査（別エージェント）→ 指摘を RED→GREEN で直す
- [ ] 記録 `docs/progress/log/2026-11-16-feat-nanbu-water-forms.md`、PR、`git merge origin/main`、mergeable 確認、マージ、Pages の公開確認
