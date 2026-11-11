/** テスト用の作り物の図面（実在の建物ではない）。図面座標(mm)で描いて紙の座標（pt）にする */
import { PT_TO_MM, type PSeg, type PText, type VectorPage } from './sheet';

export const HEAVY = 0.5, THIN = 0.1;
export const PITCH = 910;

export type Sketch = { segs: PSeg[]; texts: PText[]; k: number; ox: number; oy: number };

/** scale: 1/n の n。ox, oy: 図面座標の原点を置く紙の位置(pt) */
export function sketch(scale: number, ox = 200, oy = 600): Sketch {
  return { segs: [], texts: [], k: PT_TO_MM * scale, ox, oy };
}
export const px = (s: Sketch, x: number) => s.ox + x / s.k;
export const py = (s: Sketch, y: number) => s.oy - y / s.k;

export function line(s: Sketch, x1: number, y1: number, x2: number, y2: number, w = HEAVY): void {
  s.segs.push({ x1: px(s, x1), y1: py(s, y1), x2: px(s, x2), y2: py(s, y2), w });
}
export function text(s: Sketch, x: number, y: number, str: string, h = 8): void {
  s.texts.push({ x: px(s, x), y: py(s, y), h, s: str });
}
/** 壁（太い 2 本線）。芯 (x1,y1)→(x2,y2)、厚さ t。軸に平行なものだけ */
export function wall(s: Sketch, x1: number, y1: number, x2: number, y2: number, t = 120, w = HEAVY): void {
  const h = t / 2;
  if (y1 === y2) { line(s, x1, y1 - h, x2, y1 - h, w); line(s, x1, y1 + h, x2, y1 + h, w); }
  else { line(s, x1 - h, y1, x1 - h, y2, w); line(s, x1 + h, y1, x1 + h, y2, w); }
}
/** 通り芯の文字。X は下、Y は左。firstX / firstY: 最初の番号 */
export function gridLabels(s: Sketch, nx: number, ny: number, firstX = 1, firstY = 1): void {
  for (let i = 0; i < nx; i++) { text(s, i * PITCH, -1500, `X${firstX + i}`); line(s, i * PITCH, -1200, i * PITCH, (ny - 1) * PITCH + 1200, THIN); }
  for (let j = 0; j < ny; j++) { text(s, -1500, j * PITCH, `Y${firstY + j}`); line(s, -1200, j * PITCH, (nx - 1) * PITCH + 1200, j * PITCH, THIN); }
}
export function page(s: Sketch): VectorPage {
  // 細い線を水増しして、実際の図面のように「太い線は一部だけ」にする
  const filler: PSeg[] = [];
  for (let i = 0; i < 260; i++) filler.push({ x1: 900 + (i % 20) * 3, y1: 50 + i, x2: 960 + (i % 20) * 3, y2: 50 + i + 0.2 * (i % 3), w: THIN });
  return { widthPt: 1191, heightPt: 842, segs: [...s.segs, ...filler], texts: s.texts };
}

export const W = 8 * PITCH, D = 6 * PITCH;

/**
 * 1 階平面図（1/100）: 7280 × 5460 の四角い家。南の壁に窓（x 1820〜3640、細いサッシ線）、
 * 中央（x = 3640）に間仕切りとドア（y 910〜1820）。図面の右外に表の枠（壁と紛らわしい太い 2 本線）。
 */
export function planSheet(opts: { title?: boolean; scaleText?: boolean; labels?: boolean; firstY?: number; floorName?: string } = {}): VectorPage {
  const s = sketch(100);
  if (opts.labels !== false) gridLabels(s, 9, 7, 1, opts.firstY ?? 1);
  wall(s, 0, D, W, D); // 北
  wall(s, 0, 0, 0, D); // 西
  wall(s, W, 0, W, D); // 東
  wall(s, 0, 0, 1820, 0); wall(s, 3640, 0, W, 0); // 南（窓の両側）
  line(s, 1820, 0, 3640, 0, THIN); line(s, 1820, 30, 3640, 30, THIN); // サッシ
  wall(s, 3640, 0, 3640, 910); wall(s, 3640, 1820, 3640, D); // 間仕切り（ドアの両側）
  line(s, 3640, 910, 3640, 1820, THIN); // ドア
  wall(s, W + 6000, 3000, W + 6800, 3000); // 表の枠（建物の外）
  if (opts.title !== false) text(s, 3000, -2600, `${opts.floorName ?? '1階'} 平面図`, 10);
  if (opts.scaleText !== false) text(s, 5200, -2600, 'S:1/100', 10);
  text(s, 1000, 3000, '展開図参照', 12);
  // 部屋の名前と器具の文字（凡例の「立水栓」は建物から離れた所）
  text(s, 900, 4600, 'WC'); text(s, 2700, 4800, '洗面 床目地'); text(s, 5500, 2500, 'LDK');
  text(s, W + 700, 1000, '立水栓'); text(s, -9000, 3000, '立水栓'); text(s, 2700, 4300, '洗面化粧台合わせ');
  return page(s);
}

