/**
 * 排水の高さの計算（純関数）。正は「平面ルート＋区間の勾配・管径＋ピン」。点の z とマスの管底はここで毎回決める。
 *  1. 系統の木（根 = 公共ます）を作る
 *  2. 固定点（根・zPin の点・invertPin のマス・床下から外へ出る所）どうしの間で、勾配の固定されていない区間に勾配を割り振る。
 *     公共ますまでの区間の勾配が強すぎるときは、標準の勾配のまま公共ますの手前のマスでドロップ（落差）にする（2026-11-13）
 *  3. 根から上流へ: 横の区間は 下流端 + 落差（マス）+ 勾配 × 平面の長さ。立て管は今の高さのまま（器具の接続口は動かさない）
 *  4. 床下は「床下から出る所（土間）」から器具へ（underfloorSlope）
 *  5. 床下より上流（床下から立ち上がった先）をもう一度 3 の決まりで
 */
import type { Doc } from '../doc';
import type { DrainRuleSet } from '../drainRules';
import { groundZAt, isManhole } from '../fixtures';
import { normalize, segmentsAt, validateNetwork, type Network, type Segment } from '../network';
import { defaultSlope as indoorMinSlope, isRiserLike, isSlopePinned, outerDiameter, planLength } from '../slope';
import { distToOutline, insideBuilding, isUnderfloorDrain, slopeUnderfloor, underfloorLevels } from '../underfloorSlope';
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
/** いちばん上流の外の管底（床下から外へ出る所）の初期値: GL − 370（ユーザーの標準 2026-11-13） */
export const EXIT_BELOW_GL = 370;
/** 床下から外へ出る所（基礎の内側で地中へ下ろした点）とみなす、外周からの距離(mm) */
const EXIT_NEAR_OUTLINE = 400;
/** 公共ますまでの勾配がこれより強ければドロップにする: 標準の 2 倍（2/100 より緩ければ 2/100）、最大勾配は超えない */
const steepLimit = (rules: DrainRuleSet, d: number) => Math.min(rules.maxSlope(d) * 0.999, Math.max(2 * rules.defaultSlope(d), 0.02));
const isPublicType = (t: string) => t === 'publicSewage' || t === 'publicRain';

export function solveHeights(doc: Doc, rules: DrainRuleSet): SolveHeightsResult {
  // 1 回目: 床下から外へ出る所をすべて KSA の高さに固定。合流する短い枝が急になりすぎたら、その出口は固定せずに 2 回目
  const first = solveCore(doc, rules, null);
  if (!first.steepExits.size) return first.result;
  return solveCore(doc, rules, first.steepExits).result;
}

