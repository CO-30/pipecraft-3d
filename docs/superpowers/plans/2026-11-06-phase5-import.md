# Phase 5 図面読み込み・実用化 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 航空写真・建物外形・現場写真・画像/PDF 図面を取り込んで建物作成を速くし、縮尺設定・トレース・画像出力・一括バックアップ/復旧・バンドル分割で実用版にする。

**Architecture:** 下敷きは Doc の `underlays`（保存形式 v5）。画像は縮小した JPEG の data URL で現場データに含める（JSON バックアップにそのまま入る、Undo 対象）。下敷きの位置は 中心座標(mm)・縮尺(mm/px)・回転(度) の相似変換で、2D の SVG にだけ描く（3D には出さない）。地理計算・建物外形・射影変換は純粋関数（`src/model/geo.ts`, `src/model/homography.ts`, `src/model/underlay.ts`）でテスト。外部サービス（地理院・OSM）はブラウザから直接呼び、E2E はネットワークをモックする。

**Spec:** 設計書 第4章 4-1C・4-2、第10章（2D平面図・3D画像）、第11章、第13章 Phase 5。追加要望（PROGRESS「後続Phaseへの追加要望」）

## 決定事項

| 項目 | 決定 |
|---|---|
| 下敷きの保存 | Doc.underlays（v5）。長辺 2400px 以下に縮小した JPEG(品質0.85) の data URL。1枚 4MB(文字数) 上限。v1〜v4 は空で変換 |
| 位置・縮尺 | center(mm)・mmPerPx・rotation(度、反時計回り)・opacity・scaled(縮尺確定)。未確定は「縮尺未確定」と表示し、寸法は参考扱い |
| 縮尺設定 | 「2点で縮尺」: 下敷き上の2点をタップ → 実寸(mm) を入力 → mmPerPx を再計算（1点目を固定して拡縮） |
| 下敷きの移動 | 「下敷きを動かす」モードでドラッグ（履歴1件）。回転・透明度はスライダー |
| 航空写真 | 国土地理院 地理院タイル「全国最新写真（シームレス）」 zoom 18（約0.5m/px）、3×3 タイルを結合して中心 120m 四方を切り出し。出典「国土地理院」を図面に常時表示。住所検索は地理院の住所検索API。Google マップ・ストリートビューは規約上使わない |
| 建物外形 | OpenStreetMap（Overpass API）の building。検索地点を含む建物（なければ最も近い建物）を選び、候補が複数なら一覧から選択。軒の出補正（内側へオフセット mm、初期 0）。最長辺を図面の軸に合わせて回転（航空写真も同じ回転）。外壁として現在の階に追加（1操作）。出典「© OpenStreetMap contributors」 |
| 現場写真→窓・ドア | 外壁を選び「写真から窓・ドア」→ 写真の壁の四隅をタップ（左下・右下・右上・左上）→ 射影変換で正面画像に補正（壁長×階高）→ 四角をなぞって窓/ドアを作成。左右（壁の向き）は反転ボタンで合わせる。写真は保存しない |
| PDF 図面 | pdfjs-dist を動的 import。ページ選択 → 長辺 2400px で画像化して下敷きに |
| 画像出力 | 平面図（現在の階、SVG→PNG）・3D（キャンバス）を PNG 保存 |
| バックアップ | 全現場を1ファイル（`pipecraft-backup`）で書き出し・読み込み（常に新規追加）。本体が壊れて直前版から復旧した時は通知。起動時に永続保存を要求（navigator.storage.persist） |
| バンドル | 3D ビューを遅延読み込み、three を別チャンク |
