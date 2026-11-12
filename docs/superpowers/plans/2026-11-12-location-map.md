# 付近見取り図 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans.

**Goal:** 住所から見取図（案内図）を作り、申請画面と下水道様式 4 面に出す。
**Architecture:** 純粋なタイル計算と Sheet 作図、ブラウザだけのタイル取得を分ける。設定は site.application の mitori.*。
**Tech Stack:** TypeScript, React, pdf-lib, Vitest, Playwright
**Spec:** docs/superpowers/specs/2026-11-12-location-map-design.md

## Global Constraints
- スキーマ・排水系ファイル（network/schema/municipality/slope/drainRoute/underfloorSlope/profileDrawing/profileSheet、store の commit）に触れない。
- 出典「国土地理院の地理院タイル（標準地図）を加工して作成」を図に入れる。送信先の説明を画面に出す。
- 文字は LabelPlacer。noOverlap に加え重なり 0。PDF の文字は JIS フォント（en dash 不可）。

## Review Focus
1. 地図タイルが一部・全部取れない（オフライン）→ 灰色＋注意、全部なら枠だけの見取図。
2. 緯度経度が未設定 → 申請書 4 面は空欄＋理由、画面は住所入力を促す。
3. 高緯度・日付変更線ではなく、沖縄（北緯 26 度）〜北海道で目盛りの長さが正しい。
4. iPhone 幅で操作欄が地図を隠さない。タップ位置→緯度経度がズーム（表示倍率）に依らない。
5. 住所や現場名が長い → はみ出さない（重なり 0 テスト）。

### Task 1: タイル計算と設定（src/model/locationMap.ts）
- `mapTiles(center, z, wPx, hPx) → { tiles: {x,y,url,dx,dy}[]; mpp }`（中心が画像中央。dx,dy は画像左上からのタイル左上）
- `offsetLatLon(center, z, dxPx, dyPx) → LatLon`（画像中央からの画素ずれ → 緯度経度。worldPx の逆）
- `scaleBarMeters(metersPerMm, maxMm) → number`（1,2,5×10^n で maxMm 以下の最大）
- `readMapSettings(app) / writeMapSettings(app, patch)`（mitori.*、不正値は無視、zoom は 16/17/18）
- テスト: 往復（offsetLatLon(c, z, 0,0) = c、worldPx 差 = 画素）、タイルが画像を覆う、目盛り、設定の往復。

### Task 2: Sheet の image 命令（src/export/sheet.ts）
- `{ t: 'image'; x; y; w; h; href }`。SVG `<image>`（href は data:image/(png|jpeg) のみ許可）。PDF: `sheetsToPdf` と新しい `embedSheetImages(pdf, sheets)` → `PdfOpts.images` で `drawSheetOnPage` が描く。
- テスト: SVG に image が出る・不正 href は出ない、PDF に XObject 画像が入る。

### Task 3: 見取図の作図（src/export/locationSheet.ts）
- `renderLocationSheet({ map: {href,wPx,hPx,mpp}|null, siteName, address, title?, date, missing? }) → Sheet`（A4 縦）
- 表題・工事名・工事場所、地図枠、画像、中心の印＋「工事場所」札（白下地）、方位記号「N」、目盛り、出典。地図なしは枠＋案内文。
- テスト: 印が枠の中心、出典がある、目盛り長さ＝ scaleBarMeters の値、地図なしの文言。noOverlap に長い住所で追加。

### Task 4: 取得（src/import/locationMap.ts）と画面
- `fetchLocationMap(center, zoom)`（キャッシュ。取れない区画は灰色、全部ダメなら例外）。
- ShinseiScreen 種類「見取図」、LocationPanel（住所欄＝申請の工事場所 or 現場住所、検索、候補、縮尺、送信説明、タップで中心移動）。
- ShinseiForms 下水道: 場所があれば 4 面に貼る、なければ注意。okinawaCity 添付「見取図」を app:true。
- E2E（route で GSI をモック）: 住所検索 → プレビューに image → PDF 出力、タップで中心が動く、申請書 PDF 出力で注意なし。
