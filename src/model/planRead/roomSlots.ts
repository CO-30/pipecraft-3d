/**
 * 部屋の名前の文字から部屋の箱（内法）を作り、器具の奥を壁に付けた置き場所（スロット）を並べる。
 * スロットは図面が変わっても通じる特徴（辺の長短・出入口との関係・端か真ん中か）で表し、
 * 使う人の直し方を覚えて次の図面に合わせるのに使う（src/learn/fixtureLearning.ts）。純関数。
 */
import type { Vec2 } from '../building';
import type { Rotation } from '../fixtures';
import type { WallLine } from './fixtureGuess';

export type Side = 'L' | 'R' | 'B' | 'T';
export type SlotFeatures = {
  /** その辺が部屋の長い辺か短い辺か（差が 1 割以内は square） */
  wall: 'long' | 'short' | 'square';
  /** 出入口（ドア）の辺 / 向かい / 横 / 出入口が分からない */
  door: 'on' | 'opposite' | 'beside' | 'none';
  /** 出入口に近い端 / 遠い端 / 真ん中 / 辺いっぱい / 端（出入口が分からない・真ん中に出入口） */
  pos: 'nearDoor' | 'farDoor' | 'center' | 'full' | 'corner';
  /** 部屋の名前の文字にいちばん近い辺（今までの置き方） */
  label: boolean;
};
export type Slot = { key: string; side: Side; x: number; y: number; rotation: Rotation; f: SlotFeatures };
export type RoomBox = { x0: number; x1: number; y0: number; y1: number };

/** 文字から壁を探す距離 */
const REACH = 4000;
const MIN_ROOM = 600, MAX_ROOM = 8000;
/** 辺の内法 − 器具の幅 がこれ未満なら「辺いっぱい」 */
const FULL = 300;
/** 器具の幅が内法をこれ以上超える辺には置かない */
const OVER = 100;
/** 当てはまりの距離（既定） */
export const MATCH_MM = 400;

const vertical = (w: WallLine) => Math.abs(w.a.x - w.b.x) < 1 && Math.abs(w.a.y - w.b.y) >= 1;
const horizontal = (w: WallLine) => Math.abs(w.a.y - w.b.y) < 1 && Math.abs(w.a.x - w.b.x) >= 1;
const within = (v: number, a: number, b: number) => v >= Math.min(a, b) - 1 && v <= Math.max(a, b) + 1;

/** p から上下左右に軸に平行な壁の面を探して内法の箱を作る。どれかの向きに壁が無い・大きさが部屋らしくなければ null */
export function roomBox(p: Vec2, walls: WallLine[]): RoomBox | null {
  let x0 = -Infinity, x1 = Infinity, y0 = -Infinity, y1 = Infinity;
  for (const w of walls) {
    const h = w.thickness / 2;
    if (vertical(w) && within(p.y, w.a.y, w.b.y)) {
      if (w.a.x < p.x) x0 = Math.max(x0, w.a.x + h);
      else x1 = Math.min(x1, w.a.x - h);
    } else if (horizontal(w) && within(p.x, w.a.x, w.b.x)) {
      if (w.a.y < p.y) y0 = Math.max(y0, w.a.y + h);
      else y1 = Math.min(y1, w.a.y - h);
    }
  }
  if (p.x - x0 > REACH || x1 - p.x > REACH || p.y - y0 > REACH || y1 - p.y > REACH) return null;
  const W = x1 - x0, H = y1 - y0;
  if (!(W >= MIN_ROOM && W <= MAX_ROOM && H >= MIN_ROOM && H <= MAX_ROOM)) return null;
  return { x0, x1, y0, y1 };
}

/** 辺の内側の面（線）。a→b は座標の小さい方から */
function sideLine(b: RoomBox, s: Side): { a: Vec2; b: Vec2; n: Vec2; rotation: Rotation } {
  switch (s) {
    case 'L': return { a: { x: b.x0, y: b.y0 }, b: { x: b.x0, y: b.y1 }, n: { x: 1, y: 0 }, rotation: 90 };
    case 'R': return { a: { x: b.x1, y: b.y0 }, b: { x: b.x1, y: b.y1 }, n: { x: -1, y: 0 }, rotation: 270 };
    case 'B': return { a: { x: b.x0, y: b.y0 }, b: { x: b.x1, y: b.y0 }, n: { x: 0, y: 1 }, rotation: 180 };
    default: return { a: { x: b.x0, y: b.y1 }, b: { x: b.x1, y: b.y1 }, n: { x: 0, y: -1 }, rotation: 0 };
  }
}
const OPP: Record<Side, Side> = { L: 'R', R: 'L', B: 'T', T: 'B' };
const SIDES: Side[] = ['L', 'R', 'B', 'T'];

