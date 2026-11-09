/**
 * 給水立面図（系統図）の計算モデル（純粋関数）。
 * 起点（水道メーターの出口など）から給水・給湯の区間をたどって木構造にし、
 * 各ノードの階・高さラベル・器具、各区間の口径・系統を持つ。給湯器の接続口は通過できる（給湯の枝）。
 */
import type { Doc } from './doc';
import { floorById } from './building';
import { FIXTURE_CATALOG, groundZ, type FixtureType } from './fixtures';
import type { MunicipalityProfile } from './municipality';
import type { Network, Segment, SystemType } from './network';

export type RiserSystem = 'water' | 'hotWater';
export type RiserNode = {
  nodeId: string; x: number; z: number; floorName: string; heightLabel: string;
  fixture?: { type: FixtureType; label: string; symbol: string };
  valve?: boolean;
  children: RiserEdge[];
};
export type RiserEdge = { segId: string; diameter: number; system: RiserSystem; material: string; to: RiserNode };
export type RiserModel = { root: RiserNode; floors: { name: string; z: number }[]; columns: number; profile: MunicipalityProfile; title: string; warnings: string[] };

const isSupply = (s: SystemType): s is RiserSystem => s === 'water' || s === 'hotWater';
const supplySegmentsAt = (net: Network, id: string): Segment[] => Object.values(net.segments).filter((s) => isSupply(s.system) && (s.a === id || s.b === id));

/** 起点候補: 水道メーターの出口 → 給水の止水栓（valve） → null */
export function defaultRiserRoot(doc: Doc): string | null {
  const meter = Object.values(doc.fixtures).find((f) => f.type === 'waterMeter');
  if (meter) {
    const out = Object.values(doc.network.nodes).find((n) => n.fixtureId === meter.id && n.portId === 'out');
    if (out) return out.id;
  }
  const valve = Object.values(doc.network.nodes).find((n) => n.kind === 'valve' && supplySegmentsAt(doc.network, n.id).some((s) => s.system === 'water'));
  return valve?.id ?? null;
}

/** ノードの階（floorId → 無ければ高さから） */
function floorOf(doc: Doc, nodeId: string) {
  const n = doc.network.nodes[nodeId];
  const byId = n.floorId ? floorById(doc.building, n.floorId) : undefined;
  if (byId) return byId;
  const fs = doc.building.floors.slice().sort((a, b) => a.elevation - b.elevation);
  let pick = fs[0];
  for (const f of fs) if (f.elevation <= n.pos.z + 1e-6) pick = f;
  return pick;
}

const fmtSigned = (v: number) => `${v < 0 ? '−' : '+'}${Math.abs(Math.round(v))}`;

export function buildRiser(doc: Doc, rootNodeId: string, profile: MunicipalityProfile, title: string): RiserModel {
  const net = doc.network;
  const warnings: string[] = [];
  const seen = new Set<string>([rootNodeId]);
  let loop = false;
  let col = 0;
  const floorsSorted = doc.building.floors.slice().sort((a, b) => a.elevation - b.elevation);

  const makeNode = (id: string): RiserNode => {
    const n = net.nodes[id];
    const fl = floorOf(doc, id);
    const fx = n.fixtureId ? doc.fixtures[n.fixtureId] : undefined;
    const label = profile.riser.heightLabel === 'GL+' ? `GL${fmtSigned(n.pos.z - groundZ(fl, doc.site))}` : `FL${fmtSigned(n.pos.z - fl.elevation)}`;
    return {
      nodeId: id, x: 0, z: n.pos.z, floorName: fl.name, heightLabel: label,
      ...(fx ? { fixture: { type: fx.type, label: FIXTURE_CATALOG[fx.type].label, symbol: profile.symbols[fx.type] ?? 'faucet' } } : {}),
      ...(n.kind === 'valve' ? { valve: true } : {}),
      children: [],
    };
  };

  // 深さ優先。起点を列 0、最初の子は親と同じ列、2 本目からの子は新しい列（右へ）
  const visit = (id: string, viaSeg: string | undefined, column: number): RiserNode => {
    const node = makeNode(id);
    node.x = column;
    col = Math.max(col, column + 1);
    const n = net.nodes[id];
    // この点から先へ続く区間（来た区間を除く）。給湯器の入口に来たら出口の区間も枝として続ける
    const outgoing: { s: Segment; from: string }[] = supplySegmentsAt(net, id).filter((s) => s.id !== viaSeg).map((s) => ({ s, from: id }));
    if (n.fixtureId && doc.fixtures[n.fixtureId]?.type === 'waterHeater' && n.portId === 'in') {
      const out = Object.values(net.nodes).find((x) => x.fixtureId === n.fixtureId && x.portId === 'out');
      if (out && !seen.has(out.id)) { seen.add(out.id); outgoing.push(...supplySegmentsAt(net, out.id).map((s) => ({ s, from: out.id }))); }
    }
    // 子の順: 配管の続き（器具でない点）を先に、器具は後。それぞれ 低い → 高い、同じ高さは給水 → 給湯
    const isFx = (nodeId: string) => !!net.nodes[nodeId].fixtureId;
    const edges = outgoing.map(({ s, from }) => ({ s, o: s.a === from ? s.b : s.a }))
      .sort((p, q) => Number(isFx(p.o)) - Number(isFx(q.o)) || net.nodes[p.o].pos.z - net.nodes[q.o].pos.z || (p.s.system === 'water' ? -1 : 1));
    // 最初の「配管の続き」は親と同じ列。器具は必ず新しい列（記号が重ならないように）
    let first = true;
    for (const { s, o } of edges) {
      if (seen.has(o)) { loop = true; continue; }
      seen.add(o);
      const child = visit(o, s.id, first && !isFx(o) ? column : col);
      first = false;
      node.children.push({ segId: s.id, diameter: s.diameter, system: s.system as RiserSystem, material: s.material ?? '', to: child });
    }
    return node;
  };
  const root = visit(rootNodeId, undefined, 0);
  if (loop) warnings.push('輪になった配管を省略しました');
  return {
    root,
    floors: floorsSorted.map((f) => ({ name: f.name, z: f.elevation })),
    columns: Math.max(1, col),
    profile,
    title,
    warnings,
  };
}

/** 木を平らにする（描画用） */
export function riserNodes(root: RiserNode): RiserNode[] {
  const out: RiserNode[] = [];
  const walk = (n: RiserNode) => { out.push(n); for (const e of n.children) walk(e.to); };
  walk(root);
  return out;
}
