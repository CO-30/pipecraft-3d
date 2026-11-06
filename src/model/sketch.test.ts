import { describe, expect, it } from 'vitest';
import { addFloor, emptyBuilding, moveCorner, wallLength, wallsOnFloor, type Building, type Vec2 } from './building';
import {
  addOutlineWalls, applyOutlineLength, copyOutlineToEmptyFloors, determinedLength, outlineLoop, setWallLengthStretch,
  straightenOutline, unconfirmedWallCount,
} from './sketch';
import { emptyNetwork, addPolyline } from './network';
import type { Doc } from './doc';

/** 点列 pts を細かく分けて、少し揺らした手描き線にする */
function wobbly(pts: Vec2[], amp = 60): Vec2[] {
  const out: Vec2[] = [];
  let k = 0;
  for (let i = 1; i < pts.length; i++) {
    for (let t = 0; t < 20; t++) {
      const a = pts[i - 1], b = pts[i], f = t / 20;
      const j = Math.sin(k++ * 1.7) * amp;
      out.push({ x: a.x + (b.x - a.x) * f + j, y: a.y + (b.y - a.y) * f - j });
    }
  }
  out.push(pts.at(-1)!);
  return out;
}
const opts = { tolerance: 150, ortho: true };

describe('straightenOutline', () => {
  it('ゆがんだ四角を直角の四角に補正し、画面で時計回り・左上から並べる', () => {
    const p = straightenOutline(wobbly([{ x: 0, y: 0 }, { x: 0, y: 6000 }, { x: 8000, y: 6000 }, { x: 8000, y: 0 }, { x: 100, y: 200 }]), opts)!;
    expect(p).toHaveLength(4);
    // 左上 → 右上 → 右下 → 左下
    expect(p[0].x).toBeLessThan(p[1].x);
    expect(p[0].y).toBe(p[1].y);
    expect(p[1].x).toBe(p[2].x);
    expect(p[2].y).toBeLessThan(p[1].y);
    for (const q of p) { expect(Math.abs(q.x % 50)).toBe(0); expect(Math.abs(q.y % 50)).toBe(0); }
    expect(Math.abs(p[1].x - p[0].x - 8000)).toBeLessThan(200);
  });
  it('L字を6角の多角形にする（始点と終点が離れていても閉じる）', () => {
    const p = straightenOutline(wobbly([{ x: 0, y: 6000 }, { x: 8000, y: 6000 }, { x: 8000, y: 3000 }, { x: 5000, y: 3000 }, { x: 5000, y: 0 }, { x: 0, y: 0 }, { x: 0, y: 5200 }], 40), opts)!;
    expect(p).toHaveLength(6);
    for (let i = 0; i < 6; i++) {
      const a = p[i], b = p[(i + 1) % 6];
      expect(a.x === b.x || a.y === b.y).toBe(true);
    }
  });
  it('小さなギザギザ（短い辺）は消す', () => {
    const p = straightenOutline([{ x: 0, y: 0 }, { x: 4000, y: 0 }, { x: 4000, y: 100 }, { x: 4100, y: 100 }, { x: 4100, y: 3000 }, { x: 0, y: 3000 }, { x: 0, y: 0 }], { ...opts, tolerance: 10 })!;
    expect(p).toHaveLength(4);
  });
  it('線だけ・小さすぎる形は null', () => {
    expect(straightenOutline([{ x: 0, y: 0 }, { x: 5000, y: 0 }, { x: 5000, y: 10 }], opts)).toBeNull();
    expect(straightenOutline([{ x: 0, y: 0 }, { x: 50, y: 0 }, { x: 50, y: 50 }, { x: 0, y: 50 }], opts)).toBeNull();
  });
  it('直交補正なしなら斜めの辺も残す', () => {
    const p = straightenOutline([{ x: 0, y: 0 }, { x: 6000, y: 0 }, { x: 3000, y: 5000 }, { x: 0, y: 0 }], { tolerance: 50, ortho: false })!;
    expect(p).toHaveLength(3);
  });
});

function sketched(floors = 1, poly: Vec2[] = [{ x: 0, y: 6000 }, { x: 8000, y: 6000 }, { x: 8000, y: 0 }, { x: 0, y: 0 }]) {
  let b: Building = emptyBuilding();
  for (let i = 0; i < floors; i++) b = addFloor(b, { height: 2800 }).b;
  const f1 = b.floors[0].id;
  b = addOutlineWalls(b, f1, poly).b;
  b = copyOutlineToEmptyFloors(b, f1);
  return { b, f1 };
}
const docOf = (b: Building): Doc => ({ building: b, network: emptyNetwork(), fixtures: {} });

