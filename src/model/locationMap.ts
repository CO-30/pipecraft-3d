/**
 * 付近見取り図（案内図）の計算。国土地理院の標準地図タイルの並べ方、画素⇔緯度経度、縮尺目盛り、設定（site.application の mitori.*）。
 * ブラウザに依存しない（タイルの取得は src/import/locationMap.ts）。
 */
import { metersPerPixel, worldPx, type LatLon } from './geo';

export const GSI_STD_URL = 'https://cyberjapandata.gsi.go.jp/xyz/std/{z}/{x}/{y}.png';
/** 地理院タイルの出典（印や枠を重ねているので「加工して作成」） */
export const GSI_STD_CREDIT = '国土地理院の地理院タイル（標準地図）を加工して作成';
export const MAP_ZOOMS = [
  { z: 16, label: '広め' },
  { z: 17, label: '標準' },
  { z: 18, label: '詳しく' },
] as const;
export const DEFAULT_MAP_ZOOM = 17;

export type MapTile = { x: number; y: number; url: string; /** 画像左上からのタイル左上（画素） */ dx: number; dy: number };

/** 中心 center を画像（wPx × hPx）の中央に置くときに必要なタイル */
export function mapTiles(center: LatLon, z: number, wPx: number, hPx: number): { tiles: MapTile[]; mpp: number } {
  const c = worldPx(center, z);
  const left = c.x - wPx / 2, top = c.y - hPx / 2;
  const n = 2 ** z;
  const tiles: MapTile[] = [];
  for (let y = Math.floor(top / 256); y * 256 < top + hPx; y++) {
    if (y < 0 || y >= n) continue;
    for (let x = Math.floor(left / 256); x * 256 < left + wPx; x++) {
      const wx = ((x % n) + n) % n;
      tiles.push({ x, y, url: GSI_STD_URL.replace('{z}', String(z)).replace('{x}', String(wx)).replace('{y}', String(y)), dx: x * 256 - left, dy: y * 256 - top });
    }
  }
  return { tiles, mpp: metersPerPixel(center.lat, z) };
}

/** 画像中央 center から (dxPx, dyPx) 画素ずれた点の緯度経度（Web メルカトルの逆変換） */
export function offsetLatLon(center: LatLon, z: number, dxPx: number, dyPx: number): LatLon {
  const c = worldPx(center, z);
  const N = 256 * 2 ** z;
  const x = c.x + dxPx, y = c.y + dyPx;
  const lon = (x / N) * 360 - 180;
  const lat = (Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / N))) * 180) / Math.PI;
  return { lat, lon };
}

/** 縮尺目盛りの長さ（m）。1・2・5 × 10^n のうち、用紙で maxMm 以下に収まる最大 */
export function scaleBarMeters(metersPerMm: number, maxMm: number): number {
  const limit = metersPerMm * maxMm;
  let best = 1;
  for (let e = 0; e <= 5; e++) for (const m of [1, 2, 5]) { const v = m * 10 ** e; if (v <= limit) best = v; }
  return best;
}

export type MapSettings = { lat?: number; lon?: number; title?: string; zoom: number };

const num = (s: string | undefined) => (s !== undefined && s.trim() !== '' && Number.isFinite(Number(s)) ? Number(s) : undefined);

export function readMapSettings(app: Record<string, string> | undefined): MapSettings {
  const a = app ?? {};
  const lat = num(a['mitori.lat']), lon = num(a['mitori.lon']), zoom = num(a['mitori.zoom']);
  const out: MapSettings = { zoom: MAP_ZOOMS.some((m) => m.z === zoom) ? zoom! : DEFAULT_MAP_ZOOM };
  if (lat !== undefined && lon !== undefined && Math.abs(lat) <= 85 && Math.abs(lon) <= 180) {
    out.lat = lat; out.lon = lon;
    if (a['mitori.title']) out.title = a['mitori.title'];
  }
  return out;
}

export function writeMapSettings(app: Record<string, string> | undefined, patch: Partial<MapSettings>): Record<string, string> {
  const out = { ...(app ?? {}) };
  const set = (k: string, v: string | number | undefined) => { if (v === undefined) delete out[k]; else out[k] = String(v); };
  if ('lat' in patch) set('mitori.lat', patch.lat);
  if ('lon' in patch) set('mitori.lon', patch.lon);
  if ('title' in patch) set('mitori.title', patch.title || undefined);
  if ('zoom' in patch) set('mitori.zoom', patch.zoom);
  return out;
}
