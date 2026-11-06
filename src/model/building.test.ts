import { describe, expect, it } from 'vitest';
import {
  addFloor, addOpening, addRoomRect, addWall, createBuildingFromDims, deleteFloor, deleteWall, emptyBuilding,
  moveCorner, moveWall, roomArea, updateFloor, updateOpening, validateBuilding, wallLength, wallsOnFloor,
  type Building,
} from './building';

const P = (x: number, y: number) => ({ x, y });
const dims = { width: 8000, depth: 6000, floors: 2, floorHeight: 2900, wallThickness: 150, slabThickness: 200 };

function oneFloor(): { b: Building; f: string } {
  const b = createBuildingFromDims({ ...dims, floors: 1 });
  return { b, f: b.floors[0].id };
}

describe('建物: 数値入力で作成', () => {
  it('2階建て 8000×6000: 外壁8枚・部屋2・2階の高さ=1階の階高', () => {
    const b = createBuildingFromDims(dims);
    expect(b.floors).toHaveLength(2);
    expect(Object.values(b.walls).filter((w) => w.kind === 'exterior')).toHaveLength(8);
    expect(Object.keys(b.rooms)).toHaveLength(2);
    expect(b.floors[1].elevation).toBe(2900);
    expect(roomArea(Object.values(b.rooms)[0])).toBeCloseTo(48, 6);
    expect(validateBuilding(b)).toEqual([]);
  });
});

describe('建物: 壁', () => {
  it('壁端点が既存の角の近く(150mm以内)なら同じ角に接続し、角を動かすと両方の壁が追従', () => {
    const { b, f } = oneFloor();
    const before = Object.keys(b.corners).length;
    const r = addWall(b, f, P(8000 + 100, 6000 - 80), P(8000, 9000));
    expect(Object.keys(r.b.corners).length).toBe(before + 1);
    const corner = Object.values(r.b.corners).find((c) => c.x === 8000 && c.y === 6000)!;
    const moved = moveCorner(r.b, corner.id, P(8500, 6000));
    const touching = Object.values(moved.walls).filter((w) => w.a === corner.id || w.b === corner.id);
    expect(touching).toHaveLength(3);
    expect(validateBuilding(moved)).toEqual([]);
  });

  it('壁の途中から描く(T字)と既存壁が分割され、ドアは正しい側の壁へ移る', () => {
    const { b, f } = oneFloor();
    const south = wallsOnFloor(b, f).find((w) => b.corners[w.a].y === 0 && b.corners[w.b].y === 0)!;
    const southStart = b.corners[south.a].x; // 0 or 8000
    const doorAbsX = 6000;
    const d = addOpening(b, south.id, 'door', Math.abs(doorAbsX - southStart));
    const r = addWall(d.b, f, P(3000, 0), P(3000, 6000));
    expect(r.wallIds).toHaveLength(1);
    expect(Object.keys(r.b.walls)).toHaveLength(4 + 1 + 1 + 1); // 南壁・北壁がそれぞれ2分割 + 新しい内壁
    const op = r.b.openings[d.openingId!];
    const w = r.b.walls[op.wallId];
    const a = r.b.corners[w.a], c = r.b.corners[w.b];
    const ux = (c.x - a.x) / wallLength(r.b, w.id);
    expect(a.x + ux * op.offset).toBeCloseTo(doorAbsX, 6);
    expect(validateBuilding(r.b)).toEqual([]);
  });

  it('T字の分割点がドアの範囲内なら、ドアの外側へずらして分割する', () => {
    const { b, f } = oneFloor();
    const south = wallsOnFloor(b, f).find((w) => b.corners[w.a].y === 0 && b.corners[w.b].y === 0)!;
    const startX = b.corners[south.a].x;
    const d = addOpening(b, south.id, 'door', Math.abs(4000 - startX)); // 中心4000, 幅800 → 3600..4400
    const r = addWall(d.b, f, P(4100, 0), P(4100, 6000));
    expect(validateBuilding(r.b)).toEqual([]);
    const newWall = r.b.walls[r.wallIds[0]];
    const xs = [r.b.corners[newWall.a].x, r.b.corners[newWall.b].x];
    expect(xs.some((x) => x <= 3600 || x >= 4400)).toBe(true);
  });

  it('短すぎる壁(100mm未満)は作らない', () => {
    const { b, f } = oneFloor();
    expect(addWall(b, f, P(3000, 3000), P(3050, 3000)).wallIds).toHaveLength(0);
  });

  it('壁を移動すると両端の角が動き、つながる壁も追従', () => {
    const { b, f } = oneFloor();
    const r = addWall(b, f, P(3000, 0), P(3000, 6000));
    const moved = moveWall(r.b, r.wallIds[0], 500, 0);
    const w = moved.walls[r.wallIds[0]];
    expect(moved.corners[w.a].x).toBe(3500);
    expect(validateBuilding(moved)).toEqual([]);
  });

  it('壁を削除するとその壁の開口部も消え、孤立した角が残らない', () => {
    const { b, f } = oneFloor();
    const r = addWall(b, f, P(2000, 2000), P(5000, 2000));
    const o = addOpening(r.b, r.wallIds[0], 'window', 1500);
    const d = deleteWall(o.b, r.wallIds[0]);
    expect(Object.keys(d.openings)).toHaveLength(0);
    expect(Object.keys(d.corners)).toHaveLength(4);
    expect(validateBuilding(d)).toEqual([]);
  });
});

