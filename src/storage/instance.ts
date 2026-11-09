import { DexieProjectRepository, type ProfileRepository, type ProjectRepository, type SettingsRepository } from './repository';

/** アプリ全体で使う保存先（将来クラウド同期版に差し替える場合はここだけ変更） */
export const repo: ProjectRepository & ProfileRepository & SettingsRepository = new DexieProjectRepository();
