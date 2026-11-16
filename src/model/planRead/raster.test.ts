import { describe, expect, test } from 'vitest';
import { inkMask, rasterLines, rasterWalls } from './raster';

/** 作り物のスキャン画像（RGBA）。1/50・A3 を 2400px にしたのと同じ 1px = 8.75mm */
const MMPP = 8.75, PAPER = 0.175;
function canvas(w: number, h: number, bg = 255) {
  const d = new Uint8ClampedArray(w * h * 4).fill(bg);
  const px = (x: number, y: number, c: [number, number, number]) => { if (x < 0 || y < 0 || x >= w || y >= h) return; const i = (y * w + x) * 4; d[i] = c[0]; d[i + 1] = c[1]; d[i + 2] = c[2]; d[i + 3] = 255; };
  /** 軸に平行な線（太さ px） */
  const line = (x1: number, y1: number, x2: number, y2: number, t = 2, c: [number, number, number] = [0, 0, 0]) => {
    for (let x = Math.min(x1, x2); x <= Math.max(x1, x2); x++) for (let y = Math.min(y1, y2); y <= Math.max(y1, y2); y++)
      for (let k = 0; k < t; k++) px(x1 === x2 ? x + k : x, y1 === y2 ? y + k : y, c);
  };
  /** 壁（二重線、芯から ±60mm）。水平か垂直 */
  const wall = (x1: number, y1: number, x2: number, y2: number, c: [number, number, number] = [0, 0, 0]) => {
    const o = Math.round(60 / MMPP);
    if (y1 === y2) { line(x1 - o, y1 - o, x2 + o, y1 - o, 2, c); line(x1 - o, y1 + o, x2 + o, y1 + o, 2, c); }
    else { line(x1 - o, y1 - o, x1 - o, y2 + o, 2, c); line(x1 + o, y1 - o, x1 + o, y2 + o, 2, c); }
  };
  return { w, h, d, px, line, wall };
}
/** 9100 × 6370 の外壁（芯）と、真ん中の内壁（800mm のドアの切れ目つき） */
function house(c: ReturnType<typeof canvas>) {
  const X0 = 150, Y0 = 120, W = Math.round(9100 / MMPP), H = Math.round(6370 / MMPP);
  c.wall(X0, Y0, X0 + W, Y0); c.wall(X0, Y0 + H, X0 + W, Y0 + H);
  c.wall(X0, Y0, X0, Y0 + H); c.wall(X0 + W, Y0, X0 + W, Y0 + H);
  const mx = X0 + Math.round(4550 / MMPP), door = Math.round(800 / MMPP), dy = Y0 + Math.round(2000 / MMPP);
  c.wall(mx, Y0, mx, dy); c.wall(mx, dy + door, mx, Y0 + H);
  // 引き戸の線（切れ目の中、壁の芯に沿って）
  c.line(mx, dy + 8, mx, dy + door - 8, 1);
  return { X0, Y0, W, H };
}
const ext = (ws: { a: { x: number; y: number }; b: { x: number; y: number }; kind: string }[]) => {
  const e = ws.filter((w) => w.kind === 'exterior').flatMap((w) => [w.a, w.b]);
  return { w: (Math.max(...e.map((p) => p.x)) - Math.min(...e.map((p) => p.x))) * MMPP, h: (Math.max(...e.map((p) => p.y)) - Math.min(...e.map((p) => p.y))) * MMPP };
};

describe('スキャンの画素からインクを抜き出す（inkMask）', () => {
  test('黒・濃い灰色はインク、白はインクでない。赤や青の書き込み（色の濃い画素）はインクにしない', () => {
    const c = canvas(4, 1);
    c.px(0, 0, [0, 0, 0]); c.px(1, 0, [200, 30, 30]); c.px(2, 0, [30, 60, 200]); c.px(3, 0, [255, 255, 255]);
    expect([...inkMask(c.d, 4, 1)]).toEqual([1, 0, 0, 0]);
  });
  test('薄いスキャン（灰色 150 の線と 235 の地）でも線をインクにする（大津の閾値）', () => {
    const c = canvas(10, 10, 235);
    c.line(0, 5, 9, 5, 1, [150, 150, 150]);
    const m = inkMask(c.d, 10, 10);
    expect(m.reduce((a, b) => a + b, 0)).toBe(10);
    expect(m[5 * 10 + 3]).toBe(1);
  });
});

describe('水平・垂直の線（rasterLines）', () => {
  test('同じ幅で続く行を 1 本の線にまとめ、太さは行の数。短い線（文字など）は取らない', () => {
    const c = canvas(100, 40);
    c.line(10, 10, 89, 10, 3);
    c.line(50, 20, 50, 39, 1);
    c.line(5, 30, 8, 30, 1);
    const ls = rasterLines(inkMask(c.d, 100, 40), 100, 40, 15);
    expect(ls).toContainEqual({ dir: 'h', c: 11, lo: 10, hi: 89, t: 3 });
    expect(ls).toContainEqual({ dir: 'v', c: 50, lo: 20, hi: 39, t: 1 });
    expect(ls).toHaveLength(2);
  });
});

