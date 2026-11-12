/**
 * 住所検索（国土地理院）・航空写真（地理院タイル）・建物外形（OpenStreetMap Overpass）。
 * すべてブラウザから直接取得する（無料・登録不要）。
 */
import { aerialPlan, overpassQuery, parseOverpass, sortByDistance, type Footprint, type LatLon } from '../model/geo';
import { canvasFrom, toRaster, type Raster } from './image';

export const GSI_SEARCH_URL = 'https://msearch.gsi.go.jp/address-search/AddressSearch';
export const OVERPASS_URL = 'https://overpass-api.de/api/interpreter';

export type Place = LatLon & { title: string };

export async function searchAddress(q: string): Promise<Place[]> {
  const r = await fetch(`${GSI_SEARCH_URL}?q=${encodeURIComponent(q)}`);
  if (!r.ok) throw new Error(`住所検索に失敗しました（${r.status}）`);
  const json = (await r.json()) as { geometry?: { coordinates?: [number, number] }; properties?: { title?: string } }[];
  return (Array.isArray(json) ? json : [])
    .filter((x) => Array.isArray(x.geometry?.coordinates))
    .slice(0, 10)
    .map((x) => ({ lon: x.geometry!.coordinates![0], lat: x.geometry!.coordinates![1], title: x.properties?.title ?? '' }));
}

export function loadTile(url: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = url;
  });
}

export async function fetchAerial(p: LatLon, sizeM = 120): Promise<Raster & { mmPerPx: number; centerOffset: { x: number; y: number }; missing: number }> {
  const plan = aerialPlan(p, sizeM);
  const imgs = await Promise.all(plan.tiles.map((t) => loadTile(t.url)));
  if (imgs.every((i) => !i)) throw new Error('航空写真を取得できませんでした（通信を確認してください）');
  const all = document.createElement('canvas');
  all.width = all.height = 768;
  const ctx = all.getContext('2d')!;
  ctx.fillStyle = '#ddd';
  ctx.fillRect(0, 0, 768, 768);
  plan.tiles.forEach((t, i) => { const img = imgs[i]; if (img) ctx.drawImage(img, t.col * 256, t.row * 256); });
  const { x, y, size } = plan.crop;
  const r = toRaster(canvasFrom(all, 1024, { x, y, w: size, h: size }), 0.9);
  return { ...r, mmPerPx: (plan.mmPerPx * size) / r.widthPx, centerOffset: plan.centerOffset, missing: imgs.filter((i) => !i).length };
}

export async function fetchFootprints(p: LatLon): Promise<Footprint[]> {
  const r = await fetch(OVERPASS_URL, { method: 'POST', body: new URLSearchParams({ data: overpassQuery(p) }) });
  if (!r.ok) throw new Error(`建物外形を取得できませんでした（${r.status}）`);
  return sortByDistance(parseOverpass(await r.json(), p), { x: 0, y: 0 });
}
