import { describe, expect, test } from 'vitest';
import { addFloor, emptyBuilding } from '../model/building';
import type { Doc } from '../model/doc';
import { addPolyline, emptyNetwork } from '../model/network';
import { placeFixture } from '../model/fixtures';
import { EMPTY_CONTRACTOR } from '../forms/types';
import { num, roadDefaults, roadValues, ROAD_FIELDS } from './fields';

const C = { ...EMPTY_CONTRACTOR, name: '(株)テスト設備', chiefEngineer: '水道 次郎', chiefEngineerTel: '090-0000-0000' };

/** メーター（入口に 20mm の管）と公共汚水マスがある現場 */
export function siteDoc(withSewer = true): Doc {
  let doc: Doc = { building: addFloor(emptyBuilding(), { height: 3000 }).b, network: emptyNetwork(), fixtures: {}, site: { designGL: 0 } };
  const f = doc.building.floors[0].id;
  const r = placeFixture(doc, f, 'waterMeter', { x: 1000, y: 0 });
  doc = r.doc;
  const inPort = Object.values(doc.network.nodes).find((n) => n.fixtureId === r.fixtureId && n.portId === 'in')!;
  const pl = addPolyline(doc.network, [{ x: 0, y: 0, z: inPort.pos.z }, inPort.pos], { system: 'water', diameter: 20, material: 'HIVP' }, { endNodeId: inPort.id });
  doc = { ...doc, network: pl.net };
  if (withSewer) doc = placeFixture(doc, f, 'publicSewage', { x: 4000, y: 0 }).doc;
  return doc;
}

describe('道路の手続き: 項目と既定値', () => {
  test('num は全角・単位付きでも数として読む', () => {
    expect(num('１．５')).toBe(1.5);
    expect(num('1.5m')).toBe(1.5);
    expect(num(' 3 ')).toBe(3);
    expect(num('')).toBeUndefined();
    expect(num(undefined)).toBeUndefined();
    expect(num('あ')).toBeUndefined();
  });

  test('項目はすべて road. で始まり、id が重ならない', () => {
    const ids = ROAD_FIELDS.map((f) => f.id);
    expect(ids.every((i) => i.startsWith('road.'))).toBe(true);
    expect(new Set(ids).size).toBe(ids.length);
  });

  test('引込管の口径はメーター入口の管から、申請者は工事店（会社）から', () => {
    const d = roadDefaults(siteDoc(), { name: 'A邸', address: '沖縄県島尻郡与那原町字与那原1' }, C, {});
    expect(d['road.waterPipeDia']).toBe('20');
    expect(d['road.waterPipe']).toBe('HIVP');
    expect(d['road.applicantName']).toBe('(株)テスト設備');
    expect(d['road.siteManager']).toBe('水道 次郎');
    expect(d['road.water']).toBe('する');
    expect(d['road.sewer']).toBe('する');
    expect(d['road.digWidth']).toBe('0.6');
    expect(d['road.traffic']).toBe('片側交互通行');
  });

  test('公共汚水マスが無ければ下水の取付管は「しない」', () => {
    expect(roadDefaults(siteDoc(false), { name: 'A邸' }, C, {})['road.sewer']).toBe('しない');
  });

  test('提出先は住所の市町村で覚えた値が入る', () => {
    const offices = { 与那原町: { roadAdmin: '与那原町長', police: '与那原警察署長' } };
    const d = roadDefaults(siteDoc(), { name: 'A邸', address: '沖縄県島尻郡与那原町字与那原1' }, C, offices);
    expect(d['road.roadAdmin']).toBe('与那原町長');
    expect(d['road.police']).toBe('与那原警察署長');
  });

  test('入力済みの値は空でも既定値に戻らない', () => {
    const doc = { ...siteDoc(), site: { designGL: 0, application: { 'road.roadAdmin': '', 'road.routeName': '町道1号線' } } };
    const v = roadValues(doc, { name: 'A邸', address: '与那原町' }, C, { 与那原町: { roadAdmin: '与那原町長' } });
    expect(v['road.roadAdmin']).toBe('');
    expect(v['road.routeName']).toBe('町道1号線');
  });
});
