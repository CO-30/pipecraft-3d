/**
 * 排水管の勾配。流末（下流の出口）の点を基準に、つながった横管をたどって上流ほど高くする。
 * 立て管（平面上の長さがほぼ0の区間）・排水系以外の配管・器具の接続口（高さは器具で決まる）は動かさない。
 */
import { moveNode, validateNetwork, type Network, type Segment, type SystemType } from './network';

export const DRAIN_SYSTEMS: SystemType[] = ['drain', 'sewage', 'vent', 'condensate'];
export const isDrain = (s: SystemType) => DRAIN_SYSTEMS.includes(s);

/** 排水横管の最小勾配（管径別）: 65以下 1/50、75・100 1/100、125 1/150、150以上 1/200 */
export function defaultSlope(diameter: number): number {
  if (diameter <= 65) return 1 / 50;
  if (diameter <= 100) return 1 / 100;
  if (diameter <= 125) return 1 / 150;
  return 1 / 200;
}

/** 塩ビ管（VU）の外径(mm) */
const VU_OD: Record<number, number> = { 40: 48, 50: 60, 65: 76, 75: 89, 100: 114, 125: 140, 150: 165, 200: 216 };
export const outerDiameter = (d: number) => VU_OD[d] ?? Math.round(d * 1.15);

/** 勾配が手で固定されているか（slopePin、または以前の slopeLocked） */
export const isSlopePinned = (s: { slopePin?: boolean; slopeLocked?: boolean }) => !!(s.slopePin || s.slopeLocked);

export const slopeLabel = (r: number) => (r > 0 ? `1/${Math.round(1 / r)}` : '水平');

/** 排水管の流速の標準の上限(m/秒)。「下水道施設計画・設計指針と解説」: 0.6〜1.5m/秒、やむを得ない場合 3.0m/秒まで */
export const MAX_VELOCITY = 1.5;
/**
 * 急すぎない勾配の上限: 満流の流速が v(m/秒) になる勾配（マニング式、塩ビ管 n=0.010、内径は呼び径）。
 * 急すぎると水だけが薄く流れて汚物が残る
 */
export function maxSlope(diameter: number, v = MAX_VELOCITY): number {
  const R = diameter / 1000 / 4;
  return ((v * 0.010) / Math.pow(R, 2 / 3)) ** 2;
}

