/**
 * テスト用の家（給水・給湯を床下でつなぐ案）。8000×6000・壁厚 150・平屋、設計 GL は床の 611 下。
 * 外周の立上り、x=4000 の内部の立上り（y 2500〜3100 は人通口）。メーターは西の外、給湯器は南の外壁ぎわ。
 * キッチン（東の部屋）・洗面台とトイレ（西の部屋）。
 */
import { createBuildingFromDims, type Vec2 } from './building';
import type { Doc } from './doc';
import { placeFixture, type FixtureType } from './fixtures';
import { withMember } from './members';
import { emptyNetwork } from './network';

export function supplyHouse(opts: { extraWater?: number; header?: boolean; meter?: boolean } = {}) {
  let b = createBuildingFromDims({ width: 8000, depth: 6000, floors: 1, floorHeight: 2900, wallThickness: 150, slabThickness: 200 });
  const floorId = b.floors[0].id;
  const foot = (a: Vec2, c: Vec2) => { b = withMember(b, { kind: 'footing', floorId, a, b: c, width: 150, z0: -700, z1: -150 }).b; };
  foot({ x: 0, y: 0 }, { x: 8000, y: 0 }); foot({ x: 8000, y: 0 }, { x: 8000, y: 6000 }); foot({ x: 8000, y: 6000 }, { x: 0, y: 6000 }); foot({ x: 0, y: 6000 }, { x: 0, y: 0 });
  foot({ x: 4000, y: 0 }, { x: 4000, y: 2500 }); foot({ x: 4000, y: 3100 }, { x: 4000, y: 6000 });
  let doc: Doc = { building: { ...b, foundation: { slabTop: -550 } }, network: emptyNetwork(), fixtures: {}, site: { designGL: -611 } };
  const put = (type: FixtureType, x: number, y: number, params?: Parameters<typeof placeFixture>[5]) => {
    const r = placeFixture(doc, floorId, type, { x, y }, 0, params);
    doc = r.doc;
    return r.fixtureId!;
  };
  const meter = opts.meter === false ? undefined : put('waterMeter', -1500, 3000);
  const heater = put('waterHeater', 2000, -300);
  const kitchen = put('kitchen', 6500, 5000);
  const washbasin = put('washbasin', 1500, 1500);
  const toilet = put('toilet', 1500, 4500);
  for (let i = 0; i < (opts.extraWater ?? 0); i++) put('faucet', 2400 + i * 400, 2000);
  const header = opts.header ? put('waterHeader', 1500, 3000, { mountZ: -400 }) : undefined;
  return { doc, floorId, ids: { meter, heater, kitchen, washbasin, toilet, header } };
}
