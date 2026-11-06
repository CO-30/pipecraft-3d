import { describe, expect, it } from 'vitest';
import { addFloor, addRoomRect, emptyBuilding, roomArea, type Building, type Vec2 } from './building';
import { mergeRooms, splitRoom } from './roomOps';

function setup(): { b: Building; f: string } {
  const r = addFloor(emptyBuilding());
  return { b: r.b, f: r.floorId };
}
const poly = (b: Building, id: string) => b.rooms[id].polygon;

describe('mergeRooms', () => {
  it('merges two rooms sharing an edge into one rectangle', () => {
    let { b, f } = setup();
    const r1 = addRoomRect(b, f, { x: 0, y: 0 }, { x: 4000, y: 3000 }, '洋室'); b = r1.b;
    const r2 = addRoomRect(b, f, { x: 4000, y: 0 }, { x: 8000, y: 3000 }, '和室'); b = r2.b;
    const m = mergeRooms(b, r1.roomId, r2.roomId);
    expect(m.roomId).not.toBeNull();
    const room = m.b.rooms[m.roomId!];
    expect(room.name).toBe('洋室');
    expect(roomArea(room)).toBeCloseTo(24, 6);
    expect(room.polygon).toHaveLength(4);
    expect(m.b.rooms[r1.roomId]).toBeUndefined();
    expect(m.b.rooms[r2.roomId]).toBeUndefined();
  });

  it('merges into an L shape with 6 vertices', () => {
    let { b, f } = setup();
    const r1 = addRoomRect(b, f, { x: 0, y: 0 }, { x: 4000, y: 3000 }); b = r1.b;
    const r2 = addRoomRect(b, f, { x: 0, y: 3000 }, { x: 2000, y: 5000 }); b = r2.b;
    const m = mergeRooms(b, r1.roomId, r2.roomId);
    expect(poly(m.b, m.roomId!)).toHaveLength(6);
    expect(roomArea(m.b.rooms[m.roomId!])).toBeCloseTo(16, 6);
  });

  it('merge: disjoint / corner-touching / other floor rejected', () => {
    let { b, f } = setup();
    const r1 = addRoomRect(b, f, { x: 0, y: 0 }, { x: 4000, y: 3000 }); b = r1.b;
    const r2 = addRoomRect(b, f, { x: 5000, y: 0 }, { x: 8000, y: 3000 }); b = r2.b;
    const r3 = addRoomRect(b, f, { x: 4000, y: 3000 }, { x: 6000, y: 5000 }); b = r3.b;
    const f2 = addFloor(b); b = f2.b;
    const r4 = addRoomRect(b, f2.floorId, { x: 4000, y: 0 }, { x: 8000, y: 3000 }); b = r4.b;
    for (const other of [r2.roomId, r3.roomId, r4.roomId]) {
      const m = mergeRooms(b, r1.roomId, other);
      expect(m.roomId).toBeNull();
      expect(m.b).toBe(b);
    }
    expect(mergeRooms(b, r1.roomId, r1.roomId).roomId).toBeNull();
  });
});

describe('splitRoom', () => {
  it('splits a rectangle by a horizontal line', () => {
    let { b, f } = setup();
    const r = addRoomRect(b, f, { x: 0, y: 0 }, { x: 4000, y: 3000 }, 'LDK'); b = r.b;
    const s = splitRoom(b, r.roomId, { x: 1000, y: 1500 }, { x: 2000, y: 1500 });
    expect(s.roomIds).toHaveLength(2);
    expect(s.roomIds.map((id) => roomArea(s.b.rooms[id]))).toEqual([expect.closeTo(6, 6), expect.closeTo(6, 6)]);
    expect(s.roomIds.map((id) => s.b.rooms[id].name).sort()).toEqual(['LDK-1', 'LDK-2']);
    expect(s.b.rooms[r.roomId]).toBeUndefined();
    expect(s.cuts).toHaveLength(1);
    const cut = s.cuts[0].map((p: Vec2) => ({ x: p.x, y: p.y })).sort((a, c) => a.x - c.x);
    expect(cut).toEqual([{ x: 0, y: 1500 }, { x: 4000, y: 1500 }]);
  });

  it('split: line missing room is no-op', () => {
    let { b, f } = setup();
    const r = addRoomRect(b, f, { x: 0, y: 0 }, { x: 4000, y: 3000 }); b = r.b;
    for (const [p, q] of [[{ x: 0, y: 5000 }, { x: 100, y: 5000 }], [{ x: 0, y: 0 }, { x: 4000, y: 0 }], [{ x: 0, y: 1 }, { x: 4000, y: 1 }]]) {
      const s = splitRoom(b, r.roomId, p, q);
      expect(s.roomIds).toEqual([]);
      expect(s.b).toBe(b);
      expect(s.cuts).toEqual([]);
    }
    expect(splitRoom(b, r.roomId, { x: 10, y: 10 }, { x: 10, y: 10 }).b).toBe(b);
  });

  it('splitting a U shape across both arms yields 3 pieces', () => {
    let { b, f } = setup();
    const r = addRoomRect(b, f, { x: 0, y: 0 }, { x: 6000, y: 4000 }); b = r.b;
    // U字: 中央上部を欠いた形
    b = { ...b, rooms: { ...b.rooms, [r.roomId]: { ...b.rooms[r.roomId], polygon: [
      { x: 0, y: 0 }, { x: 6000, y: 0 }, { x: 6000, y: 4000 }, { x: 4000, y: 4000 }, { x: 4000, y: 2000 },
      { x: 2000, y: 2000 }, { x: 2000, y: 4000 }, { x: 0, y: 4000 },
    ] } } };
    const s = splitRoom(b, r.roomId, { x: 0, y: 3000 }, { x: 6000, y: 3000 });
    expect(s.roomIds).toHaveLength(3);
    const total = s.roomIds.reduce((a, id) => a + roomArea(s.b.rooms[id]), 0);
    expect(total).toBeCloseTo(20, 6);
    // 切断線は部屋の内側だけ（U字の両腕の2区間。外側の隙間には壁を作らない）
    expect(s.cuts.map((c) => [c[0].x, c[1].x].sort((a, b) => a - b))).toEqual([[0, 2000], [4000, 6000]]);
  });
});
