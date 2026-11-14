/**
 * 地番図（法務省 登記所備付地図データ）を、地点の周りだけブラウザから直接読む（無料・登録不要・サーバー不要）。
 * データ: AMX Project が登記所備付地図データ（2024年4月公開分）を 1 つのファイル（PMTiles）にしたもの。
 * 必要な部分だけを HTTP の範囲指定で取るので、全国 15GB のファイルでも数百 KB しか通信しない。
 * ライブラリ: pmtiles・@mapbox/vector-tile・pbf（すべて BSD-3-Clause、無料・商用可）。
 */
import { VectorTile } from '@mapbox/vector-tile';
import { PbfReader } from 'pbf';
import { PMTiles } from 'pmtiles';
import type { LatLon } from '../model/geo';
import { parcelsFromTile, parcelTiles, type Parcel, type TileFeature } from '../model/parcels';
import type { Raster } from './image';

export const PARCEL_PMTILES_URL = 'https://data.source.coop/smartmaps/amx-2024-04/MojMap_amx_2024.pmtiles';

let archive: PMTiles | null = null;
const pm = () => (archive ??= new PMTiles(PARCEL_PMTILES_URL));

/** 地点の周り sizeM 四方の筆（図面の座標 mm） */
export async function fetchParcels(p: LatLon, sizeM = 120): Promise<Parcel[]> {
  const a = pm();
  const h = await a.getHeader();
  // データのいちばん細かい段（細かいほど形が正確。18 まで）
  const z = Math.min(h.maxZoom, 18);
  const out: Parcel[] = [];
  for (const t of parcelTiles(p, sizeM, z)) {
    const r = await a.getZxy(t.z, t.x, t.y);
    if (!r?.data) continue;
    for (const l of decodeTile(new Uint8Array(r.data))) out.push(...parcelsFromTile(l.features, { ...t, extent: l.extent }, p));
  }
  return out;
}

/** ベクトルタイル（MVT）→ 層ごとの extent と地物 */
export function decodeTile(bytes: Uint8Array): { name: string; extent: number; features: TileFeature[] }[] {
  const vt = new VectorTile(new PbfReader(bytes));
  return Object.keys(vt.layers).map((name) => {
    const layer = vt.layers[name];
    const features: TileFeature[] = [];
    for (let i = 0; i < layer.length; i++) {
      const f = layer.feature(i);
      features.push({ type: f.type, rings: f.loadGeometry().map((ring) => ring.map((q) => ({ x: q.x, y: q.y }))), props: f.properties as Record<string, unknown> });
    }
    return { name, extent: layer.extent, features };
  });
}

/**
 * 筆の線と地番を、透明な PNG にする（航空写真と同じ位置・同じ大きさの下敷き）。
 * 中心 = 地点、x 東・y 北。線は青、地番は筆の中ほどに小さく。
 */
export function drawParcels(parcels: Parcel[], sizeM = 120, px = 1024): Raster & { mmPerPx: number } {
  const c = document.createElement('canvas');
  c.width = c.height = px;
  const ctx = c.getContext('2d')!;
  const mmPerPx = (sizeM * 1000) / px;
  const X = (x: number) => px / 2 + x / mmPerPx, Y = (y: number) => px / 2 - y / mmPerPx;
  ctx.strokeStyle = '#1d4ed8';
  ctx.lineWidth = 2;
  for (const p of parcels) p.rings.forEach((ring, r) => {
    ctx.beginPath();
    ring.forEach((a, i) => {
      if (p.hidden[r]?.[i]) return;
      const b = ring[(i + 1) % ring.length];
      ctx.moveTo(X(a.x), Y(a.y));
      ctx.lineTo(X(b.x), Y(b.y));
    });
    ctx.stroke();
  });
  ctx.font = 'bold 15px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (const p of parcels) {
    if (!p.label || !p.rings[0]?.length) continue;
    const ring = p.rings[0];
    const cx = ring.reduce((s, q) => s + q.x, 0) / ring.length, cy = ring.reduce((s, q) => s + q.y, 0) / ring.length;
    const x = X(cx), y = Y(cy);
    if (x < 10 || y < 10 || x > px - 10 || y > px - 10) continue;
    ctx.lineWidth = 4; ctx.strokeStyle = 'rgba(255,255,255,0.9)'; ctx.strokeText(p.label, x, y);
    ctx.fillStyle = '#1e3a8a'; ctx.fillText(p.label, x, y);
  }
  return { src: c.toDataURL('image/png'), widthPx: px, heightPx: px, mmPerPx };
}
