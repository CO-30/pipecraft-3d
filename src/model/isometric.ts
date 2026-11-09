/**
 * アイソメ図（立面図・展開図）の計算モデル。配管の 3D 座標を等角投影して、
 * 区間ごとの線（管種口径×長さ）と器具・マスの点（名前・高さ）にする。沖縄市の申請図面の「立面図（展開図）」と同じ見せ方。
 * 単位は mm（投影後も mm）。描画側で用紙に収まるように縮める（NO SCALE）。
 */
import type { Doc } from './doc';
import { floorById } from './building';
import { FIXTURE_CATALOG, isManhole } from './fixtures';
import type { MunicipalityProfile } from './municipality';
import type { SystemType, Vec3 } from './network';
import { isDrain } from './slope';

export type IsoKind = 'water' | 'drain';
export type IsoLine = { segId: string; x1: number; y1: number; x2: number; y2: number; label: string; system: SystemType; existing?: boolean };
export type IsoPoint = { nodeId: string; x: number; y: number; label: string; height?: string; isPublic?: boolean; isManhole?: boolean; existing?: boolean };
export type IsoModel = { kind: IsoKind; lines: IsoLine[]; points: IsoPoint[]; bounds: { minX: number; minY: number; maxX: number; maxY: number } };

const COS30 = Math.cos(Math.PI / 6), SIN30 = 0.5;

/** 等角投影。x は右下がり、y（奥行き）は左下がり、z は上。画面の y は下向き */
export function isoProject(p: Vec3): { x: number; y: number } {
  return { x: (p.x - p.y) * COS30, y: (p.x + p.y) * SIN30 - p.z };
}

const inKind = (kind: IsoKind, s: SystemType) => (kind === 'water' ? s === 'water' || s === 'hotWater' : isDrain(s));

export function buildIsometric(doc: Doc, kind: IsoKind, profile: MunicipalityProfile): IsoModel {
  const net = doc.network;
  void profile; // 今は体裁に依存しない（将来 記号などに使う）
  const lines: IsoLine[] = [];
  const used = new Set<string>();
  for (const s of Object.values(net.segments)) {
    if (!inKind(kind, s.system)) continue;
    const a = net.nodes[s.a], b = net.nodes[s.b];
    if (!a || !b) continue;
    const pa = isoProject(a.pos), pb = isoProject(b.pos);
    const len = Math.hypot(b.pos.x - a.pos.x, b.pos.y - a.pos.y, b.pos.z - a.pos.z);
    lines.push({ segId: s.id, x1: pa.x, y1: pa.y, x2: pb.x, y2: pb.y, label: `${s.material || (isDrain(s.system) ? 'VU' : 'HI')}${s.diameter}×${(len / 1000).toFixed(1)}`, system: s.system, ...(s.existing ? { existing: true } : {}) });
    used.add(s.a); used.add(s.b);
  }
  const points: IsoPoint[] = [];
  // 接続口が複数の器具は、カタログの最初の接続口（メーターなら入口）を代表にする（接続順に依存しない）
  const portIndex = (nodeId: string) => {
    const n = net.nodes[nodeId];
    const fx = n.fixtureId ? doc.fixtures[n.fixtureId] : undefined;
    return fx ? FIXTURE_CATALOG[fx.type].ports.findIndex((p) => p.id === n.portId) : 0;
  };
  const ordered = [...used].sort((p, q) => portIndex(p) - portIndex(q));
  const doneFixture = new Set<string>();
  for (const id of ordered) {
    const n = net.nodes[id];
    const fx = n.fixtureId ? doc.fixtures[n.fixtureId] : undefined;
    if (!fx) {
      if (n.kind === 'valve') { const p = isoProject(n.pos); points.push({ nodeId: id, x: p.x, y: p.y, label: 'バルブ' }); }
      continue;
    }
    if (doneFixture.has(fx.id)) continue;
    doneFixture.add(fx.id);
    const p = isoProject(n.pos);
    const fl = floorById(doc.building, fx.floorId);
    const mh = isManhole(fx.type);
    points.push({
      nodeId: id, x: p.x, y: p.y, label: FIXTURE_CATALOG[fx.type].label,
      ...(mh ? { isManhole: true, isPublic: fx.type.startsWith('public') } : { height: ((n.pos.z - (fl?.elevation ?? 0)) / 1000).toFixed(1) }),
      ...(fx.params?.existing ? { existing: true } : {}),
    });
  }
  const xs = [...lines.flatMap((l) => [l.x1, l.x2]), ...points.map((p) => p.x)];
  const ys = [...lines.flatMap((l) => [l.y1, l.y2]), ...points.map((p) => p.y)];
  const bounds = xs.length ? { minX: Math.min(...xs), minY: Math.min(...ys), maxX: Math.max(...xs), maxY: Math.max(...ys) } : { minX: 0, minY: 0, maxX: 0, maxY: 0 };
  return { kind, lines, points, bounds };
}
