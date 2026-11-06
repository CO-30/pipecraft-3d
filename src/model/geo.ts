/**
 * 地理計算（航空写真タイル・建物外形）。図面座標は検索地点を原点とした局所平面（x 東, y 北, mm）。
 * 数十〜数百 m の範囲なので正距円筒近似で十分（誤差は 1/10000 程度）。
 */
import type { Vec2 } from './building';

const R = 6378137;
const rad = (d: number) => (d * Math.PI) / 180;
export type LatLon = { lat: number; lon: number };

export function toLocalMm(origin: LatLon, p: LatLon): Vec2 {
  return { x: R * rad(p.lon - origin.lon) * Math.cos(rad(origin.lat)) * 1000, y: R * rad(p.lat - origin.lat) * 1000 };
}

/** Web メルカトルの世界ピクセル座標（zoom z、タイル256px） */
export function worldPx(p: LatLon, z: number): Vec2 {
  const n = 256 * 2 ** z;
  const s = Math.sin(rad(p.lat));
  return { x: ((p.lon + 180) / 360) * n, y: (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * n };
}

export const metersPerPixel = (lat: number, z: number) => (2 * Math.PI * R * Math.cos(rad(lat))) / (256 * 2 ** z);

export const GSI_PHOTO_URL = 'https://cyberjapandata.gsi.go.jp/xyz/seamlessphoto/{z}/{x}/{y}.jpg';
export const GSI_ATTRIBUTION = '出典：国土地理院 地理院タイル（全国最新写真）';
export const OSM_ATTRIBUTION = '建物外形 © OpenStreetMap contributors';
export const AERIAL_ZOOM = 18;

export type AerialPlan = {
  tiles: { x: number; y: number; col: number; row: number; url: string }[];
  /** 3×3 に並べた画像の中での切り出し範囲(px) */
  crop: { x: number; y: number; size: number };
  mmPerPx: number;
  /** 切り出した画像の中心が検索地点からずれている量（図面座標 mm、x 東・y 北）。画素に丸めた分 */
  centerOffset: { x: number; y: number };
};

/** 検索地点を中心に sizeM 四方の航空写真を作るためのタイルと切り出し範囲 */
export function aerialPlan(center: LatLon, sizeM = 120, z = AERIAL_ZOOM): AerialPlan {
  const wp = worldPx(center, z);
  const tx = Math.floor(wp.x / 256), ty = Math.floor(wp.y / 256);
  const tiles = [];
  for (let row = 0; row < 3; row++) for (let col = 0; col < 3; col++) {
    const x = tx - 1 + col, y = ty - 1 + row;
    tiles.push({ x, y, col, row, url: GSI_PHOTO_URL.replace('{z}', String(z)).replace('{x}', String(x)).replace('{y}', String(y)) });
  }
  const mpp = metersPerPixel(center.lat, z);
  const size = Math.min(512, Math.round(sizeM / mpp));
  const cx = wp.x - (tx - 1) * 256, cy = wp.y - (ty - 1) * 256;
  const crop = { x: Math.round(cx - size / 2), y: Math.round(cy - size / 2), size };
  const mmPerPx = mpp * 1000;
  return { tiles, crop, mmPerPx, centerOffset: { x: (crop.x + size / 2 - cx) * mmPerPx, y: -(crop.y + size / 2 - cy) * mmPerPx } };
}

// ---------- 建物外形（OpenStreetMap / Overpass API） ----------

export const overpassQuery = (p: LatLon, radiusM = 60) =>
  `[out:json][timeout:25];way["building"](around:${radiusM},${p.lat},${p.lon});out geom;`;

export type Footprint = { id: string; name?: string; polygon: Vec2[] };

const area2 = (poly: Vec2[]) => poly.reduce((a, p, i) => { const q = poly[(i + 1) % poly.length]; return a + p.x * q.y - q.x * p.y; }, 0);
export const polygonArea = (poly: Vec2[]) => Math.abs(area2(poly)) / 2;

/** Overpass の JSON から建物の多角形（反時計回り、閉じ点なし、mm）を取り出す */
export function parseOverpass(json: unknown, origin: LatLon): Footprint[] {
  const els = (json as { elements?: unknown[] })?.elements;
  if (!Array.isArray(els)) return [];
  const out: Footprint[] = [];
  for (const e of els as { type?: string; id?: number; geometry?: { lat: number; lon: number }[]; tags?: Record<string, string> }[]) {
    if (e.type !== 'way' || !Array.isArray(e.geometry) || e.geometry.length < 4) continue;
    let poly = e.geometry.filter((g) => Number.isFinite(g?.lat) && Number.isFinite(g?.lon)).map((g) => toLocalMm(origin, g));
    const f = poly[0], l = poly[poly.length - 1];
    if (f && l && Math.hypot(f.x - l.x, f.y - l.y) < 1) poly = poly.slice(0, -1);
    poly = simplifyRing(poly);
    if (poly.length < 3 || polygonArea(poly) < 1e6) continue; // 1㎡未満は除く
    out.push({ id: String(e.id), name: e.tags?.name, polygon: poly });
  }
  return out;
}

export function pointInRing(p: Vec2, poly: Vec2[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j];
    if ((a.y > p.y) !== (b.y > p.y) && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

function distToSeg(p: Vec2, a: Vec2, b: Vec2) {
  const L2 = (b.x - a.x) ** 2 + (b.y - a.y) ** 2;
  const t = L2 ? Math.max(0, Math.min(1, ((p.x - a.x) * (b.x - a.x) + (p.y - a.y) * (b.y - a.y)) / L2)) : 0;
  return Math.hypot(p.x - (a.x + (b.x - a.x) * t), p.y - (a.y + (b.y - a.y) * t));
}
export const distToRing = (p: Vec2, poly: Vec2[]) => Math.min(...poly.map((a, i) => distToSeg(p, a, poly[(i + 1) % poly.length])));

/** 地点を含む建物を先頭に、残りは近い順 */
export function sortByDistance(list: Footprint[], p: Vec2): Footprint[] {
  const d = (f: Footprint) => (pointInRing(p, f.polygon) ? -1 : distToRing(p, f.polygon));
  return [...list].sort((a, b) => d(a) - d(b));
}

/** 重複点・ほぼ一直線の点（tolMm 以内）を除き、反時計回りにそろえる */
export function simplifyRing(poly: Vec2[], tolMm = 50): Vec2[] {
  let pts = poly.filter((p, i) => { const q = poly[(i + 1) % poly.length]; return Math.hypot(p.x - q.x, p.y - q.y) > 1; });
  let changed = true;
  while (changed && pts.length > 3) {
    changed = false;
    for (let i = 0; i < pts.length; i++) {
      const prev = pts[(i - 1 + pts.length) % pts.length], next = pts[(i + 1) % pts.length];
      if (distToSeg(pts[i], prev, next) < tolMm) { pts = pts.filter((_, k) => k !== i); changed = true; break; }
    }
  }
  if (area2(pts) < 0) pts = pts.reverse();
  return pts;
}

/** 内側へ d mm 縮める（反時計回り前提、各辺を平行移動して隣の辺と交差させる） */
export function offsetRingInward(poly: Vec2[], d: number): Vec2[] | null {
  if (!d) return poly;
  const n = poly.length;
  const lines = poly.map((a, i) => {
    const b = poly[(i + 1) % n];
    const L = Math.hypot(b.x - a.x, b.y - a.y);
    const nx = -(b.y - a.y) / L, ny = (b.x - a.x) / L; // 左向き法線 = 内側
    return { p: { x: a.x + nx * d, y: a.y + ny * d }, v: { x: b.x - a.x, y: b.y - a.y } };
  });
  const out: Vec2[] = [];
  for (let i = 0; i < n; i++) {
    const l1 = lines[(i - 1 + n) % n], l2 = lines[i];
    const den = l1.v.x * l2.v.y - l1.v.y * l2.v.x;
    if (Math.abs(den) < 1e-9) { out.push(l2.p); continue; }
    const t = ((l2.p.x - l1.p.x) * l2.v.y - (l2.p.y - l1.p.y) * l2.v.x) / den;
    out.push({ x: l1.p.x + l1.v.x * t, y: l1.p.y + l1.v.y * t });
  }
  // 縮めすぎて裏返った・面積が小さすぎる場合は失敗
  if (area2(out) <= 0 || polygonArea(out) < polygonArea(poly) * 0.2) return null;
  return out;
}

/** 最長辺を図面の軸（x または y）に合わせる回転角（度、−45〜45） */
export function alignAngle(poly: Vec2[]): number {
  let best = 0, ang = 0;
  poly.forEach((a, i) => {
    const b = poly[(i + 1) % poly.length];
    const L = Math.hypot(b.x - a.x, b.y - a.y);
    if (L > best) { best = L; ang = (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI; }
  });
  let r = -(((ang % 90) + 90) % 90);
  if (r < -45) r += 90;
  return r;
}

export function rotatePoint(p: Vec2, deg: number, about: Vec2 = { x: 0, y: 0 }): Vec2 {
  const c = Math.cos(rad(deg)), s = Math.sin(rad(deg));
  const dx = p.x - about.x, dy = p.y - about.y;
  return { x: about.x + dx * c - dy * s, y: about.y + dx * s + dy * c };
}
