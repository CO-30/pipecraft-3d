/**
 * 地番図（法務省 登記所備付地図データ）の筆の形を、図面の座標(mm)にする。純粋関数。
 * データはベクトルタイル（Web メルカトル、z/x/y、タイル内の座標 0〜extent、下が +y）。
 * 図面座標は検索地点を原点に x 東・y 北（geo.ts と同じ）。
 * 地図に重ねられるのは公共座標の「地図（14条1項）」だけ。公図（任意座標）は位置を持たないのでデータに入らない。
 * 境界の証明ではない（参考）。表示には出典と「参考」を必ず付ける。
 */
import type { Vec2 } from './building';
import { toLocalMm, worldPx, type LatLon } from './geo';

/** タイルの段の目安（読むときはデータのいちばん細かい段を使う。import/parcels.ts） */
export const PARCEL_ZOOM = 16;
export const PARCEL_ATTRIBUTION = '地番図：法務省 登記所備付地図データ（2024年4月公開分、AMX Project 加工）';
export const PARCEL_NOTE = '参考（法務局の地図の証明ではありません。位置は数十cm〜数mずれることがあります）';

export type TileKey = { z: number; x: number; y: number };
/** ベクトルタイルの地物（type 1 点・2 線・3 多角形）。rings はタイル内の座標 */
export type TileFeature = { type: number; rings: { x: number; y: number }[][]; props: Record<string, unknown> };
/** hidden[r][i]: 輪 r の辺 i（点 i → i+1）がタイルの端で切られた辺（本当の境界ではないので描かない） */
export type Parcel = { rings: Vec2[][]; hidden: boolean[][]; label?: string };

/** 地点の周り sizeM 四方を覆うタイル */
export function parcelTiles(center: LatLon, sizeM: number, z = PARCEL_ZOOM): TileKey[] {
  const c = worldPx(center, z);
  const R = 6378137, mpp = (2 * Math.PI * R * Math.cos((center.lat * Math.PI) / 180)) / (256 * 2 ** z);
  const half = sizeM / 2 / mpp;
  const x0 = Math.floor((c.x - half) / 256), x1 = Math.floor((c.x + half) / 256);
  const y0 = Math.floor((c.y - half) / 256), y1 = Math.floor((c.y + half) / 256);
  const out: TileKey[] = [];
  for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) out.push({ z, x, y });
  return out;
}

/** タイルの中の座標 → 緯度経度 */
function tileToLatLon(t: TileKey & { extent: number }, p: { x: number; y: number }): LatLon {
  const n = 2 ** t.z;
  const X = t.x + p.x / t.extent, Y = t.y + p.y / t.extent;
  return { lon: (X / n) * 360 - 180, lat: (Math.atan(Math.sinh(Math.PI * (1 - (2 * Y) / n))) * 180) / Math.PI };
}

/** 地番の属性（データによって名前が違う）。「筆界未定地」などの番号でないものは付けない */
export function parcelLabel(props: Record<string, unknown>): string | undefined {
  const key = Object.keys(props).find((k) => /地番$|^chiban$/i.test(k));
  const v = key ? String(props[key] ?? '').trim() : '';
  return /^\d[\d-]*$/.test(v.normalize('NFKC')) ? v.normalize('NFKC') : undefined;
}

export function parcelsFromTile(features: TileFeature[], tile: TileKey & { extent: number }, origin: LatLon): Parcel[] {
  return features.filter((f) => f.type === 3).map((f) => {
    const label = parcelLabel(f.props);
    const E = tile.extent;
    // 両端がタイルの同じ端の上か外にある辺 = タイルで切られた辺
    const out = (a: { x: number; y: number }, b: { x: number; y: number }) =>
      (a.x <= 0 && b.x <= 0) || (a.x >= E && b.x >= E) || (a.y <= 0 && b.y <= 0) || (a.y >= E && b.y >= E);
    return {
      hidden: f.rings.map((r) => r.map((p, i) => out(p, r[(i + 1) % r.length]))),
      rings: f.rings.map((r) => r.map((p) => { const m = toLocalMm(origin, tileToLatLon(tile, p)); return { x: Math.round(m.x), y: Math.round(m.y) }; })),
      ...(label ? { label } : {}),
    };
  });
}
