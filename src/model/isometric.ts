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

/** 間隔のならし: 隣り合う位置の間隔を 全体の 1/SPREAD_MIN 以上に広げる。長い間隔を縮めるのは 全体の 1/SPREAD_MAX まで */
const SPREAD_MIN = 60, SPREAD_MAX = 6;
/** これ以下の位置の差(mm)は、描いたときのわずかなずれとして広げない */
const SPREAD_TOL = 8;
const COS30 = Math.cos(Math.PI / 6), SIN30 = 0.5;

/** 等角投影。x は右下がり、y（奥行き）は左下がり、z は上。画面の y は下向き */
export function isoProject(p: Vec3): { x: number; y: number } {
  return { x: (p.x - p.y) * COS30, y: (p.x + p.y) * SIN30 - p.z };
}

/**
 * 1 方向の位置を「間隔をならす」写像にする（NO SCALE の系統図用）。
 * 隣り合う位置の間隔が lo より狭ければ lo に広げ、hi より広ければ hi に縮める。順番は変えない（単調）ので、
 * 軸に平行な管は平行のまま、つながり方も変わらない。tol 以下の差（描いたときのわずかなずれ）は動かさず、
 * tol〜2×tol はなだらかに広げる（少しのずれが急に大きな段にならないように）。
 */
export function spreadAxis(values: number[], lo: number, hi: number, tol = SPREAD_TOL): (v: number) => number {
  const vs = [...new Set(values)].sort((a, b) => a - b);
  if (vs.length < 2) return (v) => v;
  const out = [vs[0]];
  for (let i = 1; i < vs.length; i++) {
    const g = vs[i] - vs[i - 1];
    // g ≤ tol: そのまま。tol〜2tol: g から lo へなだらかに。それ以上: lo 以上 hi 以下
    const wide = Math.max(lo, g);
    out.push(out[i - 1] + (g <= tol ? g : Math.min(hi, g < 2 * tol ? g + (wide - g) * ((g - tol) / tol) : wide)));
  }
  return (v) => {
    if (v <= vs[0]) return out[0] + (v - vs[0]);
    for (let i = 1; i < vs.length; i++) if (v <= vs[i]) return out[i - 1] + ((v - vs[i - 1]) / (vs[i] - vs[i - 1])) * (out[i] - out[i - 1]);
    return out[out.length - 1] + (v - vs[vs.length - 1]);
  };
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
export function buildIsometric(doc: Doc, kind: IsoKind, profile: MunicipalityProfile, opts: { lengthOf?: (segId: string) => number; manholeLabels?: Record<string, string>; /** 給水の図で、混んだ所を広げ長い直線を縮める（既定 true。長さの数字は実寸のまま）。false で実寸の比のまま */ spread?: boolean } = {}): IsoModel {
  const net = doc.network;
  // 給水の図は NO SCALE の系統図として、間隔をならしてから投影する。
  // ヘッダーの出口のように数 cm おきに並ぶ管が 1 本に重なって見えるのを防ぎ、長い直線を縮めたぶん全体を大きく描ける
  let place = (p: Vec3): Vec3 => p;
  if (kind === 'water' && opts.spread !== false) {
    const ps: Vec3[] = [];
    for (const s of Object.values(net.segments)) if (inKind(kind, s.system)) for (const id of [s.a, s.b]) if (net.nodes[id]) ps.push(net.nodes[id].pos);
    if (ps.length) {
      const ext = (f: (p: Vec3) => number) => Math.max(...ps.map(f)) - Math.min(...ps.map(f));
      const E = Math.max(ext((p) => p.x), ext((p) => p.y), ext((p) => p.z), 1);
      const lo0 = E / SPREAD_MIN;
      // 広げたぶんだけ、長い直線を縮めて元の大きさに収める（広げる所が無ければ何も変えない）。縮めすぎない下限は 全体の 1/SPREAD_MAX
      const axis = (f: (p: Vec3) => number) => {
        const vs = ps.map(f), span = ext(f);
        const tot = (l: number, hi: number) => { const m = spreadAxis(vs, l, hi); return m(Math.max(...vs)) - m(Math.min(...vs)); };
        // 位置の数が多い方向は、広げる幅を控える（長い直線をいちばん縮めても元の 1.25 倍に収まるまで）。
        // 広げすぎると全体が小さく描かれて、かえって見にくくなる
        let lo = lo0;
        const room = Math.max(span, E / 4) * 1.25;
        for (let i = 0; i < 40 && tot(lo, E / SPREAD_MAX) > room; i++) lo *= 0.85;
        const total = (hi: number) => tot(lo, hi);
        if (total(Infinity) <= span + 1e-6) return spreadAxis(vs, lo, Infinity);
        let a = E / SPREAD_MAX, b = Math.max(span, a);
        if (total(a) < span) for (let i = 0; i < 30; i++) { const m = (a + b) / 2; if (total(m) > span) b = m; else a = m; }
        return spreadAxis(vs, lo, a);
      };
      const mx = axis((p) => p.x), my = axis((p) => p.y), mz = axis((p) => p.z);
      place = (p) => ({ x: mx(p.x), y: my(p.y), z: mz(p.z) });
    }
  }
  const project = (p: Vec3) => isoProject(place(p));
  void profile; // 今は体裁に依存しない（将来 記号などに使う）
  const lines: IsoLine[] = [];
  const used = new Set<string>();
  for (const s of Object.values(net.segments)) {
    if (!inKind(kind, s.system)) continue;
    const a = net.nodes[s.a], b = net.nodes[s.b];
    if (!a || !b) continue;
    const pa = project(a.pos), pb = project(b.pos);
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
      if (n.kind === 'valve') { const p = project(n.pos); points.push({ nodeId: id, x: p.x, y: p.y, label: 'バルブ', valve: true }); }
      continue;
    }
    if (doneFixture.has(fx.id)) continue;
    doneFixture.add(fx.id);
    const p = project(n.pos);
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
