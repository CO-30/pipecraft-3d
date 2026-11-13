/**
 * 人が直した工事（図面から読み取ったあと、壁・器具・ますを直して「書き出し」た .pipecraft.json）を正解にする。
 * 新しい画面を作らずに正解を作れる: 読み取り → 直す → 書き出す → 図面と一緒にフォルダへ。
 * 書き出しには配管なども入っているが、正解に使うのは建物・器具・配置図の物・GL だけ。
 */
import type { Building } from '../model/building';
import type { Fixture, FixtureType } from '../model/fixtures';
import { parseTruth, type Truth } from './truth';

/** 配置図から読む物（applySite で置く物） */
const SITE: ReadonlySet<FixtureType> = new Set(['publicSewage', 'publicRain', 'manholeSewage', 'manholeRain', 'manholeTrap', 'manholeInvert', 'waterMeter', 'outdoorFaucet']);
/** 平面図から候補に出さない物（使う人が後で置く・自動で置く物） */
const NOT_READ: ReadonlySet<FixtureType> = new Set(['waterHeader', 'hotWaterHeader', 'pump', 'panel', 'outlet', 'light', 'aircon', 'roofTank']);

export type DocLike = { building: Building; fixtures: Record<string, Fixture>; site?: { designGL?: number } };

export function truthFromDoc(doc: DocLike, over: Record<string, unknown> & { id: string; kind: string }): Truth {
  const b = doc.building;
  const no = new Map(b.floors.map((f, i) => [f.id, i + 1]));
  const fx = Object.values(doc.fixtures).filter((f) => !f.params?.auto);
  const base = {
    floors: b.floors.map((f, i) => ({ n: i + 1, height: f.height })),
    ...(doc.site?.designGL !== undefined ? { glToFl: -doc.site.designGL } : {}),
    walls: Object.values(b.walls).map((w) => ({
      floor: no.get(w.floorId)!, a: { x: b.corners[w.a].x, y: b.corners[w.a].y }, b: { x: b.corners[w.b].x, y: b.corners[w.b].y }, thickness: w.thickness,
    })),
    openings: b.floors.map((f, i) => ({ floor: i + 1, count: Object.values(b.openings).filter((o) => b.walls[o.wallId]?.floorId === f.id).length })),
    fixtures: fx.filter((f) => !SITE.has(f.type) && !NOT_READ.has(f.type)).map((f) => ({ floor: no.get(f.floorId) ?? 1, type: f.type, x: f.x, y: f.y })),
    site: fx.filter((f) => SITE.has(f.type)).map((f) => ({ type: f.type, x: f.x, y: f.y })),
  };
  return parseTruth({ ...base, ...over });
}
