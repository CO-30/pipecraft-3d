import { beforeEach, describe, expect, it } from 'vitest';
import { emptyDoc, useStore } from './store';
import { createBuildingFromDims } from '../model/building';
import { emptyNetwork } from '../model/network';

const s = () => useStore.getState();
const notes = () => Object.values(s().doc.notes ?? {});

beforeEach(() => {
  const building = createBuildingFromDims({ width: 8000, depth: 6000, floors: 2, floorHeight: 2900, wallThickness: 150, slabThickness: 200 });
  s().newDoc({ ...emptyDoc(), building, network: emptyNetwork() }, { id: 'p', name: '山田邸', createdAt: 1 });
});

describe('共通ストア: メモ', () => {
  it('道具で置くとメモを選んだ状態になり、道具は選択に戻る。元に戻せる', () => {
    s().setTool('note');
    s().placeNoteAt({ x: 1000, y: 2000 });
    expect(notes()).toHaveLength(1);
    expect(notes()[0]).toMatchObject({ x: 1000, y: 2000, floorId: s().activeFloorId, text: '' });
    expect(s().selection).toEqual({ kind: 'note', id: notes()[0].id });
    expect(s().tool).toBe('select');
    s().undo();
    expect(notes()).toHaveLength(0);
    expect(s().selection).toBeNull();
  });

  it('本文と済を直せる（1 回ずつ履歴に入る）。同じ本文なら履歴を増やさない', () => {
    s().placeNoteAt({ x: 0, y: 0 });
    const id = notes()[0].id;
    const past = s().past.length;
    s().updateNote(id, { text: '梁を避ける' });
    s().updateNote(id, { text: '梁を避ける' });
    expect(s().past.length).toBe(past + 1);
    s().updateNote(id, { done: true });
    expect(s().doc.notes![id]).toMatchObject({ text: '梁を避ける', done: true });
    s().undo();
    expect(s().doc.notes![id].done).toBeUndefined();
  });

  it('選んだ器具に付けたメモは器具を動かすとついてくる（同じ履歴）', () => {
    s().setFixtureType('toilet');
    s().placeFixtureAt({ x: 1000, y: 1000 });
    const fid = Object.keys(s().doc.fixtures)[0];
    s().select({ kind: 'fixture', id: fid });
    s().addNoteFromSelection();
    const n = notes()[0];
    expect(n.target).toEqual({ kind: 'fixture', id: fid });
    expect(s().selection).toEqual({ kind: 'note', id: n.id });
    s().beginDrag();
    s().dragFixture(fid, { x: 3000, y: 1500 });
    expect(s().doc.notes![n.id]).toMatchObject({ x: 3000, y: 1500 });
    s().endDrag();
    s().undo();
    expect(s().doc.notes![n.id]).toMatchObject({ x: 1000, y: 1000 });
  });

  it('配管をタップした所に付けると、その点の管の上に付く', () => {
    s().drawPolyline([{ x: 0, y: 0, z: 300 }, { x: 4000, y: 0, z: 300 }]);
    const seg = Object.keys(s().doc.network.segments)[0];
    s().select({ kind: 'segment', id: seg, at: { x: 1000, y: 30, z: 300 } });
    s().addNoteFromSelection();
    expect(notes()[0]).toMatchObject({ x: 1000, y: 0, z: 300, target: { kind: 'segment', id: seg } });
  });

  it('メモを動かせる（付けた先からは外れる）・消せる', () => {
    s().setFixtureType('toilet');
    s().placeFixtureAt({ x: 1000, y: 1000 });
    s().select({ kind: 'fixture', id: Object.keys(s().doc.fixtures)[0] });
    s().addNoteFromSelection();
    const id = notes()[0].id;
    s().moveNote(id, { x: 2000, y: 2000 });
    expect(s().doc.notes![id].target).toBeUndefined();
    expect(s().doc.notes![id]).toMatchObject({ x: 2000, y: 2000 });
    s().removeNote(id);
    expect(notes()).toHaveLength(0);
    expect(s().selection).toBeNull();
  });

  it('階を消すとその階のメモも消える', () => {
    const f2 = s().doc.building.floors[1].id;
    s().setActiveFloor(f2);
    s().placeNoteAt({ x: 0, y: 0 });
    s().deleteFloor(f2);
    expect(notes()).toHaveLength(0);
  });

  it('保存と読み込みでメモが残る', () => {
    s().placeNoteAt({ x: 10, y: 20 });
    s().updateNote(notes()[0].id, { text: 'あ' });
    const p = s().toProjectData()!;
    expect(Object.values(p.notes ?? {})[0]).toMatchObject({ text: 'あ', x: 10, y: 20 });
    s().newDoc(emptyDoc(), { id: 'q', name: 'q', createdAt: 1 });
    s().openProject(p);
    expect(notes()[0]).toMatchObject({ text: 'あ' });
  });
});
