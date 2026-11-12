/**
 * 水理計算の給水の木（純粋関数）。水道メーターの出口から給水（water）の区間をたどる。
 * - 水道メーター・給水ヘッダーは通り抜ける（ヘッダーは入口 → 各出口）
 * - 給湯器は入口で止めて 1 つの給水用具（給湯の先は数えない）。他の器具は給水口で止める
 * - 区間（edge）は 分岐・器具・バルブ・口径の変わり目で区切る。長さは実測長を優先
 * - 引込（配水管〜メーター）: メーターの入口から上流に描いた給水管
 */
import type { Doc } from '../doc';
import { FIXTURE_CATALOG, type FixtureType } from '../fixtures';
import { segmentLength, type Network, type PipeNode, type Segment } from '../network';

export type SupplyOutlet = { fixtureId: string; nodeId: string; type: FixtureType; dia: number; z: number };
export type SupplyEdge = { from: string; to: string; segIds: string[]; length: number; diameter: number; toFixture: boolean };
export type SupplyTree = {
  rootNodeId: string;
  meterId: string;
  meterDia: number;
  meterZ: number;
  edges: SupplyEdge[];
  /** 点（下流側の nodeId）→ その点へ来る区間の添字 */
  parentEdge: Record<string, number>;
  valves: string[];
  outlets: SupplyOutlet[];
  service: { length: number; diameter: number; drawn: boolean };
  warnings: string[];
  /** 直結直圧の 1 引込でない（ポンプ・高置水槽・メーター 2 個以上）。判定は参考 */
  outOfScope: string | null;
};

const usedLength = (net: Network, s: Segment) => s.measuredLength ?? segmentLength(net, s.id);
const waterAt = (net: Network, id: string) => Object.values(net.segments).filter((s) => s.system === 'water' && (s.a === id || s.b === id));
const other = (s: Segment, id: string) => (s.a === id ? s.b : s.a);

/** 子への 1 歩: 区間を通る（seg）か、同じ器具の別の口へ跳ぶ（ヘッダー） */
type Link = { to: string; seg?: Segment };

