import { describe, expect, test } from 'vitest';
import { createBuildingFromDims } from './building';
import type { Doc } from './doc';
import { FIXTURE_CATALOG, moveFixture, placeFixture, deleteFixture } from './fixtures';
import { addPolyline, cutSegment, deleteSegment, emptyNetwork, insertValve } from './network';
import { addNote, buildingNotePoint, detachNote, targetFloorId, noteNumbers, notes3dZ, notesText, removeNote, removeNotesOnFloor, syncNotes, updateNote } from './notes';
import { projectSchema } from './schema';
import { defaultEstimate } from './estimate';

const v = (x: number, y: number, z = 0) => ({ x, y, z });
const W = { system: 'water' as const, diameter: 20 };

function base(): Doc {
  const building = createBuildingFromDims({ width: 8000, depth: 6000, floors: 2, floorHeight: 2900, wallThickness: 150, slabThickness: 200 });
  return { building, network: emptyNetwork(), fixtures: {}, site: {} };
}
const f1 = (d: Doc) => d.building.floors[0].id;

describe('メモ', () => {
  test('置く・直す・消す。番号は置いた順で、消すと詰まる', () => {
    let d = base();
    const a = addNote(d, { floorId: f1(d), x: 100, y: 200, text: '梁を避ける' }, 1000); d = a.doc;
    const b = addNote(d, { floorId: f1(d), x: 300, y: 200, text: 'メーター位置 施主確認' }, 2000); d = b.doc;
    const c = addNote(d, { floorId: f1(d), x: 500, y: 200, text: '' }, 3000); d = c.doc;
    expect(noteNumbers(d.notes).get(c.id)).toBe(3);
    d = updateNote(d, a.id, { text: '梁を下から避ける', done: true }, 4000);
    expect(d.notes![a.id]).toMatchObject({ text: '梁を下から避ける', done: true, updatedAt: 4000 });
    d = removeNote(d, b.id);
    expect(noteNumbers(d.notes).get(c.id)).toBe(2);
  });

  test('配管に付けたメモは、区間を分けても（バルブ）分けた後の区間に付き直す', () => {
    const r = addPolyline(emptyNetwork(), [v(0, 0, 300), v(2000, 0, 300)], W);
    const segId = Object.keys(r.net.segments)[0];
    let d: Doc = { ...base(), network: r.net };
    const n = addNote(d, { floorId: f1(d), x: 1500, y: 0, z: 300, text: 'ここ', target: { kind: 'segment', id: segId } }, 1);
    d = n.doc;
    const net = insertValve(d.network, segId, v(500, 0, 300))!.net;
    d = syncNotes({ ...d, network: net }, d);
    const t = d.notes![n.id].target!;
    expect(t.id).not.toBe(segId);
    expect(d.network.segments[t.id]).toBeDefined();
    expect(d.notes![n.id]).toMatchObject({ x: 1500, y: 0, z: 300 });
  });

  test('切断（隙間ができる）でも、高さが少し変わっても、近い新しい区間に付き直す', () => {
    const r = addPolyline(emptyNetwork(), [v(0, 0, 300), v(2000, 0, 300)], W);
    const segId = Object.keys(r.net.segments)[0];
    let d: Doc = { ...base(), network: r.net };
    const n = addNote(d, { floorId: f1(d), x: 1000, y: 0, z: 300, text: 'x', target: { kind: 'segment', id: segId } }, 1);
    d = n.doc;
    const cut = cutSegment(d.network, segId, v(1000, 0, 300));
    expect(cut).toBeTruthy();
    const after = syncNotes({ ...d, network: cut!.net }, d);
    const t = after.notes![n.id].target!;
    expect(after.network.segments[t.id]).toBeDefined();
    // 高さが 30mm ずれた新しい区間でも付き直す
    const moved = { ...d, network: insertValve(d.network, segId, v(500, 0, 300))!.net };
    const shifted = { ...moved, network: { ...moved.network, nodes: Object.fromEntries(Object.entries(moved.network.nodes).map(([k, nd]) => [k, { ...nd, pos: { ...nd.pos, z: nd.pos.z - 30 } }])) } };
    expect(shifted.network.segments[syncNotes(shifted, d).notes![n.id].target!.id]).toBeDefined();
  });

  test('付けた先の配管が前から無いメモは、後から描いた別の管には付かない', () => {
    const r = addPolyline(emptyNetwork(), [v(0, 0, 300), v(2000, 0, 300)], W);
    const segId = Object.keys(r.net.segments)[0];
    let d: Doc = { ...base(), network: r.net };
    const n = addNote(d, { floorId: f1(d), x: 1000, y: 0, z: 300, text: 'x', target: { kind: 'segment', id: segId } }, 1);
    d = n.doc;
    const gone = syncNotes({ ...d, network: deleteSegment(d.network, segId) }, d);
    const hot = addPolyline(gone.network, [v(1000, -500, 300), v(1000, 500, 300)], { system: 'hotWater', diameter: 13 }).net;
    const after = syncNotes({ ...gone, network: hot }, gone);
    expect(after.notes![n.id].target!.id).toBe(segId);
  });

  test('配管・接続口に付けたメモの階は、その配管の階（3D で 2 階の管を選んでも 2 階のメモ）', () => {
    let d = base();
    const f2 = d.building.floors[1];
    const r = addPolyline(emptyNetwork(), [v(0, 0, f2.elevation + 300), v(2000, 0, f2.elevation + 300)], W);
    const nodes = Object.fromEntries(Object.entries(r.net.nodes).map(([k, nd]) => [k, { ...nd, floorId: f2.id }]));
    d = { ...d, network: { ...r.net, nodes } };
    const segId = Object.keys(r.net.segments)[0];
    expect(targetFloorId(d, { kind: 'segment', id: segId })).toBe(f2.id);
    const n = addNote(d, { floorId: f1(d), x: 1000, y: 0, z: f2.elevation + 300, text: 'x', target: { kind: 'segment', id: segId } }, 1);
    expect(syncNotes(n.doc).notes![n.id].floorId).toBe(f2.id);
  });

  test('付けた先から外すと、床より下にあったメモは床下のメモになる', () => {
    const r = addPolyline(emptyNetwork(), [v(0, 0, -400), v(2000, 0, -400)], W);
    const segId = Object.keys(r.net.segments)[0];
    let d: Doc = { ...base(), network: r.net };
    const n = addNote(d, { floorId: f1(d), x: 1000, y: 0, z: -400, text: 'x', target: { kind: 'segment', id: segId } }, 1);
    d = detachNote(n.doc, n.id, { x: 1100, y: 50 }, 2);
    expect(d.notes![n.id]).toMatchObject({ x: 1100, y: 50, under: true });
    expect(d.notes![n.id].target).toBeUndefined();
    expect(d.notes![n.id].z).toBeUndefined();
  });

  test('本文は 1000 字（UTF-16）で切り、絵文字を半分に割らない', () => {
    const t = 'あ'.repeat(999) + '😀';
    const n = addNote(base(), { floorId: 'x', x: 0, y: 0, text: t }, 1);
    expect(n.doc.notes![n.id].text).toBe('あ'.repeat(999));
  });

  test('配管を動かすと、付けたメモは配管の上の一番近い所へついてくる', () => {
    const r = addPolyline(emptyNetwork(), [v(0, 0, 300), v(2000, 0, 300)], W);
    const segId = Object.keys(r.net.segments)[0];
    let d: Doc = { ...base(), network: r.net };
    const n = addNote(d, { floorId: f1(d), x: 800, y: 0, z: 300, text: 'x', target: { kind: 'segment', id: segId } }, 1);
    d = n.doc;
    const nodes = Object.fromEntries(Object.entries(d.network.nodes).map(([k, nd]) => [k, { ...nd, pos: { ...nd.pos, y: nd.pos.y + 400, z: nd.pos.z - 100 } }]));
    d = syncNotes({ ...d, network: { ...d.network, nodes } });
    expect(d.notes![n.id]).toMatchObject({ x: 800, y: 400, z: 200 });
  });

  test('器具に付けたメモは器具を動かすとついてくる（高さは器具の上）。器具が消えたら最後の場所に残る', () => {
    let d = base();
    const p = placeFixture(d, f1(d), 'toilet', { x: 1000, y: 1000 }); d = p.doc;
    const n = addNote(d, { floorId: f1(d), x: 1000, y: 1000, text: 'x', target: { kind: 'fixture', id: p.fixtureId! } }, 1); d = n.doc;
    d = syncNotes(moveFixture(d, p.fixtureId!, { x: 2500, y: 1200 }));
    const floor = d.building.floors[0];
    expect(d.notes![n.id]).toMatchObject({ x: 2500, y: 1200, z: floor.elevation + FIXTURE_CATALOG.toilet.size.h });
    d = syncNotes(deleteFixture(d, p.fixtureId!));
    expect(d.notes![n.id]).toMatchObject({ x: 2500, y: 1200, target: { kind: 'fixture', id: p.fixtureId } });
  });

  test('付けた先が変わらなければ同じ Doc を返す（履歴を増やさない）', () => {
    const r = addPolyline(emptyNetwork(), [v(0, 0, 300), v(2000, 0, 300)], W);
    const segId = Object.keys(r.net.segments)[0];
    let d: Doc = { ...base(), network: r.net };
    d = addNote(d, { floorId: f1(d), x: 800, y: 0, z: 300, text: 'x', target: { kind: 'segment', id: segId } }, 1).doc;
    d = syncNotes(d);
    expect(syncNotes(d)).toBe(d);
    const gone = syncNotes({ ...d, network: deleteSegment(d.network, segId) });
    expect(syncNotes(gone)).toBe(gone);
  });

  test('付けていないメモの 3D の高さは階の床から（床下で置いたものは床の下）。階の高さを変えても追従', () => {
    let d = base();
    const f2 = d.building.floors[1];
    const a = addNote(d, { floorId: f2.id, x: 0, y: 0, text: 'a' }, 1); d = a.doc;
    const b = addNote(d, { floorId: f2.id, x: 0, y: 0, text: 'b', under: true }, 2); d = b.doc;
    expect(notes3dZ(d, d.notes![a.id])).toBe(f2.elevation + 1200);
    expect(notes3dZ(d, d.notes![b.id])).toBe(f2.elevation - 300);
    const raised = { ...d, building: { ...d.building, floors: d.building.floors.map((f) => (f.id === f2.id ? { ...f, elevation: f.elevation + 500 } : f)) } };
    expect(notes3dZ(raised, raised.notes![a.id])).toBe(f2.elevation + 1700);
  });

  test('建物の部材に付けるときの位置: 壁は真ん中、部屋は重心、開口は開口の中心、梁は中心', () => {
    const d = base();
    const b = d.building;
    const w = Object.values(b.walls).find((x) => x.floorId === f1(d))!;
    const ca = b.corners[w.a], cb = b.corners[w.b];
    expect(buildingNotePoint(b, { kind: 'wall', id: w.id })).toEqual({ x: (ca.x + cb.x) / 2, y: (ca.y + cb.y) / 2 });
    const len = Math.hypot(cb.x - ca.x, cb.y - ca.y);
    const ob = { ...b, openings: { o1: { id: 'o1', wallId: w.id, type: 'door' as const, offset: len / 4, width: 800, height: 2000, sill: 0 } } };
    expect(buildingNotePoint(ob, { kind: 'opening', id: 'o1' })!.x).toBeCloseTo(ca.x + (cb.x - ca.x) / 4, 6);
    const rb = { ...b, rooms: { r1: { id: 'r1', floorId: f1(d), name: '洗面', polygon: [{ x: 0, y: 0 }, { x: 2000, y: 0 }, { x: 2000, y: 1000 }, { x: 0, y: 1000 }] } } };
    expect(buildingNotePoint(rb, { kind: 'room', id: 'r1' })).toEqual({ x: 1000, y: 500 });
    expect(buildingNotePoint(b, { kind: 'wall', id: 'nope' })).toBeNull();
  });

  test('階を消すとその階のメモも消える', () => {
    let d = base();
    d = addNote(d, { floorId: f1(d), x: 0, y: 0, text: 'a' }, 1).doc;
    const k = addNote(d, { floorId: d.building.floors[1].id, x: 0, y: 0, text: 'b' }, 2); d = k.doc;
    d = removeNotesOnFloor(d, f1(d));
    expect(Object.keys(d.notes!)).toEqual([k.id]);
  });

  test('一覧を文字にする（未対応だけにも絞れる）', () => {
    let d = base();
    const p = placeFixture(d, f1(d), 'toilet', { x: 1000, y: 1000 }); d = p.doc;
    const a = addNote(d, { floorId: f1(d), x: 0, y: 0, text: '梁を避ける\n下から回す' }, 1); d = a.doc;
    const b = addNote(d, { floorId: f1(d), x: 0, y: 0, text: '施主確認', target: { kind: 'fixture', id: p.fixtureId! } }, 2); d = b.doc;
    d = updateNote(d, a.id, { done: true }, 3);
    const label = (t: { kind: string }) => (t.kind === 'fixture' ? 'トイレ' : null);
    expect(notesText(d, '山田邸', label)).toBe(
      '山田邸 メモ（未対応 1 / 全 2）\n1. ✓済 [1階] 梁を避ける 下から回す\n2. [1階・トイレ] 施主確認');
    expect(notesText(d, '山田邸', label, true)).toBe('山田邸 メモ（未対応 1 / 全 2）\n2. [1階・トイレ] 施主確認');
  });

  test('保存形式: notes は省略でき、あれば検証される', () => {
    const d = addNote(base(), { floorId: 'x', x: 0, y: 0, text: 'a' }, 1).doc;
    const proj = (notes?: unknown) => ({ schemaVersion: 5, id: 'p', name: 'p', createdAt: 0, updatedAt: 0, building: d.building, network: d.network, fixtures: {}, estimate: defaultEstimate(), underlays: {}, ...(notes ? { notes } : {}) });
    const ok = projectSchema.safeParse(proj(d.notes));
    const none = projectSchema.safeParse(proj());
    const bad = projectSchema.safeParse(proj({ n: { id: 'n', floorId: 'x', x: 'a', y: 0, text: '', createdAt: 0 } }));
    expect(none.success).toBe(true);
    expect(bad.success).toBe(false);
    expect(ok.success).toBe(true);
  });
});
