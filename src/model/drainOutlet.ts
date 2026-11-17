/**
 * 公共ますが無い汚水の系統の下流端（下水の引込側のマス）を決める（純関数）。
 * 自動でつなぐ（connectYard）・高さの計算の根（buildDrainTrees）・申請図面の下流端（outletCandidates）が同じマスを使うよう、
 * 決めたマスには params.downstream の印を付ける（2026-11-18 実物の図面: 3 か所がそれぞれ別のマスを下流端にしていた）
 */
import type { Vec2 } from './building';
import type { Doc } from './doc';
import { groundZAt, type Fixture } from './fixtures';
import { distToOutline, insideBuilding, underfloorLevels } from './underfloorSlope';

/** 「下水引込へ」の文字からマスまでの距離の上限(mm)。これより遠ければ、どのマスの事か分からないので使わない */
export const SEWER_OUT_REACH = 5000;

/**
 * 下流端のマス: 印の付いたマス → 「下水引込へ」（hint）にいちばん近いマス（SEWER_OUT_REACH 以内）→
 * 地面がいちばん低い所のマス（下水は低い方へ流す）→ 同じ低さ（1mm 以内）なら家から遠いマス
 */
export function pickOutletManhole(doc: Pick<Doc, 'building' | 'site'>, holes: Fixture[], hint?: Vec2): Fixture | undefined {
  if (!holes.length) return undefined;
  const marked = holes.find((f) => f.params?.downstream);
  if (marked) return marked;
  if (hint) {
    const near = holes.map((f) => ({ f, d: Math.hypot(f.x - hint.x, f.y - hint.y) })).sort((a, b) => a.d - b.d)[0];
    if (near.d <= SEWER_OUT_REACH) return near.f;
  }
  const lv = underfloorLevels(doc);
  const away = (f: Fixture) => (!lv ? 0 : insideBuilding(lv, f) ? -distToOutline(lv, f) : distToOutline(lv, f));
  const g = (f: Fixture) => groundZAt(doc.building, doc.site, f);
  return holes.slice().sort((a, b) => (Math.abs(g(a) - g(b)) > 1 ? g(a) - g(b) : away(b) - away(a)))[0];
}

/**
 * マスに下流端の印を付ける。ほかのマスの印は外す（下流端は 1 つ。公共ますが無いときは外の汚水マスを全部ここへつなぐので、
 * 印が 2 つあると自動でつなぐ・高さの計算・申請図面で別々のマスを選ぶおそれがある）。変わらなければ同じ doc
 */
export function markDownstream(doc: Doc, fixtureId: string): Doc {
  if (!doc.fixtures[fixtureId]) return doc;
  let fixtures = doc.fixtures;
  for (const f of Object.values(doc.fixtures)) {
    const want = f.id === fixtureId;
    if (!!f.params?.downstream === want) continue;
    const { downstream: _d, ...rest } = f.params ?? {};
    fixtures = { ...fixtures, [f.id]: { ...f, params: want ? { ...rest, downstream: true } : rest } };
  }
  return fixtures === doc.fixtures ? doc : { ...doc, fixtures };
}
