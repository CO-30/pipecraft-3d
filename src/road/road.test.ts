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

import { roadChecklist, roadLayers, roadTakeoffs, roadWarnings, schedule, workPeriod } from './model';

const base = { 'road.roadKind': '町道', 'road.water': 'する', 'road.sewer': 'しない', 'road.waterMainAt': '3.0', 'road.digWidth': '0.6', 'road.restoreMargin': '0', 'road.waterPipe': 'HIVP', 'road.waterPipeDia': '20', 'road.waterDepth': '0.6', 'road.roadWidth': '6', 'road.start': '2026-12-01', 'road.pavement': 'アスファルト' };

describe('道路の手続き: 数量・チェックリスト', () => {
  test('道路内の長さ・掘削面積・復旧面積（mm・mm²）', () => {
    const [t] = roadTakeoffs(base);
    expect(t.kind).toBe('water');
    expect(t.length).toBe(3000);
    expect(t.width).toBe(600);
    expect(t.digArea).toBe(1.8e6);
    expect(t.restoreArea).toBe(1.8e6);
    expect(t.depth).toBe(600);
    const [m] = roadTakeoffs({ ...base, 'road.restoreMargin': '0.1' });
    expect(m.restoreArea).toBe(3200 * 800);
  });

  test('下水もするなら 2 件、どちらもしないなら 0 件', () => {
    expect(roadTakeoffs({ ...base, 'road.sewer': 'する', 'road.sewerMainAt': '2', 'road.sewerPipeDia': '150' }).map((t) => t.kind)).toEqual(['water', 'sewer']);
    expect(roadTakeoffs({ ...base, 'road.water': 'しない' })).toEqual([]);
  });

  test('どちらもしない → 「道路の手続きは要りません」だけ', () => {
    const c = roadChecklist({ ...base, 'road.water': 'しない' }, '2026-11-16');
    expect(c).toHaveLength(1);
    expect(c[0].label).toContain('要りません');
  });

  test('町道: 占用・使用許可・着手届・完了届。期限の目安と遅れ', () => {
    const c = roadChecklist(base, '2026-11-16');
    const occ = c.find((x) => x.label.includes('道路占用許可'))!;
    expect(occ.app).toBe(true);
    expect(occ.due).toBe('2026-11-10');
    expect(occ.late).toBe(true);
    const use = c.find((x) => x.label.includes('道路使用許可'))!;
    expect(use.due).toBe('2026-11-24');
    expect(use.late).toBe(false);
    expect(c.some((x) => x.label.includes('着手届'))).toBe(true);
    expect(c.some((x) => x.label.includes('完了届'))).toBe(true);
    expect(c.some((x) => x.label.includes('道路工事施行承認'))).toBe(false);
  });

  test('私道 → 所有者の承諾。占用許可は要らない', () => {
    const c = roadChecklist({ ...base, 'road.roadKind': '私道' }, '2026-11-16');
    expect(c.some((x) => x.label.includes('承諾'))).toBe(true);
    expect(c.some((x) => x.label.includes('道路占用許可'))).toBe(false);
  });

  test('側溝や縁石を壊す → 道路工事施行承認', () => {
    expect(roadChecklist({ ...base, 'road.curb': 'はい' }, '2026-11-16').some((x) => x.label.includes('道路工事施行承認'))).toBe(true);
  });

  test('注意: 本管の位置が道路の幅より遠い・着工日が無い', () => {
    expect(roadWarnings({ ...base, 'road.waterMainAt': '8' }).join()).toContain('道路の幅');
    expect(roadWarnings({ ...base, 'road.start': '' }).join()).toContain('着工日');
    expect(roadWarnings(base)).toEqual([]);
  });

  test('舗装の層: 既定と手入力の上書き', () => {
    expect(roadLayers(base, 'final').map((l) => l.t)).toEqual([50, 150, 200]);
    expect(roadLayers({ ...base, 'road.layersFinal': '表層 密粒As 40\n路盤 RC-40 250' }, 'final')).toEqual([{ name: '表層 密粒As', t: 40 }, { name: '路盤 RC-40', t: 250 }]);
  });

  test('工程: 着工日から作業ごとの日付、工期', () => {
    const s = schedule({ ...base, 'road.days.prep': '1', 'road.days.dig': '1', 'road.days.branch': '1', 'road.days.backfill': '1', 'road.days.temp': '1', 'road.days.final': '2' });
    expect(s[0]).toMatchObject({ from: '2026-12-01', to: '2026-12-01' });
    expect(s.at(-1)).toMatchObject({ from: '2026-12-06', to: '2026-12-07' });
    expect(workPeriod({ ...base, 'road.days.prep': '1', 'road.days.dig': '1', 'road.days.branch': '1', 'road.days.backfill': '1', 'road.days.temp': '1', 'road.days.final': '2' })).toEqual({ from: '2026-12-01', to: '2026-12-07', days: 7 });
    expect(workPeriod({ ...base, 'road.end': '2026-12-20' }).to).toBe('2026-12-20');
  });
});

