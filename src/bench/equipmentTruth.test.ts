import { describe, expect, it } from 'vitest';
import type { PText, VectorPage } from '../model/planRead/sheet';
import { quantitiesFromSheets } from './equipmentTruth';

const page = (labels: string[]): VectorPage => ({ widthPt: 800, heightPt: 600, segs: [], texts: labels.map((s, i): PText => ({ x: i * 60, y: 10, h: 4, s })) });

describe('設備図（申請図）の表示を数量の正解にする', () => {
  it('同じ配管を平面図と立面図の両方に書くので、管種・口径ごとに多い方を採る（足さない）。設備図でない図面は見ない', () => {
    const q = quantitiesFromSheets([
      { name: '給水平面図', page: page(['PB13×7.1', 'PB13×5.0', 'HI20×2.6', '止水栓20mm']) },
      { name: '給水立面図', page: page(['PB13×7.1', 'HI20×2.6', 'PE20×4.3', '止水栓20mm']) },
      { name: '平面詳細図', page: page(['VU100', 'トイレ']) },
    ]);
    expect(q).toEqual([
      { name: 'PB', spec: 'φ13', unit: 'm', qty: 12.1 },
      { name: 'HI', spec: 'φ20', unit: 'm', qty: 2.6 },
      { name: '止水栓', spec: 'φ20', unit: '個', qty: 1 },
      { name: 'PE', spec: 'φ20', unit: 'm', qty: 4.3 },
    ]);
  });
  it('平面図どうし（1 階と 2 階、給水と排水）は足す。平面図の合計と立面図の合計の多い方', () => {
    const q = quantitiesFromSheets([
      { name: '1階給水平面図', page: page(['PB13×7.0', 'PB13×1.0', 'PB13×2.0']) },
      { name: '2階給水平面図', page: page(['PB13×5.0', 'PB13×1.0', 'PB13×1.0']) },
      { name: '給水立面図', page: page(['PB13×12.1', 'PB13×1.0', 'PB13×1.0']) },
    ]);
    expect(q).toEqual([{ name: 'PB', spec: 'φ13', unit: 'm', qty: 17 }]);
  });
  it('設備図が無ければ空', () => {
    expect(quantitiesFromSheets([{ name: 'a', page: page(['トイレ']) }])).toEqual([]);
  });
});
