# ⑦ DXF の出力・取込 設計

ロードマップ ⑦（Tfas の DWG/DXF 入出力）。

## 出力
- 申請画面の図面（縦断図・立面図・水理計算書・スリーブ表・材料表・見取図）を DXF に書き出す。設計事務所・元請けの CAD（AutoCAD・Jw_cad）で開ける
- 形式は R12（AC1009）、文字は Shift_JIS（$DWGCODEPAGE ANSI_932）。Jw_cad が読める形。単位は用紙の mm（y は上向きに直す）。複数ページは横に並べる
- 線・四角・折れ線は LINE / POLYLINE、円は CIRCLE、文字は TEXT（中央・右揃えは 72/11/21）。色は近い ACI（赤 1・青 5・灰 8・黒 7）。画像（見取図の地図）は DXF に入れられないので枠だけ（知らせる）

## 取込
- DXF（R12〜R2018、Shift_JIS・UTF-8）を、Jw_cad 取込と同じ線画データ（CadDrawing）にして下敷きにする
- LINE・LWPOLYLINE（ふくらみの弧を含む）・POLYLINE/VERTEX・CIRCLE・ARC・ELLIPSE・SPLINE（制御点の折れ線）・TEXT・MTEXT（書式を除く）・INSERT（ブロックを展開、入れ子 8 まで）・DIMENSION（中のブロック）
- 単位は $INSUNITS（無ければ mm）。実寸（縮尺 1）で置く
- 端末の中だけで解析（送信しない）。線が多すぎる図面は断る（Jw_cad と同じ上限）

## 部品
- `src/import/sjis.ts`: Shift_JIS への符号化（TextDecoder('shift_jis') から逆引きの表を作る）
- `src/export/dxf.ts`: `sheetsToDxf(sheets) → Uint8Array`
- `src/import/dxf.ts`: `parseDxf(bytes) → CadDrawing`
