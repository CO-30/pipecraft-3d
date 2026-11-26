/**
 * 排水の注意の一覧（書類センター）: どの注意を並べるかと、図面のどこへ移動するか（純関数）。
 * 直すときはストアの applyDrainFix(index, n) を使うので、ストアの drainIssues の何番目かを持たせる。
 */
import type { Doc } from '../model/doc';
import type { DrainIssue } from '../model/drainSolve';

/** 一覧に並べる件数の上限（スマホで読み切れる長さに。残りは「ほか N 件」） */
export const MAX_DRAIN_ROWS = 6;

export type DrainRow = { index: number; issue: DrainIssue };

/** 注意（error・warn）だけ。お知らせ（info）は出さない（inspection.ts と同じ基準） */
export function drainRows(issues: DrainIssue[]): DrainRow[] {
  return issues.flatMap((issue, index) => (issue.level === 'info' ? [] : [{ index, issue }]));
}

export type Locate = { floorId?: string; selection: { kind: 'segment' | 'node' | 'fixture'; id: string } };

/** 図面で選ぶもの（と切り替える階）。もう無いもの・敷地全体の注意は null */
export function locateTarget(doc: Doc, target: DrainIssue['target']): Locate | null {
  const net = doc.network;
  const floors = new Set(doc.building.floors.map((f) => f.id));
  const known = (id?: string) => (id && floors.has(id) ? { floorId: id } : {});
  if (target.kind === 'segment') {
    const s = net.segments[target.id];
    if (!s) return null;
    return { ...known(net.nodes[s.a]?.floorId ?? net.nodes[s.b]?.floorId), selection: { kind: 'segment', id: s.id } };
  }
  if (target.kind === 'node') {
    const n = net.nodes[target.id];
    return n ? { ...known(n.floorId), selection: { kind: 'node', id: n.id } } : null;
  }
  if (target.kind === 'fixture') {
    const f = doc.fixtures[target.id];
    return f ? { ...known(f.floorId), selection: { kind: 'fixture', id: f.id } } : null;
  }
  return null;
}
