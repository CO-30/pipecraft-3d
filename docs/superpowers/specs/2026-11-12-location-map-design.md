# ③ 付近見取り図（案内図）設計

ロードマップ: `2026-11-12-paid-cad-roadmap.md` の ③。有料CADの「住所から案内図を自動作成」に当たる。

## 目的
住所を入れる（または地図をタップする）だけで、申請に添付する「見取図（案内図）」を作り、
- 申請画面の新しい種類「見取図」で PDF / SVG に出せる
- 下水道排水設備計画確認申請書（沖縄市）の 4 面「見取図」に自動で貼られる
- 給水の添付書類一覧の「見取図」を「アプリで作れる」にする

様式 4 面の注記「方位、位置及び目標となる地物を表示し、工事施工の位置を明示すること」を満たす: 方位記号・工事場所の印・目印の載った地図（国土地理院 標準地図）・縮尺目盛り。

## 方針（決定）
- 地図は **国土地理院 地理院タイル（標準地図）** `https://cyberjapandata.gsi.go.jp/xyz/std/{z}/{x}/{y}.png`。無料・登録不要。出典「国土地理院の地理院タイル（標準地図）を加工して作成」を図に必ず入れる。住所検索は既存の `searchAddress`（国土地理院）を使う。Google 地図は規約上使わない。
- 場所と縮尺は `site.application` の `mitori.lat` `mitori.lon` `mitori.title` `mitori.zoom` に入れる（スキーマ変更なし。排水チャットと衝突しない）。
- 縮尺は 3 段: 広め z16 / 標準 z17（既定） / 詳しく z18。用紙は A4 縦（様式 4 面と同じ）。
- 工事場所の印は常に地図の中心。地図をタップするとそこが新しい中心になる（住所検索の誤差を現場で直せる）。
- 地図画像は描くときに取り込み、端末のメモリにだけ置く（現場データには入れない）。オフラインなら「地図を取得できません」と出し、枠だけの見取図（手描き用）を出せる。
- Sheet に `image` 命令を足す（SVG は `<image>`、PDF は埋め込み画像）。文字はすべて LabelPlacer で置き、地図の上の文字は白い下地を敷く。`noOverlap.test.ts` に見取図を加える。

## 単位
- `src/model/locationMap.ts`（純粋）: タイルの並べ方 `mapTiles`、画素→緯度経度 `offsetLatLon`、目盛りの長さ `scaleBarMeters`、設定の読み書き `readMapSettings` / `writeMapSettings`。
- `src/import/locationMap.ts`（ブラウザ）: `fetchLocationMap(center, zoom)` タイルを並べて JPEG の data URL にする（キャッシュ、取れなかった区画数）。
- `src/export/locationSheet.ts`（純粋）: `renderLocationSheet(input) → Sheet`。
- `src/export/sheet.ts`: `image` 命令、PDF への埋め込み。
- UI: `ShinseiScreen` の種類「見取図」と操作欄 `LocationPanel`。`ShinseiForms` の下水道 PDF 4 面。

## しないこと（YAGNI）
- 目印の自動書き込み（標準地図に既に載っている）、地図の回転、複数現場の印。