/**
 * 基礎伏図（1/50）: 外周と中央の立上り（厚さ 150）。中央に人通口（y 2730〜3330、線なし）。
 * slab: 区画ごとのスラブ（耐圧盤）の高さの印「基礎天端」「−350」（実物の図面と同じく 2 つの文字）と、凡例の「基礎天端-350」
 */
export function foundationSheet(opts: { firstY?: number; slab?: string } = {}): VectorPage {
  const s = sketch(50, 150, 700);
  gridLabels(s, 9, 7, 1, opts.firstY ?? 1);
  wall(s, 0, D, W, D, 150); wall(s, 0, 0, W, 0, 150); wall(s, 0, 0, 0, D, 150); wall(s, W, 0, W, D, 150);
  wall(s, 3640, 0, 3640, 2730, 150); wall(s, 3640, 3330, 3640, D, 150);
  text(s, 3000, -2600, '基礎伏図 S:1/50', 12);
  if (opts.slab) {
    for (const [x, y] of [[1800, 2700], [5500, 2700]]) { text(s, x, y + 150, '基礎天端'); text(s, x, y - 150, opts.slab); }
    text(s, -3000, D + 1500, `基礎天端${opts.slab}`);
  }
  return page(s);
}

/** 立面図（1/100）: GL、基礎高（GL+400）、1階FL（GL+550）、軒高（FL+2700） */
export function elevationSheet(): VectorPage {
  const s = sketch(100, 300, 500);
  for (const dx of [0, 9000]) {
    text(s, dx, 0, 'ＧＬ'); text(s, dx, 400, '基礎高'); text(s, dx, 550, '1階ＦＬ'); text(s, dx, 3250, '1階軒高');
    text(s, dx + 500, 280, '550'); text(s, dx + 500, 1900, '2,700'); text(s, dx - 500, 200, '400');
  }
  text(s, 2000, -1500, '南側 立面図 S:1/100', 12);
  line(s, -1000, 0, 16000, 0, HEAVY);
  return page(s);
}

/** ます等の記号: 一辺 size(mm) の四角。cross で × を入れる */
function box(s: Sketch, cx: number, cy: number, size: number, cross: boolean, w = 0.24): void {
  const h = size / 2;
  line(s, cx - h, cy - h, cx + h, cy - h, w); line(s, cx + h, cy - h, cx + h, cy + h, w);
  line(s, cx + h, cy + h, cx - h, cy + h, w); line(s, cx - h, cy + h, cx - h, cy - h, w);
  if (cross) { line(s, cx - h, cy - h, cx + h, cy + h, w); line(s, cx - h, cy + h, cx + h, cy - h, w); }
}

/** 円（短い線 24 本）。中心 (cx, cy)、半径 r(mm) */
function circle(s: Sketch, cx: number, cy: number, r: number): void {
  for (let i = 0; i < 24; i++) {
    const a = (i / 24) * 2 * Math.PI, b = ((i + 1) / 24) * 2 * Math.PI;
    line(s, cx + r * Math.cos(a), cy + r * Math.sin(a), cx + r * Math.cos(b), cy + r * Math.sin(b), 0.24);
  }
}

/**
 * 配置図（1/100、通り芯なし）: 平面図の家の外形（外壁の外面）と軒の線、凡例（汚水公共桝・汚水桝・雨水桝・水道メーター・敷地レベル）、
 * 北の敷地境界ぞいの汚水桝 3 つと公共桝、東の雨水桝、南西の水道メーター、敷地の高さ（GL±0〜GL−950）、BM。
 * 紙の上の家の位置は平面図と違う（通り芯が無いので外形の重なりで合わせる）
 */