export function planLength(net: Network, s: Segment): number {
  const a = net.nodes[s.a].pos, b = net.nodes[s.b].pos;
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/**
 * 区間の端の管底高。落差桝（node.dropIn）では、流入側の区間はノードの高さ + dropIn に着く。
 * 流入側かどうかは「反対の端がノードより高い」で判定（流出側の区間は下がっていく）
 */
export function endZ(net: Network, s: Segment, side: 'a' | 'b', down?: 'a' | 'b'): number {
  const n = net.nodes[side === 'a' ? s.a : s.b], o = net.nodes[side === 'a' ? s.b : s.a];
  // dropIn・dropEnd はマスの接続口（fixtureId あり）だけで有効
  const up = (n.dropIn ?? 0) + (s.dropEnd ?? 0);
  if (!up || !n.fixtureId || !o) return n.pos.z;
  // 向きが分かっていれば（固定勾配の計算など）、この端が下流端のときだけ流入側
  if (down) return side === down ? n.pos.z + up : n.pos.z;
  return o.pos.z > n.pos.z + 0.05 ? n.pos.z + up : n.pos.z;
}
const dz = (net: Network, s: Segment) => Math.abs(endZ(net, s, 'a') - endZ(net, s, 'b'));

/** 立て管（平面の長さが1mm未満、または高低差が平面の長さより大きい斜めの管） */
export function isRiserLike(net: Network, s: Segment): boolean {
  const L = planLength(net, s);
  // 45° の斜め（基礎を抜ける排水など）も、高さを勾配で決めない管として扱う
  return L < 1 || dz(net, s) >= 0.9 * L;
}

/** 勾配が足りているか（高さを0.1mmに丸めた誤差は許す） */
export const slopeEnough = (net: Network, s: Segment, need: number) =>
  dz(net, s) + 0.15 >= need * planLength(net, s);

/** 区間の実際の勾配（高低差 / 平面の長さ）。立て管は null */
export function actualSlope(net: Network, s: Segment): number | null {
  const L = planLength(net, s);
  if (isRiserLike(net, s)) return null;
  return dz(net, s) / L;
}

/**
 * outletId を流末として勾配をつける。slope = 'auto' なら区間ごとに管径別の最小勾配。
 * 成功なら新しい Network と、高さを変えた点の数・勾配をつけた区間の数。
 */
export function applySlope(
  net: Network, outletId: string, slope: number | 'auto' | ((s: Segment) => number),
  opts: { include?: (s: Segment) => boolean; allowMid?: boolean } = {},
): { net: Network; nodes: number; segments: number } | null {
  if (!net.nodes[outletId]) return null;
  const ratioOf = (s: Segment) => (slope === 'auto' ? defaultSlope(s.diameter) : typeof slope === 'function' ? slope(s) : slope);
  const adj = new Map<string, Segment[]>();
  for (const s of Object.values(net.segments)) {
    if (!isDrain(s.system) || isRiserLike(net, s) || (opts.include && !opts.include(s))) continue;
    for (const n of [s.a, s.b]) adj.set(n, [...(adj.get(n) ?? []), s]);
  }
  // 流末は横管の端（または立て管・器具とのつなぎ目）。横管の途中の点を流末にすると V 字になるので受け付けない
  // （allowMid: 起点が分かっていて、両側へ上げてよいとき）
  const deg = adj.get(outletId)?.length ?? 0;
  if (opts.allowMid ? deg < 1 : deg !== 1) return null;
  // 平面距離の最短経路木（Dijkstra）。高さは木に沿って区間ごとの勾配で積み上げる
  const dist = new Map<string, number>([[outletId, 0]]);
  const z = new Map<string, number>([[outletId, net.nodes[outletId].pos.z]]);
  const done = new Set<string>();
  /** 各点の高さを決めた区間（最短経路木の親） */
  const parent = new Map<string, Segment>();
  while (true) {
    let cur: string | null = null;
    for (const [n, d] of dist) if (!done.has(n) && (cur === null || d < dist.get(cur)!)) cur = n;
    if (cur === null) break;
    done.add(cur);
    // 器具の接続口から先へは広げない（器具の向こう側は別系統）
    if (cur !== outletId && net.nodes[cur].fixtureId) continue;
    for (const s of adj.get(cur) ?? []) {
      const o = s.a === cur ? s.b : s.a;
      const L = planLength(net, s);
      const nd = dist.get(cur)! + L;
      if (!dist.has(o) || nd < dist.get(o)! - 1e-6) {
        const r = ratioOf(s);
        dist.set(o, nd);
        z.set(o, z.get(cur)! + r * L);
        parent.set(o, s);
      }
    }
  }
  let out = net, moved = 0;
  for (const [id, zz] of z) {
    const n = out.nodes[id];
    if (id === outletId || n.fixtureId || n.zPin || Math.abs(n.pos.z - zz) < 0.05) continue;
    const next = moveNode(out, id, { ...n.pos, z: Math.round(zz * 10) / 10 });
    if (next === out) return null;
    out = next;
    moved++;
  }
  const used = new Set([...parent.values()].map((s) => s.id));
  const segments = { ...out.segments };
  for (const id of used) {
    const s = segments[id];
    segments[id] = { ...s, slope: ratioOf(s) };
  }
  out = { ...out, segments };
  if (validateNetwork(out).length) return null;
  return { net: out, nodes: moved, segments: used.size };
}

/** その区間を通らずに node から排水管をたどって到達できるノードに pred を満たすものがあるか */
function sideReaches(net: Network, s: Segment, startId: string, pred: (nodeId: string) => boolean): boolean {
  const seen = new Set<string>([startId]);
  const queue = [startId];
  while (queue.length) {
    const cur = queue.shift()!;
    if (pred(cur)) return true;
    for (const t of Object.values(net.segments)) {
      if (t.id === s.id || !isDrain(t.system) || (t.a !== cur && t.b !== cur)) continue;
      const o = t.a === cur ? t.b : t.a;
      if (!seen.has(o)) { seen.add(o); queue.push(o); }
    }
  }
  return false;
}

/**
 * 区間の下流端。isOutlet（マス・流末の判定）が与えられ、片側だけがそこへ届くならその側。
 * そうでなければ高さが低いほう。同じ高さなら b（描いた向きの終点）。
 */
export function downstreamEnd(net: Network, s: Segment, isOutlet?: (nodeId: string) => boolean): 'a' | 'b' {
  if (isOutlet) {
    const ra = sideReaches(net, s, s.a, isOutlet), rb = sideReaches(net, s, s.b, isOutlet);
    if (ra !== rb) return ra ? 'a' : 'b';
  }
  // 隣の固定区間とのつながりで決める: 片方の端から固定区間が流れ出て（その端が高い）いればその端が下流（流れが続く）。
  // それが無ければ、片方の端へ固定区間が流れ込んで（その端が低い）いればその端が上流
  const neighbors = (nodeId: string) => Object.values(net.segments).filter((t) => t.id !== s.id && t.slopeLocked && isDrain(t.system) && (t.a === nodeId || t.b === nodeId));
  // ここは生の pos.z で比べる（落差桝の流入側は z + dropIn でさらに高いので、向きの判定は変わらない）
  const leaves = (nodeId: string) => neighbors(nodeId).some((t) => net.nodes[t.a === nodeId ? t.b : t.a].pos.z < net.nodes[nodeId].pos.z - 0.05);
  const arrives = (nodeId: string) => neighbors(nodeId).some((t) => net.nodes[t.a === nodeId ? t.b : t.a].pos.z > net.nodes[nodeId].pos.z + 0.05);
  const la = leaves(s.a), lb = leaves(s.b);
  if (la !== lb) return la ? 'a' : 'b';
  const fa = arrives(s.a), fb = arrives(s.b);
  if (fa !== fb) return fa ? 'b' : 'a';
  const za = net.nodes[s.a].pos.z, zb = net.nodes[s.b].pos.z;
  if (Math.abs(za - zb) < 0.05) return 'b';
  return za < zb ? 'a' : 'b';
}

/**
 * 下流端 Z ＝ 上流端 Z − ratio × 水平距離 にする。下流端が器具の接続口（マスの管底など、高さが器具で決まる）なら
 * 代わりに上流端を 下流端 Z + ratio × 水平距離 に上げる。どちらも器具、または配管が壊れるなら元の net
 */
function applyLockedSlope(net: Network, s: Segment, down: 'a' | 'b'): Network {
  const ratio = s.slope ?? 0;
  const upId = down === 'a' ? s.b : s.a, downId = down === 'a' ? s.a : s.b;
  const L = planLength(net, s);
  // 下流端が落差桝なら、流入側の管底（node.z + dropIn）が勾配の着点
  const dropDown = net.nodes[downId].fixtureId ? net.nodes[downId].dropIn ?? 0 : 0;
  let moveId = downId, z = endZ(net, s, upId === s.a ? 'a' : 'b', down) - ratio * L - dropDown;
  if (net.nodes[downId].fixtureId) {
    if (net.nodes[upId].fixtureId) return net;
    moveId = upId;
    z = endZ(net, s, down, down) + ratio * L;
  }
  z = Math.round(z * 10) / 10;
  const n = net.nodes[moveId];
  if (Math.abs(n.pos.z - z) < 0.05) return net;
  const next = moveNode(net, moveId, { ...n.pos, z });
  return next === net || validateNetwork(next).length ? net : next;
}

/** 区間の勾配が設計勾配どおりか（0.05mm の誤差を許す） */
function slopeSatisfied(net: Network, s: Segment, down: 'a' | 'b'): boolean {
  const upZ = endZ(net, s, down === 'a' ? 'b' : 'a', down), downZ = endZ(net, s, down, down);
  return Math.abs(downZ - (upZ - (s.slope ?? 0) * planLength(net, s))) <= 0.05;
}

/** 区間に設計勾配（比率）を設定して固定し、下流端の高さを勾配から決める。失敗なら元の net */
export function setSlopeRatio(net: Network, segId: string, ratio: number, isOutlet?: (nodeId: string) => boolean): Network {
  const s = net.segments[segId];
  if (!s || !(ratio >= 0) || !Number.isFinite(ratio)) return net;
  const down = downstreamEnd(net, s, isOutlet);
  const seg: Segment = { ...s, slope: ratio, slopeLocked: true };
  const withSeg: Network = { ...net, segments: { ...net.segments, [segId]: seg } };
  const out = applyLockedSlope(withSeg, seg, down);
  return slopeSatisfied(out, seg, down) ? out : net;
}

/**
 * movedNodeId の高さが変わったあと（prev → net）の後始末。向きは動かす前（prev）の高低で決める。
 * - 手で動かした点が下流端だった固定区間: 固定を外す（マスの管底が動いた場合は上流端を合わせる）。
 * - 上流端だった固定区間: 下流端を勾配から再計算し、下流へ連鎖する。
 * - 連鎖の途中で、別の枝の下流端（合流点）に当たった区間: その枝は動かさず、勾配が保てなければ固定を外す。
 * - 再計算できなかった（配管が壊れる・両端が器具）区間も固定を外す。固定が付いている区間は常に勾配どおり。
 */
export function propagateLockedSlopes(prev: Network, net: Network, movedNodeId: string, opts: { skip?: string[] } = {}): Network {
  let out = net;
  const queue = [movedNodeId];
  const seen = new Set<string>([movedNodeId]);
  /** skip: 今まさに勾配を設定した区間（向きの推定に使わず、再計算もしない） */
  const doneSegs = new Set<string>(opts.skip ?? []);
  const unlock = (id: string) => { out = { ...out, segments: { ...out.segments, [id]: { ...out.segments[id], slopeLocked: false } } }; };
  while (queue.length) {
    const cur = queue.shift()!;
    for (const s0 of Object.values(out.segments)) {
      if (!s0.slopeLocked || doneSegs.has(s0.id) || (s0.a !== cur && s0.b !== cur)) continue;
      const s = out.segments[s0.id];
      doneSegs.add(s.id);
      const other = s.a === cur ? s.b : s.a;
      const ps = prev.segments[s.id];
      const curSide: 'a' | 'b' = s.a === cur ? 'a' : 'b';
      const curWasDown = !!ps && !!prev.nodes[ps.a] && !!prev.nodes[ps.b] && downstreamEnd(prev, ps) === curSide;
      if (curWasDown && !out.nodes[cur].fixtureId) {
        // 下流端が動いた（手で動かした／別の枝の連鎖で動いた）→ この区間の勾配は保てないので固定を外す
        if (!slopeSatisfied(out, s, curSide)) unlock(s.id);
        continue;
      }
      // 上流端が動いた → 下流端を再計算。マスの管底が動いた → 上流端を合わせる
      const next = applyLockedSlope(out, s, curWasDown ? curSide : (curSide === 'a' ? 'b' : 'a'));
      if (next !== out) {
        out = next;
        if (!seen.has(other)) { seen.add(other); queue.push(other); }
      } else if (!slopeSatisfied(out, s, curWasDown ? curSide : (curSide === 'a' ? 'b' : 'a'))) {
        unlock(s.id);
      }
    }
  }
  return out;
}
