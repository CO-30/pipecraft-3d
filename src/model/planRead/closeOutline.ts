/**
 * 1 階の外壁の輪を閉じる（2026-11-16 実物の木造平屋: 窓・出入口・入り隅の所で外壁が切れて読まれ、外周が 1 周つながらない）。
 * 外周がつながらないと、建物の内外が分からず、床下の排水の本管・基礎を抜ける所（KSA）・マスの深さが決められない。
 *
 * 決め方:
 *  - 行き止まりの点（つながりが奇数の点）どうしを、まっすぐ（同じ線上）か L 字でつなぐ候補を作る
 *    基礎伏図の立上りがあれば、その上を通るつなぎだけ（窓の下も基礎は続いている）。無ければ同じ線上の切れ目（窓・出入口の幅）だけ
 *  - つないだあと行き止まりの壁（出窓の小さな出っぱり・内側に入り込んだ壁）は外周から外す（消さずに内壁にする）
 *  - 残りが 1 つの閉じた輪になる組み合わせのうち、いちばん外側（囲む面積が最大）、同じなら足す長さが短いもの
 */
import type { Vec2 } from '../building';

export type OSeg = { a: Vec2; b: Vec2 };
export type CloseResult = { add: OSeg[]; demote: number[] };

/** 1 本のつなぎの長さの上限(mm)。基礎が無いときは開口部の幅まで */
const MAX_LEG = 3000, OPEN_MAX = 4200;
/** 基礎の立上りの上とみなす芯のずれ(mm)と、立上りに乗っている割合 */
const FOOT_NEAR = 100, FOOT_COVER = 0.8;
/** 調べる組み合わせの上限（スマホで固まらないように） */
const MAX_EVAL = 20000;

const key = (p: Vec2) => `${Math.round(p.x)},${Math.round(p.y)}`;
const norm = (p: Vec2, q: Vec2): OSeg => (p.x < q.x || (p.x === q.x && p.y <= q.y) ? { a: p, b: q } : { a: q, b: p });
const len = (g: OSeg) => Math.hypot(g.b.x - g.a.x, g.b.y - g.a.y);
const horiz = (g: OSeg) => Math.abs(g.a.y - g.b.y) < 1;
const vert = (g: OSeg) => Math.abs(g.a.x - g.b.x) < 1;

function pointSeg(p: Vec2, g: OSeg): number {
  const dx = g.b.x - g.a.x, dy = g.b.y - g.a.y, L2 = dx * dx + dy * dy;
  const t = L2 ? Math.max(0, Math.min(1, ((p.x - g.a.x) * dx + (p.y - g.a.y) * dy) / L2)) : 0;
  return Math.hypot(p.x - (g.a.x + t * dx), p.y - (g.a.y + t * dy));
}

/** 同じ向き・同じ線（near 以内）で重なる長さ */
function overlap(g: OSeg, h: OSeg, near: number): number {
  if (horiz(g) && horiz(h) && Math.abs(g.a.y - h.a.y) <= near) return Math.max(0, Math.min(Math.max(g.a.x, g.b.x), Math.max(h.a.x, h.b.x)) - Math.max(Math.min(g.a.x, g.b.x), Math.min(h.a.x, h.b.x)));
  if (vert(g) && vert(h) && Math.abs(g.a.x - h.a.x) <= near) return Math.max(0, Math.min(Math.max(g.a.y, g.b.y), Math.max(h.a.y, h.b.y)) - Math.max(Math.min(g.a.y, g.b.y), Math.min(h.a.y, h.b.y)));
  return 0;
}

/** 線分どうしが端以外で交わる */
function crossesInside(g: OSeg, h: OSeg): boolean {
  const o = (p: Vec2, q: Vec2, r: Vec2) => Math.sign((q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x));
  return o(g.a, g.b, h.a) * o(g.a, g.b, h.b) < 0 && o(h.a, h.b, g.a) * o(h.a, h.b, g.b) < 0;
}

