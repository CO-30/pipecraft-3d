/**
 * 一続きの区間（継手なしで通り抜ける点でつながったまとまり）を端から順に並べ、
 * 長さに沿った位置の点を求める（部材図の支持金具・継ぎ足しソケットの位置）。
 */
import type { Network, Segment, Vec3 } from './network';

export type Leg = { seg: Segment; from: string; to: string };

/** まとまりを一筆書きの順に並べる（端の点から。輪なら任意の点から） */
export function orderChain(segs: Segment[]): Leg[] {
  if (segs.length === 0) return [];
  const byNode = new Map<string, Segment[]>();
  for (const s of segs) for (const n of [s.a, s.b]) { const a = byNode.get(n); if (a) a.push(s); else byNode.set(n, [s]); }
  const ends = [...byNode].filter(([, a]) => a.length === 1).map(([n]) => n).sort();
  const used = new Set<string>();
  const out: Leg[] = [];
  let cur = ends[0] ?? segs[0].a;
  while (out.length < segs.length) {
    const next = (byNode.get(cur) ?? []).find((s) => !used.has(s.id));
    if (!next) {
      // 分岐が混じる場合: 残りの区間をそのまま足す
      for (const s of segs) if (!used.has(s.id)) { used.add(s.id); out.push({ seg: s, from: s.a, to: s.b }); }
      break;
    }
    used.add(next.id);
    const to = next.a === cur ? next.b : next.a;
    out.push({ seg: next, from: cur, to });
    cur = to;
  }
  return out;
}

const lerp = (p: Vec3, q: Vec3, t: number): Vec3 => ({ x: p.x + (q.x - p.x) * t, y: p.y + (q.y - p.y) * t, z: p.z + (q.z - p.z) * t });

/**
 * 並べた区間の上で、割合 fracs（0〜1、全長に対する位置）の点。
 * 区間の長さは model 長（座標）で配分する。
 */
export function pointsAlong(net: Network, legs: Leg[], fracs: number[]): { pos: Vec3; segId: string }[] {
  const lens = legs.map((l) => {
    const p = net.nodes[l.from].pos, q = net.nodes[l.to].pos;
    return Math.hypot(q.x - p.x, q.y - p.y, q.z - p.z);
  });
  const total = lens.reduce((a, b) => a + b, 0);
  if (total <= 0 || legs.length === 0) return [];
  return fracs.map((f) => {
    let d = Math.min(Math.max(f, 0), 1) * total;
    for (let i = 0; i < legs.length; i++) {
      if (d <= lens[i] || i === legs.length - 1) {
        const t = lens[i] > 0 ? Math.min(1, d / lens[i]) : 0;
        return { pos: lerp(net.nodes[legs[i].from].pos, net.nodes[legs[i].to].pos, t), segId: legs[i].seg.id };
      }
      d -= lens[i];
    }
    return { pos: net.nodes[legs[0].from].pos, segId: legs[0].seg.id };
  });
}
