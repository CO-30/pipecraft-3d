/**
 * 公共ますが無い工事（配置図に公共ますの記号が無い）: 配置図から置いた汚水マスの深さは決まっていない（既定の GL−600 は仮の値）。
 * その深さに引っぱられて、床下から外へ出る所（前澤 KSA）を深くしない（2026-11-16 ユーザーの実物: KSA の H430 に対して図の高さ 674mm）。
 * マスの管底は、上流（KSA の外の口から標準の勾配）から決める。手で管底を入れたマス・公共ますは今までどおり固定。
 */
import { describe, expect, test } from 'vitest';
import { connectYard } from '../autoConnect';
import { dropFixturePipes } from '../dropPipes';
import { routeDrainsOut } from '../drainRoute';
import { supplyHouse } from '../testSupplyHouse';
import { placeFixture } from '../fixtures';
import { solveDrain } from './index';
import { resolveDrainRules } from '../drainRules';
import { BUILTIN_PROFILES } from '../municipality';
import { kisoSleeveItems } from '../kisoSleeve';
import { computeEstimate } from '../estimate';
import type { Doc } from '../doc';

const STD = resolveDrainRules(BUILTIN_PROFILES.find((p) => p.id === 'standard')!);

/** 器具の近くの外に、配置図から置いたような汚水マス（管底は既定のまま = 手で入れていない） */
function houseWithSiteManholes(pin?: number): Doc {
  const h = supplyHouse();
  let doc = h.doc;
  for (const [x, y] of [[6500, 6600], [-600, 4500], [-600, 1500]] as const) {
    doc = placeFixture(doc, h.floorId, 'manholeSewage', { x, y }, 0, pin !== undefined ? { invertZ: pin, invertPin: true } : undefined).doc;
  }
  return connectYard(routeDrainsOut(dropFixturePipes(doc).doc, undefined, { cover: STD.cover }).doc).doc;
}

describe('公共ますが無いとき、配置図のマスの深さに KSA を引っぱらない', () => {
  test('KSA の高さは品番の H のまま（スリーブ表の高さの食い違いが出ない）', () => {
    const d = solveDrain(houseWithSiteManholes(), STD).doc;
    const k = kisoSleeveItems(d);
    expect(k.items.some((i) => i.spec.startsWith('KSA'))).toBe(true);
    expect(k.checks.map((c) => c.message)).toEqual([]);
    expect(computeEstimate(d).issues.filter((i) => i.kind === 'sleeve' || i.kind === 'confirmFitting').map((i) => i.message)).toEqual([]);
  });

  test('マスの管底は上流から標準の勾配で決まる（既定の GL−600 より浅くなる）', () => {
    const d = solveDrain(houseWithSiteManholes(), STD).doc;
    const holes = Object.values(d.fixtures).filter((f) => f.type === 'manholeSewage');
    expect(holes.length).toBeGreaterThan(0);
    for (const f of holes) expect(f.params?.invertZ ?? -9999).toBeGreaterThan(-611 - 600);
  });

  test('手で管底を入れたマス（ピン）は今までどおりその深さ', () => {
    const d = solveDrain(houseWithSiteManholes(-1300), STD).doc;
    for (const f of Object.values(d.fixtures).filter((x) => x.type === 'manholeSewage')) expect(f.params?.invertZ).toBe(-1300);
  });
});
