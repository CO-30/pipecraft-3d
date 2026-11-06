# PipeCraft 3D

建物内の配管・配線を2D/3Dで描画・編集し、数量集計・見積まで行うPWA。

## 開発
```
npm install
npm run dev        # 開発サーバ（--host 付き。同一LANのスマホから確認可）
npm test           # 単体テスト (Vitest)
npm run test:e2e   # E2E (Playwright: PC / iPhone・Android エミュレーション)
npm run build
```

## 構成
- `src/model/` 配管ネットワーク（ノード＋区間、mm、共通3D座標）・幾何処理・スキーマ
- `src/state/` 共通ストア（Zustand、Undo/Redo）— 2D/3D の唯一のデータ源
- `src/storage/` 保存（IndexedDB/Dexie、差し替え可能なリポジトリ）
- `src/ui/` 2D平面図(SVG)・3D(React Three Fiber)
- `test-evidence/` テスト証拠（スクリーンショット・結果JSON）
- `docs/progress/` 各Phaseの記録
