# 2026-11-16 feat/office-oneclick — 事務作業のクリック削減

ユーザー指示: 事務作業をする人の観点で、クリック数・作業を極限までシンプルに。既存の機能は壊さない・なくさない。

## 点検で見つけた手間
- 申請図面 7 種類（縦断図・立面図・水理計算書・スリーブ表・ます表・材料表・見取図）を全部出すには「タブ → PDF」を 7 回（14 クリック以上・7 ファイル）。どれが作れる状態かはタブを 1 つずつ開かないと分からない
- 申請書タブの提出書類チェックリストは、付けたチェックが画面を閉じると消えていた

## 作ったもの
- 申請図面の上に「📦 まとめてPDF」: 図面ごとに「✓ 作れます／⚠ 注意 n 件／作れません（理由）」の一覧。作れるものは最初からチェック済みで、「🖨 PDF にする」の 1 押しで 1 つの PDF（`<工事名>_申請図面一式_<日付>.pdf`、竣工図なら `竣工申請図面一式`）。「見る ›」でそのタブへ。スマホでも出力ボタンは下に固定
  - 中身は各タブの PDF と同じ作図（作図を `src/ui/shinseiBuild.ts` の純粋関数に切り出し、タブとまとめ出力で共通に使う）
  - 地図が取れず枠だけの見取図は最初はチェックしない。出力に失敗したら一覧の中に理由
- 提出書類チェックリストのチェックを工事に保存（`doc.site.application` の `checklist:<項目名>`、外すとキーごと消す。スキーマ変更なし）。「n/m 済み」を表示
- 個別の PDF / DXF / SVG / Excel、申請書・道路の書類はそのまま

## ファイル
`src/ui/{shinseiBuild.ts,ShinseiBundleDialog.tsx,ShinseiScreen.tsx,ShinseiForms.tsx}`、`src/App.css`、`src/ui/{shinseiBundle,shinseiForms}.test.tsx`、`e2e/shinsei.spec.ts`、`docs/superpowers/{specs,plans}/2026-11-16-office-oneclick*`

## 独立監査（別エージェント・sonnet）
- リファクタは逐語で挙動同一と確認
- Important 1 件を修正（RED→GREEN）: まとめPDF の失敗が背面に出て見えない
- Minor を修正: 枠だけの見取図を黙って入れない／竣工の印が入る図面の注記／残ったコメント
- 後回し（小）: 一覧を開くと 7 種類を同期で作る（大きな現場で重ければ遅延計算に）、チェックリストのキーは項目名（文言を変えると外れる）

## テスト
- 単体: 全件（下の記録）。E2E: e2e/shinsei.spec.ts「まとめてPDF」（PC・iPhone・Android エミュ）
- 証拠: test-evidence/*-shinsei-bundle-01-dialog.png
