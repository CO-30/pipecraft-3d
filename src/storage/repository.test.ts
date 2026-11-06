import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { DexieProjectRepository, InvalidProjectError, parseProject } from './repository';
import { addPolyline, branchFromSegment, emptyNetwork } from '../model/network';
import { SCHEMA_VERSION, type ProjectData } from '../model/schema';

function sample(): ProjectData {
  const a = addPolyline(emptyNetwork(), [{ x: 0, y: 0, z: 0 }, { x: 4000, y: 0, z: 0 }], { system: 'water', diameter: 20 });
  const b = branchFromSegment(a.net, a.segmentIds[0], { x: 2000, y: 0, z: 0 }, [{ x: 2000, y: 1500, z: 0 }]);
  return { schemaVersion: SCHEMA_VERSION, id: 'p1', name: 'テスト現場', createdAt: 1, updatedAt: 2, network: b.net };
}

describe('IndexedDB 保存', () => {
  it('保存→新しい接続で再読み込みしても同じデータ（ブラウザ再起動相当）', async () => {
    const r1 = new DexieProjectRepository('t1');
    const p = sample();
    await r1.save(p);
    r1.close();
    const r2 = new DexieProjectRepository('t1');
    expect(await r2.load('p1')).toEqual(p);
    expect(await r2.list()).toEqual([{ id: 'p1', name: 'テスト現場', updatedAt: 2 }]);
  });

  it('本体データが破損していたら直前のバックアップから復旧', async () => {
    const r = new DexieProjectRepository('t2');
    const p1 = sample();
    await r.save(p1);
    await r.save({ ...p1, updatedAt: 3 });
    await r._corrupt('p1', '{"broken":');
    expect((await r.load('p1'))?.updatedAt).toBe(2);
  });

  it('不正データを検出する（形式不正・接続破損）', () => {
    expect(() => parseProject('not json')).toThrow(InvalidProjectError);
    expect(() => parseProject(JSON.stringify({ foo: 1 }))).toThrow(InvalidProjectError);
    const p = sample();
    const segId = Object.keys(p.network.segments)[0];
    p.network.segments[segId].b = 'missing';
    expect(() => parseProject(JSON.stringify(p))).toThrow(/接続情報/);
  });

  it('JSON書き出し→読み込みの往復', () => {
    const p = sample();
    expect(parseProject(JSON.stringify(p))).toEqual(p);
  });
});
