import { describe, expect, it } from 'vitest';
import { evaluate, type Reading } from './evaluate';
import { parseTruth, type Truth } from './truth';

const wall = (floor: number, x1: number, y1: number, x2: number, y2: number, thickness = 120) => ({ floor, a: { x: x1, y: y1 }, b: { x: x2, y: y2 }, thickness });
const reading = (r: Partial<Reading> = {}): Reading => ({ sheets: [], floors: [], walls: [], openings: [], fixtures: [], site: [], checks: [], ...r });
const truth = (t: Partial<Truth> = {}): Truth => parseTruth({ id: 't', kind: 'detached', ...t });

describe('正解データ（truth）', () => {
  it('数値だけの JSON を読む。種類は 戸建／アパート／マンション', () => {
    const t = parseTruth({ id: 'a1', kind: 'apartment', walls: [wall(1, 0, 0, 1000, 0)] });
    expect(t.kind).toBe('apartment');
    expect(t.walls).toHaveLength(1);
  });
  it('人の確認が無い正解は「未確認」として扱う', () => {
    expect(parseTruth({ id: 'a', kind: 'detached' }).confirmed).toBe(false);
    expect(parseTruth({ id: 'a', kind: 'detached', confirmedBy: '新垣', confirmedAt: '2026-11-13' }).confirmed).toBe(true);
  });
  it('種類が違う・数値でない値は読まない（分かる文で断る）', () => {
    expect(() => parseTruth({ id: 'a', kind: 'house' })).toThrow(/kind/);
    expect(() => parseTruth({ id: 'a', kind: 'detached', walls: [{ floor: 1, a: { x: 'x', y: 0 }, b: { x: 0, y: 0 }, thickness: 1 }] })).toThrow();
  });
});

describe('壁の比べ方', () => {
  it('同じ壁は再現率・適合率とも 100%、厚さの誤差 0', () => {
    const s = evaluate(reading({ walls: [wall(1, 0, 0, 5000, 0)] }), truth({ walls: [wall(1, 0, 0, 5000, 0)] }));
    expect(s.walls).toMatchObject({ recall: 1, precision: 1, thicknessError: 0 });
  });
  it('芯が 100mm 以内のずれは同じ壁。半分しか読めていなければ再現率 50%', () => {
    const s = evaluate(reading({ walls: [wall(1, 0, 80, 2500, 80, 150)] }), truth({ walls: [wall(1, 0, 0, 5000, 0)] }));
    expect(s.walls.recall).toBeCloseTo(0.5);
    expect(s.walls.precision).toBeCloseTo(1);
    expect(s.walls.thicknessError).toBe(30);
  });
  it('離れた壁・向きの違う壁・違う階の壁は一致にしない（余分な壁は適合率を下げる）', () => {
    const s = evaluate(
      reading({ walls: [wall(1, 0, 300, 5000, 300), wall(1, 0, 0, 0, 5000), wall(2, 0, 0, 5000, 0)] }),
      truth({ walls: [wall(1, 0, 0, 5000, 0)] }),
    );
    expect(s.walls.recall).toBe(0);
    expect(s.walls.precision).toBe(0);
  });
  it('a と b が逆向きでも同じ壁', () => {
    expect(evaluate(reading({ walls: [wall(1, 5000, 0, 0, 0)] }), truth({ walls: [wall(1, 0, 0, 5000, 0)] })).walls.recall).toBe(1);
  });
  it('正解に壁が無ければ壁は測らない（null）', () => {
    expect(evaluate(reading({ walls: [wall(1, 0, 0, 1000, 0)] }), truth()).walls.recall).toBeNull();
  });
});

describe('器具・配置図の比べ方', () => {
  it('種類ごとに 正解・読んだ数・一致・不足・余分 と位置の誤差（中央値・最大）', () => {
    const s = evaluate(
      reading({ fixtures: [{ floor: 1, type: 'toilet', x: 300, y: 400 }, { floor: 1, type: 'kitchen', x: 0, y: 0 }, { floor: 1, type: 'kitchen', x: 9000, y: 0 }] }),
      truth({ fixtures: [{ floor: 1, type: 'toilet', x: 0, y: 0 }, { floor: 1, type: 'kitchen', x: 100, y: 0 }, { floor: 1, type: 'washbasin', x: 0, y: 0 }] }),
    );
    expect(s.fixtures.byType.toilet).toMatchObject({ truth: 1, read: 1, matched: 1, missing: 0, extra: 0 });
    expect(s.fixtures.byType.kitchen).toMatchObject({ truth: 1, read: 2, matched: 1, extra: 1 });
    expect(s.fixtures.byType.washbasin).toMatchObject({ truth: 1, read: 0, missing: 1 });
    expect(s.fixtures.positionMedian).toBe(300);
    expect(s.fixtures.positionMax).toBe(500);
    expect(s.fixtures.recall).toBeCloseTo(2 / 3);
    expect(s.fixtures.precision).toBeCloseTo(2 / 3);
  });
  it('2,000mm より遠いものは別の器具（位置の誤差に入れない）', () => {
    const s = evaluate(reading({ fixtures: [{ floor: 1, type: 'toilet', x: 2500, y: 0 }] }), truth({ fixtures: [{ floor: 1, type: 'toilet', x: 0, y: 0 }] }));
    expect(s.fixtures.byType.toilet).toMatchObject({ matched: 0, missing: 1, extra: 1 });
    expect(s.fixtures.positionMedian).toBeNull();
  });
  it('配置図の公共ます・メーターも同じ比べ方', () => {
    const s = evaluate(reading({ site: [{ type: 'publicSewage', x: 0, y: 200 }] }), truth({ site: [{ type: 'publicSewage', x: 0, y: 0 }, { type: 'waterMeter', x: 0, y: 0 }] }));
    expect(s.site.byType.publicSewage.matched).toBe(1);
    expect(s.site.byType.waterMeter.missing).toBe(1);
  });
});

describe('図面・高さ・開口・要確認', () => {
  it('図面の種類と縮尺の正誤', () => {
    const s = evaluate(
      reading({ sheets: [{ name: '1F', kind: 'plan', scale: 100 }, { name: 'K', kind: 'other' }] }),
      truth({ sheets: [{ name: '1F', kind: 'plan', scale: 50 }, { name: 'K', kind: 'foundation', scale: 50 }] }),
    );
    expect(s.sheets).toMatchObject({ total: 2, kindCorrect: 1, scaleCorrect: 0, scaleTotal: 2 });
    expect(s.sheets.wrong).toEqual(['1F: 縮尺 1/100（正解 1/50）', 'K: 種類 other（正解 foundation）', 'K: 縮尺 読めず（正解 1/50）']);
  });
  it('階の数・階高・GL〜床の誤差(mm)', () => {
    const s = evaluate(reading({ floors: [{ n: 1, height: 2900 }], glToFl: 600 }), truth({ floors: [{ n: 1, height: 2970 }, { n: 2, height: 2800 }], glToFl: 611 }));
    expect(s.floors).toMatchObject({ truth: 2, read: 1, heightErrorMax: 70, glToFlError: 11 });
  });
  it('開口部は階ごとの数の差', () => {
    const s = evaluate(reading({ openings: [{ floor: 1, count: 12 }] }), truth({ openings: [{ floor: 1, count: 14 }] }));
    expect(s.openings).toEqual({ truth: 14, read: 12, diff: -2 });
  });
  it('要確認として出した数を数える', () => {
    expect(evaluate(reading({ checks: ['a', 'b'] }), truth()).checks).toBe(2);
  });
});
