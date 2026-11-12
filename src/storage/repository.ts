/**
 * 保存処理の抽象。将来 Supabase 等へ差し替えられるよう、UIはこのインターフェースだけに依存する。
 */
import Dexie, { type Table } from 'dexie';
import { migrate, projectSchema, type ProjectData } from '../model/schema';
import { validateNetwork } from '../model/network';
import { validateBuilding } from '../model/building';
import { validateFixtures } from '../model/fixtures';
import { newId } from '../model/id';
import { isBuiltinProfile, municipalityProfileSchema, type MunicipalityProfile } from '../model/municipality';

export type ProjectSummary = Pick<ProjectData, 'id' | 'name' | 'address' | 'createdAt' | 'updatedAt'>;

export interface ProjectRepository {
  save(p: ProjectData): Promise<void>;
  load(id: string): Promise<ProjectData | undefined>;
  list(): Promise<ProjectSummary[]>;
  delete(id: string): Promise<void>;
  duplicate(id: string, newName: string): Promise<ProjectData>;
  exportJson(id: string): Promise<string>;
  importJson(json: string): Promise<ProjectData>;
  /** 本体が壊れていて直前の版から復旧した場合は recovered=true */
  loadWithStatus(id: string): Promise<{ project: ProjectData; recovered: boolean } | undefined>;
  /** 全現場を1つのファイルに */
  exportAll(): Promise<{ json: string; skipped: string[] }>;
  /** 1現場のファイル・全現場のバックアップのどちらも読み込める（常に新規追加） */
  importAny(json: string): Promise<{ imported: ProjectData[]; failed: number }>;
}

/** 版（保存した時点）。端末の中だけ（工事の書き出しには入れない） */
export interface VersionRepository {
  saveVersion(p: ProjectData, name: string, now?: number): Promise<{ id: string; dropped: number }>;
  listVersions(projectId: string): Promise<VersionSummary[]>;
  loadVersion(id: string): Promise<ProjectData | undefined>;
  deleteVersion(id: string): Promise<void>;
}

/** 自治体プロファイル（ユーザーが追加・編集した分）の保存 */
export interface ProfileRepository {
  listProfiles(): Promise<MunicipalityProfile[]>;
  /** 同梱プロファイルの id は保存できない（InvalidProjectError） */
  saveProfile(p: MunicipalityProfile): Promise<void>;
  deleteProfile(id: string): Promise<void>;
}

/** 端末ごとの設定（工事店情報など。現場ファイルやバックアップには入れない） */
export interface SettingsRepository {
  getSetting<T>(key: string): Promise<T | undefined>;
  setSetting<T>(key: string, value: T): Promise<void>;
}

export const BACKUP_FORMAT = 'pipecraft-backup';

type Row = { id: string; name: string; address?: string; createdAt: number; updatedAt: number; json: string; backupJson?: string };
type ProfileRow = { id: string; name: string; json: string };
type SettingRow = { key: string; json: string };
type VersionRow = { id: string; projectId: string; name: string; createdAt: number; json: string };
/** 版（保存した時点）の一覧の 1 行 */
export type VersionSummary = { id: string; projectId: string; name: string; createdAt: number; bytes: number };
/** 工事ごとの版の上限（あふれたら古いものから消す） */
export const MAX_VERSIONS = 20;

class PipeCraftDB extends Dexie {
  projects!: Table<Row, string>;
  profiles!: Table<ProfileRow, string>;
  settings!: Table<SettingRow, string>;
  versions!: Table<VersionRow, string>;
  constructor(name: string) {
    super(name);
    this.version(1).stores({ projects: 'id, updatedAt, name' });
    this.version(2).stores({ projects: 'id, updatedAt, name', profiles: 'id, name' });
    this.version(3).stores({ projects: 'id, updatedAt, name', profiles: 'id, name', settings: 'key' });
    this.version(4).stores({ projects: 'id, updatedAt, name', profiles: 'id, name', settings: 'key', versions: 'id, projectId, createdAt' });
  }
}

export class InvalidProjectError extends Error {}

