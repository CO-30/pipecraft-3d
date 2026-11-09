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

export const slopeLabel = (r: number) => (r > 0 ? `1/${Math.round(1 / r)}` : '水平');

export function planLength(net: Network, s: Segment): number {
  const a = net.nodes[s.a].pos, b = net.nodes[s.b].pos;
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/** 立て管（平面の長さが1mm未満、または高低差が平面の長さより大きい斜めの管） */
export function isRiserLike(net: Network, s: Segment): boolean {
  const L = planLength(net, s);
  return L < 1 || Math.abs(net.nodes[s.a].pos.z - net.nodes[s.b].pos.z) > L;
}

/** 勾配が足りているか（高さを0.1mmに丸めた誤差は許す） */
export const slopeEnough = (net: Network, s: Segment, need: number) =>
  Math.abs(net.nodes[s.a].pos.z - net.nodes[s.b].pos.z) + 0.15 >= need * planLength(net, s);

/** 区間の実際の勾配（高低差 / 平面の長さ）。立て管は null */
export function actualSlope(net: Network, s: Segment): number | null {
  const L = planLength(net, s);
  if (isRiserLike(net, s)) return null;
  return Math.abs(net.nodes[s.a].pos.z - net.nodes[s.b].pos.z) / L;
}

/**
 * outletId を流末として勾配をつける。slope = 'auto' なら区間ごとに管径別の最小勾配。
 * 成功なら新しい Network と、高さを変えた点の数・勾配をつけた区間の数。
 */
export function applySlope(net: Network, outletId: string, slope: number | 'auto'): { net: Network; nodes: number; segments: number } | null {
  if (!net.nodes[outletId]) return null;
  const adj = new Map<string, Segment[]>();
  for (const s of Object.values(net.segments)) {
    if (!isDrain(s.system) || isRiserLike(net, s)) continue;
    for (const n of [s.a, s.b]) adj.set(n, [...(adj.get(n) ?? []), s]);
  }
  // 流末は横管の端（または立て管・器具とのつなぎ目）。横管の途中の点を流末にすると V 字になるので受け付けない
  if ((adj.get(outletId)?.length ?? 0) !== 1) return null;
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
        const r = slope === 'auto' ? defaultSlope(s.diameter) : slope;
        dist.set(o, nd);
        z.set(o, z.get(cur)! + r * L);
        parent.set(o, s);
      }
    }
  }
  let out = net, moved = 0;
  for (const [id, zz] of z) {
    const n = out.nodes[id];
    if (id === outletId || n.fixtureId || Math.abs(n.pos.z - zz) < 0.05) continue;
    const next = moveNode(out, id, { ...n.pos, z: Math.round(zz * 10) / 10 });
    if (next === out) return null;
    out = next;
    moved++;
  }
  const used = new Set([...parent.values()].map((s) => s.id));
  const segments = { ...out.segments };
  for (const id of used) {
    const s = segments[id];
    segments[id] = { ...s, slope: slope === 'auto' ? defaultSlope(s.diameter) : slope };
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
  const za = net.nodes[s.a].pos.z, zb = net.nodes[s.b].pos.z;
  if (Math.abs(za - zb) < 0.05) return 'b';
  return za < zb ? 'a' : 'b';
}

/** 下流端 Z ＝ 上流端 Z − ratio × 水平距離 にする。だめ（配管が壊れる・器具の接続口）なら元の net */
function applyLockedSlope(net: Network, s: Segment, down: 'a' | 'b'): Network {
  const ratio = s.slope ?? 0;
  const upId = down === 'a' ? s.b : s.a, downId = down === 'a' ? s.a : s.b;
  const dn = net.nodes[downId];
  if (dn.fixtureId) return net;
  const z = Math.round((net.nodes[upId].pos.z - ratio * planLength(net, s)) * 10) / 10;
  if (Math.abs(dn.pos.z - z) < 0.05) return net;
  const next = moveNode(net, downId, { ...dn.pos, z });
  return next === net || validateNetwork(next).length ? net : next;
}

/** 区間に設計勾配（比率）を設定して固定し、下流端の高さを勾配から決める。失敗なら元の net */
export function setSlopeRatio(net: Network, segId: string, ratio: number, isOutlet?: (nodeId: string) => boolean): Network {
  const s = net.segments[segId];
  if (!s || !(ratio >= 0) || !Number.isFinite(ratio)) return net;
  const down = downstreamEnd(net, s, isOutlet);
  const seg: Segment = { ...s, slope: ratio, slopeLocked: true };
  const withSeg: Network = { ...net, segments: { ...net.segments, [segId]: seg } };
  const out = applyLockedSlope(withSeg, seg, down);
  return out === withSeg && Math.abs(net.nodes[down === 'a' ? s.a : s.b].pos.z - (net.nodes[down === 'a' ? s.b : s.a].pos.z - ratio * planLength(net, s))) > 0.05 ? net : out;
}

/**
 * movedNodeId の高さが変わったあと（prev → net）の後始末。
 * - 動かす前に下流端（低いほう）だった固定区間: 手で動かしたので固定を外す。
 * - 上流端だった固定区間: 下流端を勾配から再計算し、下流へ連鎖する。
 */
export function propagateLockedSlopes(prev: Network, net: Network, movedNodeId: string): Network {
  let out = net;
  const queue = [movedNodeId];
  const seen = new Set<string>([movedNodeId]);
  const doneSegs = new Set<string>();
  let first = true;
  while (queue.length) {
    const cur = queue.shift()!;
    for (const s0 of Object.values(out.segments)) {
      if (!s0.slopeLocked || doneSegs.has(s0.id) || (s0.a !== cur && s0.b !== cur)) continue;
      const s = out.segments[s0.id];
      doneSegs.add(s.id);
      const other = s.a === cur ? s.b : s.a;
      const ps = prev.segments[s.id];
      const curWasDown = first && !!ps && prev.nodes[ps.a] && prev.nodes[ps.b] && downstreamEnd(prev, ps) === (s.a === cur ? 'a' : 'b');
      if (curWasDown) {
        out = { ...out, segments: { ...out.segments, [s.id]: { ...s, slopeLocked: false } } };
        continue;
      }
      const next = applyLockedSlope(out, s, s.a === cur ? 'b' : 'a');
      if (next !== out) {
        out = next;
        if (!seen.has(other)) { seen.add(other); queue.push(other); }
      }
    }
    first = false;
  }
  return out;
}