export function buildSupplyTree(doc: Doc): SupplyTree | { error: string } {
  const net = doc.network;
  const warnings: string[] = [];
  const meters = Object.values(doc.fixtures).filter((f) => f.type === 'waterMeter');
  if (!meters.length) return { error: '水道メーターがありません。器具の「水道メーター」を置き、給水の配管をつないでください' };
  const scope: string[] = [];
  if (meters.length > 1) { warnings.push('水道メーターが 2 個以上あります。複数の引込は対象外のため、1 個目のメーターから計算しています'); scope.push('メーターが 2 個以上'); }
  if (Object.values(doc.fixtures).some((f) => f.type === 'pump' || f.type === 'roofTank')) { warnings.push('ポンプ・高置水槽があります。増圧・受水槽の方式は対象外のため、直結直圧として計算しています'); scope.push('ポンプ・高置水槽がある'); }
  const meter = meters[0];
  const nodes = Object.values(net.nodes);
  const portOf = (fid: string, pid: string): PipeNode | undefined => nodes.find((n) => n.fixtureId === fid && n.portId === pid);
  const out = portOf(meter.id, 'out');
  if (!out || !waterAt(net, out.id).length) return { error: '水道メーターの出口に給水の配管がつながっていません' };

  // メーターの口径（申請書と同じ決め方: 指定 → 入口の管 → 出口の管）
  const inp = portOf(meter.id, 'in');
  const inSeg = inp ? waterAt(net, inp.id)[0] : undefined;
  const meterDia = meter.params?.diameter ?? inSeg?.diameter ?? waterAt(net, out.id)[0]?.diameter ?? 20;

  // 1) 点の木（深さ優先）
  const children = new Map<string, Link[]>();
  const outlets: SupplyOutlet[] = [];
  const valves: string[] = [];
  const seen = new Set<string>([out.id]);
  let loop = false;
  const visit = (id: string, via: Segment | undefined) => {
    const n = net.nodes[id];
    const fx = n.fixtureId ? doc.fixtures[n.fixtureId] : undefined;
    const links: Link[] = [];
    if (fx && id !== out.id) {
      if (fx.type === 'waterHeader' && n.portId === 'in') {
        // 管がつながっている出口だけ（使っていない出口を長さ 0 の枝にしない）
        for (const p of nodes) if (p.fixtureId === fx.id && p.portId?.startsWith('out') && !seen.has(p.id) && waterAt(net, p.id).length) { seen.add(p.id); links.push({ to: p.id }); }
      } else if (fx.type === 'waterMeter') {
        return; // 別のメーター（または同じメーターの入口）には入らない
      } else if (!(fx.type === 'waterHeader' && n.portId?.startsWith('out'))) {
        const def = FIXTURE_CATALOG[fx.type].ports.find((p) => p.id === n.portId);
        outlets.push({ fixtureId: fx.id, nodeId: id, type: fx.type, dia: def?.diameter ?? via?.diameter ?? 13, z: n.pos.z });
        return;
      }
    }
    if (n.kind === 'valve') valves.push(id);
    for (const s of waterAt(net, id)) {
      if (s.id === via?.id) continue;
      const o = other(s, id);
      if (seen.has(o)) { loop = true; continue; }
      seen.add(o);
      links.push({ to: o, seg: s });
    }
    children.set(id, links);
    for (const l of links) visit(l.to, l.seg);
  };
  visit(out.id, undefined);
  if (loop) warnings.push('輪になった給水配管があります。輪の一部を省いて計算しています');

  // 2) 区間にまとめる
  const outletIds = new Set(outlets.map((o) => o.nodeId));
  const valveIds = new Set(valves);
  const isBoundary = (id: string, viaDia: number | undefined): boolean => {
    if (id === out.id || outletIds.has(id) || valveIds.has(id)) return true;
    const ls = children.get(id) ?? [];
    if (ls.length !== 1) return true;
    const next = ls[0].seg?.diameter;
    return next !== undefined && viaDia !== undefined && next !== viaDia;
  };
  const edges: SupplyEdge[] = [];
  const parentEdge: Record<string, number> = {};
  const walk = (from: string) => {
    for (const first of children.get(from) ?? []) {
      const segIds: string[] = [];
      let length = 0;
      let dia: number | undefined;
      let cur = first;
      for (;;) {
        if (cur.seg) { segIds.push(cur.seg.id); length += usedLength(net, cur.seg); dia ??= cur.seg.diameter; }
        if (isBoundary(cur.to, cur.seg?.diameter ?? dia)) break;
        cur = children.get(cur.to)![0];
      }
      parentEdge[cur.to] = edges.length;
      edges.push({ from, to: cur.to, segIds, length, diameter: dia ?? meterDia, toFixture: outletIds.has(cur.to) });
      walk(cur.to);
    }
  };
  walk(out.id);

  // 3) 引込: メーターの入口から上流へ 1 本道をたどる
  const service = { length: 0, diameter: meterDia, drawn: false };
  if (inp && inSeg) {
    service.drawn = true;
    service.diameter = inSeg.diameter;
    const done = new Set([inp.id]);
    let cur = inp.id;
    for (;;) {
      const next = waterAt(net, cur).filter((s) => !done.has(other(s, cur)));
      if (next.length !== 1) break;
      service.length += usedLength(net, next[0]);
      cur = other(next[0], cur);
      done.add(cur);
      if (net.nodes[cur].fixtureId) break;
    }
  }

  return { rootNodeId: out.id, meterId: meter.id, meterDia, meterZ: out.pos.z, edges, parentEdge, valves, outlets, service, warnings, outOfScope: scope.length ? scope.join('・') : null };
}