/** JSON文字列を検証して ProjectData に変換（旧形式は変換）。不正データは例外 */
export function parseProject(json: string): ProjectData {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    throw new InvalidProjectError('JSONとして読み込めません');
  }
  const r = projectSchema.safeParse(migrate(raw));
  if (!r.success) throw new InvalidProjectError('データ形式が正しくありません: ' + r.error.issues[0]?.message);
  const errs = validateNetwork(r.data.network);
  if (errs.length) throw new InvalidProjectError('配管の接続情報が壊れています: ' + errs[0]);
  const berrs = validateBuilding(r.data.building);
  if (berrs.length) throw new InvalidProjectError('建物データが壊れています: ' + berrs[0]);
  const ferrs = validateFixtures(r.data);
  if (ferrs.length) throw new InvalidProjectError('設備機器（器具）のデータが壊れています: ' + ferrs[0]);
  const lost = Object.values(r.data.underlays).find((u) => !r.data.building.floors.some((f) => f.id === u.floorId));
  if (lost) throw new InvalidProjectError('下敷きの階が見つかりません: ' + lost.id);
  const lostEl = Object.values(r.data.elevations ?? {}).find((e) => !r.data.building.floors.some((f) => f.id === e.floorId));
  if (lostEl) throw new InvalidProjectError('立面の階が見つかりません: ' + lostEl.id);
  return r.data;
}

export class DexieProjectRepository implements ProjectRepository, ProfileRepository, SettingsRepository, VersionRepository {
  private db: PipeCraftDB;
  constructor(dbName = 'pipecraft3d') {
    this.db = new PipeCraftDB(dbName);
  }

  /** 直前の正常データを backupJson に残す（破損時の復旧用）。不正データは InvalidProjectError で保存しない */
  async save(p: ProjectData): Promise<void> {
    const json = JSON.stringify(p);
    parseProject(json);
    await this.db.transaction('rw', this.db.projects, async () => {
      const prev = await this.db.projects.get(p.id);
      await this.db.projects.put({ id: p.id, name: p.name, address: p.address, createdAt: p.createdAt, updatedAt: p.updatedAt, json, backupJson: prev?.json });
    });
  }

  /** 本体が壊れていればバックアップから復旧する */
  async load(id: string): Promise<ProjectData | undefined> {
    return (await this.loadWithStatus(id))?.project;
  }

  async loadWithStatus(id: string): Promise<{ project: ProjectData; recovered: boolean } | undefined> {
    const row = await this.db.projects.get(id);
    if (!row) return undefined;
    try {
      return { project: parseProject(row.json), recovered: false };
    } catch (e) {
      if (row.backupJson) return { project: parseProject(row.backupJson), recovered: true };
      throw e;
    }
  }

  /** 読めない現場は skipped に名前を返す（黙って欠けないように） */
  async exportAll(): Promise<{ json: string; skipped: string[] }> {
    const rows = await this.db.projects.orderBy('updatedAt').reverse().toArray();
    const projects: ProjectData[] = [];
    const skipped: string[] = [];
    for (const r of rows) {
      const p = await this.load(r.id).catch(() => undefined);
      if (p) projects.push(p);
      else skipped.push(r.name);
    }
    // ユーザーの自治体プロファイルも一緒に（別端末での復元で体裁が変わらないように）
    const profiles = await this.listProfiles();
    return { json: JSON.stringify({ format: BACKUP_FORMAT, version: 1, exportedAt: Date.now(), projects, ...(profiles.length ? { profiles } : {}) }), skipped };
  }

  async importAny(json: string): Promise<{ imported: ProjectData[]; failed: number }> {
    let raw: unknown;
    try { raw = JSON.parse(json); } catch { throw new InvalidProjectError('JSONとして読み込めません'); }
    const b = raw as { format?: string; projects?: unknown[]; profiles?: unknown[] };
    if (b?.format !== BACKUP_FORMAT) return { imported: [await this.importJson(json)], failed: 0 };
    if (!Array.isArray(b.projects)) throw new InvalidProjectError('バックアップの形式が正しくありません');
    // 同梱プロファイルは未保存のものだけ保存（保存済みは上書きしない）
    for (const raw of Array.isArray(b.profiles) ? b.profiles : []) {
      const p = municipalityProfileSchema.safeParse(raw);
      if (p.success && !isBuiltinProfile(p.data.id) && !(await this.db.profiles.get(p.data.id))) await this.saveProfile(p.data);
    }
    const imported: ProjectData[] = [];
    let failed = 0;
    for (const p of b.projects) {
      try { imported.push(await this.importJson(JSON.stringify(p))); } catch { failed++; }
    }
    return { imported, failed };
  }

  async list(): Promise<ProjectSummary[]> {
    const rows = await this.db.projects.orderBy('updatedAt').reverse().toArray();
    return rows.map(({ id, name, address, createdAt, updatedAt }) => ({ id, name, address, createdAt: createdAt ?? updatedAt, updatedAt }));
  }

  async delete(id: string): Promise<void> {
    await this.db.transaction('rw', this.db.projects, this.db.versions, async () => {
      await this.db.projects.delete(id);
      await this.db.versions.where('projectId').equals(id).delete();
    });
  }