describe('建物: 開口部', () => {
  it('壁端からはみ出す位置はクランプ、壁より幅が大きいものは作らない', () => {
    const { b, f } = oneFloor();
    const r = addWall(b, f, P(2000, 2000), P(3000, 2000)); // 1000mm
    const ok = addOpening(r.b, r.wallIds[0], 'door', 50);
    expect(ok.openingId).not.toBeNull();
    expect(ok.b.openings[ok.openingId!].offset).toBe(400);
    const ng = addOpening(r.b, r.wallIds[0], 'window', 500, { width: 1200 });
    expect(ng.openingId).toBeNull();
  });

  it('開口部が収まらなくなる角の移動は拒否', () => {
    const { b, f } = oneFloor();
    const r = addWall(b, f, P(2000, 2000), P(3000, 2000));
    const o = addOpening(r.b, r.wallIds[0], 'door', 500);
    const w = o.b.walls[r.wallIds[0]];
    const moved = moveCorner(o.b, w.b, P(2500, 2000));
    expect(moved).toBe(o.b);
  });
});

describe('建物: 階・部屋', () => {
  it('階高を変えると上の階の高さが再計算される', () => {
    const b = createBuildingFromDims(dims);
    const u = updateFloor(b, b.floors[0].id, { height: 3200 });
    expect(u.floors[1].elevation).toBe(3200);
  });

  it('階を追加（外壁コピー）・削除、最後の1階は削除できない', () => {
    const { b, f } = oneFloor();
    const a = addFloor(b, { copyExteriorFrom: f });
    expect(a.b.floors).toHaveLength(2);
    expect(wallsOnFloor(a.b, a.floorId)).toHaveLength(4);
    expect(a.b.floors[1].elevation).toBe(2900);
    const d = deleteFloor(a.b, a.floorId);
    expect(d.floors).toHaveLength(1);
    expect(Object.keys(d.walls)).toHaveLength(4);
    expect(deleteFloor(d, f)).toBe(d);
  });

  it('矩形の部屋を追加し面積を計算', () => {
    const b0 = emptyBuilding();
    const a = addFloor(b0);
    const r = addRoomRect(a.b, a.floorId, P(0, 0), P(3000, 2500), '洗面所');
    expect(roomArea(r.b.rooms[r.roomId])).toBeCloseTo(7.5, 6);
    expect(r.b.rooms[r.roomId].name).toBe('洗面所');
  });
});

describe('建物: 不変条件', () => {
  it('ランダム操作80回で整合性が保たれる', () => {
    let seed = 11;
    const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
    let { b } = oneFloor();
    const f = b.floors[0].id;
    for (let i = 0; i < 80; i++) {
      const walls = wallsOnFloor(b, f);
      const corners = Object.keys(b.corners);
      const op = rnd();
      if (op < 0.35) {
        const p = P(Math.round(rnd() * 16) * 500, Math.round(rnd() * 12) * 500);
        const q = rnd() < 0.5 ? P(p.x, Math.round(rnd() * 12) * 500) : P(Math.round(rnd() * 16) * 500, p.y);
        b = addWall(b, f, p, q).b;
      } else if (op < 0.5 && walls.length) {
        const w = walls[Math.floor(rnd() * walls.length)];
        b = addOpening(b, w.id, rnd() < 0.5 ? 'door' : 'window', rnd() * wallLength(b, w.id)).b;
      } else if (op < 0.65 && walls.length) {
        b = deleteWall(b, walls[Math.floor(rnd() * walls.length)].id);
      } else if (op < 0.85 && corners.length) {
        const c = b.corners[corners[Math.floor(rnd() * corners.length)]];
        b = moveCorner(b, c.id, P(c.x + (rnd() - 0.5) * 2000, c.y + (rnd() - 0.5) * 2000));
      } else if (walls.length) {
        b = moveWall(b, walls[Math.floor(rnd() * walls.length)].id, (rnd() - 0.5) * 1000, (rnd() - 0.5) * 1000);
      }
      expect(validateBuilding(b)).toEqual([]);
    }
  });
});

