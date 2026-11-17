/**
 * 要望欄の「直前の操作」を厚くする：ボタン名（部品が自動で残す）に加えて、道具・階・床下・立面の切り替えと、
 * 配管・器具・壁などの数の増減を残す。工事名・住所・階の名前・器具の名前は残さない（番号と数だけ）。
 */
import { useStore, type Tool } from '../state/store';
import type { Doc } from '../model/doc';
import { fbLog } from './feedback';

const TOOL: Record<Tool, string> = { select: '選択', outline: '外形', pipe: '配管', wall: '壁', room: '部屋', split: '分ける', door: 'ドア',
  window: '窓', fixture: '器具', underlay: '下敷き', note: 'メモ' };
const WAIT_MS = 800;

export function counts(d: Doc): Record<string, number> {
  return { 配管: Object.keys(d.network.segments).length, 器具: Object.keys(d.fixtures ?? {}).length, 壁: Object.keys(d.building.walls).length,
    部屋: Object.keys(d.building.rooms).length, メモ: Object.keys(d.notes ?? {}).length, 下敷き: Object.keys(d.underlays ?? {}).length,
    階: d.building.floors.length };
}
const summary = (c: Record<string, number>) => Object.entries(c).map(([k, v]) => `${k}${v}`).join(' ');

/** 記録を始める。戻り値で止める */
export function startTrail(): () => void {
  let prev = useStore.getState();
  let base = counts(prev.doc);
  let timer: ReturnType<typeof setTimeout> | undefined;
  const flush = () => {
    timer = undefined;
    const c = counts(useStore.getState().doc);
    const d = Object.keys(c).filter((k) => c[k] !== base[k]).map((k) => `${k}${c[k] > base[k] ? '+' : ''}${c[k] - base[k]}`);
    if (d.length) fbLog('変化: ' + d.join(' '));
    base = c;
  };
  const unsub = useStore.subscribe((s) => {
    const p = prev; prev = s;
    if ((s.meta?.id ?? null) !== (p.meta?.id ?? null)) {
      if (timer) clearTimeout(timer); timer = undefined;
      base = counts(s.doc);
      if (s.meta) fbLog('工事を開いた（' + summary(base) + '）');
      return;
    }
    if (s.tool !== p.tool) fbLog('道具: ' + (TOOL[s.tool] ?? s.tool));
    if (s.underFloor !== p.underFloor) fbLog('床下: ' + (s.underFloor ? 'ON' : 'OFF'));
    if (s.activeFloorId !== p.activeFloorId) {
      const fl = s.doc.building.floors, i = fl.findIndex((f) => f.id === s.activeFloorId);
      if (i >= 0) fbLog(`階: ${i + 1}/${fl.length}`);
    }
    if (s.activeElevationId !== p.activeElevationId) fbLog(s.activeElevationId ? '立面を開いた' : '立面を閉じた');
    if (s.doc !== p.doc) { if (timer) clearTimeout(timer); timer = setTimeout(flush, WAIT_MS); }
  });
  return () => { unsub(); if (timer) clearTimeout(timer); };
}
