/**
 * 排水の自動計算（純関数）: 平面ルート＋区間の属性＋ピンから、管底高・勾配・マスの管底を決め、検査する。
 * ストアは配管・マス・建物・工事の設定が変わるたびにこれを呼び、結果（pos.z・invertZ）を写す。
 */
import type { Doc } from '../doc';
import type { DrainRuleSet } from '../drainRules';
import { checkDrain, type DrainIssue } from './checks';
import { solveHeights } from './heights';

export type { DrainIssue, DrainFix, DrainIssueKind } from './checks';
export { unpinNode, unpinSlope } from './checks';

export function solveDrain(doc: Doc, rules: DrainRuleSet): { doc: Doc; issues: DrainIssue[] } {
  const r = solveHeights(doc, rules);
  const issues = checkDrain(r.doc, rules, r.trees, { underfloorOver: r.underfloor.over });
  if (r.failed) issues.unshift({ kind: 'loop', level: 'error', target: { kind: 'site', id: '' }, message: '排水の高さを計算できませんでした（配管が重なる・長さが 0 になる所があります）。高さは前のままです', fixes: [] });
  return { doc: r.doc, issues };
}