export function closeOutline(ext: OSeg[], foot: OSeg[]): CloseResult | null {
  if (ext.length < 2) return null;
  const pts = new Map<string, Vec2>();
  const deg = new Map<string, number>();
  for (const g of ext) for (const p of [g.a, g.b]) { pts.set(key(p), p); deg.set(key(p), (deg.get(key(p)) ?? 0) + 1); }
  const odd = [...deg].filter(([, n]) => n % 2 === 1).map(([k]) => pts.get(k)!);
  if (!odd.length) return { add: [], demote: [] };

  /** つなぎの 1 本が使えるか（外壁と重ならない・交わらない・他の点を通らない・基礎の上を通る） */
  const legOk = (g: OSeg, ends: Vec2[]): boolean => {
    const L = len(g);
    if (L < 1 || L > (foot.length ? MAX_LEG : OPEN_MAX)) return false;
    if (ext.some((e) => overlap(g, e, 1) > 10 || crossesInside(g, e))) return false;
    if ([...pts.values()].some((p) => !ends.some((q) => key(q) === key(p)) && pointSeg(p, g) < 30)) return false;
    if (!foot.length) return true;
    const on = foot.reduce((s, f) => s + overlap(g, f, FOOT_NEAR), 0);
    return on >= L * FOOT_COVER;
  };
  /** u と v のつなぎ方（まっすぐ 1 本、または L 字 2 本） */
  type Link = { i: number; j: number; segs: OSeg[] };
  const links: Link[] = [];
  for (let i = 0; i < odd.length; i++) for (let j = i + 1; j < odd.length; j++) {
    const u = odd[i], v = odd[j];
    if (Math.abs(u.x - v.x) < 1 || Math.abs(u.y - v.y) < 1) {
      const g = norm(u, v);
      if (legOk(g, [u, v])) links.push({ i, j, segs: [g] });
    } else if (foot.length) {
      for (const c of [{ x: u.x, y: v.y }, { x: v.x, y: u.y }]) {
        if (pts.has(key(c))) continue;
        const g1 = norm(u, c), g2 = norm(c, v);
        if (legOk(g1, [u, c]) && legOk(g2, [c, v]) && !crossesInside(g1, g2)) links.push({ i, j, segs: [g1, g2] });
      }
    }
  }

  let best: { add: OSeg[]; demote: number[]; area: number; added: number } | null = null;
  let evals = 0;
  const evaluate = (chosen: Link[]) => {
    evals++;
    const add = chosen.flatMap((l) => l.segs);
    const all = [...ext.map((g, i) => ({ g, i })), ...add.map((g) => ({ g, i: -1 }))];
    const alive = new Set(all.map((_, k) => k));
    const at = new Map<string, number[]>();
    all.forEach((e, k) => { for (const p of [e.g.a, e.g.b]) (at.get(key(p)) ?? at.set(key(p), []).get(key(p))!).push(k); });
    const degOf = (p: string) => (at.get(p) ?? []).filter((k) => alive.has(k)).length;
    // 行き止まりを外す（つないだ線は外さない: 外すことになる組み合わせは採らない）
    for (let changed = true; changed;) {
      changed = false;
      for (const [p] of at) {
        if (degOf(p) !== 1) continue;
        const k = at.get(p)!.find((x) => alive.has(x))!;
        if (all[k].i < 0) return;
        alive.delete(k);
        changed = true;
      }
    }
    const live = [...alive];
    if (live.length < 4 || [...at.keys()].some((p) => { const d = degOf(p); return d !== 0 && d !== 2; })) return;
    // 1 つの輪か（たどって全部を回る）と、囲む面積
    const next = (p: string, from: number) => at.get(p)!.find((k) => alive.has(k) && k !== from)!;
    let k = live[0], p = key(all[k].g.a);
    const start = p;
    let area = 0, n = 0;
    do {
      const g = all[k].g, q = key(g.a) === p ? key(g.b) : key(g.a);
      const P = key(g.a) === p ? g.a : g.b, Q = key(g.a) === p ? g.b : g.a;
      area += P.x * Q.y - Q.x * P.y;
      n++;
      p = q;
      if (p === start) break;
      k = next(p, k);
    } while (n <= live.length);
    if (p !== start || n !== live.length) return;
    const added = add.reduce((s, g) => s + len(g), 0);
    const cand = { add, demote: ext.map((_, i) => i).filter((i) => !alive.has(i)), area: Math.abs(area) / 2, added };
    if (!best || cand.area > best.area + 1 || (Math.abs(cand.area - best.area) <= 1 && cand.added < best.added)) best = cand;
  };
  // 行き止まりの点ごとに「つながない」か「どれかとつなぐ」を選ぶ
  const used = new Set<number>();
  const chosen: Link[] = [];
  const search = (i: number) => {
    if (evals >= MAX_EVAL) return;
    while (i < odd.length && used.has(i)) i++;
    if (i >= odd.length) { evaluate(chosen); return; }
    search(i + 1);
    for (const l of links) {
      if (l.i !== i || used.has(l.j)) continue;
      used.add(i); used.add(l.j); chosen.push(l);
      search(i + 1);
      chosen.pop(); used.delete(i); used.delete(l.j);
    }
  };
  search(0);
  const b = best as { add: OSeg[]; demote: number[] } | null;
  return b ? { add: b.add, demote: b.demote } : null;
}
