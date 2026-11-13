/** 器具を置いたあと（2026-11-13 ユーザー要望: まちがって次々に置かないよう ☝️ に戻し、内容を変えられるように） */
import { beforeEach, describe, expect, it } from 'vitest';
import { emptyDoc, useStore } from './store';
import { createBuildingFromDims } from '../model/building';
import { addPolyline } from '../model/network';
import { portNodes, validateFixtures } from '../model/fixtures';

const s = () => useStore.getState();

beforeEach(() => {
  s().newDoc({ ...emptyDoc(), building: createBuildingFromDims({ width: 8000, depth: 6000, floors: 1, floorHeight: 2900, wallThickness: 150, slabThickness: 200 }) }, { id: 'p', name: 'テスト', createdAt: 1 });
});

describe('器具を置いたら選択（☝️）に戻す', () => {
  it('置くと道具は選択になり、置いた器具を選んでいる。もう一度タップしても増えない', () => {
    s().setTool('fixture');
    s().setFixtureType('toilet');
    s().placeFixtureAt({ x: 2000, y: 2000 });
    const id = Object.keys(s().doc.fixtures)[0];
    expect(s().tool).toBe('select');
    expect(s().selection).toEqual({ kind: 'fixture', id });
    expect(s().notice).toMatch(/器具/);
  });
});

describe('置いた器具の種類を変える', () => {
  it('同じ場所・向き・番号のまま種類が変わり、接続口も付け替わる。元に戻すで戻る', () => {
    s().setFixtureType('toilet');
    s().placeFixtureAt({ x: 2000, y: 2000 });
    const id = Object.keys(s().doc.fixtures)[0];
    s().rotateFixture(id);
    s().changeFixtureType(id, 'washbasin');
    const f = s().doc.fixtures[id];
    expect(f.type).toBe('washbasin');
    expect([f.x, f.y, f.rotation]).toEqual([2000, 2000, 90]);
    expect(portNodes(s().doc.network, id).map((n) => n.portId).sort()).toEqual(['drain', 'hot', 'water']);
    expect(validateFixtures(s().doc)).toEqual([]);
    expect(s().selection).toEqual({ kind: 'fixture', id });
    s().undo();
    expect(s().doc.fixtures[id].type).toBe('toilet');
  });
  it('配管がつながっている器具は変えずに知らせる', () => {
    s().setFixtureType('toilet');
    s().placeFixtureAt({ x: 2000, y: 2000 });
    const id = Object.keys(s().doc.fixtures)[0];
    const w = portNodes(s().doc.network, id).find((n) => n.portId === 'water')!;
    s().newDoc({ ...s().doc, network: addPolyline(s().doc.network, [w.pos, { ...w.pos, x: w.pos.x + 500 }], { system: 'water', diameter: 13 }, { startNodeId: w.id }).net }, s().meta);
    s().changeFixtureType(id, 'washbasin');
    expect(s().doc.fixtures[id].type).toBe('toilet');
    expect(s().notice).toMatch(/配管/);
  });
});