describe('レビュー指摘の回帰テスト', () => {
  it('同じ壁で開口部が重なる追加・変更は拒否', () => {
    const { b, f } = oneFloor();
    const r = addWall(b, f, P(1000, 2000), P(6000, 2000));
    const d1 = addOpening(r.b, r.wallIds[0], 'door', 2000);
    const d2 = addOpening(d1.b, r.wallIds[0], 'door', 2300);
    expect(d2.openingId).toBeNull();
    const d3 = addOpening(d1.b, r.wallIds[0], 'window', 3500);
    expect(d3.openingId).not.toBeNull();
    expect(updateOpening(d3.b, d3.openingId!, { offset: 2500 })).toBe(d3.b);
    expect(validateBuilding(d3.b)).toEqual([]);
  });

  it('階の天井高に収まらない開口部は拒否', () => {
    const { b, f } = oneFloor(); // 階高2900・床厚200 → 天井高2700
    const r = addWall(b, f, P(1000, 2000), P(6000, 2000));
    expect(addOpening(r.b, r.wallIds[0], 'window', 2000, { sill: 1800, height: 1000 }).openingId).toBeNull();
    const ok = addOpening(r.b, r.wallIds[0], 'door', 2000);
    expect(updateOpening(ok.b, ok.openingId!, { height: 2800 })).toBe(ok.b);
  });

  it('移動量0の移動は同じ参照を返す（空の履歴を作らない）', () => {
    const { b } = oneFloor();
    const c = Object.values(b.corners)[0];
    expect(moveCorner(b, c.id, P(c.x, c.y))).toBe(b);
    expect(moveWall(b, Object.keys(b.walls)[0], 0, 0)).toBe(b);
  });

  it('階が0件・ID重複・キーとIDの不一致を検出', () => {
    expect(validateBuilding(emptyBuilding())).not.toEqual([]);
    const { b } = oneFloor();
    const w = Object.values(b.walls)[0];
    expect(validateBuilding({ ...b, walls: { ...b.walls, wrongKey: w } })).not.toEqual([]);
    expect(validateBuilding({ ...b, floors: [b.floors[0], b.floors[0]] })).not.toEqual([]);
  });
});

describe('建物: 部屋が壁に追従する（Phase 2）', () => {
  const rect = () => createBuildingFromDims({ width: 8000, depth: 6000, floors: 1, floorHeight: 2900, wallThickness: 150, slabThickness: 200 });
  const cornerAt = (b: ReturnType<typeof rect>, x: number, y: number) => Object.values(b.corners).find((c) => c.x === x && c.y === y)!;

  it('角を動かすと部屋の頂点も同じだけ動く', () => {
    const b = rect();
    const c = cornerAt(b, 8000, 6000);
    const n = moveCorner(b, c.id, { x: 9000, y: 6500 });
    const room = Object.values(n.rooms)[0];
    expect(room.polygon).toContainEqual({ x: 9000, y: 6500 });
    expect(room.polygon).not.toContainEqual({ x: 8000, y: 6000 });
  });

  it('壁を動かすと両端の頂点が動く', () => {
    const b = rect();
    const w = Object.values(b.walls).find((x) => b.corners[x.a].x === 8000 && b.corners[x.b].x === 8000)!;
    const n = moveWall(b, w.id, 1000, 0);
    const xs = Object.values(n.rooms)[0].polygon.map((p) => p.x).sort((a, c) => a - c);
    expect(xs).toEqual([0, 0, 9000, 9000]);
  });

  it('rejected corner move leaves rooms', () => {
    const b = rect();
    const c = cornerAt(b, 8000, 6000);
    const n = moveCorner(b, c.id, { x: 8000, y: 50 }); // 壁が短すぎる
    expect(n).toBe(b);
  });
});
