/**
 * アイソメ図（立面図・展開図）の計算モデル。配管の 3D 座標を等角投影して、
 * 区間ごとの線（管種口径×長さ）と器具・マスの点（名前・高さ）にする。沖縄市の申請図面の「立面図（展開図）」と同じ見せ方。
 * 単位は mm（投影後も mm）。描画側で用紙に収まるように縮める（NO SCALE）。
 */
import type { Doc } from './doc';
import { floorById } from './building';
import { FIXTURE_CATALOG, isHeader, isManhole, type FixtureType } from './fixtures';
import type { MunicipalityProfile } from './municipality';
import type { ProfileModel } from './profileDrawing';
import type { SystemType, Vec3 } from './network';
import { isDrain } from './slope';
import { drawingMaterial } from './materials';

export type IsoKind = 'water' | 'drain';
/** spec: 管種口径（VU50）、len: 長さ（m 1 桁）。main: 両端が桝（桝どうしの本管） */
export type IsoLine = { segId: string; x1: number; y1: number; x2: number; y2: number; label: string; system: SystemType; existing?: boolean; spec?: string; len?: string; main?: boolean; /** 両端の点の ID と長さ(mm)（同じ管の続きをまとめて書くため） */ a?: string; b?: string; lenMm?: number };
export type IsoPoint = { nodeId: string; x: number; y: number; label: string; /** 器具の種類（記号の選択用） */ type?: FixtureType; height?: string; isPublic?: boolean; isManhole?: boolean; existing?: boolean; /** 配管の途中のバルブ（止水栓）。給水の図では文字を書かず、記号と凡例で示す */ valve?: boolean };
export type IsoModel = { kind: IsoKind; lines: IsoLine[]; points: IsoPoint[]; /** 器具の接続口・バルブの点の ID（代表の点だけの points と違い全部。管をまとめるときにここで切る） */ fixed?: string[]; bounds: { minX: number; minY: number; maxX: number; maxY: number } };

const COS30 = Math.cos(Math.PI / 6), SIN30 = 0.5;

/** 等角投影。x は右下がり、y（奥行き）は左下がり、z は上。画面の y は下向き */
export function isoProject(p: Vec3): { x: number; y: number } {
  return { x: (p.x - p.y) * COS30, y: (p.x + p.y) * SIN30 - p.z };
}

const inKind = (kind: IsoKind, s: SystemType) => (kind === 'water' ? s === 'water' || s === 'hotWater' : isDrain(s));

/** lengthOf: 区間の長さ（mm）。竣工図では実測長を渡す。既定は配管の 3D の長さ */
/** 丸数字（①〜⑳） */
const circledNo = (n: number) => (n >= 1 && n <= 20 ? String.fromCharCode(0x2460 + n - 1) : `(${n})`);

/**
 * 南風原町の配管立図の桝の書き方: 「① H=410」（縦断図の NO.n と同じ番号）、落差は「H=600-1280」、公共は「既設公共汚水桝 H=1100」。
 * 縦断図のモデル（本線・枝）から 点の ID → 文字 を作る
 */
export function isoManholeLabels(models: ProfileModel[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of models) for (const n of m.nodes) {
    if (!n.manhole || out[n.nodeId]) continue;
    const h = n.manhole.depthIn !== undefined ? `${Math.round(n.manhole.depthIn)}-${Math.round(n.manhole.depth)}` : `${Math.round(n.manhole.depth)}`;
    const no = /^NO\.(\d+)/.exec(n.manhole.name ?? '');
    out[n.nodeId] = n.manhole.isPublic ? `${n.existing ? '既設' : '新設'}${n.manhole.label.replace('マス', '桝')} H=${h}` : no ? `${circledNo(Number(no[1]))} H=${h}` : `${n.manhole.label} H=${h}`;
  }
  return out;
}

/** manholeLabels: 桝の点の ID → 図に書く文字（isoManholeLabels）。無ければ桝の種類名 */
export function buildIsometric(doc: Doc, kind: IsoKind, profile: MunicipalityProfile, opts: { lengthOf?: (segId: string) => number; manholeLabels?: Record<string, string> } = {}): IsoModel {
  const net = doc.network;
  void profile; // 今は体裁に依存しない（将来 記号などに使う）
  const lines: IsoLine[] = [];
  const used = new Set<string>();
  for (const s of Object.values(net.segments)) {
    if (!inKind(kind, s.system)) continue;
    const a = net.nodes[s.a], b = net.nodes[s.b];
    if (!a || !b) continue;
    const pa = isoProject(a.pos), pb = isoProject(b.pos);
    const len = opts.lengthOf ? opts.lengthOf(s.id) : Math.hypot(b.pos.x - a.pos.x, b.pos.y - a.pos.y, b.pos.z - a.pos.z);
    const spec = `${drawingMaterial(s.material) || (isDrain(s.system) ? 'VU' : 'HI')}${s.diameter}`, lenText = (len / 1000).toFixed(1);
    const isMh = (nid: string) => { const f = net.nodes[nid]?.fixtureId ? doc.fixtures[net.nodes[nid].fixtureId!] : undefined; return !!f && isManhole(f.type); };
    lines.push({ segId: s.id, x1: pa.x, y1: pa.y, x2: pb.x, y2: pb.y, label: `${spec}×${lenText}`, spec, len: lenText, a: s.a, b: s.b, lenMm: len, ...(isMh(s.a) && isMh(s.b) ? { main: true } : {}), system: s.system, ...(s.existing ? { existing: true } : {}) });
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
      if (n.kind === 'valve') { const p = isoProject(n.pos); points.push({ nodeId: id, x: p.x, y: p.y, label: 'バルブ', valve: true }); }
      continue;
    }
    if (doneFixture.has(fx.id)) continue;
    doneFixture.add(fx.id);
    const p = isoProject(n.pos);
    const fl = floorById(doc.building, fx.floorId);
    const mh = isManhole(fx.type);
    // ヘッダーは配管をつないだ出口の数を付ける（給水ヘッダー6P）
    const label = isHeader(fx.type)
      ? `${FIXTURE_CATALOG[fx.type].label}${Object.values(doc.network.nodes).filter((m) => m.fixtureId === fx.id && m.portId?.startsWith('out') && Object.values(doc.network.segments).some((s) => s.a === m.id || s.b === m.id)).length}P`
      : (mh && opts.manholeLabels?.[id]) || FIXTURE_CATALOG[fx.type].label;
    points.push({
      nodeId: id, x: p.x, y: p.y, label, type: fx.type,
      ...(mh ? { isManhole: true, isPublic: fx.type.startsWith('public') } : { height: ((n.pos.z - (fl?.elevation ?? 0)) / 1000).toFixed(1) }),
      ...(fx.params?.existing ? { existing: true } : {}),
    });
  }
  const xs = [...lines.flatMap((l) => [l.x1, l.x2]), ...points.map((p) => p.x)];
  const ys = [...lines.flatMap((l) => [l.y1, l.y2]), ...points.map((p) => p.y)];
  const bounds = xs.length ? { minX: Math.min(...xs), minY: Math.min(...ys), maxX: Math.max(...xs), maxY: Math.max(...ys) } : { minX: 0, minY: 0, maxX: 0, maxY: 0 };
  const fixed = [...used].filter((id) => !!net.nodes[id].fixtureId || net.nodes[id].kind === 'valve');
  return { kind, lines, points, fixed, bounds };
}
