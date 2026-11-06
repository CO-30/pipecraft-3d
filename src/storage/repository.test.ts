import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { DexieProjectRepository, InvalidProjectError, parseProject } from './repository';
import { addPolyline, branchFromSegment, emptyNetwork } from '../model/network';
import { createBuildingFromDims } from '../model/building';
import { SCHEMA_VERSION, type ProjectData } from '../model/schema';

function sample(): ProjectData {
  const a = addPolyline(emptyNetwork(), [{ x: 0, y: 0, z: 0 }, { x: 4000, y: 0, z: 0 }], { system: 'water', diameter: 20 });
  const b = branchFromSegment(a.net, a.segmentIds[0], { x: 2000, y: 0, z: 0 }, [{ x: 2000, y: 1500, z: 0 }]);
  const building = createBuildingFromDims({ width: 8000, depth: 6000, floors: 2, floorHeight: 2900, wallThickness: 150, slabThickness: 200 });
  return { schemaVersion: SCHEMA_VERSION, id: 'p1', name: 'テスト現場', address: '那覇市', createdAt: 1, updatedAt: 2, building, network: b.net, fixtures: {} };
}

let n = 0;
const nextName = () => `t${++n}`;

describe('IndexedDB 保存', () => {
  it('保存→新しい接続で再読み込みしても同じデータ（ブラウザ再起動相当）', async () => {
    const name = nextName();
    const r1 = new DexieProjectRepository(name);
    const p = sample();
    await r1.save(p);
    r1.close();
    const r2 = new DexieProjectRepository(name);
    expect(await r2.load('p1')).toEqual(p);
    expect(await r2.list()).toEqual([{ id: 'p1', name: 'テスト現場', address: '那覇市', createdAt: 1, updatedAt: 2 }]);
  });

  it('本体データが破損していたら直前のバックアップから復旧', async () => {
    const r = new DexieProjectRepository(nextName());
    const p1 = sample();
    await r.save(p1);
    await r.save({ ...p1, updatedAt: 3 });
    await r._corrupt('p1', '{"broken":');
    expect((await r.load('p1'))?.updatedAt).toBe(2);
  });

  it('不正データを検出する（形式不正・配管接続破損・建物破損）', () => {
    expect(() => parseProject('not json')).toThrow(InvalidProjectError);
    expect(() => parseProject(JSON.stringify({ foo: 1 }))).toThrow(InvalidProjectError);
    const p = sample();
    p.network.segments[Object.keys(p.network.segments)[0]].b = 'missing';
    expect(() => parseProject(JSON.stringify(p))).toThrow(/接続情報/);
    const q = sample();
    q.building.walls[Object.keys(q.building.walls)[0]].a = 'missing';
    expect(() => parseProject(JSON.stringify(q))).toThrow(/建物/);
  });

  it('JSON書き出し→読み込みの往復', () => {
    const p = sample();
    expect(parseProject(JSON.stringify(p))).toEqual(p);
  });

  it('旧形式(v1)は配管を保持したまま変換して読み込める', () => {
    const p = sample();
    const v1 = { schemaVersion: 1, id: 'old', name: '旧', createdAt: 1, updatedAt: 2, network: p.network };
    const r = parseProject(JSON.stringify(v1));
    expect(r.schemaVersion).toBe(SCHEMA_VERSION);
    expect(r.network).toEqual(p.network);
    expect(r.building.floors).toHaveLength(1);
  });

  it('接続情報が壊れたデータの保存は拒否し、既存の正常データを残す', async () => {
    const r = new DexieProjectRepository(nextName());
    const p = sample();
    await r.save(p);
    const bad = structuredClone(p);
    bad.network.segments[Object.keys(bad.network.segments)[0]].b = 'missing';
    await expect(r.save({ ...bad, updatedAt: 9 })).rejects.toThrow(InvalidProjectError);
    expect((await r.load('p1'))?.updatedAt).toBe(2);
  });
});

describe('現場の管理', () => {
  it('複製は別IDで同じ内容', async () => {
    const r = new DexieProjectRepository(nextName());
    const orig = sample();
    await r.save(orig);
    const c = await r.duplicate('p1', 'テスト現場 のコピー');
    expect(c.id).not.toBe('p1');
    expect(c.building).toEqual(orig.building);
    expect((await r.list()).map((x) => x.name).sort()).toEqual(['テスト現場', 'テスト現場 のコピー']);
  });

  it('JSON読み込みは既存を上書きせず新規追加、不正JSONは追加しない', async () => {
    const r = new DexieProjectRepository(nextName());
    await r.save(sample());
    const json = await r.exportJson('p1');
    const imp = await r.importJson(json);
    expect(imp.id).not.toBe('p1');
    expect(await r.list()).toHaveLength(2);
    await expect(r.importJson('{"x":1}')).rejects.toThrow(InvalidProjectError);
    expect(await r.list()).toHaveLength(2);
  });

  it('削除', async () => {
    const r = new DexieProjectRepository(nextName());
    await r.save(sample());
    await r.delete('p1');
    expect(await r.list()).toHaveLength(0);
  });
});
