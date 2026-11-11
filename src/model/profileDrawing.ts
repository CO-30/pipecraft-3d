/**
 * 排水縦断図の計算モデル（純粋関数）。
 * - extractRoute: 下流端（公共マスなど）から上流へ排水系の配管をたどって主経路を決める。
 * - buildProfile: 経路の各点の累加距離・地盤高・管底高・土被り、各区間の距離・勾配・管種口径と警告。
 * 単位は mm。表示のための丸め・単位変換は描画側で行う。
 */
import { groundAt } from './ground';
import type { Doc } from './doc';
import { floorById } from './building';
import { FIXTURE_CATALOG, groundZ, isManhole, manholeDepth, type FixtureType } from './fixtures';
import { formatSlope, minSlopeFor, type MunicipalityProfile } from './municipality';
import type { Network, Segment } from './network';
import { isDrain, planLength } from './slope';

export type RouteResult = {
  route: string[];
  branches: { atNodeId: string; nodeIds: string[] }[];
  /** 枝の中にさらにあった分岐（図に含めていない。警告用） */
  omitted: { atNodeId: string }[];
} | { error: string };

/** VU/VP 管の外径(mm)。表に無い口径は 1.1 倍 */
export const OUTER_DIAMETER: Record<number, number> = { 40: 48, 50: 60, 65: 76, 75: 89, 100: 114, 125: 140, 150: 165, 200: 216 };
export const outerDiameter = (nominal: number) => OUTER_DIAMETER[nominal] ?? Math.round(nominal * 1.1);

export type ProfileWarning = { kind: 'minSlope' | 'reverseSlope' | 'cover' | 'tentativeGL' | 'datum'; segId?: string; nodeId?: string; message: string };
export type ProfileNode = {
  nodeId: string; cumDistance: number; groundLevel: number; invertLevel: number; cover: number;
  manhole?: { type: FixtureType; label: string; diameter: number; depth: number; symbol: string; /** 公共マス（±0 の基準。色は新設/既設で決める） */ isPublic: boolean; /** 図に書く名前（manholeLabel above のとき上流から NO.1〜。公共マスは種類名） */ name: string; /** 落差桝: 流入側の深さ(mm) */ depthIn?: number };
  /** 落差桝: 流入側の管底高（invertLevel は流出側）。上流の区間はここに着く */
  invertIn?: number;
  /** 落差桝: 流入側の土被り */
  coverIn?: number;
  /** datum publicInvert のとき: 下流端の地盤高との差(mm) */
  glDiff?: number;
  /** 分岐点の注記（「→別図 枝1」など） */
  note?: string;
  /** 既設のマス（青で描く） */
  existing?: boolean;
};
export type ProfileSegment = { segId: string; distance: number; slope: number | null; slopeText: string; diameter: number; material: string; pipeSpec: string; /** 既設（青） */ existing?: boolean };
export type ProfileModel = {
  nodes: ProfileNode[]; segments: ProfileSegment[]; warnings: ProfileWarning[]; tentativeGL: boolean; profile: MunicipalityProfile; title: string;
  /** 高さの基準の注記（datum publicInvert のとき） */
  datumLabel?: string;
  /** 基準にした管底高（絶対 mm）。枝の図に同じ基準を渡すため */
  datumZ?: number;
  /** この図で振った NO. の数（枝の図は続きから） */
  manholeCount: number;
};

export type BuildProfileOpts = {
  /** 枝の図: 本線の基準（公共桝の管底、絶対 mm） */
  datumZ?: number;
  /** 枝の図: NO. をこの数の次から振る */
  manholeNoStart?: number;
};

/** 管種口径の表記 */
export function formatPipeSpec(material: string, diameter: number, format: MunicipalityProfile['profileTable']['pipeSpecFormat']): string {
  return format === 'diameterFirst' ? `${diameter}${material}` : `${material}φ${diameter}`;
}

