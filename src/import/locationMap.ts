/**
 * 見取図の地図画像を国土地理院の標準地図タイルから作る（ブラウザだけ）。
 * 画像は端末のメモリにだけ置き、現場データには入れない（同じ場所・縮尺は使い回す）。
 */
import { mapTiles, readMapSettings } from '../model/locationMap';
import type { LatLon } from '../model/geo';
import { MAP_PX, renderLocationSheet, type LocationMapImage } from '../export/locationSheet';
import type { Sheet } from '../export/sheet';
import { loadTile } from './site';

export type FetchedMap = LocationMapImage & { missing: number; total: number };
const cache = new Map<string, Promise<FetchedMap>>();

/** 中心 center・ズーム z の地図（MAP_PX の大きさ、JPEG の data URL）。全部の区画が取れなければ例外 */
export function fetchLocationMap(center: LatLon, z: number): Promise<FetchedMap> {
  const key = `${center.lat.toFixed(7)},${center.lon.toFixed(7)},${z}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const p = (async () => {
    const { tiles, mpp } = mapTiles(center, z, MAP_PX.w, MAP_PX.h);
    const imgs = await Promise.all(tiles.map((t) => loadTile(t.url)));
    if (imgs.every((i) => !i)) throw new Error('地図を取得できませんでした（通信を確認してください）');
    const c = document.createElement('canvas');
    c.width = MAP_PX.w; c.height = MAP_PX.h;
    const ctx = c.getContext('2d')!;
    ctx.fillStyle = '#dddddd'; ctx.fillRect(0, 0, c.width, c.height);
    tiles.forEach((t, i) => { const img = imgs[i]; if (img) ctx.drawImage(img, t.dx, t.dy, 256, 256); });
    return { href: c.toDataURL('image/jpeg', 0.88), wPx: MAP_PX.w, hPx: MAP_PX.h, mpp, missing: imgs.filter((i) => !i).length, total: tiles.length };
  })();
  cache.set(key, p);
  p.catch(() => cache.delete(key)); // 失敗は次に取り直す
  return p;
}

export type LocationBuild = { sheet: Sheet; notes: string[]; mapOk: boolean };

/** 申請の値（mitori.*）から見取図を作る。工事場所が未設定なら null。地図が取れなければ枠だけの見取図。住所が空なら検索した地名を使う */
export async function buildLocationSheet(app: Record<string, string> | undefined, info: { siteName: string; address: string; date: Date }): Promise<LocationBuild | null> {
  const s = readMapSettings(app);
  if (s.lat === undefined || s.lon === undefined) return null;
  const meta = { ...info, address: info.address || s.title || '' };
  try {
    const m = await fetchLocationMap({ lat: s.lat, lon: s.lon }, s.zoom);
    const notes = m.missing ? [`地図の一部（${m.missing}/${m.total} 区画）を取得できず灰色になっています。通信を確かめて出し直してください`] : [];
    return { sheet: renderLocationSheet({ ...meta, map: m }), notes, mapOk: true };
  } catch (e) {
    return { sheet: renderLocationSheet({ ...meta, map: null }), notes: [e instanceof Error ? e.message : String(e)], mapOk: false };
  }
}
