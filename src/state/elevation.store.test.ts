import { beforeEach, describe, expect, it } from 'vitest';
import { useStore } from './store';
import { createBuildingFromDims, wallsOnFloor } from '../model/building';
import { emptyNetwork, totalLength, validateNetwork } from '../model/network';
import { defaultEstimate, computeEstimate } from '../model/estimate';
import { elevationFromWall, worldToElev } from '../model/elevation';
import { projectSchema } from '../model/schema';

const s = () => useStore.getState();
const bld = () => createBuildingFromDims({ width: 10000, depth: 6000, floors: 3, floorHeight: 3000, wallThickness: 200, slabThickness: 200 });

function southWallId() {
  const b = s().doc.building;
  const ys = Object.values(b.corners).map((c) => c.y);
  return wallsOnFloor(b, b.floors[0].id).find((w) => b.corners[w.a].y === Math.min(...ys) && b.corners[w.b].y === Math.min(...ys))!.id;
}

beforeEach(() => {
  s().newDoc({ building: bld(), network: emptyNetwork(), fixtures: {}, estimate: defaultEstimate() }, { id: 'p', name: 't', createdAt: 1 });
  s().setDrawAttrs({ system: 'drain', diameter: 50 });
});

describe('立面で外壁に配管を描く', () => {
  it('立面を追加して開き、縦管を描くと壁の外 60mm（T字金具）に3階分の管ができる', () => {
    const el = elevationFromWall(s().doc.building, southWallId());
    expect(s().addElevation(el)).toBeNull();
    expect(s().activeElevationId).toBe(el.id);
    s().drawOnFace(el.id, [{ u: 800, v: 8800 }, { u: 800, v: 300 }, { u: 1500, v: 300 }]);
    const segs = Object.values(s().doc.network.segments);
    expect(segs).toHaveLength(2);
    expect(segs.every((x) => x.face === el.id && x.support === 'tBracket')).toBe(true);
    expect(totalLength(s().doc.network)).toBeCloseTo(8500 + 700);
    for (const n of Object.values(s().doc.network.nodes)) expect(worldToElev(el, n.pos).depth).toBeCloseTo(85);
    // 3階分にまたがる縦管の上端は3階に属する
    const top = Object.values(s().doc.network.nodes).find((n) => n.pos.z === 8800)!;
    expect(top.floorId).toBe(s().doc.building.floors[2].id);
    expect(validateNetwork(s().doc.network)).toEqual([]);
  });

  it('取付をサドル直付けに変えると配管が壁に寄り、支持金具がサドルになる（Undo 1回で戻る）', () => {
    const el = elevationFromWall(s().doc.building, southWallId());
    s().addElevation(el);
    s().drawOnFace(el.id, [{ u: 800, v: 6000 }, { u: 800, v: 300 }]);
    expect(s().updateElevation(el.id, { mount: { type: 'saddle', standoff: 60 } })).toBeNull();
    const n = Object.values(s().doc.network.nodes)[0];
    expect(worldToElev(el, n.pos).depth).toBeCloseTo(25);
    expect(Object.values(s().doc.network.segments)[0].support).toBe('saddle');
    s().undo();
    expect(worldToElev(el, Object.values(s().doc.network.nodes)[0].pos).depth).toBeCloseTo(85);
    expect(s().doc.elevations![el.id].mount.type).toBe('tBracket');
  });

  it('積算に T字金具が出る（間隔ごと）', () => {
    const el = elevationFromWall(s().doc.building, southWallId());
    s().addElevation(el);
    s().drawOnFace(el.id, [{ u: 800, v: 6300 }, { u: 800, v: 300 }]);
    const est = computeEstimate(s().doc);
    const t = est.supports.find((x) => x.key === 'sup|tBracket|50');
    expect(t?.name).toBe('T字金具');
    expect(t?.count).toBe(6);
    expect(t?.priceSource).toBe('none');
    expect(est.supports.some((x) => x.key.startsWith('sup|saddle'))).toBe(false);
  });

  it('立面の寸法が不正なら追加しない。保存データに入り、削除すると配管のひも付けだけ外れる', () => {
    const el = elevationFromWall(s().doc.building, southWallId());
    expect(s().addElevation({ ...el, width: 0 })).not.toBeNull();
    s().addElevation(el);
    s().drawOnFace(el.id, [{ u: 800, v: 3000 }, { u: 800, v: 300 }]);
    const data = s().toProjectData()!;
    expect(projectSchema.safeParse(data).success).toBe(true);
    expect(Object.keys(data.elevations!)).toEqual([el.id]);
    s().deleteElevation(el.id);
    expect(s().activeElevationId).toBeNull();
    expect(Object.values(s().doc.network.segments)[0].face).toBeUndefined();
    expect(Object.keys(s().doc.network.segments)).toHaveLength(1);
  });

  it('壁面の縦管の途中から横へ分岐できる（履歴1件）', () => {
    const el = elevationFromWall(s().doc.building, southWallId());
    s().addElevation(el);
    s().drawOnFace(el.id, [{ u: 800, v: 6000 }, { u: 800, v: 300 }]);
    const seg = Object.keys(s().doc.network.segments)[0];
    const h = s().past.length;
    s().drawOnFace(el.id, [{ u: 800, v: 2000 }, { u: 2000, v: 2000 }], { startSegId: seg });
    expect(s().past.length).toBe(h + 1);
    expect(Object.keys(s().doc.network.segments)).toHaveLength(3);
    expect(Object.values(s().doc.network.nodes).filter((n) => n.kind === 'tee')).toHaveLength(1);
    expect(validateNetwork(s().doc.network)).toEqual([]);
  });

  it('Undo で立面が消えたら平面図に戻る', () => {
    const el = elevationFromWall(s().doc.building, southWallId());
    s().addElevation(el);
    s().undo();
    expect(s().activeElevationId).toBeNull();
  });

  it('壁がない現場: 外壁1枚と立面を1回の操作で作る（Undo 1回で両方消える）', () => {
    s().newDoc({ building: { ...bld(), corners: {}, walls: {}, openings: {}, rooms: {} }, network: emptyNetwork(), fixtures: {}, estimate: defaultEstimate() }, { id: 'p', name: 't', createdAt: 1 });
    const f = s().doc.building.floors[0].id;
    const base = { id: 'el1', label: '外壁', floorId: f, origin: { x: 0, y: 0 }, dir: { x: 1, y: 0 }, normal: { x: 0, y: -1 }, faceOffset: 0, baseZ: 0, width: 6000, height: 6000, mount: { type: 'saddle' as const, standoff: 60 }, opacity: 0.8 };
    expect(s().addElevation(base, { createWall: true })).toBeNull();
    const walls = Object.values(s().doc.building.walls);
    expect(walls).toHaveLength(1);
    expect(walls[0].kind).toBe('exterior');
    expect(s().doc.elevations!.el1.wallId).toBe(walls[0].id);
    expect(s().doc.elevations!.el1.faceOffset).toBe(walls[0].thickness / 2);
    s().undo();
    expect(Object.keys(s().doc.building.walls)).toHaveLength(0);
    expect(s().doc.elevations?.el1).toBeUndefined();
  });

  it('配線は支持金具を付けない。口径の違う管につなぐと同じ壁からの距離で描く', () => {
    const el = elevationFromWall(s().doc.building, southWallId());
    s().addElevation(el);
    s().setDrawAttrs({ system: 'drain', diameter: 100 });
    s().drawOnFace(el.id, [{ u: 800, v: 6000 }, { u: 800, v: 300 }]);
    const top = Object.values(s().doc.network.nodes).find((n) => n.pos.z === 6000)!;
    s().setDrawAttrs({ system: 'drain', diameter: 50 });
    s().drawOnFace(el.id, [{ u: 800, v: 6000 }, { u: 2000, v: 6000 }], { startNodeId: top.id });
    for (const n of Object.values(s().doc.network.nodes)) expect(worldToElev(el, n.pos).depth).toBeCloseTo(110);
    s().setDrawAttrs({ system: 'electric', diameter: 2 });
    s().drawOnFace(el.id, [{ u: 4000, v: 3000 }, { u: 6000, v: 3000 }]);
    const wire = Object.values(s().doc.network.segments).find((x) => x.system === 'electric')!;
    expect(wire.support).toBeUndefined();
    expect(wire.face).toBe(el.id);
  });
});
