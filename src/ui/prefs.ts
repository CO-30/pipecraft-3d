/** 端末ごとの表示設定（工事データには含めない） */
import { create } from 'zustand';

export type LengthUnit = 'mm' | 'm';
const KEY = 'pipecraft3d.lengthUnit';
const GUIDE_KEY = 'pipecraft3d.guideHidden';
const get = (k: string) => { try { return localStorage.getItem(k); } catch { return null; } };
const put = (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* 保存できない環境では今回のみ */ } };

export const usePrefs = create<{ lengthUnit: LengthUnit; setLengthUnit(u: LengthUnit): void; guideHidden: boolean; setGuideHidden(v: boolean): void }>((set) => ({
  lengthUnit: get(KEY) === 'm' ? 'm' : 'mm',
  setLengthUnit: (lengthUnit) => { set({ lengthUnit }); put(KEY, lengthUnit); },
  /** 作業手順ガイドを隠す（慣れた人向け） */
  guideHidden: get(GUIDE_KEY) === '1',
  setGuideHidden: (guideHidden) => { set({ guideHidden }); put(GUIDE_KEY, guideHidden ? '1' : '0'); },
}));
