/**
 * 配管ノードと階の関連付け。ノードは絶対高さ(z)を持ち、所属階(floorId)を記録する。
 * 階高の変更・階の削除で床高が変わったら、所属階の床高の差分だけノードを平行移動する（立て管は上端だけ動く）。
 */
import type { Floor } from './building';
import { normalize, type Network } from './network';

/** z を含む階（床高が z 以下の最も上の階）。どれにも当たらなければ最下階 */
export function floorIndexForZ(floors: Floor[], z: number): number {
  let idx = 0;
  floors.forEach((f, i) => { if (f.elevation <= z + 1e-6) idx = i; });
  return idx;
}

/** 階の高さ範囲に床下配管（1000mm）を含めた範囲に z があるか */
export const zOnFloor = (f: Floor, z: number) => z >= f.elevation - 1000 && z < f.elevation + f.height;

/**
 * floorId が未設定・存在しない階を指すノードに所属階を付ける。
 * 同じ高さでつながった隣のノードの階 → 既定の階（その階の範囲内なら）→ 高さから判定、の順。
 */
export function tagNodeFloors(net: Network, floors: Floor[], defaultFloorId?: string): Network {
  if (!floors.length) return net;
  const valid = new Set(floors.map((f) => f.id));
  const need = Object.values(net.nodes).filter((n) => !n.floorId || !valid.has(n.floorId));
  if (!need.length) return net;
  const nodes = { ...net.nodes };
  const def = floors.find((f) => f.id === defaultFloorId);
  const neighbors = new Map<string, string[]>();
  for (const s of Object.values(net.segments)) {
    neighbors.set(s.a, [...(neighbors.get(s.a) ?? []), s.b]);
    neighbors.set(s.b, [...(neighbors.get(s.b) ?? []), s.a]);
  }
  // 隣からの伝播は数回繰り返す（新しく描いた折れ線の途中のノードも同じ階になる）
  for (let pass = 0; pass < 2; pass++) {
    for (const n0 of need) {
      const n = nodes[n0.id];
      if (n.floorId && valid.has(n.floorId)) continue;
      const same = (neighbors.get(n.id) ?? []).map((id) => nodes[id]).find((o) => o.floorId && valid.has(o.floorId) && Math.abs(o.pos.z - n.pos.z) < 1);
      if (same) nodes[n.id] = { ...n, floorId: same.floorId };
      else if (pass === 1) nodes[n.id] = { ...n, floorId: def && zOnFloor(def, n.pos.z) ? def.id : floors[floorIndexForZ(floors, n.pos.z)].id };
    }
  }
  return { ...net, nodes };
}

/** 床高の変化に配管を追従させる（ID で階を対応づけ。削除された階のノードは動かさず所属階を付け直す） */
export function followFloors(net: Network, oldFloors: Floor[], newFloors: Floor[]): Network {
  const oldById = new Map(oldFloors.map((f) => [f.id, f]));
  const newById = new Map(newFloors.map((f) => [f.id, f]));
  let moved = false;
  const nodes = { ...net.nodes };
  for (const n of Object.values(net.nodes)) {
    const fid = n.floorId && oldById.has(n.floorId) ? n.floorId : oldFloors[floorIndexForZ(oldFloors, n.pos.z)]?.id;
    const of = fid ? oldById.get(fid) : undefined;
    const nf = fid ? newById.get(fid) : undefined;
    if (!of) continue;
    if (!nf) { nodes[n.id] = { ...n, floorId: undefined }; moved = true; continue; }
    const dz = nf.elevation - of.elevation;
    if (dz !== 0 || n.floorId !== fid) { nodes[n.id] = { ...n, floorId: fid, pos: { ...n.pos, z: n.pos.z + dz } }; moved = true; }
  }
  if (!moved) return net;
  return tagNodeFloors(normalize({ ...net, nodes }), newFloors);
}
