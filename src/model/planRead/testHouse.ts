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