/** 部屋の辺にある出入口の中心（壁の芯の上の点）と、その辺 */
function doorsOf(box: RoomBox, walls: WallLine[]): { p: Vec2; side: Side }[] {
  const out: { p: Vec2; side: Side }[] = [];
  for (const w of walls) {
    if (!w.doors?.length) continue;
    const L = Math.hypot(w.b.x - w.a.x, w.b.y - w.a.y);
    if (L < 1) continue;
    for (const off of w.doors) {
      const p = { x: w.a.x + ((w.b.x - w.a.x) / L) * off, y: w.a.y + ((w.b.y - w.a.y) / L) * off };
      const tol = w.thickness / 2 + 50;
      for (const s of SIDES) {
        const l = sideLine(box, s);
        const onLine = s === 'L' || s === 'R' ? Math.abs(p.x - l.a.x) <= tol && within(p.y, box.y0, box.y1) : Math.abs(p.y - l.a.y) <= tol && within(p.x, box.x0, box.x1);
        if (onLine) { out.push({ p, side: s }); break; }
      }
    }
  }
  return out;
}

/** 箱の各辺に、奥行 size.d・幅 size.w の器具の奥を壁に付けたスロットを並べる */
export function roomSlots(box: RoomBox, size: { w: number; d: number }, walls: WallLine[], label: Vec2): Slot[] {
  const W = box.x1 - box.x0, H = box.y1 - box.y0;
  const doors = doorsOf(box, walls);
  const doorSides = new Set(doors.map((d) => d.side));
  const dist = (s: Side) => { const l = sideLine(box, s); return s === 'L' || s === 'R' ? Math.abs(label.x - l.a.x) : Math.abs(label.y - l.a.y); };
  const labelSide = SIDES.reduce((m, s) => (dist(s) < dist(m) ? s : m), 'L' as Side);
  const toDoor = (p: Vec2) => Math.min(...doors.map((d) => Math.hypot(d.p.x - p.x, d.p.y - p.y)));
  const out: Slot[] = [];
  for (const s of SIDES) {
    const l = sideLine(box, s);
    const len = s === 'L' || s === 'R' ? H : W;
    const depth = s === 'L' || s === 'R' ? W : H;
    if (size.w > len + OVER || size.d > depth + OVER) continue;
    const wall: SlotFeatures['wall'] = Math.abs(W - H) <= 0.1 * Math.max(W, H) ? 'square' : len > depth ? 'long' : 'short';
    const door: SlotFeatures['door'] = !doors.length ? 'none' : doorSides.has(s) ? 'on' : doorSides.has(OPP[s]) ? 'opposite' : 'beside';
    const u = { x: (l.b.x - l.a.x) / len, y: (l.b.y - l.a.y) / len };
    const at = (along: number): Vec2 => ({ x: Math.round(l.a.x + u.x * along + l.n.x * size.d / 2), y: Math.round(l.a.y + u.y * along + l.n.y * size.d / 2) });
    const half = size.w / 2;
    const alongs = len - size.w < FULL ? [len / 2] : [half, len / 2, len - half];
    const pts = alongs.map(at);
    pts.forEach((p, i) => {
      let pos: SlotFeatures['pos'] = alongs.length === 1 ? 'full' : i === 1 ? 'center' : 'corner';
      if (pos === 'corner' && doors.length) {
        const me = toDoor(p), other = toDoor(pts[2 - i]);
        pos = me < other - 50 ? 'nearDoor' : me > other + 50 ? 'farDoor' : 'corner';
      }
      out.push({ key: `${s}${i}`, side: s, x: p.x, y: p.y, rotation: l.rotation, f: { wall, door, pos, label: s === labelSide } });
    });
  }
  return out;
}

/** いまの位置・向きにいちばん近いスロット。向きの軸が同じで中心が tol 以内のもの。180° 逆向きは flip */
export function matchSlot(slots: Slot[], x: number, y: number, rotation: Rotation, tol = MATCH_MM): { slot: Slot; flip: boolean } | null {
  let best: { slot: Slot; flip: boolean; d: number } | null = null;
  for (const slot of slots) {
    if (slot.rotation % 180 !== rotation % 180) continue;
    const d = Math.hypot(slot.x - x, slot.y - y);
    if (d <= tol && (!best || d < best.d)) best = { slot, flip: slot.rotation !== rotation, d };
  }
  return best && { slot: best.slot, flip: best.flip };
}
