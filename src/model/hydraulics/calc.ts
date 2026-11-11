/**
 * 給水の水理計算（直結直圧式・口径決定）。純粋関数。給水装置工事技術指針の方式:
 *   同時使用率を考慮した給水用具数 → 同時に使う器具 → 区間の流量 → 動水勾配（ウエストン等）
 *   → 損失水頭（管: I×L×係数、器具: I×直管換算長）＋立上り → いちばん大きい末端の所要水頭＋引込
 *   → ＋余裕水頭 ≦ 設計水圧の水頭 なら適当。流速の上限も確かめる。
 * 長さは内部 mm、結果は m。丸めずに計算する（表示で丸める）。
 */
import type { Doc } from '../doc';
import { FIXTURE_CATALOG } from '../fixtures';
import { gradient, MPA_HEAD, velocity } from './formulas';
import type { SuiriSettings } from './settings';
import { buildSupplyTree, type SupplyOutlet, type SupplyTree } from './supplyTree';
import { defaultFlow, EQUIV_LABEL, equivLength, simultaneousCount, type EquivItem, type SupplyRules } from './supplyRules';

export type CalcRow = {
  kind: 'pipe' | 'item';
  label: string;
  flow: number;
  diameter: number;
  velocity: number;
  /** 動水勾配 ‰ */
  gradient: number;
  /** 延長 m（係数込み）。器具は 0 */
  length: number;
  /** 直管換算長 m。管は 0 */
  equiv: number;
  loss: number;
  rise: number;
  /** 所要水頭 = 損失 + 立上り */
  head: number;
  over: boolean;
  /** SupplyTree.edges の添字（家の中の管だけ） */
  edge?: number;
  critical: boolean;
};
export type OutletUse = { fixtureId: string; letter: string; label: string; dia: number; flow: number; used: boolean; pathHead: number };
export type SupplyCalc = {
  ok: boolean;
  /** 全所要水頭 m */
  total: number;
  /** 全所要水頭 + 余裕水頭 m */
  required: number;
  /** 設計水圧の水頭 m */
  available: number;
  pressure: number;
  margin: number;
  plannedFlow: number;
  totalOutlets: number;
  simultaneous: number;
  outlets: OutletUse[];
  rows: CalcRow[];
  /** 点の記号（nodeId → 記号。配水管の分岐は '__main__'） */
  letters: Record<string, string>;
  criticalFixtureId: string;
  warnings: string[];
  unverified: string[];
  tree: SupplyTree;
  rules: SupplyRules;
};

export const MAIN_POINT = '__main__';
const letterAt = (i: number) => (i < 26 ? String.fromCharCode(65 + i) : String.fromCharCode(65 + (i % 26)) + Math.floor(i / 26 + 1));

