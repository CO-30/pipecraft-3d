/**
 * ます表（排水設備のますの一覧）。縦断図と同じモデル（buildProfile の結果）から作るので、
 * 番号・高さの基準・勾配の書き方が縦断図と必ず一致する。本線 → 枝の順、同じますは最初の 1 行だけ。
 */
import type { Doc } from './doc';
import { isManhole } from './fixtures';
import type { ProfileModel } from './profileDrawing';

export type ManholeRow = {
  nodeId: string;
  /** NO.1… または「公共」 */
  no: string;
  /** 種類（汚水桝・雨水桝・公共桝 など） */
  kind: string;
  /** 大きさ（φ300・□300） */
  size: string;
  isPublic: boolean;
  existing: boolean;
  /** 地盤高・管底高（流出側）・深さ（縦断図の基準 mm） */
  gl: number;
  invert: number;
  depth: number;
  /** 落差桝: 流入側の管底高と落差 */
  invertIn?: number;
  drop?: number;
  /** 下流側の管（管種・口径）と勾配 */
  pipe?: string;
  slope?: string;
  /** 次のます（下流）までの延長 mm と名前 */
  toNext?: number;
  next?: string;
};
export type ManholeTable = { rows: ManholeRow[]; datumLabel?: string; /** 縦断図に入っていないますの数（別の系統） */ outside: number };

export function manholeTable(doc: Doc, models: ProfileModel[]): ManholeTable {
  const rows: ManholeRow[] = [];
  const seen = new Set<string>();
  let no = 0;
  // 公共ますは最後にまとめる
  const publics: ManholeRow[] = [];
  const nameOf = new Map<string, string>();
  for (const m of models) {
    m.nodes.forEach((n) => { if (n.manhole && !n.manhole.isPublic && !nameOf.has(n.nodeId)) nameOf.set(n.nodeId, `NO.${++no}`); });
  }
  for (const m of models) {
    m.nodes.forEach((n, i) => {
      const mh = n.manhole;
      if (!mh || seen.has(n.nodeId)) return;
      seen.add(n.nodeId);
      // 下流の次のますまで（このモデルの中で）
      const j = m.nodes.findIndex((x, k) => k > i && x.manhole);
      const seg = m.segments[i];
      const nextNode = j >= 0 ? m.nodes[j] : undefined;
      const drop = n.invertIn !== undefined ? Math.round(n.invertIn - n.invertLevel) : undefined;
      const row: ManholeRow = {
        nodeId: n.nodeId,
        no: mh.isPublic ? '公共' : nameOf.get(n.nodeId)!,
        kind: mh.label,
        size: `${mh.symbol === 'square' ? '□' : 'φ'}${mh.diameter}`,
        isPublic: mh.isPublic,
        existing: !!n.existing,
        gl: Math.round(n.groundLevel),
        invert: Math.round(n.invertLevel),
        depth: Math.round(mh.depth),
        ...(drop ? { invertIn: Math.round(n.invertIn!), drop } : {}),
        ...(seg && nextNode ? { pipe: seg.pipeSpec, slope: seg.slopeText, toNext: Math.round(nextNode.cumDistance - n.cumDistance), next: nextNode.manhole!.isPublic ? '公共' : nameOf.get(nextNode.nodeId) } : {}),
      };
      (mh.isPublic ? publics : rows).push(row);
    });
  }
  const shown = new Set([...rows, ...publics].map((r) => r.nodeId));
  const outside = Object.values(doc.fixtures).filter((f) => isManhole(f.type) && !Object.values(doc.network.nodes).some((n) => n.fixtureId === f.id && shown.has(n.id))).length;
  return { rows: [...rows, ...publics], datumLabel: models[0]?.datumLabel, outside };
}