describe('外形と階のコピー', () => {
  it('外壁は寸法未確定で作られ、壁のない上の階にもコピーされる', () => {
    const { b } = sketched(2);
    expect(Object.keys(b.walls)).toHaveLength(8);
    expect(unconfirmedWallCount(b)).toBe(8);
    expect(wallsOnFloor(b, b.floors[1].id).every((w) => w.kind === 'exterior')).toBe(true);
  });
  it('ループは時計回り・左上の角から', () => {
    const { b, f1 } = sketched();
    const loop = outlineLoop(b, f1)!;
    const c0 = b.corners[loop.corners[0]], c1 = b.corners[loop.corners[1]];
    expect([c0.x, c0.y, c1.x, c1.y]).toEqual([0, 6000, 8000, 6000]);
    expect(loop.walls).toHaveLength(4);
  });
});

describe('寸法の入力', () => {
  it('上の辺に実測を入れると平行な下の辺も同じ長さになり、全階まとめて変わる', () => {
    const { b, f1 } = sketched(2);
    const top = outlineLoop(b, f1)!.walls[0];
    const r = setWallLengthStretch(docOf(b), top, 7280, 'a');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const nb = r.doc.building;
    for (const w of Object.values(nb.walls)) {
      const L = wallLength(nb, w.id);
      expect([7280, 6000]).toContain(Math.round(L));
    }
    // 変えた壁と 2階の同じ位置の壁は確定
    expect(unconfirmedWallCount(nb)).toBe(6);
  });
  it('四角で上と右を入れると、下と左は自動計算になる', () => {
    const { b, f1 } = sketched();
    const loop = outlineLoop(b, f1)!;
    let d = docOf(b);
    for (const [i, L] of [[0, 7280], [1, 5460]] as const) {
      const r = applyOutlineLength(d, loop.walls[i], L, 'a');
      if (!r.ok) throw new Error('fail');
      d = r.doc;
    }
    expect(determinedLength(d.building, f1, loop.walls[2])).toBe(7280);
    expect(determinedLength(d.building, f1, loop.walls[3])).toBe(5460);
    expect(determinedLength(d.building, f1, loop.walls[1])).toBeNull(); // 左の辺が未確定
  });
  it('決まっている辺に違う実測を入れると、ずれを返す。force なら採用して他の辺を未確定に戻す', () => {
    const { b, f1 } = sketched();
    const loop = outlineLoop(b, f1)!;
    let d = docOf(b);
    for (const [i, L] of [[0, 7280], [1, 5460], [3, 5460]] as const) {
      const r = applyOutlineLength(d, loop.walls[i], L, 'a');
      if (!r.ok) throw new Error('fail');
      d = r.doc;
    }
    const bottom = loop.walls[2];
    const c = applyOutlineLength(d, bottom, 7300, 'a');
    expect(c.ok).toBe(false);
    if (c.ok || !('conflict' in c)) throw new Error('no conflict');
    expect(c.conflict.gap).toBeCloseTo(20);
    const f = applyOutlineLength(d, bottom, 7300, 'a', true);
    expect(f.ok).toBe(true);
    if (!f.ok) return;
    expect(Math.round(wallLength(f.doc.building, bottom))).toBe(7300);
    expect(f.unconfirmed).toContain(loop.walls[0]);
  });
  it('確定済みの辺が変わる側は避けて、反対側を固定する', () => {
    // L字: 上(8000) 右上(3000) 段(3000) 右下(3000) 下(5000) 左(6000)
    const L = [{ x: 0, y: 6000 }, { x: 8000, y: 6000 }, { x: 8000, y: 3000 }, { x: 5000, y: 3000 }, { x: 5000, y: 0 }, { x: 0, y: 0 }];
    const { b, f1 } = sketched(1, L);
    const loop = outlineLoop(b, f1)!;
    let d = docOf(b);
    const r0 = applyOutlineLength(d, loop.walls[0], 8000, 'a');
    if (!r0.ok) throw new Error();
    d = r0.doc;
    // 段の辺（右へ向かう逆向き: 8000→5000）を 2500 に。固定 a(右端) だと上の辺は変わらない
    const r = applyOutlineLength(d, loop.walls[2], 2500, 'b');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.mode).toBe('slide');
    expect(Math.round(wallLength(r.doc.building, loop.walls[0]))).toBe(8000);
    expect(Math.round(wallLength(r.doc.building, loop.walls[2]))).toBe(2500);
    expect(Math.round(wallLength(r.doc.building, loop.walls[4]))).toBe(5500);
  });
  it('配管・器具も一緒にずれる', () => {
    const { b, f1 } = sketched();
    const net = addPolyline(emptyNetwork(), [{ x: 7000, y: 1000, z: 300 }, { x: 8000, y: 1000, z: 300 }], { system: 'water', diameter: 20 }).net;
    const d: Doc = { building: b, network: net, fixtures: {} };
    const top = outlineLoop(b, f1)!.walls[0];
    const r = setWallLengthStretch(d, top, 9000, 'a');
    if (!r.ok) throw new Error();
    // 伸ばす側の端（x=8000）より先の点だけ動く
    expect(Object.values(r.doc.network.nodes).map((n) => n.pos.x).sort()).toEqual([7000, 9000]);
  });
  it('窓は動く端より手前なら図面上の位置のまま（壁の始点が動けば距離を測り直す）', () => {
    const { b, f1 } = sketched();
    const top = outlineLoop(b, f1)!.walls[0]; // (0,6000)→(8000,6000)
    const bw = { ...b, openings: { o1: { id: 'o1', wallId: top, type: 'window' as const, offset: 1000, width: 800, height: 1100, sill: 900 } } };
    const r = setWallLengthStretch(docOf(bw), top, 9000, 'b'); // 右端を固定 → 左の角が x=-1000 へ
    if (!r.ok) throw new Error(r.error);
    expect(Math.round(r.doc.building.openings.o1.offset)).toBe(2000); // 窓は x=1000 のまま、始点が x=-1000 へ
    const r2 = setWallLengthStretch(docOf(bw), top, 9000, 'a');
    if (!r2.ok) throw new Error(r2.error);
    expect(Math.round(r2.doc.building.openings.o1.offset)).toBe(1000);
  });
  it('形が裏返る長さは拒否（L字の上の辺を段より短く）', () => {
    const L = [{ x: 0, y: 6000 }, { x: 8000, y: 6000 }, { x: 8000, y: 3000 }, { x: 5000, y: 3000 }, { x: 5000, y: 0 }, { x: 0, y: 0 }];
    const { b, f1 } = sketched(1, L);
    const r = setWallLengthStretch(docOf(b), outlineLoop(b, f1)!.walls[0], 4000, 'a');
    expect(r.ok).toBe(false);
  });
  it('下の階にはコピーしない', () => {
    let b: Building = emptyBuilding();
    b = addFloor(b).b; b = addFloor(b).b;
    const f2 = b.floors[1].id;
    b = copyOutlineToEmptyFloors(addOutlineWalls(b, f2, [{ x: 0, y: 6000 }, { x: 8000, y: 6000 }, { x: 8000, y: 0 }, { x: 0, y: 0 }]).b, f2);
    expect(wallsOnFloor(b, b.floors[0].id)).toHaveLength(0);
  });
  it('確定した壁の角を手で動かすと未確定に戻る（寸法管理していない壁はそのまま）', () => {
    const { b, f1 } = sketched();
    const loop = outlineLoop(b, f1)!;
    const r = setWallLengthStretch(docOf(b), loop.walls[0], 7000, 'a');
    if (!r.ok) throw new Error();
    const nb = moveCorner(r.doc.building, loop.corners[1], { x: 7500, y: 6000 });
    expect(nb.walls[loop.walls[0]].lengthSet).toBe(false);
  });
  it('短すぎる長さ・窓がはみ出す長さは拒否', () => {
    const { b, f1 } = sketched();
    const top = outlineLoop(b, f1)!.walls[0];
    expect(setWallLengthStretch(docOf(b), top, 50, 'a').ok).toBe(false);
    const bw = { ...b, openings: { o1: { id: 'o1', wallId: top, type: 'window' as const, offset: 6000, width: 1600, height: 1100, sill: 900 } } };
    expect(setWallLengthStretch(docOf(bw), top, 5000, 'a').ok).toBe(false);
  });
});
