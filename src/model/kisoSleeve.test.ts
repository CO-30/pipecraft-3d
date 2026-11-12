import { describe, expect, test } from 'vitest';
import { kisoSleeveItems, pickKsa, pickKss } from './kisoSleeve';
import { addPolyline } from './network';
import { supplyHouse } from './testSupplyHouse';
import type { Doc } from './doc';

describe('基礎貫通スリーブの品番', () => {
  test('排水: 口径と立ち下げの高さに一番近い KSA（標準 45°・深基礎 90°）', () => {
    expect(pickKsa(75, 240)?.code).toBe('KSA75N×230H');
    expect(pickKsa(75, 270)?.code).toBe('KSA75N×280H');
    expect(pickKsa(75, 420)?.code).toBe('KSA75NF×430H');
    expect(pickKsa(100, 350)?.code).toBe('KSA100×333H');
    expect(pickKsa(100, 600)?.code).toBe('KSA100F×680H');
    expect(pickKsa(50, 230, true)?.code).toBe('KSA-B50N×230H');
    expect(pickKsa(150, 300)).toBeNull();
  });
  test('給水: 管の外径で 50/75、深い所は 90L、防蟻品', () => {
    expect(pickKss(22, 250)?.code).toBe('KSS45L50×230H');
    expect(pickKss(22, 400)?.code).toBe('KSS90L50×430H');
    expect(pickKss(60, 250)?.code).toBe('KSS45L75×280H');
    expect(pickKss(22, 250, true)?.code).toBe('KSS45L-B50×230H');
  });
});

describe('積算に入れる基礎貫通スリーブ', () => {
  /** 南の外周の基礎（y=0）の内側で立ち下げ、地中で基礎を抜けて外へ */
  function withExit(dia: number, drop: number, system: 'sewage' | 'water' = 'sewage'): Doc {
    const h = supplyHouse();
    const z = -450;
    const net = addPolyline(h.doc.network, [{ x: 2000, y: 1500, z }, { x: 2000, y: 55, z }, { x: 2000, y: 55, z: z - drop }, { x: 2000, y: -700, z: z - drop - 15 }], { system, diameter: dia }).net;
    return { ...h.doc, network: net };
  }
  test('外周の基礎を地中で抜ける排水は KSA 1 セット（スリーブ表の番号つき）', () => {
    const r = kisoSleeveItems(withExit(75, 425));
    const k = r.items.find((i) => i.key.startsWith('kiso|KSA'));
    expect(k?.spec).toBe('KSA75NF×430H');
    expect(k?.count).toBe(1);
    expect(k?.price).toBe(21600);
    expect(r.checks).toHaveLength(0);
  });
  test('品番の高さと大きく違えば要確認', () => {
    const r = kisoSleeveItems(withExit(100, 480));
    expect(r.items[0].spec).toBe('KSA100×333H');
    expect(r.checks[0].message).toContain('H333');
  });
  test('給水は KSS、防蟻の設定で -B', () => {
    const r = kisoSleeveItems(withExit(20, 250, 'water'), { antiTermite: true });
    expect(r.items[0].spec).toBe('KSS45L-B50×230H');
  });
  test('床下の高さで内部の立上りを横切る所は VU 管のスリーブ（定尺の本数）', () => {
    const h = supplyHouse();
    // x=4000 の内部の立上り（z -700〜-150）を z=-300 で横切る
    const net = addPolyline(h.doc.network, [{ x: 3000, y: 1000, z: -300 }, { x: 5000, y: 1000, z: -300 }], { system: 'water', diameter: 20 }).net;
    const r = kisoSleeveItems({ ...h.doc, network: net });
    const v = r.items.find((i) => i.key.startsWith('kiso|vu|'));
    expect(v?.count).toBe(1);
    expect(v?.unit).toBe('本');
  });
});
