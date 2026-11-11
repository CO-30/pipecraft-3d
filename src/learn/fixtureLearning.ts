/**
 * 器具の候補を、使う人の直し方から覚えて次の図面に合わせる（純関数）。
 * 覚えるのは「どんな辺のどこに、どちら向きで置いたか」の特徴（src/model/planRead/roomSlots.ts）で、
 * 図面の向き・左右反転・部屋の大きさが違っても同じ特徴の置き場所を選べる。保存は src/learn/learnStore.ts。
 */
import { FIXTURE_CATALOG, type FixtureType, type Rotation } from '../model/fixtures';
import { matchTol, type CandidateRoom, type FixtureCandidate } from '../model/planRead/fixtureGuess';
import { matchSlot, type Slot, type SlotFeatures } from '../model/planRead/roomSlots';

/** 直し方 1 件（器具 1 個につき 1 件。id は器具の id） */
export type LearnSample = { id: string; type: FixtureType; room: string; f: SlotFeatures; flip: boolean; at: number };

/** 種類ごとに使う記録の数（新しい順） */
export const USE_SAMPLES = 20;
const W = { door: 3, wall: 2, pos: 2, label: 1 } as const;

function score(s: Slot, x: LearnSample, room: string): number {
  return (s.f.door === x.f.door ? W.door : 0) + (s.f.wall === x.f.wall ? W.wall : 0) + (s.f.pos === x.f.pos ? W.pos : 0)
    + (s.f.label === x.f.label ? W.label : 0) + (x.room === room ? 1 : 0);
}

type Rect = { x0: number; x1: number; y0: number; y1: number };
function rectOf(type: FixtureType, x: number, y: number, r: Rotation): Rect {
  const { w, d } = FIXTURE_CATALOG[type].size;
  const hx = (r % 180 === 0 ? w : d) / 2 - 5, hy = (r % 180 === 0 ? d : w) / 2 - 5;
  return { x0: x - hx, x1: x + hx, y0: y - hy, y1: y + hy };
}
const overlap = (a: Rect, b: Rect) => a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;
const sameBox = (a: CandidateRoom, b: CandidateRoom) => a.box.x0 === b.box.x0 && a.box.x1 === b.box.x1 && a.box.y0 === b.box.y0 && a.box.y1 === b.box.y1;

/**
 * 記録のある種類の器具を、記録と特徴がいちばん合うスロットへ置き直す。
 * 同点は今の置き方（最初のスロット → 文字に近い辺 → 真ん中）を優先し、同じ部屋の先の器具と重なるスロットは使わない。
 * learned: 参考にした記録の数。記録・部屋の情報が無い候補はそのまま。
 */
export function applyLearned<T extends FixtureCandidate>(cands: T[], samples: LearnSample[]): (T & { learned?: number })[] {
  const out: (T & { learned?: number })[] = [];
  for (const c of cands) {
    const room = c.room;
    const mine = samples.filter((x) => x.type === c.type).sort((p, q) => q.at - p.at).slice(0, USE_SAMPLES);
    if (!room || !mine.length) { out.push(c); continue; }
    const taken = out.filter((o) => o.room && sameBox(o.room, room) && (o as { floorId?: string }).floorId === (c as { floorId?: string }).floorId)
      .map((o) => rectOf(o.type, o.x, o.y, o.rotation));
    let best: { slot: Slot; v: number; flip: boolean } | null = null;
    for (const slot of room.slots) {
      if (taken.some((r) => overlap(r, rectOf(c.type, slot.x, slot.y, slot.rotation)))) continue;
      const scored = mine.map((x) => ({ x, v: score(slot, x, room.name) }));
      const v = scored.reduce((s, y) => s + y.v, 0);
      const tie = (s: Slot) => (s.key === room.first ? 4 : 0) + (s.f.label ? 2 : 0) + (s.f.pos === 'center' ? 1 : 0);
      if (!best || v > best.v || (v === best.v && tie(slot) > tie(best.slot))) {
        // 向き: このスロットにいちばん合う記録（同点は新しい方）の向き
        const top = scored.reduce((m, y) => (y.v > m.v ? y : m), scored[0]);
        best = { slot, v, flip: top.x.flip };
      }
    }
    if (!best) { out.push(c); continue; }
    const rotation = (best.flip ? (best.slot.rotation + 180) % 360 : best.slot.rotation) as Rotation;
    out.push({ ...c, x: best.slot.x, y: best.slot.y, rotation, learned: mine.length, room: { ...room, first: best.slot.key, ...(best.flip ? { flip: true } : { flip: undefined }) } });
  }
  return out;
}

/**
 * 置いた器具のいまの位置・向きから直し方の記録を作る。
 * 置いたときのスロット・向きのまま、またはどのスロットにも当てはまらないときは null（覚えることが無い）。
 */
export function sampleFor(id: string, type: FixtureType, room: CandidateRoom, fx: { x: number; y: number; rotation: Rotation }, at: number): LearnSample | null {
  const m = matchSlot(room.slots, fx.x, fx.y, fx.rotation, matchTol(room.box));
  if (!m || (m.slot.key === room.first && m.flip === !!room.flip)) return null;
  return { id, type, room: room.name, f: m.slot.f, flip: m.flip, at };
}
