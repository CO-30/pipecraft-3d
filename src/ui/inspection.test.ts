import { describe, expect, it } from 'vitest';
import { inspect, unconnectedPorts, MAX_LINES } from './inspection';
import { newDoc, port, put, route } from '../model/hydraulics/testSupply';
import { kawasakiLike } from '../model/hydraulics/testSupply';
import type { DrainIssue } from '../model/drainSolve';
import type { SupplyCalc } from '../model/hydraulics/calc';
import { calcSupply } from '../model/hydraulics/calc';
import { resolveSupplyRules } from '../model/hydraulics/supplyRules';
import { readSuiriSettings } from '../model/hydraulics/settings';
import { supplyHouse } from '../model/testSupplyHouse';
import { autoConnect } from '../model/autoConnect';
import { placeFixture } from '../model/fixtures';

const issue = (message: string, level: DrainIssue['level'] = 'error'): DrainIssue => ({ kind: 'minSlope', level, target: { kind: 'segment', id: 's' }, message, fixes: [] });
const fakeCalc = (over: Partial<SupplyCalc>): SupplyCalc => ({ ok: true, required: 20, available: 30, rows: [], unverified: [], ...over } as SupplyCalc);

describe('書類の状態に出す検査の結果', () => {
  it('何も無ければ空（書類は「出力できます」のまま）', () => {
    const { doc } = newDoc();
    expect(inspect(doc, [], null)).toEqual({ drain: [], supply: [] });
  });

  it('排水の注意（error・warn）は件数と中身を出す。お知らせ（info）は数えない', () => {
    const { doc } = newDoc();
    const r = inspect(doc, [issue('区間 A の勾配が 1/100 で、最小 2/100 に足りません'), issue('土かぶりが足りません', 'warn'), issue('規定は一般値です', 'info')], null);
    expect(r.drain[0]).toContain('注意が 2 件');
    expect(r.drain[0]).toContain('下の「排水の注意」から場所へ移動して直せます');
    expect(r.drain).toContain('区間 A の勾配が 1/100 で、最小 2/100 に足りません');
    expect(r.drain.join('|')).not.toContain('一般値');
    expect(r.supply).toEqual([]);
  });

  it('注意が多いときは「ほか N 件」にまとめる（同じ文は 1 つに）', () => {
    const { doc } = newDoc();
    const r = inspect(doc, ['a', 'b', 'c', 'd', 'e', 'e'].map((m) => issue(m)), null);
    expect(r.drain.length).toBe(1 + MAX_LINES);
    expect(r.drain.at(-1)).toBe('ほか 2 件');
  });

  it('水圧不足・流速超過は直し方と一緒に出す。計算できないときも理由を出す', () => {
    const { doc } = newDoc();
    const low = inspect(doc, [], fakeCalc({ ok: false, required: 35.5, available: 30 }));
    expect(low.supply[0]).toContain('水圧が足りません（必要 35.50m・使える 30.00m）');
    expect(low.supply[0]).toContain('水理計算書');
    expect(low.supply[0]).not.toContain('おすすめの口径に直せます');
    const fast = inspect(doc, [], fakeCalc({ ok: false, rows: [{ over: true }, { over: false }] as SupplyCalc['rows'] }));
    expect(fast.supply).toEqual([expect.stringContaining('流速が上限を超える区間が 1 か所')]);
    expect(inspect(doc, [], { error: 'メーターがありません' }).supply).toEqual(['給水の水理計算ができません（メーターがありません）']);
    expect(inspect(doc, [], fakeCalc({ ok: true })).supply).toEqual([]);
  });

  it('つなぎ忘れ: 器具の給水・給湯・排水の口を数える。ヘッダーの出口・メーターの入口・既設・ガスは数えない', () => {
    let { doc, floorId } = newDoc();
    let t = put(doc, floorId, 'toilet', 0, 0); doc = t.doc; const toilet = t.id;
    t = put(doc, floorId, 'waterHeader', 2000, 0); doc = t.doc;
    t = put(doc, floorId, 'waterMeter', -3000, 0); doc = t.doc; const meter = t.id;
    t = put(doc, floorId, 'washbasin', 4000, 0, ); doc = { ...t.doc, fixtures: { ...t.doc.fixtures, [t.id]: { ...t.doc.fixtures[t.id], params: { existing: true } } } };
    // トイレの給水だけつなぐ
    const r = route(doc.network, port(doc.network, toilet, 'water').id, { x: 0, y: -1000, z: 0 }, 13);
    doc = { ...doc, network: r.net };
    const open = unconnectedPorts(doc).map((x) => `${x.label}:${x.port}`).sort();
    expect(open).toEqual(['トイレ:汚水', '水道メーター:出口', '給水ヘッダー:入口'].sort());
    void meter;
    const res = inspect(doc, [], null);
    expect(res.drain).toEqual(['排水がつながっていない器具・マスが 1 か所あります: トイレの汚水']);
    expect(res.supply[0]).toBe('給水・給湯がつながっていない器具が 2 か所あります: 給水ヘッダーの入口・水道メーターの出口');
  });

  it('計算例の現場（給水はつないで給湯は未接続）: 給湯の口だけを挙げ、給水の口は挙げない', () => {
    const { doc } = kawasakiLike();
    const c = calcSupply(doc, resolveSupplyRules({}), readSuiriSettings(doc.site?.application));
    const r = inspect(doc, [], c);
    expect(r.supply[0]).toBe('給水・給湯がつながっていない器具が 3 か所あります: キッチンの給湯・洗面台の給湯・給湯器の給湯');
    expect(r.supply.join('|')).not.toContain('の給水');
  });

  it('「自動でつなぐ」を押した家（ヘッダーあり・なし）では、つなぎ忘れを出さない（普段の工事で余計な注意を出さない）', () => {
    for (const header of [false, true]) {
      const h = supplyHouse({ header });
      const p = placeFixture(h.doc, h.floorId, 'publicSewage', { x: -3000, y: 1000 }, 0, { invertZ: -1300 });
      const r = autoConnect(p.doc);
      expect(unconnectedPorts(r.doc).map((x) => `${x.label}:${x.port}`)).toEqual([]);
    }
  });

  it('設計水圧が未確認（一般値）のときは、計算が合っていても確認を促す', () => {
    const { doc } = newDoc();
    const r = inspect(doc, [], fakeCalc({ ok: true, unverified: ['設計水圧 0.2MPa（一般値）'] }));
    expect(r.supply).toEqual([expect.stringContaining('設計水圧 0.2MPa（一般値）が未確認です')]);
  });
});
