/**
 * 排水縦断図の計算モデル（純粋関数）。
 * - extractRoute: 下流端（公共マスなど）から上流へ排水系の配管をたどって主経路を決める。
 * - buildProfile: 経路の各点の累加距離・地盤高・管底高・土被り、各区間の距離・勾配・管種口径と警告。
 * 単位は mm。表示のための丸め・単位変換は描画側で行う。
 */
import type { Doc } from './doc';
import { floorById } from './building';
import { FIXTURE_CATALOG, groundZ, isManhole, manholeDepth, type FixtureType } from './fixtures';
import { formatSlope, minSlopeFor, type MunicipalityProfile } from './municipality';
import type { Network, Segment } from './network';
import { isDrain, planLength } from './slope';

export type RouteResult = { route: string[]; branches: { atNodeId: string; nodeIds: string[] }[] } | { error: string };

/** VU/VP 管の外径(mm)。表に無い口径は 1.1 倍 */
export const OUTER_DIAMETER: Record<number, number> = { 40: 48, 50: 60, 65: 76, 75: 89, 100: 114, 125: 140, 150: 165, 200: 216 };
export const outerDiameter = (nominal: number) => OUTER_DIAMETER[nominal] ?? Math.round(nominal * 1.1);

export type ProfileWarning = { kind: 'minSlope' | 'reverseSlope' | 'cover' | 'tentativeGL'; segId?: string; nodeId?: string; message: string };
export type ProfileNode = {
  nodeId: string; cumDistance: number; groundLevel: number; invertLevel: number; cover: number;
  manhole?: { type: FixtureType; label: string; diameter: number; depth: number; symbol: string };
};
export type ProfileSegment = { segId: string; distance: number; slope: number | null; slopeText: string; diameter: number; material: string; pipeSpec: string };
export type ProfileModel = { nodes: ProfileNode[]; segments: ProfileSegment[]; warnings: ProfileWarning[]; tentativeGL: boolean; profile: MunicipalityProfile; title: string };

/** ノードにつながる排水系の区間 */
function drainSegmentsAt(net: Network, nodeId: string): Segment[] {
  return Object.values(net.segments).filter((s) => isDrain(s.system) && (s.a === nodeId || s.b === nodeId));
}
const otherEnd = (s: Segment, id: string) => (s.a === id ? s.b : s.a);

/**
 * outlet から上流へ向かう木。parent[node] = 来た区間。閉路があれば null。
 * 器具の接続口は「その器具がマスなら通過できる」。他の器具（トイレなど）は端。
 */
function upstreamTree(net: Network, outletId: string): { children: Map<string, string[]>; order: string[] } | null {
  const children = new Map<string, string[]>();
  const seen = new Set<string>([outletId]);
  const order: string[] = [];
  const stack = [outletId];
  while (stack.length) {
    const cur = stack.pop()!;
    order.push(cur);
    const kids: string[] = [];
    for (const s of drainSegmentsAt(net, cur)) {
      const o = otherEnd(s, cur);
      if (seen.has(o)) {
        // 親へ戻る辺は無視。それ以外の既訪問は閉路
        const parentOf = [...children.entries()].find(([, ks]) => ks.includes(cur))?.[0];
        if (o !== parentOf) return null;
        continue;
      }
      seen.add(o);
      kids.push(o);
      stack.push(o);
    }
    children.set(cur, kids);
  }
  return { children, order };
}

/** 上流側へ 2 本以上に分かれる点とその隣ノード */
export function branchPoints(net: Network, outletId: string): { nodeId: string; options: string[] }[] {
  const t = upstreamTree(net, outletId);
  if (!t) return [];
  return [...t.children.entries()].filter(([, ks]) => ks.length >= 2).map(([nodeId, options]) => ({ nodeId, options }));
}

/** node から上流へのいちばん長い水平距離（枝の自動選択用） */
function longest(net: Network, children: Map<string, string[]>, node: string): number {
  let best = 0;
  for (const k of children.get(node) ?? []) {
    const s = drainSegmentsAt(net, node).find((x) => otherEnd(x, node) === k)!;
    best = Math.max(best, planLength(net, s) + longest(net, children, k));
  }
  return best;
}

/**
 * 下流端 outletId から上流へ排水系の区間をたどって主経路を決める。
 * choice: 分岐点ごとに本線として進む隣ノード。未指定の分岐はいちばん長い枝を本線にし、他は branches（分岐点から始まる枝の経路）
 */
