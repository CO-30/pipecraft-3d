/**
 * 排水の高さの計算（純関数）。正は「平面ルート＋区間の勾配・管径＋ピン」。点の z とマスの管底はここで毎回決める。
 *  1. 系統の木（根 = 公共ます）を作る
 *  2. 固定点（根・zPin の点・invertPin のマス）どうしの間で、勾配の固定されていない区間に勾配を割り振る
 *  3. 根から上流へ: 横の区間は 下流端 + 落差（マス）+ 勾配 × 平面の長さ。立て管は今の高さのまま（器具の接続口は動かさない）
 *  4. 床下は「床下から出る所（土間）」から器具へ（underfloorSlope）
 *  5. 床下より上流（床下から立ち上がった先）をもう一度 3 の決まりで
 */
import type { Doc } from '../doc';
import type { DrainRuleSet } from '../drainRules';
import { isManhole } from '../fixtures';
import { normalize, validateNetwork, type Network, type Segment } from '../network';
import { defaultSlope as indoorMinSlope, isSlopePinned, planLength } from '../slope';
import { insideBuilding, isUnderfloorDrain, slopeUnderfloor, underfloorLevels } from '../underfloorSlope';
import { buildDrainTrees, type DrainTree } from './tree';

export type SolveHeightsResult = {
  doc: Doc;
  /** 横の区間に使った勾配（比率）。割り振った勾配・固定した勾配を含む */
  segSlopes: Record<string, number>;
  trees: DrainTree[];
  /** 床下: 1.5/100 に下げた・それでも基礎天端を超えた・起点を上げた系統の数 */
  underfloor: { low: number; over: number; raised: number };
  /** 計算すると配管が壊れる（長さ 0 など）ため、元の高さのままにした */
  failed: boolean;
};

const r1 = (z: number) => Math.round(z * 10) / 10;
const isPublicType = (t: string) => t === 'publicSewage' || t === 'publicRain';

