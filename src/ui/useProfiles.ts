/**
 * 自治体プロファイルの一覧（同梱＋ユーザー分）。ユーザー分は IndexedDB（repository）に保存する。
 */
import { create } from 'zustand';
import { BUILTIN_PROFILES, type MunicipalityProfile } from '../model/municipality';
import { repo } from '../storage/instance';

const profileRepo = () => repo;

type ProfilesState = {
  user: MunicipalityProfile[];
  loaded: boolean;
  error: string | null;
  /** 同梱 → ユーザー の順 */
  all(): MunicipalityProfile[];
  load(): Promise<void>;
  save(p: MunicipalityProfile): Promise<string | null>;
  remove(id: string): Promise<void>;
};

export const useProfiles = create<ProfilesState>((set, get) => ({
  user: [],
  loaded: false,
  error: null,
  all: () => [...BUILTIN_PROFILES, ...get().user],
  load: async () => {
    try {
      const user = await profileRepo().listProfiles();
      set({ user, loaded: true, error: null });
    } catch (e) {
      set({ loaded: true, error: e instanceof Error ? e.message : String(e) });
    }
  },
  save: async (p) => {
    try {
      await profileRepo().saveProfile(p);
      set({ user: [...get().user.filter((x) => x.id !== p.id), p].sort((a, b) => a.name.localeCompare(b.name, 'ja')) });
      return null;
    } catch (e) {
      return e instanceof Error ? e.message : String(e);
    }
  },
  remove: async (id) => {
    await profileRepo().deleteProfile(id);
    set({ user: get().user.filter((x) => x.id !== id) });
  },
}));
