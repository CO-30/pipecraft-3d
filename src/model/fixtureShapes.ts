/**
 * 器具の見た目（平面の記号と 3D の形）。種類ごとに、外形の寸法（w・d・h）に合わせて伸び縮みする部品の組み合わせ。
 * ローカル座標(mm): x は右、y は奥（+y が壁の側。接続口の dy と同じ向き）、z は設置面から上。
 * 当たり判定・接続口・寸法には使わない（見た目だけ）。マスは別（地中の円・角）。
 */
import { FIXTURE_CATALOG, type FixtureType } from './fixtures';

/** 平面の塗り: body 本体、basin 水まわりのくぼみ、dark 濃い部分、metal 金物、none 線だけ */
export type Fill2D = 'body' | 'basin' | 'dark' | 'metal' | 'none';
export type Prim2D =
  | { k: 'rect'; x: number; y: number; w: number; h: number; r?: number; fill: Fill2D }
  | { k: 'ellipse'; cx: number; cy: number; rx: number; ry: number; fill: Fill2D }
  | { k: 'line'; x1: number; y1: number; x2: number; y2: number };

/** 3D の材質 */
export type Mat = 'ceramic' | 'counter' | 'cabinet' | 'metal' | 'dark' | 'plastic' | 'basin' | 'glass' | 'concrete';
export type Part3D =
  | { k: 'box'; x: number; y: number; z: number; w: number; d: number; h: number; mat: Mat }
  /** 円柱（ry があれば楕円柱）。axis は軸の向き（既定 z）。h は軸方向の長さ */
  | { k: 'cyl'; x: number; y: number; z: number; r: number; ry?: number; h: number; axis?: 'x' | 'y' | 'z'; mat: Mat }
  | { k: 'sphere'; x: number; y: number; z: number; r: number; mat: Mat };

// ---- 平面の部品 ----
const R = (x0: number, y0: number, x1: number, y1: number, fill: Fill2D = 'body', r?: number): Prim2D => ({ k: 'rect', x: Math.min(x0, x1), y: Math.min(y0, y1), w: Math.abs(x1 - x0), h: Math.abs(y1 - y0), fill, ...(r ? { r } : {}) });
const E = (cx: number, cy: number, rx: number, ry: number = rx, fill: Fill2D = 'body'): Prim2D => ({ k: 'ellipse', cx, cy, rx, ry, fill });
const L = (x1: number, y1: number, x2: number, y2: number): Prim2D => ({ k: 'line', x1, y1, x2, y2 });
// ---- 3D の部品 ----
const B = (x: number, y: number, z: number, w: number, d: number, h: number, mat: Mat): Part3D => ({ k: 'box', x, y, z, w, d, h, mat });
const C = (x: number, y: number, z: number, r: number, h: number, mat: Mat, axis: 'x' | 'y' | 'z' = 'z', ry?: number): Part3D => ({ k: 'cyl', x, y, z, r, h, mat, axis, ...(ry !== undefined ? { ry } : {}) });
const S = (x: number, y: number, z: number, r: number, mat: Mat): Part3D => ({ k: 'sphere', x, y, z, r, mat });

/** ヘッダーの出口の位置（カタログの接続口から） */
const outletXs = (t: FixtureType) => FIXTURE_CATALOG[t].ports.filter((p) => p.id.startsWith('out')).map((p) => p.dx);

const tankDepth = (d: number) => Math.min(200, d * 0.3);
const sinkOf = (w: number, d: number) => ({ x: Math.max(-w / 2 + Math.min(800, w * 0.3) / 2 + 40, -w * 0.15), w: Math.min(800, w * 0.3), d: d * 0.62, cy: -d * 0.05 });
const stoveX = (w: number) => Math.min(w / 2 - 340, w * 0.28);

