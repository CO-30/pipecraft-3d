/**
 * 支持金具（サドルバンド・レベルバンド）と、それを止めるビス・下穴用のコンクリキリの数量。
 * - 支持間隔: ビニル管等の横走り管の支持間隔（公共建築工事標準仕様書の一般値）＝呼び径80以下 1.0m、100以上 2.0m。現場ごとに変更可
 * - 一直線に続く区間（継手で区切られるまとまり）ごとに max(1, ceil(長さ/間隔 − 0.01)) 個（勾配で数mm伸びた分は数えない）
 * - 自動判定: 配線は対象外。排水系で床から0〜400mmの横管（床上排水）はレベルバンド、それ以外はサドルバンド
 * - ビス: 支持金具1個あたり N 本（初期2本）。下地がコンクリートならコンクリートビス＋インパクト用コンクリキリ（M 穴ごとに1本）、木ならステンレスビス
 */
import type { Doc } from './doc';
import type { Network, Segment } from './network';
import { isWire } from './fittings';
import { isDrain, isRiserLike } from './slope';
import type { SegmentMeasure } from './estimate';

export type SupportKind = 'saddle' | 'levelBand';
export type Substrate = 'concrete' | 'wood';
export type SupportSettings = {
  enabled: boolean;
  substrate: Substrate;
  /** 呼び径80以下の支持間隔(mm) */
  spacingSmall: number;
  /** 呼び径100以上の支持間隔(mm) */
  spacingLarge: number;
  /** 支持金具1個あたりのビス本数 */
  screwsPerSupport: number;
  /** コンクリキリ1本で開けられる穴の数（消耗の目安） */
  holesPerBit: number;
};

export const defaultSupportSettings = (): SupportSettings => ({
  enabled: true, substrate: 'concrete', spacingSmall: 1000, spacingLarge: 2000, screwsPerSupport: 2, holesPerBit: 100,
});

export const SUPPORT_LABEL: Record<SupportKind, string> = { saddle: 'サドルバンド', levelBand: 'レベルバンド' };
export const SUBSTRATE_LABEL: Record<Substrate, string> = { concrete: 'コンクリート', wood: '木' };
/** 床からこの高さ(mm)以内の排水横管は「床上排水」としてレベルバンドで支持 */
export const FLOOR_DRAIN_MAX = 400;

export const spacingFor = (st: SupportSettings, diameter: number) => (diameter <= 80 ? st.spacingSmall : st.spacingLarge);

/** 区間の支持金具（自動判定を含む）。null = 支持しない */
export function supportKindOf(doc: Doc, s: Segment): SupportKind | null {
  if (s.support === 'none') return null;
  if (s.support) return s.support;
  if (isWire(s.system)) return null;
  const net = doc.network;
  if (isDrain(s.system) && !isRiserLike(net, s)) {
    const a = net.nodes[s.a], b = net.nodes[s.b];
    const floor = doc.building.floors.find((f) => f.id === (a.floorId ?? b.floorId));
    const base = floor?.elevation ?? 0;
    const lo = Math.min(a.pos.z, b.pos.z) - base, hi = Math.max(a.pos.z, b.pos.z) - base;
    if (lo >= 0 && hi <= FLOOR_DRAIN_MAX) return 'levelBand';
  }
  return 'saddle';
}

export type SupportCount = {
  kind: SupportKind;
  diameter: number;
  count: number;
  /** 下地別の支持金具の数 */
  bySubstrate: Record<Substrate, number>;
  segmentIds: string[];
};
export type SupportResult = {
  supports: SupportCount[];
  /** 下穴・ビスの数（下地別） */
  holes: Record<Substrate, number>;
  /** コンクリキリの本数 */
  bits: number;
};

/** 継手なしで続く同じ支持条件の区間のまとまり */
function runs(net: Network, segs: Segment[], through: Set<string>): Segment[][] {
  const byNode = new Map<string, Segment[]>();
  for (const s of segs) for (const n of [s.a, s.b]) { const arr = byNode.get(n); if (arr) arr.push(s); else byNode.set(n, [s]); }
  const seen = new Set<string>();
  const out: Segment[][] = [];
  for (const s of segs) {
    if (seen.has(s.id)) continue;
    const run: Segment[] = [];
    const stack = [s];
    seen.add(s.id);
    while (stack.length) {
      const cur = stack.pop()!;
      run.push(cur);
      for (const n of [cur.a, cur.b]) {
        if (!through.has(n)) continue;
        for (const t of byNode.get(n) ?? []) if (!seen.has(t.id)) { seen.add(t.id); stack.push(t); }
      }
    }
    out.push(run);
  }
  void net;
  return out;
}

export function computeSupports(doc: Doc, st: SupportSettings, measures: Record<string, SegmentMeasure>, passThrough: Set<string>): SupportResult {
  const empty: SupportResult = { supports: [], holes: { concrete: 0, wood: 0 }, bits: 0 };
  if (!st.enabled) return empty;
  const groups = new Map<string, { kind: SupportKind; diameter: number; substrate: Substrate; segs: Segment[] }>();
  for (const s of Object.values(doc.network.segments)) {
    const kind = supportKindOf(doc, s);
    if (!kind) continue;
    const substrate = s.substrate ?? st.substrate;
    const k = `${kind}|${s.diameter}|${substrate}`;
    const g = groups.get(k);
    if (g) g.segs.push(s); else groups.set(k, { kind, diameter: s.diameter, substrate, segs: [s] });
  }
  const merged = new Map<string, SupportCount>();
  const holes: Record<Substrate, number> = { concrete: 0, wood: 0 };
  for (const g of groups.values()) {
    let n = 0;
    for (const run of runs(doc.network, g.segs, passThrough)) {
      const len = run.reduce((a, r) => a + (measures[r.id]?.usedLength ?? 0), 0);
      // 勾配による長さの増加（数mm）で1個増えないよう、1%の余裕を見る
      n += Math.max(1, Math.ceil(len / spacingFor(st, g.diameter) - 0.01));
    }
    const key = `${g.kind}|${g.diameter}`;
    const m = merged.get(key) ?? { kind: g.kind, diameter: g.diameter, count: 0, bySubstrate: { concrete: 0, wood: 0 }, segmentIds: [] };
    m.count += n;
    m.bySubstrate[g.substrate] += n;
    m.segmentIds.push(...g.segs.map((s) => s.id));
    merged.set(key, m);
    holes[g.substrate] += n * st.screwsPerSupport;
  }
  const supports = [...merged.values()].sort((a, b) => a.kind.localeCompare(b.kind) || a.diameter - b.diameter);
  return { supports, holes, bits: holes.concrete > 0 ? Math.ceil(holes.concrete / st.holesPerBit) : 0 };
}
