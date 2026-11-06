/**
 * 断面表示（表示専用・保存しない）。共通座標(mm)で切断面を表し、値より大きい側を切り取る。
 */
import type { Building } from './building';
import type { Vec3 } from './network';

export type SectionMode = 'off' | 'z' | 'x' | 'y';
export type Section = { mode: SectionMode; value: number };
/** normal·p + constant >= 0 の側を残す */
export type SectionPlane = { normal: Vec3; constant: number };

const MARGIN = 1000;

function range(b: Building, mode: Exclude<SectionMode, 'off'>): [number, number] {
  if (mode === 'z') {
    const top = b.floors.at(-1);
    return [0, top ? top.elevation + top.height : 3000];
  }
  const vs = Object.values(b.corners).map((c) => (mode === 'x' ? c.x : c.y));
  if (!vs.length) return [-MARGIN, MARGIN];
  return [Math.min(...vs) - MARGIN, Math.max(...vs) + MARGIN];
}

export function clampSection(b: Building, s: Section): Section {
  if (s.mode === 'off') return s;
  const [lo, hi] = range(b, s.mode);
  return { mode: s.mode, value: Math.min(hi, Math.max(lo, s.value)) };
}

export function sectionRange(b: Building, mode: Exclude<SectionMode, 'off'>): [number, number] {
  return range(b, mode);
}

export function defaultSectionValue(b: Building, mode: Exclude<SectionMode, 'off'>, activeFloorId: string): number {
  if (mode === 'z') return (b.floors.find((f) => f.id === activeFloorId)?.elevation ?? 0) + 1200;
  const [lo, hi] = range(b, mode);
  return (lo + hi) / 2;
}

export function sectionPlane(s: Section): SectionPlane | null {
  if (s.mode === 'off') return null;
  const normal = { x: s.mode === 'x' ? -1 : 0, y: s.mode === 'y' ? -1 : 0, z: s.mode === 'z' ? -1 : 0 };
  return { normal, constant: s.value };
}
