/** 端末ごとの表示設定（現場データには含めない） */
import { create } from 'zustand';

export type LengthUnit = 'mm' | 'm';
const KEY = 'pipecraft3d.lengthUnit';
const load = (): LengthUnit => {
  try { return localStorage.getItem(KEY) === 'm' ? 'm' : 'mm'; } catch { return 'mm'; }
};

export const usePrefs = create<{ lengthUnit: LengthUnit; setLengthUnit(u: LengthUnit): void }>((set) => ({
  lengthUnit: load(),
  setLengthUnit: (lengthUnit) => {
    set({ lengthUnit });
    try { localStorage.setItem(KEY, lengthUnit); } catch { /* 保存できない環境では今回のみ */ }
  },
}));
