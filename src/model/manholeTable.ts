/**
 * ます表（排水設備のますの一覧）。縦断図と同じモデル（buildRouteProfiles の結果）から作るので、
 * 番号・高さの基準・勾配の書き方・延長（竣工図なら実測）が縦断図と一致する。本線 → 枝の順、同じますは最初の 1 行だけ。
 */
import type { Doc } from './doc';
import { isManhole } from './fixtures';
import type { ProfileModel, ProfileNode } from './profileDrawing';

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
  /** 地盤高・管底高（流出側）・深さ（地盤高 − 管底高）。縦断図の基準 mm */
  gl: number;
  invert: number;
  depth: number;
  /** 落差桝: 流入側の管底高と落差 */
  invertIn?: number;
  drop?: number;
  /** 下流側の管（管種・口径）と勾配（区間で違えば「a〜b」） */
  pipe?: string;
  slope?: string;
  /** 次のます（下流）までの延長 mm と名前 */
  toNext?: number;
  next?: string;
};
export type ManholeTable = {
  rows: ManholeRow[];
  datumLabel?: string;
  /** この表に入っていないますの数（別の系統など。枝の中の分岐の先は除く） */
  outside: number;
  /** 表の系統の区間（位置図に描く管） */
  segIds: string[];
};

/** omittedAt: 縦断図に含めない枝の中の分岐の点（その先のますは outside に数えない） */
export function manholeTable(doc: Doc, models: ProfileModel[], omittedAt: string[] = []): ManholeTable {
  // 名前: 縦断図に NO. があればそれ、無ければ（表の様式）同じ順に NO. を振る。合流のますは最初の名前
  const nameOf = new Map<string, string>();
  let no = 0;
  for (const m of models) for (const n of m.nodes) {
    if (!n.manhole || n.manhole.isPublic || nameOf.has(n.nodeId)) continue;
    const hit = /^NO\.(\d+)/.exec(n.manhole.name);
    nameOf.set(n.nodeId, hit ? `NO.${hit[1]}` : `NO.${++no}`);
  }
  const label = (n: ProfileNode) => (n.manhole!.isPublic ? '公共' : nameOf.get(n.nodeId)!);
  /** どの図のどこにあるか（枝の終わりの合流点から本線へ続けるため。最初に出てきた図） */
  const where = new Map<string, { mi: number; i: number }>();
  models.forEach((m, mi) => m.nodes.forEach((n, i) => { if (!where.has(n.nodeId)) where.set(n.nodeId, { mi, i }); }));

  /** 下流の次のますまで（図の中に無ければ、図の終わりの点から前の図へ続ける）。延長は区間の長さ（竣工図なら実測）の和 */
  const downstream = (mi: number, i: number) => {
    let dist = 0;
    const slopes: string[] = [];
    let pipe: string | undefined;
    for (let guard = 0; guard < models.length + 1; guard++) {
      const m = models[mi];
      for (let k = i; k < m.nodes.length - 1; k++) {
        const s = m.segments[k];
        if (s) {
          dist += s.distance;
          pipe ??= s.pipeSpec;
          if (s.slope !== null && s.distance >= 1 && !slopes.includes(s.slopeText)) slopes.push(s.slopeText);
        }
        const nx = m.nodes[k + 1];
        if (nx.manhole) return { pipe, slopes, dist, next: label(nx) };
      }
      const end = m.nodes[m.nodes.length - 1];
      const w = where.get(end.nodeId);
      if (!w || (w.mi === mi && w.i === m.nodes.length - 1)) return { pipe, slopes, dist, next: undefined };
      mi = w.mi; i = w.i;
    }
    return { pipe, slopes, dist, next: undefined };
  };

  const rows: ManholeRow[] = [], publics: ManholeRow[] = [];
  const seen = new Set<string>();
  models.forEach((m, mi) => m.nodes.forEach((n, i) => {
    const mh = n.manhole;
    if (!mh || seen.has(n.nodeId)) return;
    seen.add(n.nodeId);
    const gl = Math.round(n.groundLevel), invert = Math.round(n.invertLevel);
    const drop = n.invertIn !== undefined ? Math.round(n.invertIn - n.invertLevel) : undefined;
    const d = mh.isPublic ? null : downstream(mi, i);
    const row: ManholeRow = {
      nodeId: n.nodeId, no: label(n), kind: mh.label, size: `${mh.symbol === 'square' ? '□' : 'φ'}${mh.diameter}`,
      isPublic: mh.isPublic, existing: !!n.existing, gl, invert, depth: gl - invert,
      ...(drop ? { invertIn: Math.round(n.invertIn!), drop } : {}),
      ...(d?.pipe ? { pipe: d.pipe } : {}),
      ...(d && d.slopes.length ? { slope: d.slopes.length === 1 ? d.slopes[0] : `${d.slopes[0]}〜${d.slopes.at(-1)}` } : {}),
      ...(d?.next ? { toNext: Math.round(d.dist), next: d.next } : {}),
    };
    (mh.isPublic ? publics : rows).push(row);
  }));

  // 枝の中の分岐の先（縦断図に入れていない）は「入っていない」に数えない
  const skip = new Set<string>();
  const net = doc.network;
  const shownNodes = new Set(models.flatMap((m) => m.nodes.map((n) => n.nodeId)));
  for (const at of omittedAt) {
    const st = [at];
    while (st.length) {
      const id = st.pop()!;
      for (const s of Object.values(net.segments)) {
        if ((s.system !== 'drain' && s.system !== 'sewage') || (s.a !== id && s.b !== id)) continue;
        const o = s.a === id ? s.b : s.a;
        if (!skip.has(o) && !shownNodes.has(o)) { skip.add(o); st.push(o); }
      }
    }
  }
  const shown = new Set([...rows, ...publics].map((r) => r.nodeId));
  const outside = Object.values(doc.fixtures).filter((f) => isManhole(f.type)
    && !Object.values(net.nodes).some((n) => n.fixtureId === f.id && (shown.has(n.id) || skip.has(n.id)))).length;
  return { rows: [...rows, ...publics], datumLabel: models[0]?.datumLabel, outside, segIds: [...new Set(models.flatMap((m) => m.segments.map((s) => s.segId)))] };
}
