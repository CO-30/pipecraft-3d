/**
 * 南風原町で受理された排水設備の申請図面（木造 2 階建て、2026-11-18 入手）の配管を再現した工事データ。
 * 個人情報は持たない（ます・管・高さだけ）。申請図面の体裁が実物と同じになるかの照合（テスト）に使う。
 *
 * 実物の値（公共汚水ますの管底を ±0 とした m）:
 *   公共汚水ます 内径250 深1100 管底 0.000 ／ 地盤 1.100（道路側 GL−900）
 *   ⑤ 小口径ます 深520-1035（落差） 管底 0.065 / 流入 0.580 ← 3.00m 2.2/100
 *   ④ 深410 管底 0.690 ← 5.30m 2.1/100
 *   ③ 深600-1280（落差、GL の段差 +900 の上） 管底 0.720 / 流入 1.400 ← 1.30m 2.3/100
 *   ② 深450 管底 1.550 ← 7.10m 2.1/100
 *   ① 深410 管底 1.590 ← 1.60m
 */
import { addFloor, addWall, emptyBuilding } from '../model/building';
import type { Doc } from '../model/doc';
import { placeFixture, portNodes, type FixtureType } from '../model/fixtures';
import { addPolyline, emptyNetwork } from '../model/network';

/** 1 階の床（FL）は設計 GL から 450 上 */
export const HAEBARU_DESIGN_GL = -450;
/** 実物の「公共汚水ますの管底 ±0」からの高さ(m) → 絶対 z(mm)。建物側の地盤 2.000 が設計 GL */
const abs = (relM: number) => Math.round(relM * 1000) - 2000 + HAEBARU_DESIGN_GL;

/** 実物のますの並び（上流 → 下流）。length は 1 つ下流のますまでの長さ(m) */
export const HAEBARU_MASU = [
  { no: 1, invert: 1.59, ground: 2.0, length: 1.6 },
  { no: 2, invert: 1.55, ground: 2.0, length: 7.1 },
  { no: 3, invert: 0.72, invertIn: 1.4, ground: 2.0, length: 1.3 },
  { no: 4, invert: 0.69, ground: 1.1, length: 5.3 },
  { no: 5, invert: 0.065, invertIn: 0.58, ground: 1.1, length: 3.0 },
] as const;

type P = { x: number; y: number };
function masu(d: Doc, type: FixtureType, p: P, invertZ: number, opts: { dropIn?: number; diameter?: number; existing?: boolean } = {}) {
  const r = placeFixture(d, d.building.floors[0].id, type, p);
  const f = r.doc.fixtures[r.fixtureId!];
  const port = portNodes(r.doc.network, f.id)[0];
  const doc: Doc = {
    ...r.doc,
    fixtures: { ...r.doc.fixtures, [f.id]: { ...f, params: { ...f.params, invertZ, ...(opts.diameter ? { diameter: opts.diameter } : {}), ...(opts.existing ? { existing: true } : {}) } } },
    network: { ...r.doc.network, nodes: { ...r.doc.network.nodes, [port.id]: { ...port, pos: { ...port.pos, z: invertZ }, ...(opts.dropIn ? { dropIn: opts.dropIn } : {}) } } },
  };
  return { doc, port: port.id };
}

