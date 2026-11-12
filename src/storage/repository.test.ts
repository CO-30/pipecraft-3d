import { defaultEstimate } from '../model/estimate';
import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { DexieProjectRepository, InvalidProjectError, parseProject } from './repository';
import { addPolyline, branchFromSegment, emptyNetwork } from '../model/network';
import { createBuildingFromDims } from '../model/building';
import { SCHEMA_VERSION, type ProjectData } from '../model/schema';
import { duplicateProfile, STANDARD_PROFILE } from '../model/municipality';

function sample(): ProjectData {
  const a = addPolyline(emptyNetwork(), [{ x: 0, y: 0, z: 0 }, { x: 4000, y: 0, z: 0 }], { system: 'water', diameter: 20 });
  const b = branchFromSegment(a.net, a.segmentIds[0], { x: 2000, y: 0, z: 0 }, [{ x: 2000, y: 1500, z: 0 }]);
  const building = createBuildingFromDims({ width: 8000, depth: 6000, floors: 2, floorHeight: 2900, wallThickness: 150, slabThickness: 200 });
  return { schemaVersion: SCHEMA_VERSION, id: 'p1', name: 'テスト現場', address: '那覇市', createdAt: 1, updatedAt: 2, building, network: b.net, fixtures: {}, estimate: defaultEstimate(), underlays: {} };
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

  it('端末設定（工事店情報）は settings に保存され、現場の書き出し・バックアップには入らない。v2 の DB を v3 で開いても現場は残る', async () => {
    const name = nextName();
    // v2 相当の DB（projects・profiles のみ）を先に作る
    const Dexie = (await import('dexie')).default;
    const old = new Dexie(name);
    old.version(2).stores({ projects: 'id, updatedAt, name', profiles: 'id, name' });
    const p = sample();
    await old.table('projects').put({ id: p.id, name: p.name, address: p.address, createdAt: p.createdAt, updatedAt: p.updatedAt, json: JSON.stringify(p) });
    old.close();
    const r = new DexieProjectRepository(name);
    expect(await r.load('p1')).toEqual(p);
    expect(await r.getSetting('contractor')).toBeUndefined();
    await r.setSetting('contractor', { name: 'テスト設備', tel: '098' });
    expect(await r.getSetting<{ name: string }>('contractor')).toEqual({ name: 'テスト設備', tel: '098' });
    const all = await r.exportAll();
    expect(all.json).not.toContain('テスト設備');
    expect(JSON.stringify(await r.load('p1'))).not.toContain('テスト設備');
    r.close();
  });
  it('申請書の入力（site.application）は往復で保持され、無い旧データも読める', () => {
    const p = { ...sample(), site: { designGL: -100, application: { applicantName: '水道 太郎', diameter: '20' } } };
    const back = parseProject(JSON.stringify(p));
    expect(back.site?.application).toEqual({ applicantName: '水道 太郎', diameter: '20' });
    const noApp = parseProject(JSON.stringify({ ...sample(), site: { designGL: -100 } }));
    expect(noApp.site?.application).toBeUndefined();
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

  it('v3 は積算設定の初期値を入れて v4 に変換、部品の確定・単価は往復で保持', () => {
    const p = sample();
    const { estimate: _e, underlays: _u, ...rest } = p;
    const r = parseProject(JSON.stringify({ ...rest, schemaVersion: 3 }));
    expect(r.schemaVersion).toBe(SCHEMA_VERSION);
    expect(r.estimate).toEqual(defaultEstimate());
    expect(r.underlays).toEqual({});
    const r4 = parseProject(JSON.stringify({ ...rest, estimate: p.estimate, schemaVersion: 4 }));
    expect(r4.underlays).toEqual({});
    const nid = Object.keys(p.network.nodes)[0];
    const q = structuredClone(p);
    q.network.nodes[nid].fitting = { type: 'elbow45', degree: 1 };
    q.estimate.prices['pipe|water||20'] = { material: 1200, labor: 400, saleUnit: { kind: 'roll', length: 50000 } };
    q.estimate.extras.push({ id: 'x1', name: '試験', quantity: 1, unit: '式', unitPrice: 5000 });
    expect(parseProject(JSON.stringify(q))).toEqual(q);
  });

  it('下敷き: 画像の data URL のみ・存在する階のみ受け付ける', () => {
    const p = sample();
    const u = { id: 'u1', floorId: p.building.floors[0].id, kind: 'image', label: '図面', src: 'data:image/jpeg;base64,AAAA', widthPx: 10, heightPx: 10, center: { x: 0, y: 0 }, mmPerPx: 10, rotation: 0, opacity: 0.5, scaled: false };
    expect(parseProject(JSON.stringify({ ...p, underlays: { u1: u } })).underlays.u1).toEqual(u);
    expect(() => parseProject(JSON.stringify({ ...p, underlays: { u1: { ...u, src: 'data:image/svg+xml;base64,AAAA' } } }))).toThrow(InvalidProjectError);
    expect(() => parseProject(JSON.stringify({ ...p, underlays: { u1: { ...u, floorId: 'nope' } } }))).toThrow(/下敷き/);
  });

  it('全現場の一括バックアップ → 読み込みで全件が新しいIDで追加。壊れた1件は数えて飛ばす', async () => {
    const r = new DexieProjectRepository(nextName());
    const a = sample(), b = { ...sample(), id: 'p2', name: '二件目' };
    await r.save(a); await r.save(b);
    const { json, skipped } = await r.exportAll();
    expect(skipped).toEqual([]);
    const r2 = new DexieProjectRepository(nextName());
    const res = await r2.importAny(json);
    expect(res.imported.map((p) => p.name).sort()).toEqual(['テスト現場', '二件目']);
    expect(res.imported.every((p) => p.id !== 'p1' && p.id !== 'p2')).toBe(true);
    const bad = JSON.parse(json);
    bad.projects[0].network.segments[Object.keys(bad.projects[0].network.segments)[0]].b = 'missing';
    const res2 = await r2.importAny(JSON.stringify(bad));
    expect([res2.imported.length, res2.failed]).toEqual([1, 1]);
    // 1現場のファイルもそのまま読める
    expect((await r2.importAny(JSON.stringify(a))).imported).toHaveLength(1);
  });

  it('本体が壊れていたら直前の版から復旧し、recovered で知らせる', async () => {
    const r = new DexieProjectRepository(nextName());
    const p = sample();
    await r.save(p);
    await r.save({ ...p, updatedAt: 5 });
    await r._corrupt('p1', '{broken');
    const got = await r.loadWithStatus('p1');
    expect(got?.recovered).toBe(true);
    expect(got?.project.updatedAt).toBe(2);
    expect((await r.loadWithStatus('p1'))!.project.id).toBe('p1');
  });

  it('積算設定の不正値（負の単価・税率>1）は拒否', () => {
    const q = structuredClone(sample());
    q.estimate.prices.k = { material: -1, labor: 0 };
    expect(() => parseProject(JSON.stringify(q))).toThrow(InvalidProjectError);
    const t = structuredClone(sample());
    t.estimate.taxRate = 1.5;
    expect(() => parseProject(JSON.stringify(t))).toThrow(InvalidProjectError);
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

describe('自治体プロファイルの保存', () => {
  it('saveProfile → listProfiles に出る。同梱 id は保存できない', async () => {
    const r = new DexieProjectRepository(nextName());
    const d = duplicateProfile(STANDARD_PROFILE, '那覇市（仮）');
    await r.saveProfile(d);
    expect(await r.listProfiles()).toEqual([d]);
    await expect(r.saveProfile({ ...STANDARD_PROFILE, name: '上書き' })).rejects.toBeInstanceOf(InvalidProjectError);
    await r.deleteProfile(d.id);
    expect(await r.listProfiles()).toEqual([]);
  });
  it('exportJson にユーザープロファイルが同梱され、importJson で未保存なら保存・保存済みなら上書きしない', async () => {
    const r1 = new DexieProjectRepository(nextName());
    const d = duplicateProfile(STANDARD_PROFILE, '豊見城市（仮）');
    await r1.saveProfile(d);
    await r1.save({ ...sample(), site: { municipalityProfileId: d.id } });
    const json = await r1.exportJson('p1');
    expect(JSON.parse(json).bundledProfile?.id).toBe(d.id);
    // standard を使う現場には同梱しない
    await r1.save({ ...sample(), id: 'p2', site: { municipalityProfileId: 'standard' } });
    expect(JSON.parse(await r1.exportJson('p2')).bundledProfile).toBeUndefined();

    const r2 = new DexieProjectRepository(nextName());
    const imported = await r2.importJson(json);
    expect((await r2.listProfiles()).map((p) => p.id)).toEqual([d.id]);
    expect((imported as { bundledProfile?: unknown }).bundledProfile).toBeUndefined();
    expect(JSON.parse(await r2.exportJson(imported.id)).site.municipalityProfileId).toBe(d.id);
    // 保存済みの同じ id は上書きしない
    const edited = { ...d, name: '編集済み' };
    await r2.saveProfile(edited);
    await r2.importJson(json);
    expect((await r2.listProfiles())[0].name).toBe('編集済み');
  });
});

describe('全現場バックアップとプロファイル', () => {
  it('exportAll にユーザープロファイルが入り、importAny で未保存分だけ保存される', async () => {
    const r1 = new DexieProjectRepository(nextName());
    const d = duplicateProfile(STANDARD_PROFILE, '沖縄市（仮）');
    await r1.saveProfile(d);
    await r1.save({ ...sample(), site: { municipalityProfileId: d.id } });
    const { json } = await r1.exportAll();
    expect(JSON.parse(json).profiles?.map((p: { id: string }) => p.id)).toEqual([d.id]);
    const r2 = new DexieProjectRepository(nextName());
    await r2.saveProfile({ ...d, name: '先に保存済み' });
    const res = await r2.importAny(json);
    expect(res.imported).toHaveLength(1);
    expect((await r2.listProfiles())[0].name).toBe('先に保存済み');
    const r3 = new DexieProjectRepository(nextName());
    await r3.importAny(json);
    expect((await r3.listProfiles()).map((p) => p.name)).toEqual(['沖縄市（仮）']);
  });
  it('壊れたプロファイル行があっても他は読める', async () => {
    const r = new DexieProjectRepository(nextName());
    const d = duplicateProfile(STANDARD_PROFILE, '正常');
    await r.saveProfile(d);
    await r._corruptProfile('broken', '{not json');
    expect((await r.listProfiles()).map((p) => p.name)).toEqual(['正常']);
  });
});

describe('版（保存した時点）', () => {
  it('残す・一覧（新しい順）・読み込む・消す。工事を消すと版も消える', async () => {
    const r = new DexieProjectRepository(nextName());
    const p = sample();
    await r.save(p);
    const v1 = await r.saveVersion(p, '申請提出', 100);
    await r.saveVersion({ ...p, name: '変更後' }, '施主確認', 200);
    const list = await r.listVersions('p1');
    expect(list.map((x) => x.name)).toEqual(['施主確認', '申請提出']);
    expect(list[0]).toMatchObject({ projectId: 'p1', createdAt: 200 });
    expect((await r.loadVersion(v1.id))?.network).toEqual(p.network);
    await r.deleteVersion(v1.id);
    expect(await r.listVersions('p1')).toHaveLength(1);
    await r.delete('p1');
    expect(await r.listVersions('p1')).toHaveLength(0);
  });

  it('工事ごとに 20 版まで。あふれたら古いものから消し、消した数を返す', async () => {
    const r = new DexieProjectRepository(nextName());
    const p = sample();
    for (let i = 0; i < 20; i++) await r.saveVersion(p, `v${i}`, i);
    const res = await r.saveVersion(p, 'v20', 20);
    expect(res.dropped).toBe(1);
    const list = await r.listVersions('p1');
    expect(list).toHaveLength(20);
    expect(list.at(-1)!.name).toBe('v1');
  });

  it('壊れたデータは版にしない', async () => {
    const r = new DexieProjectRepository(nextName());
    await expect(r.saveVersion({ ...sample(), network: { nodes: {}, segments: { s: { id: 's', a: 'x', b: 'y', system: 'water', diameter: 20 } } } } as never, 'x', 1)).rejects.toThrow(InvalidProjectError);
  });
});
