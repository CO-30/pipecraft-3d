/**
 * マスへ高く着く排水の管（ドロップ）の、マスの外で L で落とす形（3D の表示・積算用）。純粋関数。
 * 管はマスの壁の外（マスの半径 + DROP_GAP）で止め、そこから真下へ落として、マスの流入の高さで横からマスへ入る。
 */
import type { Doc } from './doc';
import { fixtureSize, isManhole } from './fixtures';
import type { Segment, Vec3 } from './network';
import { endZ } from './slope';

/** この高さ以上高く着く管を、マスの外で L で落とす(mm)。それより小さい段差はマスの中で受ける */
export const DROP_LEG_MIN = 100;
/** マスの壁から、落とす管の芯までの離れ(mm) */
const DROP_GAP = 80;

export type DropLeg = {
  segId: string;
  /** マスの側の端 */
  side: 'a' | 'b';
  /** 横の管の止まる所（マスの外・着く高さ） */
  top: Vec3;
  /** 落とした下（マスの外・マスへ入る高さ） */
  bottom: Vec3;
  /** マスの中心（入る所） */
  into: Vec3;
  /** 落とす長さ(mm) */
  length: number;
};

export function dropLegs(doc: Doc): Map<string, DropLeg> {
  const net = doc.network, out = new Map<string, DropLeg>();
  for (const s of Object.values(net.segments) as Segment[]) {
    if (s.system !== 'drain' && s.system !== 'sewage') continue;
    for (const side of ['a', 'b'] as const) {
      const n = net.nodes[side === 'a' ? s.a : s.b], o = net.nodes[side === 'a' ? s.b : s.a];
      const f = n?.fixtureId ? doc.fixtures[n.fixtureId] : undefined;
      if (!f || !isManhole(f.type) || !o) continue;
      const arrive = endZ(net, s, side);
      // 管ごとのドロップ（合流マスへ高く着く）はマスの流入の高さまで、マスのドロップ（公共ますの手前）はマスの管底まで外で落とす
      const inZ = s.dropEnd ? n.pos.z + (n.dropIn ?? 0) : n.pos.z;
      if (arrive - inZ < DROP_LEG_MIN) continue;
      const L = Math.hypot(o.pos.x - n.pos.x, o.pos.y - n.pos.y);
      const r = fixtureSize(f, doc.building, doc.site).w / 2 + DROP_GAP;
      if (L <= r + 1) continue;
      const ux = (o.pos.x - n.pos.x) / L, uy = (o.pos.y - n.pos.y) / L;
      const x = n.pos.x + ux * r, y = n.pos.y + uy * r;
      out.set(s.id, { segId: s.id, side, top: { x, y, z: arrive }, bottom: { x, y, z: inZ }, into: { x: n.pos.x, y: n.pos.y, z: inZ }, length: Math.round(arrive - inZ) });
    }
  }
  return out;
}