/** 再現した工事データ。ますの並びは x 方向（① が x=0）、⑤ から先は道路へ斜めに下る */
export function haebaruCase(opts: { twoFloors?: boolean } = {}): { doc: Doc; masu: string[]; publicPort: string } {
  // 建物: 1 階 19.0m × 5.46m（外壁）＋間仕切り 2 本、2 階は外壁を写す
  const f1 = addFloor(emptyBuilding(), { height: 2900 });
  let bld = f1.b;
  const rect = [{ x: -12500, y: 600 }, { x: 6500, y: 600 }, { x: 6500, y: 6060 }, { x: -12500, y: 6060 }];
  for (let i = 0; i < 4; i++) bld = addWall(bld, f1.floorId, rect[i], rect[(i + 1) % 4], { thickness: 150, kind: 'exterior' }).b;
  bld = addWall(bld, f1.floorId, { x: -4000, y: 600 }, { x: -4000, y: 6060 }, { thickness: 100, kind: 'interior' }).b;
  bld = addWall(bld, f1.floorId, { x: -8000, y: 600 }, { x: -8000, y: 6060 }, { thickness: 100, kind: 'interior' }).b;
  if (opts.twoFloors) bld = addFloor(bld, { copyExteriorFrom: f1.floorId, height: 2800 }).b;
  let d: Doc = { building: bld, network: emptyNetwork(), fixtures: {}, site: { designGL: HAEBARU_DESIGN_GL } };
  // 敷地の高さ: 建物の周り GL±0、道路側（③ より先）GL−900
  d = { ...d, site: { ...d.site, groundPoints: [
    { x: -2000, y: 0, gl: 0 }, { x: 4000, y: 3000, gl: 0 }, { x: 8700, y: 0, gl: 0 }, { x: 8700, y: 3000, gl: 0 },
    { x: 10000, y: 0, gl: -900 }, { x: 14600, y: -2650, gl: -900 }, { x: 17200, y: -4150, gl: -900 }, { x: 20000, y: -4000, gl: -900 },
  ] } };
  // ますの位置: ①〜④ はまっすぐ、⑤・公共は 30° 斜め
  const pos: P[] = [{ x: 0, y: 0 }];
  const dirs = [0, 0, 0, -30, -30];
  HAEBARU_MASU.forEach((m, i) => {
    const a = (dirs[i] * Math.PI) / 180, p = pos[i];
    pos.push({ x: Math.round(p.x + m.length * 1000 * Math.cos(a)), y: Math.round(p.y + m.length * 1000 * Math.sin(a)) });
  });
  const ports: string[] = [];
  HAEBARU_MASU.forEach((m, i) => {
    const r = masu(d, 'manholeSewage', pos[i], abs(m.invert), { diameter: 150, ...('invertIn' in m ? { dropIn: Math.round((m.invertIn - m.invert) * 1000) } : {}) });
    d = r.doc; ports.push(r.port);
  });
  const pub = masu(d, 'publicSewage', pos[5], abs(0), { diameter: 250, existing: true });
  d = pub.doc;
  const all = [...ports, pub.port];
  for (let i = 0; i < all.length - 1; i++) {
    const a = d.network.nodes[all[i]].pos, b = d.network.nodes[all[i + 1]].pos;
    const bIn = b.z + (d.network.nodes[all[i + 1]].dropIn ?? 0);
    const r = addPolyline(d.network, [a, { ...b, z: bIn }], { system: 'sewage', diameter: 100, material: 'VU', ...(i === all.length - 2 ? { existing: true } : {}) }, { startNodeId: all[i], endNodeId: all[i + 1] });
    d = { ...d, network: r.net };
  }
  // 器具の排水（実物の一部）: ① へ 浴室（VU50）・洗面（VU50）・トイレ（VU75）、② へ キッチン（VU50）
  const fixtures: { type: FixtureType; at: P; to: number; dia: number }[] = [
    { type: 'bathtub', at: { x: -6000, y: 2500 }, to: 0, dia: 50 },
    { type: 'washbasin', at: { x: -9000, y: 4500 }, to: 0, dia: 50 },
    { type: 'toilet', at: { x: -1500, y: 4800 }, to: 0, dia: 75 },
    { type: 'kitchen', at: { x: 1600, y: 3000 }, to: 1, dia: 50 },
  ];
  for (const f of fixtures) {
    const r = placeFixture(d, d.building.floors[0].id, f.type, f.at);
    d = r.doc;
    const port = portNodes(d.network, r.fixtureId!).find((n) => { const fx = d.fixtures[r.fixtureId!]; return fx && (n.portId === 'drain' || n.portId === 'sewage'); })!;
    const m = d.network.nodes[ports[f.to]].pos;
    const under = -350; // 床下（FL−350）
    const pts = [port.pos, { ...port.pos, z: under }, { x: port.pos.x, y: m.y + 400, z: under - 50 }, { x: m.x, y: m.y + 400, z: m.z + 150 }, { ...m, z: m.z + 100 }];
    const rr = addPolyline(d.network, pts, { system: 'sewage', diameter: f.dia, material: 'VU' }, { startNodeId: port.id, endNodeId: ports[f.to] });
    d = { ...d, network: rr.net };
  }
  return { doc: d, masu: ports, publicPort: pub.port };
}
