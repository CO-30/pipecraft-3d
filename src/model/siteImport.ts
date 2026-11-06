/**
 * 航空写真と建物外形を図面に置く位置の計算。原点 = 検索地点。
 * 建物外形があれば、最長辺を軸に合わせて回転し（航空写真も同じだけ回転）、外形の左下を (0,0) に置く。
 */
import type { Vec2 } from './building';
import { alignAngle, offsetRingInward, rotatePoint, simplifyRing } from './geo';

export type SitePlacement = { polygon?: Vec2[]; rotation: number; aerialCenter: Vec2 };

export function planSiteImport(footprint: Vec2[] | null, opts: { eaveMm: number; align: boolean }): SitePlacement | { error: string } {
  if (!footprint) return { rotation: 0, aerialCenter: { x: 0, y: 0 } };
  const base = offsetRingInward(simplifyRing(footprint), opts.eaveMm);
  if (!base) return { error: '軒の出の補正が大きすぎます' };
  const rotation = opts.align ? alignAngle(base) : 0;
  const rot = base.map((p) => rotatePoint(p, rotation));
  const t = { x: -Math.min(...rot.map((p) => p.x)), y: -Math.min(...rot.map((p) => p.y)) };
  const r10 = (v: number) => Math.round(v / 10) * 10;
  return {
    polygon: rot.map((p) => ({ x: r10(p.x + t.x), y: r10(p.y + t.y) })),
    rotation,
    aerialCenter: t, // 検索地点（原点）は回転しても原点なので、平行移動分だけ
  };
}