import { renderNoticeForms, renderOccupancyForm, renderTakeoffTable, renderUseForm } from './formSheets';
import type { Sheet } from '../export/sheet';
import { findTextOverlaps } from '../export/labelLayout';
import { textRects } from '../export/labelLayout';

const texts = (s: Sheet) => s.ops.filter((o) => o.t === 'text').map((o) => (o as { s: string }).s).join('\n');
/** 文字が用紙の内側（余白 5mm）に収まっているか */
export const outside = (s: Sheet) => s.ops.filter((o) => o.t === 'text').flatMap((o) => textRects(o as never)).filter((r) => r.x1 < 5 || r.y1 < 5 || r.x2 > s.width - 5 || r.y2 > s.height - 5);
const rm = { siteName: 'A邸新築工事', address: '沖縄県島尻郡与那原町字与那原1番地', date: new Date(2026, 10, 16) };
const full = { ...base, 'road.sewer': 'する', 'road.sewerMainAt': '2.5', 'road.sewerPipe': 'VU', 'road.sewerPipeDia': '150', 'road.sewerDepth': '1.2', 'road.routeName': '町道与那原1号線', 'road.roadAdmin': '与那原町長', 'road.police': '与那原警察署長', 'road.applicantName': '(株)テスト設備', 'road.applicantAddress': '沖縄県那覇市1-1', 'road.applicantRep': '代表取締役 水道 太郎', 'road.applicantTel': '098-000-0000', 'road.siteManager': '水道 次郎', 'road.siteManagerTel': '090-0000-0000', 'road.place': '与那原町字与那原1番地先', 'road.period': '許可の日から10年', 'road.traffic': '片側交互通行', 'road.guards': '2', 'road.hours': '9:00〜17:00' };

describe('道路の手続き: 申請書・届・内訳調書', () => {
  const sheets = () => [renderOccupancyForm(full, roadTakeoffs(full), rm), renderUseForm(full, rm), ...renderNoticeForms(full, rm), renderTakeoffTable(roadTakeoffs(full), full, rm)];
  test('見出しと値が入る', () => {
    const [occ, use, start, done, table] = sheets();
    expect(texts(occ)).toContain('道路占用許可申請書');
    expect(texts(occ)).toContain('町道与那原1号線');
    expect(texts(occ)).toContain('与那原町長');
    expect(texts(occ)).toContain('給水管');
    expect(texts(use)).toContain('道路使用許可申請書');
    expect(texts(use)).toContain('与那原警察署長');
    expect(texts(use)).toContain('水道 次郎');
    expect(texts(start)).toContain('工事着手届');
    expect(texts(done)).toContain('工事完了届');
    expect(texts(table)).toContain('占用内訳調書');
    expect(texts(table)).toContain('3.00');
  });
  test('A4 縦・文字の重なり 0・用紙からはみ出さない（長い名前でも）', () => {
    const long = { ...full, 'road.routeName': '町道与那原東西線（与那原町字与那原から字板良敷まで）第二工区南側車道部分', 'road.applicantAddress': '沖縄県島尻郡与那原町字与那原三千八百九十番地の二 与那原ビルディング三階三〇一号室' };
    for (const s of [renderOccupancyForm(long, roadTakeoffs(long), rm), renderUseForm(long, rm), ...renderNoticeForms(long, rm), renderTakeoffTable(roadTakeoffs(long), long, rm), ...sheets()]) {
      expect([s.width, s.height]).toEqual([210, 297]);
      expect(findTextOverlaps(s)).toEqual([]);
      expect(outside(s)).toEqual([]);
    }
  });
  test('何も入力していなくても描ける', () => {
    expect(() => [renderOccupancyForm({}, [], rm), renderUseForm({}, rm), ...renderNoticeForms({}, rm), renderTakeoffTable([], {}, rm)]).not.toThrow();
  });
});