export function solveHeights(doc: Doc, rules: DrainRuleSet): SolveHeightsResult {
  const trees = buildDrainTrees(doc);
  const lv = underfloorLevels(doc);
  const empty = { low: 0, over: 0, raised: 0 };
  if (!trees.length) return { doc, segSlopes: {}, trees, underfloor: empty, failed: false };
  const net0 = doc.network;
  const z = new Map<string, number>(Object.values(net0.nodes).map((n) => [n.id, n.pos.z]));
  const fxOf = (id: string) => { const f = net0.nodes[id]?.fixtureId; return f ? doc.fixtures[f] : undefined; };
  /** マス（公共ます以外）の流入側の落差 */
  const dropOf = (id: string) => {
    const f = fxOf(id);
    if (!f || !isManhole(f.type)) return 0;
    // 公共ますは管底を食い違わせない（使う人が落差を入れたときだけ）
    return isPublicType(f.type) ? f.params?.drop ?? 0 : Math.max(f.params?.drop ?? 0, rules.drop);
  };
  const ufSegs = new Set(lv ? Object.values(net0.segments).filter((s) => isUnderfloorDrain(net0, s, lv)).map((s) => s.id) : []);
  const ufNodes = new Set([...ufSegs].flatMap((id) => [net0.segments[id].a, net0.segments[id].b]));
  const vertical = (s: Segment) => planLength(net0, s) < 1;
  const defaultFor = (s: Segment) => {
    const a = net0.nodes[s.a].pos, b = net0.nodes[s.b].pos;
    // 床より上の建物の中（床上排水・上の階）は屋内の最小勾配、それ以外（屋外・地中）は自治体の既定
    const indoor = !!lv && a.z >= lv.floor - 1 && b.z >= lv.floor - 1 && insideBuilding(lv, { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
    return indoor ? indoorMinSlope(s.diameter) : rules.defaultSlope(s.diameter);
  };
  const segSlopes: Record<string, number> = {};
  const fixtureIds = new Map<string, number>(); // マスの管底（fixtureId → z）
  const childrenOf = new Map<string, number>();
  const sweeps: (() => void)[] = [];

  for (const t of trees) {
    for (const [n, sid] of t.parent) {
      const s = net0.segments[sid];
      const p = s.a === n ? s.b : s.a;
      childrenOf.set(p, (childrenOf.get(p) ?? 0) + 1);
    }
    const anchor = (id: string) => {
      if (id === t.root) return true;
      const n = net0.nodes[id];
      if (n.zPin) return true;
      const f = fxOf(id);
      return !!f && isManhole(f.type) && !!f.params?.invertPin;
    };
    const down = (id: string) => { const sid = t.parent.get(id)!; const s = net0.segments[sid]; return { s, p: s.a === id ? s.b : s.a }; };
    const slopeOverride = new Map<string, number>();
    // 2. 固定点の間に勾配を割り振る（間に立て管・床下があれば割り振らない）
    for (const a of t.order) {
      if (a === t.root || !anchor(a)) continue;
      const path: Segment[] = [];
      let cur = a, ok = true;
      while (cur !== t.root && !(cur !== a && anchor(cur))) {
        const { s, p } = down(cur);
        if (vertical(s) || ufSegs.has(s.id)) { ok = false; break; }
        path.push(s);
        cur = p;
      }
      if (!ok || !path.length) continue;
      let fixed = 0, free = 0;
      for (const s of path) {
        const L = planLength(net0, s);
        if (isSlopePinned(s) && s.slope !== undefined) fixed += s.slope * L; else free += L;
      }
      // 経路の途中のマス（と下端のマス）の落差
      let drops = 0;
      cur = a;
      for (const s of path) { const p = s.a === cur ? s.b : s.a; drops += dropOf(p); cur = p; }
      if (free <= 0) continue;
      const r = (z.get(a)! - z.get(cur)! - drops - fixed) / free;
      for (const s of path) if (!(isSlopePinned(s) && s.slope !== undefined)) slopeOverride.set(s.id, r);
    }
    // 3. 根から上流へ
    const sweep = () => {
      for (const n of t.order) {
        if (n === t.root || anchor(n) || ufNodes.has(n)) continue;
        const f = fxOf(n);
        if (f && !isManhole(f.type)) continue; // 器具の接続口
        const { s, p } = down(n);
        if (vertical(s)) continue; // 立て管: 今の高さのまま
        const r = isSlopePinned(s) && s.slope !== undefined ? s.slope : slopeOverride.get(s.id) ?? defaultFor(s);
        segSlopes[s.id] = r;
        z.set(n, r1(z.get(p)! + dropOf(p) + r * planLength(net0, s)));
      }
      // 割り振った区間（上端が固定点）の勾配も記録
      for (const [sid, r] of slopeOverride) segSlopes[sid] = r;
    };
    sweep();
    sweeps.push(sweep);
  }

  // 計算した高さを写す（マスは管底も）
  const apply = (net: Network): Network => {
    const nodes = { ...net.nodes };
    for (const [id, zz] of z) {
      const n = nodes[id];
      if (!n) continue;
      let next = n;
      if (Math.abs(n.pos.z - zz) >= 0.05) next = { ...next, pos: { ...next.pos, z: zz } };
      const f = fxOf(id);
      if (f && isManhole(f.type)) {
        const d = (childrenOf.get(id) ?? 0) > 0 || isPublicType(f.type) ? dropOf(id) : 0;
        if ((next.dropIn ?? 0) !== d) { const { dropIn: _d, ...rest } = next; next = d ? { ...rest, dropIn: d } : rest; }
        fixtureIds.set(f.id, zz);
      }
      if (next !== n) nodes[id] = next;
    }
    const segments = { ...net.segments };
    for (const [sid, r] of Object.entries(segSlopes)) {
      const s = segments[sid];
      if (s && !isSlopePinned(s) && s.slope !== r) segments[sid] = { ...s, slope: r };
    }
    return { nodes, segments };
  };
  let net = apply(net0);
  // 4. 床下
  let underfloor = empty;
  if (lv && ufSegs.size) {
    const u = slopeUnderfloor({ ...doc, network: net }, { ratio: (d, low) => rules.underfloorSlope(d, low) });
    net = u.net;
    underfloor = { low: u.low, over: u.over, raised: u.raised };
    for (const n of Object.values(net.nodes)) z.set(n.id, n.pos.z);
    for (const id of ufSegs) { const s = net.segments[id]; if (s?.slope !== undefined) segSlopes[id] = s.slope; }
    // 5. 床下より上流をもう一度
    for (const sw of sweeps) sw();
    net = apply(net);
  }
  // 高さが変わると継手の種類（直線の継ぎ目・曲がり）が変わることがあるので付け直す
  net = normalize(net);
  if (validateNetwork(net).length) return { doc, segSlopes, trees, underfloor, failed: true };
  let fixtures = doc.fixtures;
  for (const [fid, zz] of fixtureIds) {
    const f = fixtures[fid];
    if (f.params?.invertPin || f.params?.invertZ === zz) continue;
    fixtures = { ...fixtures, [fid]: { ...f, params: { ...(f.params ?? {}), invertZ: zz } } };
  }
  return { doc: { ...doc, network: net, fixtures }, segSlopes, trees, underfloor, failed: false };
}