/** 平面の記号（ローカル mm）。外形の四角の中に収まる */
export function planSymbol(t: FixtureType, w: number, d: number): Prim2D[] {
  const W = w / 2, D = d / 2;
  switch (t) {
    case 'toilet': {
      const td = tankDepth(d), cy = -td / 2, ry = (d - td) / 2 * 0.98;
      return [R(-w * 0.45, D - td, w * 0.45, D, 'body', 30), E(0, cy, w * 0.45, ry), E(0, cy - ry * 0.08, w * 0.28, ry * 0.62, 'basin')];
    }
    case 'washbasin':
      return [R(-W, -D, W, D, 'body', 20), E(0, -d * 0.05, w * 0.3, d * 0.3, 'basin'), E(0, D - 60, 25, 25, 'metal')];
    case 'kitchen': {
      const s = sinkOf(w, d), sx = stoveX(w);
      return [R(-W, -D, W, D, 'body', 10), R(s.x - s.w / 2, s.cy - s.d / 2, s.x + s.w / 2, s.cy + s.d / 2, 'basin', 30), E(s.x, D - 70, 25, 25, 'metal'),
        R(sx - 300, -D * 0.8, sx + 300, D * 0.8, 'none', 10), E(sx - 150, -d * 0.12, 80, 80, 'dark'), E(sx + 150, -d * 0.12, 80, 80, 'dark'), E(sx, d * 0.2, 60, 60, 'dark')];
    }
    case 'bathtub': {
      const t2 = Math.min(80, d * 0.12);
      return [R(-W, -D, W, D, 'body', 40), R(-W + t2, -D + t2, W - t2, D - t2, 'basin', Math.min(150, d * 0.2)), E(-W + t2 + 80, 0, 30, 30, 'metal')];
    }
    case 'shower':
      return [R(-W, -D, W, D, 'body', 20), R(-W + 50, -D + 50, W - 50, D - 50, 'basin', 40), E(0, 0, 40, 40, 'metal'), R(-160, D - 40, 160, D, 'metal', 10)];
    case 'washer':
      return [R(-W, -D, W, D, 'body', 40), E(0, -d * 0.05, w * 0.3, w * 0.3, 'basin'), R(-W + 30, D - 110, W - 30, D - 30, 'dark', 10)];
    case 'waterHeater':
      return [R(-W, -D, W, D, 'body', 20), R(-W + 30, -D, W - 30, -D + Math.min(40, d * 0.2), 'dark')];
    case 'waterMeter':
      return [R(-W, -D, W, D, 'body', 20), E(0, 0, Math.min(60, d * 0.3), Math.min(60, d * 0.3), 'basin')];
    case 'pump':
      return [R(-W, -D, W, D, 'body', 10), E(0, 0, w * 0.3, w * 0.3, 'metal')];
    case 'panel':
      return [R(-W, -D, W, D, 'body'), L(-W + 20, -D + Math.min(20, d * 0.2), W - 20, -D + Math.min(20, d * 0.2))];
    case 'outlet':
      return [R(-W, -D, W, D, 'body'), L(-W * 0.6, 0, W * 0.6, 0)];
    case 'light':
      return [E(0, 0, W, D), L(-W * 0.7, 0, W * 0.7, 0), L(0, -D * 0.7, 0, D * 0.7)];
    case 'aircon':
      return [R(-W, -D, W, D, 'body', 40), L(-W + 40, -D + 30, W - 40, -D + 30)];
    case 'faucet':
      return [R(-W, D - 20, W, D, 'metal'), R(-12, -D, 12, D - 20, 'metal', 6), E(0, d * 0.15, 22, 22, 'metal')];
    case 'mixFaucet':
      return [R(-W + 20, D - 60, W - 20, D - 20, 'metal', 10), R(-12, -D, 12, D - 60, 'metal', 6), E(-(W - 35), D - 40, 25, 20, 'metal'), E(W - 35, D - 40, 25, 20, 'metal')];
    case 'outdoorFaucet':
      return [R(-W * 0.6, -D * 0.3, W * 0.6, D * 0.9, 'body', 6), R(-8, -D, 8, -D * 0.3, 'metal'), E(0, D * 0.3, 15, 15, 'metal')];
    case 'roofTank':
      return [R(-W, -D, W, D, 'body'), L(-w / 6, -D, -w / 6, D), L(w / 6, -D, w / 6, D), E(w * 0.25, 0, Math.min(150, d * 0.15), Math.min(150, d * 0.15), 'dark')];
    case 'waterHeader':
    case 'hotWaterHeader': {
      const r = Math.min(18, d * 0.2);
      return [R(-W, -d * 0.25, W, d * 0.25, 'metal', 10), ...outletXs(t).map((x) => E(x, 0, r, r, 'body'))];
    }
    default:
      return [R(-W, -D, W, D, 'body'), L(-W, -D, W, D)];
  }
}