export function siteSheet(opts: { eavesOnly?: boolean } = {}): VectorPage {
  const s = sketch(100, 420, 560);
  // 家: 外壁の外面（壁厚 120 → ±60）と、屋根の線・軒の線（紛らわしい線）。eavesOnly: 外壁の外形を描かない図面
  const o = 60;
  if (!opts.eavesOnly) for (const [x1, y1, x2, y2] of [[-o, -o, W + o, -o], [W + o, -o, W + o, D + o], [W + o, D + o, -o, D + o], [-o, D + o, -o, -o]]) line(s, x1, y1, x2, y2, 0.38);
  for (let y = 600; y < D; y += 600) line(s, -510, y, W + 510, y, 0.24);
  for (const [x1, y1, x2, y2] of [[-510, -510, W + 510, -510], [W + 510, -510, W + 510, D + 510], [W + 510, D + 510, -510, D + 510], [-510, D + 510, -510, -510]]) line(s, x1, y1, x2, y2, 0.24);
  // 敷地境界（細い線）
  for (const [x1, y1, x2, y2] of [[-4000, -2500, W + 1500, -2500], [W + 1500, -2500, W + 1500, D + 1200], [W + 1500, D + 1200, -4000, D + 1200], [-4000, D + 1200, -4000, -2500]]) line(s, x1, y1, x2, y2, 0.24);
  // 凡例（家から離れた所）
  const lx = -12000; // 紙の中（左の余白）
  box(s, lx, 9000, 200, false); box(s, lx, 9000, 150, true); text(s, lx + 2500, 9000, '汚水 公共桝');
  box(s, lx, 8500, 150, true); text(s, lx + 2500, 8500, '汚水桝');
  box(s, lx, 8000, 150, false); text(s, lx + 2500, 8000, '雨水桝');
  text(s, lx, 7500, 'WM'); text(s, lx + 2500, 7500, '水道メーター');
  text(s, lx, 7000, 'GL±0'); text(s, lx + 2500, 7000, '敷地レベル');
  box(s, lx - 60, 6500, 150, false); circle(s, lx + 90, 6500, 75); text(s, lx + 2500, 6500, '立水栓');
  // ます・メーター
  for (const x of [1000, 3000, 5000]) box(s, x, D + 600, 150, true);
  box(s, -1500, D + 600, 200, false); box(s, -1500, D + 600, 150, true);
  box(s, W + 600, 1000, 150, false);
  // 雨水桝の横に雨どいの丸（離れた大きな丸）→ 雨水桝のまま。凡例どおりの □○ → 立水栓
  box(s, W + 600, 3000, 150, false); circle(s, W + 900, 3000, 120);
  box(s, 1200, -600, 150, false); circle(s, 1350, -600, 75);
  // 対角線が角まで届いていない ☒ → 汚水桝
  { const h = 75, i = 25; box(s, 6500, D + 600, 150, false); line(s, 6500 - h + i, D + 600 - h + i, 6500 + h - i, D + 600 + h - i, 0.24); line(s, 6500 - h + i, D + 600 + h - i, 6500 + h - i, D + 600 - h + i, 0.24); }
  // 「WM」を四角で囲んだもの（雨水桝ではない）と、そのすぐ横の説明の「水道メーター」（凡例ではない）
  text(s, -800, -800, 'WM'); box(s, -800, -800, 150, false); text(s, 1200, -800, '水道メーター');
  // 敷地の高さ・BM
  text(s, W / 2, D + 900, 'GL±0'); text(s, -1000, D + 900, 'GL-500'); text(s, -2500, D + 900, 'GL-950'); text(s, W + 800, -1500, 'GL+300');
  text(s, -3000, -2000, '汚水桝天端=BM'); text(s, -3000, -2300, 'BM+550=GL±0');
  text(s, 3000, -4000, '配置図 S:1/100', 12);
  // 実際の図面のように細い線を多く入れる（線の入っていない PDF とみなされないように）
  const filler: PSeg[] = [];
  for (let i = 0; i < 260; i++) filler.push({ x1: 1000 + (i % 20) * 3, y1: 50 + i, x2: 1060 + (i % 20) * 3, y2: 50 + i + 0.2 * (i % 3), w: 0.1 });
  return { widthPt: 1191, heightPt: 842, segs: [...s.segs, ...filler], texts: s.texts };
}