import { renderRoadPlan, renderRoadSection, renderSchedule, renderTrafficPlan, roadSheets } from './drawSheets';

describe('道路の手続き: 図面', () => {
  const tk = roadTakeoffs(full);
  test('平面図: 寸法と数量の表', () => {
    const s = renderRoadPlan(full, tk, rm);
    expect([s.width, s.height]).toEqual([297, 210]);
    const t = texts(s);
    expect(t).toContain('占用平面図');
    expect(t).toContain('官民境界');
    expect(t).toContain('3.00');
    expect(t).toContain('2.50');
    expect(t).toContain('1.80');
  });
  test('横断図・復旧断面図: 層の名前と深さ', () => {
    const t = texts(renderRoadSection(full, tk, rm));
    expect(t).toContain('表層 アスファルト');
    expect(t).toContain('仮舗装 常温合材');
    expect(t).toContain('0.60');
  });
  test('交通規制図: 誘導員の数と規制の種類', () => {
    const count = (s: Sheet) => s.ops.filter((o) => o.t === 'text' && (o as { s: string }).s === '誘導員').length;
    expect(count(renderTrafficPlan({ ...full, 'road.guards': '3' }, rm))).toBe(3);
    expect(texts(renderTrafficPlan({ ...full, 'road.traffic': '通行止め' }, rm))).toContain('通行止');
    expect(texts(renderTrafficPlan({ ...full, 'road.traffic': '路肩規制' }, rm))).toContain('路肩規制');
  });
  test('工程表: 作業ごとの棒', () => {
    const s = renderSchedule(full, rm);
    expect(texts(s)).toContain('工程表');
    expect(texts(s)).toContain('本復旧');
    expect(s.ops.filter((o) => o.t === 'rect' && (o as { fill?: string }).fill === '#d91e18').length).toBe(6);
  });
  test('一式は 9 枚（位置図は呼ぶ側で入れる）。どの組み合わせでも重なり 0・はみ出し 0', () => {
    for (const traffic of ['片側交互通行', '路肩規制', '通行止め']) for (const [w, sw] of [['する', 'する'], ['する', 'しない'], ['しない', 'する']]) for (const g of ['0.5', '0', '']) {
      const v = { ...full, 'road.traffic': traffic, 'road.water': w, 'road.sewer': sw, 'road.gap': g };
      const all = roadSheets(v, rm);
      expect(all).toHaveLength(9);
      for (const s of all) { expect(findTextOverlaps(s)).toEqual([]); expect(outside(s)).toEqual([]); }
    }
  });
  test('何も入力していなくても描ける', () => {
    for (const s of roadSheets({}, rm)) { expect(findTextOverlaps(s)).toEqual([]); expect(outside(s)).toEqual([]); }
  });
});

import { wrap } from './draw';
test('折り返しは英数字の続きを途中で切らない', () => {
  const src = '本復旧: 下層路盤 再生砕石 200mm、HIVP φ20';
  for (let w = 20; w <= 80; w += 0.5) {
    const lines = wrap(src, 3.2, w, 9);
    expect(lines.join('')).toBe(src);
    for (let i = 1; i < lines.length; i++) expect(/[A-Za-z0-9.]$/.test(lines[i - 1]) && /^[A-Za-z0-9.]/.test(lines[i])).toBe(false);
  }
});