export function calcSupply(doc: Doc, rules: SupplyRules, settings: SuiriSettings): SupplyCalc | { error: string } {
  const t = buildSupplyTree(doc);
  if ('error' in t) return t;
  if (!t.outlets.length) return { error: '給水の配管の先に器具がありません。器具の給水口まで配管をつないでください' };
  const warnings = [...t.warnings];
  const pressure = settings.pressure ?? rules.designPressure.v;
  const margin = settings.margin ?? rules.margin.v;
  const factor = rules.lengthFactor.v;
  const vmax = rules.maxVelocity.v;
  const drop = settings.drop ?? rules.mainDrop.v;
  const zOf = (id: string) => doc.network.nodes[id].pos.z;
  const flowOf = (o: SupplyOutlet) => settings.flows[o.fixtureId] ?? defaultFlow(o.type, o.dia);

  // 記号: 器具 → 分岐・バルブ（区間の順）→ メーターの出口 → 配水管の分岐
  const letters: Record<string, string> = {};
  let li = 0;
  for (const o of t.outlets) letters[o.nodeId] = letterAt(li++);
  for (const e of t.edges) if (!letters[e.to]) letters[e.to] = letterAt(li++);
  letters[t.rootNodeId] = letterAt(li++);
  letters[MAIN_POINT] = letterAt(li++);

  /** 末端から上流への区間の添字 */
  const pathOf = (nodeId: string): number[] => {
    const out: number[] = [];
    for (let i = t.parentEdge[nodeId]; i !== undefined; i = t.parentEdge[t.edges[i].from]) out.push(i);
    return out;
  };
  const paths = new Map(t.outlets.map((o) => [o.nodeId, pathOf(o.nodeId)]));
  const valveSet = new Set(t.valves);

  const row = (kind: CalcRow['kind'], label: string, flow: number, dia: number, lengthM: number, equiv: number, rise: number, edge?: number): CalcRow => {
    const I = gradient(flow, dia);
    const v = velocity(flow, dia);
    const loss = (I * (lengthM + equiv)) / 1000;
    return { kind, label, flow, diameter: dia, velocity: v, gradient: I, length: lengthM, equiv, loss, rise, head: loss + rise, over: kind === 'pipe' && v > vmax + 1e-9, ...(edge !== undefined ? { edge } : {}), critical: false };
  };

  /** used の器具を流したときの、区間ごとの流量 */
  const edgeFlows = (used: SupplyOutlet[]): number[] => {
    const f = t.edges.map(() => 0);
    for (const o of used) for (const i of paths.get(o.nodeId)!) f[i] += flowOf(o);
    return f;
  };
  const edgeRow = (i: number, flow: number) => {
    const e = t.edges[i];
    return row('pipe', `${letters[e.to]}-${letters[e.from]}`, flow, e.diameter, (e.length / 1000) * factor, 0, (zOf(e.to) - zOf(e.from)) / 1000, i);
  };
  const faucetRow = (o: SupplyOutlet) => row('item', `${EQUIV_LABEL.faucet} ${letters[o.nodeId]}`, flowOf(o), o.dia, 0, equivLength('faucet', o.dia), 0);
  const valveRow = (node: string, flow: number, dia: number) => row('item', `${EQUIV_LABEL.valve} ${letters[node]}`, flow, dia, 0, equivLength('valve', dia), 0);
  /** 末端の所要水頭（器具 + 道筋の管 + 途中のバルブ） */
  const pathRows = (o: SupplyOutlet, flows: number[]): CalcRow[] => {
    const rows = [faucetRow(o)];
    for (const i of paths.get(o.nodeId)!) {
      rows.push(edgeRow(i, flows[i]));
      const up = t.edges[i].from;
      if (valveSet.has(up) && t.parentEdge[up] !== undefined) rows.push(valveRow(up, flows[t.parentEdge[up]], t.edges[t.parentEdge[up]].diameter));
    }
    return rows;
  };
  const headOf = (rows: CalcRow[]) => rows.reduce((a, r) => a + r.head, 0);

  // 同時に使う器具
  const totalOutlets = t.outlets.length;
  const simultaneous = simultaneousCount(totalOutlets);
  const chosen = (settings.use ?? []).map((id) => t.outlets.find((o) => o.fixtureId === id)).filter((o): o is SupplyOutlet => !!o);
  let used: SupplyOutlet[];
  if (chosen.length) used = chosen;
  else {
    const solo = new Map(t.outlets.map((o) => [o.nodeId, headOf(pathRows(o, edgeFlows([o])))]));
    const crit = t.outlets.reduce((a, b) => (solo.get(b.nodeId)! > solo.get(a.nodeId)! ? b : a));
    const rest = t.outlets.filter((o) => o !== crit).sort((a, b) => flowOf(b) - flowOf(a) || solo.get(b.nodeId)! - solo.get(a.nodeId)!);
    used = [crit, ...rest.slice(0, simultaneous - 1)];
  }
  if (settings.use?.length && chosen.length < settings.use.length) warnings.push('選んだ器具の一部が見つからないため、見つかった器具で計算しています');
  const plannedFlow = used.reduce((a, o) => a + flowOf(o), 0);
  const flows = edgeFlows(used);

  // 末端ごとの所要水頭
  const perOutlet = new Map(used.map((o) => [o.nodeId, pathRows(o, flows)]));
  const critical = used.reduce((a, b) => (headOf(perOutlet.get(b.nodeId)!) > headOf(perOutlet.get(a.nodeId)!) ? b : a));

  // 引込（配水管〜メーター）。配水管の側から: 分水栓・止水栓・(引込管)・メーター・逆止弁
  const s = t.service;
  const svcLenM = s.drawn ? s.length / 1000 : settings.serviceLen ?? rules.serviceLength.v;
  if (!s.drawn && settings.serviceLen === undefined) warnings.push(`引込（配水管〜メーター）の管が描かれていないため、延長 ${rules.serviceLength.v.toFixed(1)}m・口径 ${s.diameter} として計算しています`);
  const svcItem = (item: EquivItem) => {
    const dia = item === 'meter' ? t.meterDia : s.diameter;
    const label = item === 'tap' ? `${EQUIV_LABEL.tap} ${letters[MAIN_POINT]}` : EQUIV_LABEL[item];
    return row('item', label, plannedFlow, dia, 0, equivLength(item, dia), 0);
  };
  const fromMeter = [...rules.serviceItems].reverse();
  const serviceRows: CalcRow[] = [];
  for (const item of fromMeter) {
    if (item === 'tap') serviceRows.push(row('pipe', `引込管 ${letters[t.rootNodeId]}-${letters[MAIN_POINT]}`, plannedFlow, s.diameter, svcLenM * factor, 0, drop));
    serviceRows.push(svcItem(item));
  }
  if (!fromMeter.includes('tap')) serviceRows.push(row('pipe', `引込管 ${letters[t.rootNodeId]}-${letters[MAIN_POINT]}`, plannedFlow, s.diameter, svcLenM * factor, 0, drop));

  // 行の順: いちばん条件の悪い末端から。2 本目からは合流するまで
  const order = [critical, ...used.filter((o) => o !== critical)];
  const listedEdges = new Set<number>();
  const rows: CalcRow[] = [];
  for (const o of order) {
    for (const r of perOutlet.get(o.nodeId)!) {
      if (r.edge !== undefined) { if (listedEdges.has(r.edge)) break; listedEdges.add(r.edge); }
      rows.push({ ...r, critical: o === critical });
    }
  }
  for (const r of serviceRows) rows.push({ ...r, critical: true });

  const pathHeads = new Map([...perOutlet].map(([k, v]) => [k, headOf(v)]));
  const total = pathHeads.get(critical.nodeId)! + headOf(serviceRows);
  const required = total + margin;
  const available = pressure * MPA_HEAD;
  const overRows = rows.filter((r) => r.over);
  for (const r of overRows) warnings.push(`区間 ${r.label} の流速 ${r.velocity.toFixed(2)}m/s が上限 ${vmax.toFixed(1)}m/s を超えています`);

  const unverified: string[] = [];
  if (settings.pressure === undefined && rules.designPressure.status === 'unknown') unverified.push(`設計水圧 ${pressure}MPa（${rules.designPressure.source}）`);

  const usedIds = new Set(used.map((o) => o.nodeId));
  return {
    ok: required <= available + 1e-9 && overRows.length === 0,
    total, required, available, pressure, margin, plannedFlow, totalOutlets, simultaneous,
    outlets: t.outlets.map((o) => ({ fixtureId: o.fixtureId, letter: letters[o.nodeId], label: FIXTURE_CATALOG[o.type].label, dia: o.dia, flow: flowOf(o), used: usedIds.has(o.nodeId), pathHead: pathHeads.get(o.nodeId) ?? 0 })),
    rows, letters, criticalFixtureId: critical.fixtureId, warnings, unverified, tree: t, rules,
  };
}
