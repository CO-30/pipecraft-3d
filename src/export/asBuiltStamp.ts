/**
 * 竣工図の印（赤枠に「竣 工 図」と竣工日）。用紙の右上を優先に、文字・線・表題欄を避けて空いた所へ押す。
 * 枠の中は白く塗るので、下の線は隠れる（それでも線の少ない所を選ぶ）。文字は LabelPlacer で置く。
 */
import { LabelPlacer, segHitsRect, textRects, textWidth, type Cand, type Rect } from './labelLayout';
import { RED, type Sheet } from './sheet';

const TITLE = '竣 工 図';
const T1 = 5, T2 = 2.8, PAD = 2.5, MARGIN = 12, STEP = 3;

type Seg = { x1: number; y1: number; x2: number; y2: number };

export function stampAsBuilt(sheet: Sheet, dateText: string): { collided: boolean } {
  const sub = `竣工 ${dateText}`;
  const w = Math.max(textWidth(TITLE, T1), textWidth(sub, T2)) + PAD * 2;
  const h = T1 * 1.25 + T2 * 1.3 + PAD * 2;
  const W = sheet.width, H = sheet.height;

  // 障害物: 文字（少し広め）・画像は重ねない、線は少ないほど良い。用紙いっぱいの外枠は除く
  const hard: Rect[] = [];
  const segs: Seg[] = [];
  const edges = (x: number, y: number, ww: number, hh: number) => segs.push({ x1: x, y1: y, x2: x + ww, y2: y }, { x1: x + ww, y1: y, x2: x + ww, y2: y + hh }, { x1: x, y1: y + hh, x2: x + ww, y2: y + hh }, { x1: x, y1: y, x2: x, y2: y + hh });
  for (const o of sheet.ops) {
    if (o.t === 'text') { if (o.s.trim()) hard.push(...textRects(o, 1.2)); }
    else if (o.t === 'image') hard.push({ x1: o.x, y1: o.y, x2: o.x + o.w, y2: o.y + o.h });
    else if (o.t === 'line') segs.push(o);
    else if (o.t === 'rect') { if (!(o.w > W * 0.8 && o.h > H * 0.8)) edges(o.x, o.y, o.w, o.h); }
    else if (o.t === 'circle') edges(o.cx - o.r, o.cy - o.r, o.r * 2, o.r * 2);
    else if (o.t === 'poly') for (let i = 1; i < o.pts.length; i++) segs.push({ x1: o.pts[i - 1][0], y1: o.pts[i - 1][1], x2: o.pts[i][0], y2: o.pts[i][1] });
  }
  const hit = (a: Rect, b: Rect) => a.x1 < b.x2 && b.x1 < a.x2 && a.y1 < b.y2 && b.y1 < a.y2;

  let best: { x: number; y: number; cost: number } | null = null;
  const x0 = W - MARGIN - w;
  for (let y = MARGIN; y + h <= H - MARGIN; y += STEP) {
    for (let x = x0; x >= MARGIN; x -= STEP) {
      // 右上ほど良い（上へ寄せる重みを強く）
      let cost = (x0 - x) * 0.4 + (y - MARGIN) * 1.2;
      if (best && cost >= best.cost) continue;
      const box: Rect = { x1: x, y1: y, x2: x + w, y2: y + h };
      for (const r of hard) if (hit(box, r)) cost += 1000;
      if (best && cost >= best.cost) continue;
      for (const s of segs) if (segHitsRect(s, box)) cost += 200; // 白い枠で図の線を隠さないよう、線の少ない所を強く選ぶ
      if (!best || cost < best.cost) best = { x, y, cost };
    }
  }
  if (!best) best = { x: x0, y: MARGIN, cost: 1000 };
  const { x, y } = best;
  sheet.ops.push({ t: 'rect', x, y, w, h, fill: '#ffffff', stroke: RED, lw: 0.6 });
  const cx = x + w / 2;
  const cand: Cand = {
    penalty: 0,
    texts: [
      { t: 'text', x: cx, y: y + PAD + T1 * 0.9, s: TITLE, size: T1, anchor: 'middle', color: RED, bold: true },
      { t: 'text', x: cx, y: y + PAD + T1 * 1.25 + T2 * 0.95, s: sub, size: T2, anchor: 'middle', color: RED },
    ],
  };
  new LabelPlacer(sheet, { x1: 0, y1: 0, x2: W, y2: H }).place([cand]);
  return { collided: best.cost >= 1000 };
}
