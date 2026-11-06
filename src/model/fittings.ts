/**
 * 継手（接続部品）の自動判定。ノードの接続数・角度・口径・系統から部品の種類を決める。
 * 線の曲がりだけで確定せず、判断できないものは needsConfirm にしてユーザーの確定を待つ。
 * ユーザーの確定はノードの fitting に保存し、接続数が変わったら無効にする。
 */
import { FIXTURE_CATALOG, type Fixture } from './fixtures';
import { adjacency, type Network, type PipeNode, type Segment, type SystemType, type Vec3 } from './network';

export type FittingType =
  | 'elbow90' | 'elbow45' | 'elbow' | 'socket' | 'reducer' | 'tee' | 'wye' | 'cross'
  | 'valve' | 'adapter' | 'junctionBox' | 'cap' | 'other'
  | 'faucetElbow' | 'faucetSocket' | 'threadSocket';
export type FittingChoice = FittingType | 'none';

export const FITTING_LABEL: Record<FittingType, string> = {
  elbow90: '90°エルボ', elbow45: '45°エルボ', elbow: 'エルボ', socket: 'ソケット', reducer: '径違いソケット',
  tee: 'チーズ', wye: 'Y管', cross: 'クロス', valve: 'バルブ', adapter: '器具接続継手',
  junctionBox: 'ジョイントボックス', cap: 'キャップ', other: 'その他部品',
  faucetElbow: '給水栓用エルボ（ネジ）', faucetSocket: '給水栓用ソケット（ネジ）', threadSocket: 'バルブ用ソケット（ネジ）',
};
/** 片側がネジの継手（シールテープを巻く） */
export const THREAD_FITTINGS: ReadonlySet<FittingType> = new Set(['faucetElbow', 'faucetSocket', 'threadSocket']);
export const FITTING_TYPES = Object.keys(FITTING_LABEL) as FittingType[];

/** 配線（継手の代わりに分岐でジョイントボックスを使う） */
export const isWire = (s: SystemType) => s === 'electric' || s === 'telecom';

export type NodeFitting = {
  nodeId: string;
  /** 自動判定の結果 */
  auto: FittingChoice;
  /** 実際に積算に使う部品（確定があればそれ） */
  type: FittingChoice;
  /** 自動判定できない（ユーザーの確定が必要） */
  needsConfirm: boolean;
  /** ユーザーが確定済み */
  confirmed: boolean;
  /** 確定後に接続が変わって無効になった */
  stale: boolean;
  /** 口径表記（例: "20"、"20×13"） */
  size: string;
  /** 主となる区間（系統・材質の代表） */
  main: Segment;
  reason?: string;
};

const ANGLE_TOL = 10;

const sub = (p: Vec3, q: Vec3): Vec3 => ({ x: p.x - q.x, y: p.y - q.y, z: p.z - q.z });
const unit = (v: Vec3): Vec3 => {
  const l = Math.hypot(v.x, v.y, v.z) || 1;
  return { x: v.x / l, y: v.y / l, z: v.z / l };
};
const dot = (a: Vec3, b: Vec3) => a.x * b.x + a.y * b.y + a.z * b.z;
const deg = (c: number) => (Math.acos(Math.max(-1, Math.min(1, c))) * 180) / Math.PI;
const near = (a: number, b: number) => Math.abs(a - b) <= ANGLE_TOL;

/** ノードから各区間の向き（単位ベクトル） */
function dirs(net: Network, n: PipeNode, segs: Segment[]): Vec3[] {
  return segs.map((s) => unit(sub(net.nodes[s.a === n.id ? s.b : s.a].pos, n.pos)));
}

function sizeOf(main: Segment[], branch: Segment[] = []): string {
  const all = [...main, ...branch].map((s) => s.diameter);
  const m = Math.max(...all);
  if (all.every((d) => d === m)) return String(m);
  const rest = [...new Set(all)].filter((d) => d !== m).sort((a, b) => b - a);
  return [m, ...rest].join('×');
}

const largest = (segs: Segment[]) => segs.reduce((a, b) => (b.diameter > a.diameter ? b : a));

type Auto = { auto: FittingChoice; needsConfirm: boolean; size: string; main: Segment; reason?: string };

