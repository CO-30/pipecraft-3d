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
import { buildSupplyTree } from './supplyTree';

export type DiameterChange = { segId: string; from: number; to: number };
const STEPS = [13, 20, 25, 30, 40, 50];
/** 次の段（家の管はメーターの口径より太くしない） */
const nextSize = (d: number, cap: number) => STEPS.find((x) => x > d && x <= cap);
const GIVE_UP = '家の中の管をメーターの口径まで太くしても足りません。メーターの口径を上げるか、増圧方式を検討してください';

function pick(c: SupplyCalc): CalcRow | undefined {
  // 長さ 0 の区間（ヘッダーの出口など）は太くしても何も変わらないので選ばない
  const bumpable = (r: CalcRow) => r.kind === 'pipe' && r.edge !== undefined && c.tree.edges[r.edge].segIds.length > 0 && nextSize(r.diameter, c.meterDia) !== undefined;
  const over = c.rows.filter((r) => r.over && bumpable(r)).sort((a, b) => b.velocity - a.velocity);
  if (over.length) return over[0];
  const crit = c.rows.filter((r) => r.critical && bumpable(r)).sort((a, b) => b.loss - a.loss);
  return crit.find((r) => !c.tree.edges[r.edge!].toFixture) ?? crit[0];
}

export function suggestDiameters(doc: Doc, rules: SupplyRules, settings: SuiriSettings): { changes: DiameterChange[]; ok: boolean; message?: string } {
  const orig = new Map(Object.values(doc.network.segments).map((s) => [s.id, s.diameter]));
  const t0 = buildSupplyTree(doc);
  if ('error' in t0) return { changes: [], ok: false, message: t0.error };
  // メーター（と描いていない引込）の口径は、太くした管から決め直さないように固定する
  const fixed: SuiriSettings = { ...settings, meterDia: settings.meterDia ?? t0.meterDia };
  settings = fixed;
  let cur = doc;
  const diff = (): DiameterChange[] => Object.values(cur.network.segments).filter((s) => orig.get(s.id) !== s.diameter).map((s) => ({ segId: s.id, from: orig.get(s.id)!, to: s.diameter }));
  for (let iter = 0; iter < 60; iter++) {
    const c = calcSupply(cur, rules, settings);
    if ('error' in c) return { changes: [], ok: false, message: c.error };
    if (c.ok) return { changes: diff(), ok: true };
    const row = pick(c);
    if (!row) return { changes: diff(), ok: false, message: c.rows.some((r) => r.over && r.edge === undefined) ? `引込の流速が上限を超えています。${GIVE_UP}` : GIVE_UP };
    const t = c.tree;
    const to = nextSize(row.diameter, c.meterDia)!;
    const segments = { ...cur.network.segments };
    const widen = (i: number) => { for (const id of t.edges[i].segIds) if (segments[id].diameter < to) segments[id] = { ...segments[id], diameter: to }; };
    widen(row.edge!);
    for (let i = t.parentEdge[t.edges[row.edge!].from]; i !== undefined; i = t.parentEdge[t.edges[i].from]) widen(i);
    cur = { ...cur, network: { ...cur.network, segments } };
  }
  return { changes: diff(), ok: false, message: GIVE_UP };
}