function solveCore(doc: Doc, rules: DrainRuleSet, floatExits: Set<string> | null): { result: SolveHeightsResult; steepExits: Set<string> } {
  const trees = buildDrainTrees(doc);
  const lv = underfloorLevels(doc);
  const empty = { low: 0, over: 0, raised: 0 };
  const none = new Set<string>();
  if (!trees.length) return { result: { doc, segSlopes: {}, trees, underfloor: empty, failed: false }, steepExits: none };
  const net0 = doc.network;
  const z = new Map<string, number>(Object.values(net0.nodes).map((n) => [n.id, n.pos.z]));
  const fxOf = (id: string) => { const f = net0.nodes[id]?.fixtureId; return f ? doc.fixtures[f] : undefined; };
  /** 公共ますの手前のドロップ（勾配が強すぎるとき自動で付ける落差。マスの点 → mm） */
  const autoDrop = new Map<string, number>();
  /** 管ごとのドロップ: 下流のマスへ高く着く管（区間 → mm）。マスの外で L で落としてつなぐ */
  const segDrop = new Map<string, number>();
  /** マス（公共ます以外）の流入側の落差 */
  const dropOf = (id: string) => {
    const f = fxOf(id);
    if (!f || !isManhole(f.type)) return 0;
    // 公共ますは管底を食い違わせない（使う人が落差を入れたとき・手前にマスが無くてドロップするときだけ）
    return (isPublicType(f.type) ? f.params?.drop ?? 0 : Math.max(f.params?.drop ?? 0, rules.drop)) + (autoDrop.get(id) ?? 0);
  };
  const ufSegs = new Set(lv ? Object.values(net0.segments).filter((s) => isUnderfloorDrain(net0, s, lv)).map((s) => s.id) : []);
  const ufNodes = new Set([...ufSegs].flatMap((id) => [net0.segments[id].a, net0.segments[id].b]));
  /** 立て管（少し斜めでも、高さの差が平面の長さより大きい管は立て管として今の高さのまま） */
  const vertical = (s: Segment) => isRiserLike(net0, s);
  const defaultFor = (s: Segment) => {
    const a = net0.nodes[s.a].pos, b = net0.nodes[s.b].pos;
    // 床より上の建物の中（床上排水・上の階）は屋内の最小勾配、それ以外（屋外・地中）は自治体の既定
    const indoor = !!lv && a.z >= lv.floor - 1 && b.z >= lv.floor - 1 && insideBuilding(lv, { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
    return indoor ? indoorMinSlope(s.diameter) : rules.defaultSlope(s.diameter);
  };
  /**
   * 床下から外へ出る所（前澤 KSA の外の口）: 床下から下りてきた立て管の下の端で、外周の基礎のすぐ内側・土間より下にあり、
   * そこから建物の外へ出る点。いちばん上流の外の管底なので、公共ますの深さに引きずられないよう固定点にする。
   * 高さは GL − 370（ユーザーの標準）。ここから公共ますへ下る
   */
  const exitZ = new Map<string, number>();
  if (lv?.outline.length) {
    for (const n of Object.values(net0.nodes)) {
      if (n.fixtureId || n.zPin || n.pos.z >= lv.slab - 1) continue;
      const segs = segmentsAt(net0, n.id).filter((s) => s.system === 'drain' || s.system === 'sewage');
      if (segs.length !== 2) continue;
      const riser = segs.find((s) => vertical(s)), out = segs.find((s) => !vertical(s));
      if (!riser || !out) continue;
      const top = net0.nodes[riser.a === n.id ? riser.b : riser.a];
      if (top.pos.z <= n.pos.z || !ufNodes.has(top.id) || !insideBuilding(lv, top.pos)) continue;
      // 外周の基礎のすぐ内（真下へ下ろした形）か、外の面（45° で抜けた形）にあり、そこから建物の外へ出る点
      if (distToOutline(lv, n.pos) > EXIT_NEAR_OUTLINE) continue;
      if (insideBuilding(lv, net0.nodes[out.a === n.id ? out.b : out.a].pos)) continue;
      // GL−370。自治体の土かぶりが深ければそれを守り、床下の配管より 100 は下げる（器具の真下に深く落とした所など）
      const g = groundZAt(doc.building, doc.site, n.pos);
      if (!floatExits?.has(n.id)) exitZ.set(n.id, Math.round(Math.min(g - EXIT_BELOW_GL, g - rules.cover - outerDiameter(out.diameter), top.pos.z - 100)));
    }
    for (const [id, zz] of exitZ) z.set(id, zz);
  }
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
    /** 先に決めた（長い方の）経路の点。後の経路はここで止めて、間に割り振る */
    const settled = new Set<string>();
    const anchor = (id: string) => {
      if (id === t.root || settled.has(id)) return true;
      const n = net0.nodes[id];
      if (n.zPin || exitZ.has(id)) return true;
      const f = fxOf(id);
      // 公共ますの管底は現地で決まっている値なので、いつも固定点
      return !!f && isManhole(f.type) && (!!f.params?.invertPin || isPublicType(f.type));
    };
    const down = (id: string) => { const sid = t.parent.get(id)!; const s = net0.segments[sid]; return { s, p: s.a === id ? s.b : s.a }; };
    const slopeOverride = new Map<string, number>();
    // 2. 固定点の間に勾配を割り振る（間に立て管・床下があれば割り振らない）。公共ますから遠い固定点から（幹を先に決める）
    const distRoot = new Map<string, number>([[t.root, 0]]);
    for (const n of t.order) if (n !== t.root) { const { s, p } = down(n); distRoot.set(n, (distRoot.get(p) ?? 0) + planLength(net0, s)); }
    const tops = t.order.filter((a) => a !== t.root && anchor(a)).sort((x, y) => (distRoot.get(y) ?? 0) - (distRoot.get(x) ?? 0));
    for (const a of tops) {
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
      const isFree = (s: Segment) => !(isSlopePinned(s) && s.slope !== undefined);
      const r = (z.get(a)! - z.get(cur)! - drops - fixed) / free;
      // 公共ますまでの勾配が強すぎる: 標準の勾配のまま、差を公共ますの手前のマス（無ければ公共ますへ入る所）のドロップにする
      const last = path[path.length - 1];
      const m = last.a === cur ? last.b : last.a;
      const fm = fxOf(m);
      const at = fm && isManhole(fm.type) && !isPublicType(fm.type) && m !== a ? m : t.root;
      const std = path.filter(isFree).reduce((sum, s) => sum + defaultFor(s) * planLength(net0, s), 0);
      const extra = Math.round(z.get(a)! - z.get(cur)! - drops - fixed - std);
      // ドロップは 1 つのマスに 1 回だけ（先に決めた経路の高さを変えない）。差が無ければ割り振る
      const steep = extra > 0 && path.some((s) => isFree(s) && r > steepLimit(rules, s.diameter));
      const fc = fxOf(cur);
      if (cur === t.root && steep && !autoDrop.has(at)) {
        autoDrop.set(at, extra);
        for (const s of path) if (isFree(s)) slopeOverride.set(s.id, defaultFor(s));
      } else if (cur !== t.root && steep && fc && isManhole(fc.type)) {
        // 先に決めたマス（合流・手で管底を入れたマス）へ高く着く: 標準の勾配で行き、マスの外で L で落としてつなぐ
        segDrop.set(last.id, extra);
        for (const s of path) if (isFree(s)) slopeOverride.set(s.id, defaultFor(s));
      } else for (const s of path) if (isFree(s)) slopeOverride.set(s.id, r);
      // 経路の点の高さを下から決めて、後の経路の止まる所にする
      let lo = cur, zz = z.get(cur)!;
      for (let i = path.length - 1; i >= 0; i--) {
        const s = path[i], up = s.a === lo ? s.b : s.a;
        zz = zz + dropOf(lo) + (segDrop.get(s.id) ?? 0) + (isFree(s) ? slopeOverride.get(s.id)! : s.slope!) * planLength(net0, s);
        // 器具の接続口（マス以外）は動かさない
        const fu = fxOf(up);
        if (up !== a && !(fu && !isManhole(fu.type))) { z.set(up, r1(zz)); settled.add(up); }
        lo = up;
      }
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
        z.set(n, r1(z.get(p)! + dropOf(p) + (segDrop.get(s.id) ?? 0) + r * planLength(net0, s)));
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
    // 管ごとのドロップ（計算の写し）。無くなった所（木から外れた管を含む）は消す
    for (const s of Object.values(segments)) {
      const d = Math.round(segDrop.get(s.id) ?? 0);
      if (d >= 1 && s.dropEnd !== d) segments[s.id] = { ...s, dropEnd: d };
      else if (d < 1 && s.dropEnd !== undefined) { const { dropEnd: _d, ...rest } = s; segments[s.id] = rest; }
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
  const fixturesChanged = [...fixtureIds].some(([fid, zz]) => !doc.fixtures[fid].params?.invertPin && doc.fixtures[fid].params?.invertZ !== zz);
  // 何も変わらなければ同じ doc（履歴を増やさない・描き直しを起こさない）
  const same = (a: Network) => Object.values(a.nodes).every((n) => { const o = net0.nodes[n.id]; return o && o.pos.z === n.pos.z && o.dropIn === n.dropIn; })
    && Object.values(a.segments).every((x) => net0.segments[x.id]?.slope === x.slope && net0.segments[x.id]?.dropEnd === x.dropEnd);
  // 合流する枝で、KSA の高さに固定した出口から急になりすぎた所（2 回目は固定しない）
  const steepExits = new Set<string>();
  for (const id of exitZ.keys()) {
    const t = trees.find((x) => x.parent.has(id));
    const sid = t?.parent.get(id);
    const sg = sid ? net0.segments[sid] : undefined;
    // 急すぎる、または公共ますが浅くて下りにならない出口は、2 回目は固定しない（下流から決める）。緩いだけなら GL−370 のまま（検査で知らせる）
    const sl = sg ? segSlopes[sg.id] ?? 0 : 0;
    if (sg && (sl > steepLimit(rules, sg.diameter) || sl <= 0)) steepExits.add(id);
  }
  if (!fixturesChanged && same(net)) return { result: { doc, segSlopes, trees, underfloor, failed: false }, steepExits };
  // 高さが変わると継手の種類（直線の継ぎ目・曲がり）が変わることがあるので付け直す
  net = normalize(net);
  if (validateNetwork(net).length) return { result: { doc, segSlopes, trees, underfloor, failed: true }, steepExits };
  let fixtures = doc.fixtures;
  for (const [fid, zz] of fixtureIds) {
    const f = fixtures[fid];
    if (f.params?.invertPin || f.params?.invertZ === zz) continue;
    fixtures = { ...fixtures, [fid]: { ...f, params: { ...(f.params ?? {}), invertZ: zz } } };
  }
  return { result: { doc: { ...doc, network: net, fixtures }, segSlopes, trees, underfloor, failed: false }, steepExits };
}