function judge(net: Network, n: PipeNode, segs: Segment[], fixtures?: Record<string, Fixture>): Auto | null {
  if (segs.length === 0) return null;
  const main0 = largest(segs);
  const base = { size: sizeOf(segs), main: main0 };
  const systems = new Set(segs.map((s) => s.system));
  const wires = segs.filter((s) => isWire(s.system)).length;
  if (wires > 0 && wires < segs.length) return { ...base, auto: 'other', needsConfirm: true, reason: '配管と配線が同じ点につながっています' };
  const wire = wires > 0;
  const d = dirs(net, n, segs);

  if (n.kind === 'valve') {
    if (wire) return { ...base, auto: 'other', needsConfirm: true, reason: '配線にバルブが入っています' };
    return { ...base, auto: 'valve', needsConfirm: segs.length !== 2, reason: segs.length !== 2 ? 'バルブの接続数が2ではありません' : undefined };
  }
  if (n.fixtureId) {
    const f = fixtures?.[n.fixtureId];
    const thread = f ? FIXTURE_CATALOG[f.type]?.ports.find((p) => p.id === n.portId)?.thread : undefined;
    const auto: FittingChoice = wire ? 'none' : thread ?? 'adapter';
    return { ...base, auto, needsConfirm: segs.length > 1, reason: segs.length > 1 ? '器具の接続口に複数の配管がつながっています' : undefined };
  }
  if (segs.length === 1) return { ...base, auto: 'none', needsConfirm: false };

  if (wire) {
    if (segs.length === 2) return { ...base, auto: 'none', needsConfirm: false };
    return { ...base, auto: 'junctionBox', needsConfirm: false };
  }
  const mixed = systems.size > 1 || new Set(segs.map((s) => s.material ?? '')).size > 1;

  if (segs.length === 2) {
    const bend = 180 - deg(dot(d[0], d[1]));
    const diaDiff = segs[0].diameter !== segs[1].diameter;
    if (mixed) return { ...base, auto: 'other', needsConfirm: true, reason: '種類または材質の違う配管の接続です（異種管継手など）' };
    if (bend < 1) return { ...base, auto: diaDiff ? 'reducer' : 'none', needsConfirm: false };
    if (near(bend, 90)) return { ...base, auto: 'elbow90', needsConfirm: false };
    if (near(bend, 45)) return { ...base, auto: 'elbow45', needsConfirm: false };
    return { ...base, auto: 'elbow', needsConfirm: true, reason: `曲がり角 ${Math.round(bend)}° の部品を確定してください` };
  }

  // 一直線の組を探す
  const pairs: [number, number][] = [];
  for (let i = 0; i < d.length; i++) for (let j = i + 1; j < d.length; j++) if (180 - deg(dot(d[i], d[j])) <= ANGLE_TOL) pairs.push([i, j]);
  if (segs.length === 3) {
    if (pairs.length === 0) return { ...base, auto: 'tee', needsConfirm: true, reason: '一直線の本管がない分岐です（部品を確定してください）' };
    const [i, j] = pairs[0];
    const k = [0, 1, 2].find((x) => x !== i && x !== j)!;
    const main = [segs[i], segs[j]];
    const angle = deg(Math.abs(dot(d[k], d[i])));
    const size = sizeOf(main, [segs[k]]);
    const m = largest(main);
    if (mixed) return { size, main: m, auto: 'tee', needsConfirm: true, reason: '種類または材質の違う配管の分岐です' };
    if (near(angle, 90)) return { size, main: m, auto: 'tee', needsConfirm: false };
    if (near(angle, 45)) return { size, main: m, auto: 'wye', needsConfirm: false };
    return { size, main: m, auto: 'tee', needsConfirm: true, reason: `分岐角 ${Math.round(angle)}° の部品を確定してください` };
  }
  if (segs.length === 4) {
    const used = new Set(pairs.flat());
    const ok = pairs.length >= 2 && used.size === 4 && !mixed;
    return { ...base, auto: 'cross', needsConfirm: !ok, reason: ok ? undefined : '十字に一直線でない4方向の分岐です' };
  }
  return { ...base, auto: 'other', needsConfirm: true, reason: `${segs.length}方向の分岐です` };
}

/** 全ノードの部品判定（接続のないノードは含めない）。fixtures を渡すと器具の接続口のネジ継手を判定する */
export function analyzeFittings(net: Network, fixtures?: Record<string, Fixture>): NodeFitting[] {
  const adj = adjacency(net);
  const out: NodeFitting[] = [];
  for (const n of Object.values(net.nodes)) {
    const segs = adj.get(n.id) ?? [];
    const a = judge(net, n, segs, fixtures);
    if (!a) continue;
    const ov = n.fitting;
    const valid = !!ov && ov.degree === segs.length && (ov.type === 'none' || (FITTING_TYPES as string[]).includes(ov.type));
    const stale = !!ov && !valid;
    out.push({
      nodeId: n.id,
      auto: a.auto,
      type: valid ? (ov!.type as FittingChoice) : a.auto,
      needsConfirm: valid ? false : a.needsConfirm || stale,
      confirmed: valid,
      stale,
      size: a.size,
      main: a.main,
      reason: stale ? '確定後に接続が変わりました。部品を確認してください' : a.reason,
    });
  }
  return out;
}

export function fittingName(type: FittingType, size: string): string {
  const reduced = size.includes('×') && type !== 'reducer';
  const name = FITTING_LABEL[type];
  return reduced && (type === 'elbow90' || type === 'elbow45' || type === 'elbow' || type === 'tee' || type === 'cross' || type === 'wye') ? `径違い${name}` : name;
}
