/**
 * 屋外の給水・給湯の立上りまわりの材料（2026-11-13 ユーザーの施工）。純粋関数。
 * - コーキング: 地上で外周の基礎を水平に抜けて床下へ入る給水・給湯の所（か所）
 * - 立上り保護のさや管 φ40: 建物の外（外壁から 1m 以内）で地面から出ている給水・給湯の立て管の、地上の長さ
 *   （立水栓・メーターの口へ上がる管は除く）
 * - ベンリカン: 給湯器の口と止水栓をつなぐ短い管（本数。管の長さには入れない）
 */
import type { Doc } from './doc';
import { groundZ } from './fixtures';
import { isBenrikan } from './materials';
import { sleeveSchedule } from './sleeves';
import { distToOutline, insideBuilding, underfloorLevels } from './underfloorSlope';

export const SHEATH_DIAMETER = 40;
/** 外壁からこの距離までの立て管を、立上りとして保護する(mm) */
const SHEATH_NEAR_WALL = 1000;

export type OutdoorRiserItem = { key: string; name: string; spec: string; count: number; unit: string; note: string };

export function outdoorRiserItems(doc: Doc): OutdoorRiserItem[] {
  const net = doc.network, items: OutdoorRiserItem[] = [];
  if (!doc.building.floors.length) return items;
  const gl = groundZ(doc.building, doc.site);
  const isSupply = (s: string) => s === 'water' || s === 'hotWater';

  // コーキング: 外周の基礎を GL より上で抜ける給水・給湯
  const caulk = sleeveSchedule(doc).filter((r) => r.part === 'footingOuter' && isSupply(r.system) && r.point.z > gl);
  if (caulk.length) items.push({ key: 'kiso|caulk', name: 'コーキング（床下への入口）', spec: '基礎の貫通部', count: caulk.length, unit: 'か所', note: `外で立ち上げて基礎を抜ける給水・給湯（スリーブ表 No.${caulk.map((r) => r.no).join('・')}）` });

  // さや管 φ40: 屋外の立て管の地上の部分
  const lv = underfloorLevels(doc);
  const outdoorNearWall = (p: { x: number; y: number }) => !!lv && lv.outline.length > 0 && !insideBuilding(lv, p) && distToOutline(lv, p) <= SHEATH_NEAR_WALL;
  const skipTop = new Set(['outdoorFaucet', 'waterMeter']);
  let len = 0, places = 0;
  for (const s of Object.values(net.segments)) {
    if (!isSupply(s.system) || isBenrikan(s.material)) continue;
    const A = net.nodes[s.a], B = net.nodes[s.b];
    if (!A || !B || Math.hypot(A.pos.x - B.pos.x, A.pos.y - B.pos.y) >= 1) continue;
    const [lo, hi] = A.pos.z < B.pos.z ? [A, B] : [B, A];
    if (hi.pos.z <= gl + 1 || !outdoorNearWall(hi.pos)) continue;
    if (hi.fixtureId && skipTop.has(doc.fixtures[hi.fixtureId]?.type ?? '')) continue;
    len += hi.pos.z - Math.max(lo.pos.z, gl);
    places++;
  }
  if (places) items.push({ key: `kiso|sheath|${SHEATH_DIAMETER}`, name: '立上り保護 さや管', spec: `φ${SHEATH_DIAMETER}`, count: Math.ceil(len / 100) / 10, unit: 'm', note: `屋外の給水・給湯の立上り ${places} 本の地上の部分` });

  // ベンリカン: 口径ごとの本数
  const ben = new Map<number, number[]>();
  for (const s of Object.values(net.segments)) {
    if (!isBenrikan(s.material)) continue;
    const A = net.nodes[s.a]?.pos, B = net.nodes[s.b]?.pos;
    if (!A || !B) continue;
    (ben.get(s.diameter) ?? ben.set(s.diameter, []).get(s.diameter)!).push(Math.round(Math.hypot(A.x - B.x, A.y - B.y, A.z - B.z)));
  }
  for (const [d, ls] of [...ben].sort((a, b) => a[0] - b[0])) items.push({ key: `kiso|benrikan|${d}`, name: 'ベンリカン（給湯器の接続）', spec: `φ${d}`, count: ls.length, unit: '本', note: `長さ ${ls.join('・')}mm` });
  return items;
}
