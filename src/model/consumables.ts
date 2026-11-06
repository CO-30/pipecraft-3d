/**
 * 消耗品（シールテープ・塩ビ管用接着剤）の数量。
 * - シールテープ: ネジでつなぐ箇所（給水栓用エルボ・給水栓用ソケット・バルブ用ソケット）ごとに、ネジの太さに応じた長さを巻く → 巻数に切り上げ
 * - 接着剤: 塩ビ系の継手の受口（接着する口）ごとに、呼び径に応じた使用量 → 缶数に切り上げ。
 *   管の材質で使い分ける（HIVP=HI用、VP・VU=VP用、HTVP=HT用）。VP と HI をつなぐ口は HI用（日本水道協会 Q&A）
 * 1口あたりの量は施工時の目安（現場の実績に合わせて巻・缶の大きさや単価で調整する）。
 */
import type { Network, Segment } from './network';
import { isWire, THREAD_FITTINGS, type NodeFitting } from './fittings';
import { effectiveMaterial, normMaterial } from './priceCatalog';

export type ConsumableSettings = {
  enabled: boolean;
  /** シールテープ1巻の長さ（m） */
  tapeRoll: number;
  /** 接着剤1缶の量（g） */
  glueCan: number;
};
export const defaultConsumableSettings = (): ConsumableSettings => ({ enabled: true, tapeRoll: 15, glueCan: 500 });

export type GlueKind = 'hi' | 'vp' | 'ht';
export const GLUE_LABEL: Record<GlueKind, string> = { hi: '塩ビ管用接着剤（HI用）', vp: '塩ビ管用接着剤（VP・VU用）', ht: '塩ビ管用接着剤（HT用）' };

/** ネジ1か所に巻くシールテープの長さ（m）。1/2(13・16) 0.5、3/4(20) 0.7、1(25) 0.9、それ以上 1.2 */
export const tapePerJoint = (d: number) => (d <= 16 ? 0.5 : d <= 20 ? 0.7 : d <= 25 ? 0.9 : 1.2);

/** 受口1口あたりの接着剤の目安（g）。管と継手の両方に塗る量 */
const GLUE_G: [number, number][] = [[13, 1], [16, 1.2], [20, 1.5], [25, 2], [30, 3], [40, 4], [50, 6], [65, 9], [75, 12], [100, 20], [125, 30], [150, 40]];
export function gluePerJoint(d: number): number {
  for (const [max, g] of GLUE_G) if (d <= max) return g;
  return Math.round((d / 150) * 40);
}

export const glueKindOf = (s: Pick<Segment, 'system' | 'material'>): GlueKind | null => {
  if (isWire(s.system)) return null;
  const m = normMaterial(effectiveMaterial(s));
  if (m === 'HIVP') return 'hi';
  if (m === 'HTVP') return 'ht';
  if (m === 'VP' || m === 'VU') return 'vp';
  return null;
};

export type ConsumableResult = {
  /** ネジの箇所数と、巻く長さの合計 m */
  threads: number;
  tapeLength: number;
  /** 接着剤の種類ごとの口数と使用量 g */
  glue: Partial<Record<GlueKind, { joints: number; grams: number }>>;
};

/**
 * stockJoints: 定尺の継ぎ足しソケット（区間の代表と個数）
 */
export function computeConsumables(net: Network, fittings: NodeFitting[], stockJoints: { seg: Segment; count: number }[]): ConsumableResult {
  const r: ConsumableResult = { threads: 0, tapeLength: 0, glue: {} };
  const addGlue = (k: GlueKind | null, d: number, n = 1) => {
    if (!k || n <= 0) return;
    const g = (r.glue[k] ??= { joints: 0, grams: 0 });
    g.joints += n;
    g.grams += gluePerJoint(d) * n;
  };
  const segsAt = new Map<string, Segment[]>();
  for (const s of Object.values(net.segments)) for (const n of [s.a, s.b]) { const a = segsAt.get(n); if (a) a.push(s); else segsAt.set(n, [s]); }
  for (const f of fittings) {
    if (f.type === 'none' || f.type === 'junctionBox' || f.type === 'other') continue;
    const segs = segsAt.get(f.nodeId) ?? [];
    if (segs.some((s) => isWire(s.system))) continue;
    if (THREAD_FITTINGS.has(f.type)) {
      r.threads += 1;
      r.tapeLength += tapePerJoint(f.main.diameter);
    }
    // 受口ごとに接着。HI が混じる点では VP の口も HI用
    const kinds = segs.map(glueKindOf);
    const hasHi = kinds.includes('hi');
    segs.forEach((s, i) => addGlue(kinds[i] === 'vp' && hasHi ? 'hi' : kinds[i], s.diameter));
  }
  for (const { seg, count } of stockJoints) addGlue(glueKindOf(seg), seg.diameter, count * 2);
  r.tapeLength = Math.round(r.tapeLength * 1000) / 1000;
  return r;
}