export function extractRoute(net: Network, outletId: string, choice: Record<string, string> = {}): RouteResult {
  if (!net.nodes[outletId] || drainSegmentsAt(net, outletId).length === 0) return { error: '排水の配管がつながっていません' };
  const t = upstreamTree(net, outletId);
  if (!t) return { error: '経路が輪になっています' };
  const { children } = t;
  const branches: { atNodeId: string; nodeIds: string[] }[] = [];
  const walk = (start: string, pickMain: boolean): string[] => {
    const path = [start];
    let cur = start;
    while (true) {
      const kids = children.get(cur) ?? [];
      if (kids.length === 0) break;
      let next: string;
      if (kids.length === 1) next = kids[0];
      else {
        const chosen = pickMain && choice[cur] && kids.includes(choice[cur]) ? choice[cur] : kids.slice().sort((p, q) => longest(net, children, q) - longest(net, children, p))[0];
        next = chosen;
        if (pickMain) for (const k of kids) if (k !== chosen) branches.push({ atNodeId: cur, nodeIds: [cur, ...walk(k, false)] });
      }
      path.push(next);
      cur = next;
    }
    return path;
  };
  const route = walk(outletId, true);
  return { route, branches };
}

/**
 * 経路（下流→上流）を最上流のマスで切る（マスより先の屋内配管は縦断図に含めない）。
 * 経路に下流端以外のマスが無ければそのまま返す。
 */
export function trimToManholes(doc: Doc, route: string[]): string[] {
  let last = -1;
  route.forEach((id, i) => {
    const fx = doc.network.nodes[id]?.fixtureId ? doc.fixtures[doc.network.nodes[id].fixtureId!] : undefined;
    if (i > 0 && fx && isManhole(fx.type)) last = i;
  });
  return last > 0 ? route.slice(0, last + 1) : route;
}

/** 経路（下流→上流）から縦断図のモデルを作る。図は上流を左に描くので nodes は上流→下流で返す */
export function buildProfile(doc: Doc, route: string[], profile: MunicipalityProfile, title: string): ProfileModel {
  const net = doc.network;
  const ids = route.slice().reverse(); // 上流 → 下流
  const tentativeGL = doc.site?.designGL === undefined;
  const warnings: ProfileWarning[] = [];
  if (tentativeGL) warnings.push({ kind: 'tentativeGL', message: '設計GL が未入力のため、仮の地盤高（1階の床と同じ高さ）で描いています' });
  const firstFloor = doc.building.floors[0];
  const glOf = (nodeId: string) => {
    const n = net.nodes[nodeId];
    if (n.groundLevel !== undefined) return n.groundLevel;
    const fl = (n.floorId && floorById(doc.building, n.floorId)) || firstFloor;
    return groundZ(fl, doc.site);
  };
  const nodes: ProfileNode[] = [];
  const segments: ProfileSegment[] = [];
  let cum = 0;
  for (let i = 0; i < ids.length; i++) {
    const id = ids[i];
    const n = net.nodes[id];
    const seg = i > 0 ? drainSegmentsAt(net, id).find((s) => otherEnd(s, id) === ids[i - 1]) : undefined;
    if (seg) {
      const L = planLength(net, seg);
      cum += L;
      const up = net.nodes[ids[i - 1]].pos.z, down = n.pos.z;
      const riser = L < 1;
      const slope = riser ? null : (up - down) / L;
      const material = seg.material || 'VU';
      segments.push({ segId: seg.id, distance: L, slope, slopeText: riser ? '立管' : formatSlope(Math.max(0, slope!), profile.profileTable.slopeFormat), diameter: seg.diameter, material, pipeSpec: `${material}φ${seg.diameter}` });
      if (!riser) {
        if (slope! < -1e-9) warnings.push({ kind: 'reverseSlope', segId: seg.id, message: `区間 ${segments.length}: 逆勾配（下流のほうが高い）` });
        else {
          const need = minSlopeFor(profile, seg.diameter);
          if (need !== undefined && slope! + 1e-9 < need) warnings.push({ kind: 'minSlope', segId: seg.id, message: `区間 ${segments.length}: φ${seg.diameter} の最小勾配 ${formatSlope(need, profile.profileTable.slopeFormat)} より緩い（${formatSlope(slope!, profile.profileTable.slopeFormat)}）` });
        }
      }
    }
    // 土被り: 地盤高 − (管底高 + 外径)。外径はこの点につながる区間の最大口径
    const dias = drainSegmentsAt(net, id).map((s) => s.diameter);
    const od = dias.length ? outerDiameter(Math.max(...dias)) : 0;
    const gl = glOf(id);
    const cover = gl - (n.pos.z + od);
    const fx = n.fixtureId ? doc.fixtures[n.fixtureId] : undefined;
    const fl = fx ? floorById(doc.building, fx.floorId) : undefined;
    const manhole = fx && fl && isManhole(fx.type)
      ? { type: fx.type, label: FIXTURE_CATALOG[fx.type].label, diameter: fx.params?.diameter ?? 300, depth: manholeDepth(fx, fl, doc.site), symbol: profile.symbols[fx.type] ?? 'circle' }
      : undefined;
    nodes.push({ nodeId: id, cumDistance: cum, groundLevel: gl, invertLevel: n.pos.z, cover, manhole });
    if (od && cover + 1e-9 < profile.profileTable.minCover) warnings.push({ kind: 'cover', nodeId: id, message: `点 ${nodes.length}: 土被り ${Math.round(cover)}mm が最小 ${profile.profileTable.minCover}mm より少ない` });
  }
  return { nodes, segments, warnings, tentativeGL, profile, title };
}
