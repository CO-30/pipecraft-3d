/**
 * 給水の口径の提案（Rebro の「流量に応じた自動サイジング」の給水版）。純粋関数。
 * 不適当・流速超過のあいだ、1 段ずつ太くする:
 *   流速超過の区間 → それが無ければ、いちばん条件の悪い末端の道筋で損失の大きい区間（器具につながる区間は後回し）。
 *   太くした区間からメーターまでの上流も、それより細ければ同じ口径に。最大 50。メーターの口径は変えない。
 */
import type { Doc } from '../doc';
import { calcSupply, type CalcRow, type SupplyCalc } from './calc';
import type { SuiriSettings } from './settings';
import type { SupplyRules } from './supplyRules';

export type DiameterChange = { segId: string; from: number; to: number };
const STEPS = [13, 20, 25, 30, 40, 50];
const nextSize = (d: number) => STEPS.find((x) => x > d);
const GIVE_UP = '口径を 50 まで太くしても足りません。メーターの口径を上げるか、増圧方式を検討してください';

function pick(c: SupplyCalc): CalcRow | undefined {
  const bumpable = (r: CalcRow) => r.kind === 'pipe' && r.edge !== undefined && nextSize(r.diameter) !== undefined;
  const over = c.rows.filter((r) => r.over && bumpable(r)).sort((a, b) => b.velocity - a.velocity);
  if (over.length) return over[0];
  const crit = c.rows.filter((r) => r.critical && bumpable(r)).sort((a, b) => b.loss - a.loss);
  return crit.find((r) => !c.tree.edges[r.edge!].toFixture) ?? crit[0];
}

export function suggestDiameters(doc: Doc, rules: SupplyRules, settings: SuiriSettings): { changes: DiameterChange[]; ok: boolean; message?: string } {
  const orig = new Map(Object.values(doc.network.segments).map((s) => [s.id, s.diameter]));
  let cur = doc;
  const diff = (): DiameterChange[] => Object.values(cur.network.segments).filter((s) => orig.get(s.id) !== s.diameter).map((s) => ({ segId: s.id, from: orig.get(s.id)!, to: s.diameter }));
  for (let iter = 0; iter < 60; iter++) {
    const c = calcSupply(cur, rules, settings);
    if ('error' in c) return { changes: [], ok: false, message: c.error };
    if (c.ok) return { changes: diff(), ok: true };
    const row = pick(c);
    if (!row) return { changes: diff(), ok: false, message: c.rows.some((r) => r.over && r.edge === undefined) ? `引込の流速が上限を超えています。${GIVE_UP}` : GIVE_UP };
    const t = c.tree;
    const to = nextSize(row.diameter)!;
    const segments = { ...cur.network.segments };
    const widen = (i: number) => { for (const id of t.edges[i].segIds) if (segments[id].diameter < to) segments[id] = { ...segments[id], diameter: to }; };
    widen(row.edge!);
    for (let i = t.parentEdge[t.edges[row.edge!].from]; i !== undefined; i = t.parentEdge[t.edges[i].from]) widen(i);
    cur = { ...cur, network: { ...cur.network, segments } };
  }
  return { changes: diff(), ok: false, message: GIVE_UP };
}
