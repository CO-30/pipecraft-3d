/**
 * 排水の系統の木。排水・汚水の区間（立て管を含む）のつながりごとに、いちばん下流（根）から上流へたどる。
 * 根: 公共ますの接続口 → 無ければ管底のいちばん低いマス → 無ければ外壁にいちばん近い端（いちばん低い点）
 */
import type { Doc } from '../doc';
import { isManhole } from '../fixtures';
import type { Segment } from '../network';

export type DrainTree = {
  root: string;
  /** 点 → 下流へ向かう区間 */
  parent: Map<string, string>;
  /** 根から上流への順 */
  order: string[];
  /** 木に入らなかった区間（輪になっている所） */
  loops: string[];
  /** 根が公共ますか */
  public: boolean;
};

export const isDrainSeg = (s: Segment) => s.system === 'drain' || s.system === 'sewage';
const isPublic = (t: string) => t === 'publicSewage' || t === 'publicRain';

export function buildDrainTrees(doc: Doc): DrainTree[] {
  const net = doc.network;
  const byNode = new Map<string, Segment[]>();
  for (const s of Object.values(net.segments)) {
    if (!isDrainSeg(s)) continue;
    for (const n of [s.a, s.b]) byNode.set(n, [...(byNode.get(n) ?? []), s]);
  }
  const fx = (id: string) => { const f = net.nodes[id]?.fixtureId; return f ? doc.fixtures[f] : undefined; };
  const seen = new Set<string>();
  const trees: DrainTree[] = [];
  for (const start of byNode.keys()) {
    if (seen.has(start)) continue;
    // まとまりの点を集める
    const comp: string[] = [];
    const stack = [start];
    seen.add(start);
    while (stack.length) {
      const id = stack.pop()!;
      comp.push(id);
      for (const s of byNode.get(id) ?? []) { const o = s.a === id ? s.b : s.a; if (!seen.has(o)) { seen.add(o); stack.push(o); } }
    }
    const z = (id: string) => net.nodes[id].pos.z;
    const pub = comp.filter((id) => { const f = fx(id); return f && isPublic(f.type); }).sort((p, q) => z(p) - z(q));
    const mh = comp.filter((id) => { const f = fx(id); return f && isManhole(f.type); }).sort((p, q) => z(p) - z(q));
    // マスが無ければいちばん低い端（器具の接続口でない、つながりが 1 本の点）
    const ends = comp.filter((id) => !net.nodes[id].fixtureId && (byNode.get(id)?.length ?? 0) === 1).sort((p, q) => z(p) - z(q));
    const root = pub[0] ?? mh[0] ?? ends[0] ?? comp.sort((p, q) => z(p) - z(q))[0];
    const parent = new Map<string, string>();
    const order = [root];
    const visited = new Set([root]);
    const used = new Set<string>();
    for (let i = 0; i < order.length; i++) {
      const id = order[i];
      for (const s of byNode.get(id) ?? []) {
        if (used.has(s.id)) continue;
        const o = s.a === id ? s.b : s.a;
        if (visited.has(o)) continue;
        used.add(s.id);
        visited.add(o);
        parent.set(o, s.id);
        order.push(o);
      }
    }
    const segs = new Set(comp.flatMap((id) => (byNode.get(id) ?? []).map((s) => s.id)));
    const loops = [...segs].filter((id) => !used.has(id));
    trees.push({ root, parent, order, loops, public: pub.length > 0 });
  }
  return trees;
}