describe('スキャンから壁（rasterWalls）', () => {
  test('二重線の外壁 4 本と内壁、ドアの切れ目は開口。外形はほぼ 9100 × 6370', () => {
    const c = canvas(1400, 1000);
    house(c);
    const ws = rasterWalls(inkMask(c.d, c.w, c.h), c.w, c.h, MMPP, PAPER);
    expect(ws.filter((w) => w.kind === 'exterior')).toHaveLength(4);
    expect(ws.filter((w) => w.kind === 'interior').length).toBeGreaterThanOrEqual(1);
    const e = ext(ws);
    expect(Math.abs(e.w - 9100)).toBeLessThan(40);
    expect(Math.abs(e.h - 6370)).toBeLessThan(40);
    for (const w of ws) expect(Math.abs(w.thickness - 120)).toBeLessThan(30);
    // 描いた切れ目は 800 − 壁の線の張り出し 60 × 2 = 680
    expect(ws.flatMap((w) => w.openings).some((o) => Math.abs(o.width - 680) < 60)).toBe(true);
  });
  test('赤い手書きの二重線（現場のメモ）は壁にしない', () => {
    const c = canvas(1400, 1000);
    house(c);
    c.wall(300, 900, 1300, 900, [220, 40, 40]);
    const ws = rasterWalls(inkMask(c.d, c.w, c.h), c.w, c.h, MMPP, PAPER);
    expect(ws.some((w) => w.a.y > 850 && w.b.y > 850)).toBe(false);
  });
  test('スキャンのカラーの層の薄い灰色（網掛け・薄い通り芯の番号など）は壁にしない。黒い線だけを読む', () => {
    const c = canvas(1400, 1000);
    house(c);
    // カラーの層の灰色（網掛け・薄い文字。実物は紙面の多くを占め、明るさ 150〜170 くらい）
    for (let y = 0; y < c.h; y++) for (let x = 0; x < 110; x++) c.px(x, y, [170, 170, 170]);
    for (let y = 965; y < c.h; y++) for (let x = 0; x < c.w; x++) c.px(x, y, [170, 170, 170]);
    for (let k = 0; k < 6; k++) c.wall(250 + k * 150, 930, 250 + k * 150 + 120, 930, [150, 150, 150]);
    c.wall(1300, 150, 1300, 900, [150, 150, 150]);
    const m = inkMask(c.d, c.w, c.h);
    const ws = rasterWalls(m, c.w, c.h, MMPP, PAPER);
    expect(ws.filter((w) => w.kind === 'exterior')).toHaveLength(4);
    expect(ws.some((w) => (w.a.y > 900 && w.b.y > 900) || (w.a.x > 1250 && w.b.x > 1250))).toBe(false);
  });
  test('文字の枠（「CH=2300」のような小さな四角）・離れた短い線の組は壁にしない', () => {
    const c = canvas(1400, 1000);
    house(c);
    // 部屋の中の文字枠: 幅 500mm・高さ 200mm の四角（上下の線が 200mm 離れて平行 → 帯に見える）
    const bx = 300, by = 400, bw = Math.round(500 / MMPP), bh = Math.round(200 / MMPP);
    c.line(bx, by, bx + bw, by, 2); c.line(bx, by + bh, bx + bw, by + bh, 2); c.line(bx, by, bx, by + bh, 2); c.line(bx + bw, by, bx + bw, by + bh, 2);
    const ws = rasterWalls(inkMask(c.d, c.w, c.h), c.w, c.h, MMPP, PAPER);
    expect(ws.some((w) => Math.min(w.a.x, w.b.x) >= bx - 5 && Math.max(w.a.x, w.b.x) <= bx + bw + 5 && Math.min(w.a.y, w.b.y) >= by - 5 && Math.max(w.a.y, w.b.y) <= by + bh + 5)).toBe(false);
    expect(ws.filter((w) => w.kind === 'exterior')).toHaveLength(4);
  });
  test('表（申請書・チェックシートのページ）は壁にしない', () => {
    const c = canvas(1400, 1000);
    for (let r = 0; r <= 30; r++) c.line(100, 100 + r * 25, 1300, 100 + r * 25, 2);
    for (const x of [100, 160, 600, 900, 1300]) c.line(x, 100, x, 850, 2);
    expect(rasterWalls(inkMask(c.d, c.w, c.h), c.w, c.h, MMPP, PAPER).length).toBeLessThanOrEqual(2);
  });
  test('1/100（1px = 17.5mm、壁の線の間は約 7px）でも外壁 4 本', () => {
    const M = 17.5, c = canvas(800, 600), o = Math.round(60 / M);
    const wall = (x1: number, y1: number, x2: number, y2: number) => {
      if (y1 === y2) { c.line(x1 - o, y1 - o, x2 + o, y1 - o, 1); c.line(x1 - o, y1 + o, x2 + o, y1 + o, 1); }
      else { c.line(x1 - o, y1 - o, x1 - o, y2 + o, 1); c.line(x1 + o, y1 - o, x1 + o, y2 + o, 1); }
    };
    const X0 = 100, Y0 = 100, W = Math.round(9100 / M), H = Math.round(6370 / M);
    wall(X0, Y0, X0 + W, Y0); wall(X0, Y0 + H, X0 + W, Y0 + H); wall(X0, Y0, X0, Y0 + H); wall(X0 + W, Y0, X0 + W, Y0 + H);
    const ws = rasterWalls(inkMask(c.d, c.w, c.h), c.w, c.h, M, 0.175);
    expect(ws.filter((w) => w.kind === 'exterior')).toHaveLength(4);
  });
  test('白紙・真っ黒・文字のような点だけの画像は 0 本', () => {
    const blank = canvas(300, 200), black = canvas(300, 200, 0), dots = canvas(300, 200);
    for (let i = 0; i < 400; i++) dots.line((i * 37) % 290, (i * 53) % 190, ((i * 37) % 290) + 4, (i * 53) % 190, 1);
    for (const c of [blank, black, dots]) expect(rasterWalls(inkMask(c.d, c.w, c.h), c.w, c.h, MMPP, PAPER)).toEqual([]);
  });
});
