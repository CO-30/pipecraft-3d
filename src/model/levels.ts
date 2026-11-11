/**
 * 高さの基準: 設計 GL・基礎天端・床下の底（ベタ基礎のスラブ天端）と 1 階の床の関係（純関数）。
 * 床下の配管はスラブ天端〜基礎天端の間（地面より上・基礎の中）を通る。
 */
import type { Building } from './building';
import type { SiteSettings } from './doc';
import { groundZ } from './fixtures';
import { membersOf } from './members';

/** 3D に描く床下の底（スラブ）の厚さ(mm) */
export const SLAB_THICKNESS = 150;

const lowest = (b: Pick<Building, 'floors'>) => Math.min(0, ...b.floors.map((f) => f.elevation));
/** 図面から置いた基礎の立上り（絶対 z の下端・上端） */
function footings(b: Building) {
  const fl = new Map(b.floors.map((f) => [f.id, f.elevation]));
  return membersOf(b).filter((m) => m.kind === 'footing').map((m) => ({ z0: (fl.get(m.floorId) ?? 0) + m.z0, z1: (fl.get(m.floorId) ?? 0) + m.z1 }));
}

/** 3D の地面の高さ（絶対 mm）: 設計 GL。未入力でも図面から置いた基礎があれば その下端（読み取りで GL に置いている） */
export function viewGroundZ(b: Building, site?: SiteSettings): number {
  if (site?.designGL !== undefined) return groundZ(b, site);
  const f = footings(b);
  return f.length ? Math.min(...f.map((x) => x.z0)) : groundZ(b, site);
}

/** GL からの高さ(mm): floor = 1 階の床、footingTop = 基礎天端、slabTop = 床下の底。tentative: 設計 GL 未入力 */
export type LevelSummary = { floor: number; footingTop?: number; slabTop?: number; tentative: boolean };

export function levelSummary(b: Building, site?: SiteSettings): LevelSummary {
  const gl = viewGroundZ(b, site);
  const f = footings(b);
  const r: LevelSummary = { floor: Math.round(lowest(b) - gl), tentative: site?.designGL === undefined };
  if (f.length) r.footingTop = Math.round(Math.max(...f.map((x) => x.z1)) - gl);
  if (b.foundation) r.slabTop = Math.round(lowest(b) + b.foundation.slabTop - gl);
  return r;
}

const gl = (v: number) => `GL${v >= 0 ? '+' : '−'}${Math.abs(v).toLocaleString('ja-JP')}`;
/** 「1階の床 GL+611・基礎天端 GL+450・床下の底 GL+100」。何も分からなければ null */
export function levelText(s: LevelSummary): string | null {
  if (s.tentative && s.footingTop === undefined && s.slabTop === undefined) return null;
  const parts = [`1階の床 ${gl(s.floor)}`];
  if (s.footingTop !== undefined) parts.push(`基礎天端 ${gl(s.footingTop)}`);
  if (s.slabTop !== undefined) parts.push(`床下の底 ${gl(s.slabTop)}`);
  return parts.join('・') + (s.tentative ? '（GL は仮）' : '');
}
/** 床下の範囲の説明「GL+100〜GL+450 の基礎の中」。床下の底が分からなければ null */
export function underfloorText(s: LevelSummary): string | null {
  if (s.slabTop === undefined) return null;
  const top = s.footingTop ?? s.floor;
  return `${gl(s.slabTop)}〜${gl(top)} の基礎の中${s.slabTop >= 0 ? '・地面より上' : ''}`;
}
/** 床から depth(mm) 下の高さを GL で「GL+311」。GL が分からなければ null */
export function glOfDepth(s: LevelSummary, depth: number): string | null {
  return s.tentative && s.footingTop === undefined ? null : gl(s.floor - depth);
}