/** ノードにつながる排水系の区間（通気管は縦断図に含めない） */
function drainSegmentsAt(net: Network, nodeId: string): Segment[] {
  return Object.values(net.segments).filter((s) => isDrain(s.system) && s.system !== 'vent' && (s.a === nodeId || s.b === nodeId));
}
const otherEnd = (s: Segment, id: string) => (s.a === id ? s.b : s.a);

/**
 * outlet から上流へ向かう木。parent[node] = 来た区間。閉路があれば null。
 * 器具の接続口は「その器具がマスなら通過できる」。他の器具（トイレなど）は端。
 */
function upstreamTree(net: Network, outletId: string): { children: Map<string, string[]>; order: string[] } | null {
  const children = new Map<string, string[]>();
  const parent = new Map<string, string>();
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
        if (o !== parent.get(cur)) return null;
        continue;
      }
      seen.add(o);
      parent.set(o, cur);
      kids.push(o);
      stack.push(o);
    }
    children.set(cur, kids);
  }
  return { children, order };
}

/** 本線上で上流側へ 2 本以上に分かれる点とその隣ノード（枝の中の分岐は出さない。choice で本線が変わると分岐点も変わる） */
export function branchPoints(net: Network, outletId: string, choice: Record<string, string> = {}): { nodeId: string; options: string[] }[] {
  const t = upstreamTree(net, outletId);
  const r = extractRoute(net, outletId, choice);
  if (!t || 'error' in r) return [];
  return r.route.filter((id) => (t.children.get(id)?.length ?? 0) >= 2).map((nodeId) => ({ nodeId, options: t.children.get(nodeId)! }));
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
  const omitted: { atNodeId: string }[] = [];
  const walk = (start: string, pickMain: boolean): string[] => {
    const path = [start];
    let cur = start;
    while (true) {
      const kids = children.get(cur) ?? [];
      if (kids.length === 0) break;
      let next: string;
      if (kids.length === 1) next = kids[0];
      else {
        // 枝の長さ ＝ cur→k の区間 ＋ k から先のいちばん長い経路
        const len = (k: string) => planLength(net, drainSegmentsAt(net, cur).find((x) => otherEnd(x, cur) === k)!) + longest(net, children, k);
        const chosen = pickMain && choice[cur] && kids.includes(choice[cur]) ? choice[cur] : kids.slice().sort((p, q) => len(q) - len(p))[0];
        next = chosen;
        if (pickMain) {
          for (const k of kids) if (k !== chosen) branches.push({ atNodeId: cur, nodeIds: [cur, ...walk(k, false)] });
        } else {
          omitted.push({ atNodeId: cur });
        }
      }
      path.push(next);
      cur = next;
    }
    return path;
  };
  const route = walk(outletId, true);
  return { route, branches, omitted };
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
export function buildProfile(doc: Doc, route: string[], profile: MunicipalityProfile, title: string, notes: Record<string, string> = {}, opts: BuildProfileOpts = {}): ProfileModel {
  const net = doc.network;
  const ids = route.slice().reverse(); // 上流 → 下流
  const tentativeGL = doc.site?.designGL === undefined;
  const warnings: ProfileWarning[] = [];
  if (tentativeGL) warnings.push({ kind: 'tentativeGL', message: '設計GL が未入力のため、仮の地盤高（1階の床と同じ高さ）で描いています' });
  const gl0 = groundZ(doc.building, doc.site);
  // 地盤高: 点に入れた値、無ければその場所の地面（配置図の敷地の高さ。無ければ設計 GL）
  const glOf = (nodeId: string) => net.nodes[nodeId].groundLevel ?? gl0 + groundAt(doc.site, net.nodes[nodeId].pos);
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
      // 落差桝（node.dropIn）: 上流の区間は流入側の管底（z + dropIn）に着く
      const up = net.nodes[ids[i - 1]].pos.z, down = n.pos.z + (n.dropIn ?? 0);
      const riser = L < 1;
      const slope = riser ? null : (up - down) / L;
      const material = seg.material || 'VU';
      const slopeText = riser ? '立管' : slope! < -1e-9 ? '逆勾配' : formatSlope(slope!, profile.profileTable.slopeFormat);
      segments.push({ segId: seg.id, distance: L, slope, slopeText, diameter: seg.diameter, material, pipeSpec: formatPipeSpec(material, seg.diameter, profile.profileTable.pipeSpecFormat), ...(seg.existing ? { existing: true } : {}) });
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
    const manhole: ProfileNode['manhole'] = fx && fl && isManhole(fx.type)
      ? { type: fx.type, label: FIXTURE_CATALOG[fx.type].label, diameter: fx.params?.diameter ?? 300, depth: manholeDepth(fx, doc.building, doc.site), symbol: profile.symbols[fx.type] ?? 'circle', isPublic: fx.type.startsWith('public'), name: FIXTURE_CATALOG[fx.type].label }
      : undefined;
    const drop = i > 0 && manhole && n.dropIn && n.dropIn > 0 ? n.dropIn : 0;
    if (drop && manhole) manhole.depthIn = manhole.depth - drop;
    nodes.push({ nodeId: id, cumDistance: cum, groundLevel: gl, invertLevel: n.pos.z, cover, manhole, ...(drop ? { invertIn: n.pos.z + drop, coverIn: gl - (n.pos.z + drop + od) } : {}), ...(notes[id] ? { note: notes[id] } : {}), ...(fx?.params?.existing ? { existing: true } : {}) });
    const minCover = drop ? Math.min(cover, gl - (n.pos.z + drop + od)) : cover;
    if (od && minCover + 1e-9 < profile.profileTable.minCover) warnings.push({ kind: 'cover', nodeId: id, message: `点 ${nodes.length}: 土被り ${Math.round(minCover)}mm が最小 ${profile.profileTable.minCover}mm より少ない` });
  }
  // 桝の名前: 図の上に書く様式では、上流から NO.1, NO.2 …（公共マスは種類名のまま。枝は本線の続き）
  let no = opts.manholeNoStart ?? 0;
  if (profile.profileTable.manholeLabel === 'above') {
    for (const n of nodes) if (n.manhole) n.manhole.name = n.manhole.isPublic ? `${n.existing ? '既存' : '新設'}${n.manhole.label}` : `NO.${++no}${n.manhole.label}`;
  }
  const manholeCount = no - (opts.manholeNoStart ?? 0);
  // 高さの基準: 下流端（公共桝）の管底を ±0 にする。下流端が公共桝でなければ動かさず警告（枝は本線の基準を使う）
  let datumLabel: string | undefined, datumZ: number | undefined;
  if (profile.profileTable.datum === 'publicInvert' && nodes.length) {
    const last = nodes[nodes.length - 1];
    const z0 = opts.datumZ ?? (last.manhole?.isPublic ? last.invertLevel : undefined);
    if (z0 === undefined) {
      warnings.push({ kind: 'datum', message: '下流端が公共桝ではないため、高さは 1階 FL 基準のままです（公共桝の管底を ±0 にするには公共マスを下流端に選んでください）' });
    } else {
      const gl0 = opts.datumZ !== undefined ? undefined : last.groundLevel;
      for (const n of nodes) {
        if (gl0 !== undefined) n.glDiff = Math.round(n.groundLevel - gl0);
        n.invertLevel -= z0;
        n.groundLevel -= z0;
        if (n.invertIn !== undefined) n.invertIn -= z0;
      }
      datumLabel = '公共桝の管底を ±0 とする';
      datumZ = z0;
    }
  }
  return { nodes, segments, warnings, tentativeGL, profile, title, manholeCount, ...(datumLabel ? { datumLabel } : {}), ...(datumZ !== undefined ? { datumZ } : {}) };
}