/** 3D の形（ローカル mm、z は設置面から）。平面は外形の中、設置面より下に出ない */
export function fixtureParts(t: FixtureType, w: number, d: number, h: number): Part3D[] {
  const W = w / 2, D = d / 2;
  switch (t) {
    case 'toilet': {
      const td = tankDepth(d), cy = -td / 2, ry = (d - td) / 2 * 0.98;
      return [
        C(0, cy + ry * 0.15, h * 0.2, w * 0.25, h * 0.4, 'ceramic', 'z', ry * 0.55), // 台座
        C(0, cy, h * 0.45, w * 0.45, h * 0.1, 'ceramic', 'z', ry), // 便器の縁
        C(0, cy, h * 0.505, w * 0.45, h * 0.01, 'plastic', 'z', ry), // 便座
        C(0, cy - ry * 0.08, h * 0.512, w * 0.27, h * 0.006, 'basin', 'z', ry * 0.6), // 水
        B(0, D - td / 2, (h * 0.4 + h - 24) / 2, w * 0.9, td - 6, h * 0.6 - 24, 'ceramic'), // タンク（便器の後ろに載る）
        B(0, D - td / 2, h - 12, w * 0.92, td, 24, 'plastic'), // タンクのふた（少し張り出す）
        B(0, D - td - 15, h * 0.45, w * 0.5, 36, h * 0.06, 'ceramic'), // 便器とタンクのつなぎ
      ];
    }
    case 'washbasin':
      return [
        B(0, 0, (h - 40) / 2, w, d, h - 40, 'cabinet'), B(0, 0, h - 20, w, d, 40, 'counter'),
        C(0, -d * 0.05, h + 1, w * 0.3, 2, 'basin', 'z', d * 0.3),
        C(0, D - 60, h + 120, 16, 240, 'metal'), C(0, D - 60 - 70, h + 225, 10, 140, 'metal', 'y'), S(0, D - 60, h + 250, 16, 'metal'),
      ];
    case 'kitchen': {
      const s = sinkOf(w, d), sx = stoveX(w);
      return [
        B(0, 0, (h - 40) / 2, w, d, h - 40, 'cabinet'), B(0, 0, h - 20, w, d, 40, 'counter'),
        B(s.x, s.cy, h + 1, s.w, s.d, 2, 'basin'),
        C(s.x, D - 70, h + 140, 18, 280, 'metal'), C(s.x, D - 70 - 90, h + 265, 12, 180, 'metal', 'y'),
        B(sx, 0, h + 4, 600, d * 0.8, 8, 'dark'),
        C(sx - 150, -d * 0.12, h + 11, 70, 6, 'metal'), C(sx + 150, -d * 0.12, h + 11, 70, 6, 'metal'), C(sx, d * 0.2, h + 11, 55, 6, 'metal'),
      ];
    }
    case 'bathtub': {
      const t2 = Math.min(80, d * 0.12);
      return [
        B(0, 0, 30, w - t2 * 2, d - t2 * 2, 60, 'ceramic'),
        B(0, -D + t2 / 2, h / 2, w, t2, h, 'ceramic'), B(0, D - t2 / 2, h / 2, w, t2, h, 'ceramic'),
        B(-W + t2 / 2, 0, h / 2, t2, d - t2 * 2, h, 'ceramic'), B(W - t2 / 2, 0, h / 2, t2, d - t2 * 2, h, 'ceramic'),
        C(-W + t2 + 80, 0, 61, 30, 2, 'metal'),
      ];
    }
    case 'shower':
      return [
        B(0, 0, h / 2, w, d, h, 'ceramic'), B(0, 0, h + 1, w - 100, d - 100, 2, 'basin'), C(0, 0, h + 3, 40, 2, 'metal'),
        C(0, D - 30, 1000, 22, 320, 'metal', 'x'), // 混合水栓
        C(w * 0.3, D - 30, 1500, 12, 1000, 'metal'), // スライドバー
        C(w * 0.3, D - 90, 2000, 60, 16, 'metal'), // ヘッド
      ];
    case 'washer':
      return [
        B(0, 0, h * 0.45, w, d, h * 0.9, 'plastic'),
        B(0, D - 60, h * 0.95, w, 120, h * 0.1, 'plastic'),
        C(0, -d * 0.05, h * 0.9 + 2, w * 0.3, 4, 'glass'),
        B(0, D - 121, h * 0.95, w * 0.6, 2, h * 0.04, 'dark'), // 操作パネルの表示
      ];
    case 'waterHeater':
      return [
        B(0, 2, h / 2, w, d - 4, h, 'plastic'),
        B(0, -D + 3, h * 0.55, w * 0.8, 6, h * 0.5, 'counter'),
        B(0, -D + 5, h * 0.88, w * 0.5, 10, h * 0.08, 'dark'),
      ];
    case 'waterMeter':
      return [
        C(0, 0, h * 0.5, Math.min(d * 0.35, h * 0.4), w, 'metal', 'x'), // 胴（接続口の高さ）
        C(0, 0, h * 0.8, Math.min(55, d * 0.3), h * 0.3, 'glass'),
      ];
    case 'pump':
      return [B(0, 0, 30, w, d, 60, 'concrete'), C(0, 0, h * 0.3, w * 0.35, h * 0.35, 'metal'), C(0, 0, h * 0.72, w * 0.28, h * 0.5, 'plastic'),
        C(-(W - w * 0.15), 0, h * 0.3, Math.min(30, h * 0.1), w * 0.3, 'metal', 'x'), C(W - w * 0.15, 0, h * 0.3, Math.min(30, h * 0.1), w * 0.3, 'metal', 'x')]; // 吸込・吐出の口
    case 'panel':
      return [B(0, 2, h / 2, w, d - 4, h, 'plastic'), B(0, -D + 5, h / 2, w * 0.9, 10, h * 0.9, 'counter')];
    case 'outlet':
      return [B(0, 1, h / 2, w, d - 2, h, 'plastic'), B(-12, -D + 1, h * 0.6, 6, 2, 18, 'dark'), B(12, -D + 1, h * 0.6, 6, 2, 18, 'dark')];
    case 'light':
      return [C(0, 0, h * 0.8, w * 0.3, h * 0.4, 'counter'), C(0, 0, h * 0.3, W, h * 0.6, 'ceramic')]; // 台座・白いかさ
    case 'aircon':
      return [B(0, 2, h / 2, w, d - 4, h, 'plastic'), B(0, -D + 4, h * 0.2, w * 0.85, 8, h * 0.12, 'dark')];
    case 'faucet':
      return [
        C(0, D - 10, h / 2, Math.min(W, h / 2 - 1), 20, 'metal', 'y'),
        C(0, -10, h * 0.6, 10, d - 20, 'metal', 'y'),
        C(0, -D + 12, h * 0.35, 9, h * 0.35, 'metal'),
        S(0, d * 0.2, h - 12, 12, 'metal'),
      ];
    case 'mixFaucet':
      return [
        C(0, D - 40, h * 0.5, 25, w - 40, 'metal', 'x'),
        C(-(W - 30), D - 40, h * 0.5, 30, 40, 'metal', 'x'), C(W - 30, D - 40, h * 0.5, 30, 40, 'metal', 'x'),
        C(-(W - 50), D - 12, h * 0.5, 12, 24, 'metal', 'y'), C(W - 50, D - 12, h * 0.5, 12, 24, 'metal', 'y'), // 壁への脚（接続口）
        C(0, -30, h * 0.4, 10, d - 60, 'metal', 'y'),
        C(0, -D + 12, h * 0.25, 8, h * 0.3, 'metal'),
      ];
    case 'outdoorFaucet':
      return [
        B(0, d * 0.15, h / 2, w * 0.6, d * 0.6, h, 'concrete'),
        C(0, -d * 0.2, h * 0.85, 8, d * 0.3, 'metal', 'y'),
        C(0, -d * 0.32, h * 0.8, 7, h * 0.08, 'metal'),
        S(0, -d * 0.05, h * 0.92, 12, 'metal'),
      ];
    case 'roofTank':
      return [B(0, 0, 50, w, d, 100, 'concrete'), B(0, 0, (100 + h - 20) / 2, w - 20, d - 20, h - 120, 'plastic'), C(w * 0.25, 0, h - 10, Math.min(160, d * 0.16), 20, 'plastic')];
    case 'waterHeader':
    case 'hotWaterHeader': {
      const r = Math.min(d * 0.3, h * 0.24);
      return [
        B(0, 0, h * 0.12, w * 0.6, d * 0.6, h * 0.24, 'dark'),
        C(0, 0, h * 0.5, r, w, 'metal', 'x'),
        ...outletXs(t).map((x) => C(x, 0, h * 0.75, Math.min(d * 0.18, 14), h * 0.5, 'metal')),
      ];
    }
    default:
      return [B(0, 0, h / 2, w, d, h, 'plastic'), B(0, 0, h - 5, w * 0.9, d * 0.9, 10, 'dark')];
  }
}