  /** 今の状態を版にする（壊れたデータは InvalidProjectError）。上限を超えたら古いものから消し、消した数を返す */
  async saveVersion(p: ProjectData, name: string, now = Date.now()): Promise<{ id: string; dropped: number }> {
    const json = JSON.stringify(p);
    parseProject(json);
    const id = `v-${now.toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    let dropped = 0;
    await this.db.transaction('rw', this.db.versions, async () => {
      await this.db.versions.put({ id, projectId: p.id, name, createdAt: now, json });
      const all = await this.db.versions.where('projectId').equals(p.id).sortBy('createdAt');
      const extra = all.slice(0, Math.max(0, all.length - MAX_VERSIONS));
      dropped = extra.length;
      if (extra.length) await this.db.versions.bulkDelete(extra.map((x) => x.id));
    });
    return { id, dropped };
  }

  /** 版の一覧（新しい順） */
  async listVersions(projectId: string): Promise<VersionSummary[]> {
    const rows = await this.db.versions.where('projectId').equals(projectId).sortBy('createdAt');
    return rows.reverse().map(({ id, projectId: pid, name, createdAt, json }) => ({ id, projectId: pid, name, createdAt, bytes: json.length }));
  }

  async loadVersion(id: string): Promise<ProjectData | undefined> {
    const row = await this.db.versions.get(id);
    return row ? parseProject(row.json) : undefined;
  }

  async deleteVersion(id: string): Promise<void> {
    await this.db.versions.delete(id);
  }

  async duplicate(id: string, newName: string): Promise<ProjectData> {
    const p = await this.load(id);
    if (!p) throw new InvalidProjectError('現場が見つかりません');
    const now = Date.now();
    const copy: ProjectData = { ...structuredClone(p), id: newId('p'), name: newName, createdAt: now, updatedAt: now };
    await this.save(copy);
    return copy;
  }

  /** 使用中の自治体プロファイルがユーザー分なら本体も同梱する（別端末でも同じ体裁で開けるように） */
  async exportJson(id: string): Promise<string> {
    const p = await this.load(id);
    if (!p) throw new InvalidProjectError('現場が見つかりません');
    const pid = p.site?.municipalityProfileId;
    const bundled = pid && !isBuiltinProfile(pid) ? (await this.listProfiles()).find((x) => x.id === pid) : undefined;
    return JSON.stringify(bundled ? { ...p, bundledProfile: bundled } : p, null, 2);
  }

  /** 読み込んだ現場は常に新しいIDで追加する（既存を上書きしない）。同梱プロファイルは未保存のときだけ保存する */
  async importJson(json: string): Promise<ProjectData> {
    const p = parseProject(json);
    const { bundledProfile, ...rest } = p as ProjectData & { bundledProfile?: unknown };
    const imported: ProjectData = { ...rest, id: newId('p'), updatedAt: Date.now() };
    await this.save(imported);
    const bp = municipalityProfileSchema.safeParse(bundledProfile);
    if (bp.success && !isBuiltinProfile(bp.data.id) && !(await this.db.profiles.get(bp.data.id))) await this.saveProfile(bp.data);
    return imported;
  }

  async listProfiles(): Promise<MunicipalityProfile[]> {
    const rows = await this.db.profiles.orderBy('name').toArray();
    const out: MunicipalityProfile[] = [];
    for (const r of rows) {
      // 壊れた行は飛ばす（他のプロファイルは読めるように）
      try {
        const p = municipalityProfileSchema.safeParse(JSON.parse(r.json));
        if (p.success) out.push(p.data);
      } catch { /* skip */ }
    }
    return out;
  }

  async getSetting<T>(key: string): Promise<T | undefined> {
    const r = await this.db.settings.get(key);
    if (!r) return undefined;
    try { return JSON.parse(r.json) as T; } catch { return undefined; }
  }

  async setSetting<T>(key: string, value: T): Promise<void> {
    await this.db.settings.put({ key, json: JSON.stringify(value) });
  }

  async saveProfile(p: MunicipalityProfile): Promise<void> {
    if (isBuiltinProfile(p.id)) throw new InvalidProjectError('同梱のプロファイルは上書きできません（複製して編集してください）');
    const r = municipalityProfileSchema.safeParse(p);
    if (!r.success) throw new InvalidProjectError('プロファイルの形式が正しくありません: ' + r.error.issues[0]?.message);
    await this.db.profiles.put({ id: r.data.id, name: r.data.name, json: JSON.stringify(r.data) });
  }

  async deleteProfile(id: string): Promise<void> {
    await this.db.profiles.delete(id);
  }

  /** テスト用: 生データを書き換える */
  async _corrupt(id: string, json: string) {
    await this.db.projects.update(id, { json });
  }
  async _corruptProfile(id: string, json: string) {
    await this.db.profiles.put({ id, name: id, json });
  }

  close() {
    this.db.close();
  }
}
