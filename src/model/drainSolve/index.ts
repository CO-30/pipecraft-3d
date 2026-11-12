/**
 * 排水の自動計算（純関数）: 平面ルート＋区間の属性＋ピンから、管底高・勾配・マスの管底を決め、検査する。
 * ストアは配管・マス・建物・工事の設定が変わるたびにこれを呼び、結果（pos.z・invertZ）を写す。
 */
import type { Doc } from '../doc';
import type { DrainRuleSet } from '../drainRules';
import { checkDrain, type DrainIssue } from './checks';
import { solveHeights } from './heights';
import { autoDiameters } from './diameter';
import { placeManholes } from './manholes';

export type { DrainIssue, DrainFix, DrainIssueKind } from './checks';
export { unpinNode, unpinSlope } from './checks';

/**
 * place: マスの自動配置。省略 = すべての系統、Set = その点を含む系統だけ（編集で変わった点）、false = 置かない（ドラッグ中・開いたとき）
 */
export function solveDrain(doc: Doc, rules: DrainRuleSet, opts: { place?: Set<string> | false } = {}): { doc: Doc; issues: DrainIssue[] } {
  // 管径（勾配の既定・マスの間隔は管径で決まるので先に）→ マスの自動配置 → 高さ
  const sized = autoDiameters(doc);
  const placed = opts.place === false ? sized : placeManholes(sized, rules, opts.place);
  const r = solveHeights(placed, rules);
  const issues = checkDrain(r.doc, rules, r.trees, { underfloorOver: r.underfloor.over });
  if (r.failed) issues.unshift({ kind: 'loop', level: 'error', target: { kind: 'site', id: '' }, message: '排水の高さを計算できませんでした（配管が重なる・長さが 0 になる所があります）。高さは前のままです', fixes: [] });
  return { doc: r.doc, issues };
}
