/**
 * 保存処理の抽象。将来 Supabase 等へ差し替えられるよう、UIはこのインターフェースだけに依存する。
 */
import Dexie, { type Table } from 'dexie';
import { migrate, projectSchema, type ProjectData } from '../model/schema';
import { validateNetwork } from '../model/network';
import { validateBuilding } from '../model/building';
import { validateFixtures } from '../model/fixtures';
import { newId } from '../model/id';

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
  exportAll(): Promise<string>;
  /** 1現場のファイル・全現場のバックアップのどちらも読み込める（常に新規追加） */
  importAny(json: string): Promise<{ imported: ProjectData[]; failed: number }>;
}

export const BACKUP_FORMAT = 'pipecraft-backup';

type Row = { id: string; name: string; address?: string; createdAt: number; updatedAt: number; json: string; backupJson?: string };

class PipeCraftDB extends Dexie {
  projects!: Table<Row, string>;
  constructor(name: string) {
    super(name);
    this.version(1).stores({ projects: 'id, updatedAt, name' });
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
  return r.data;
}

export class DexieProjectRepository implements ProjectRepository {
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

  async exportAll(): Promise<string> {
    const rows = await this.db.projects.orderBy('updatedAt').reverse().toArray();
    const projects: ProjectData[] = [];
    for (const r of rows) {
      const p = await this.load(r.id).catch(() => undefined);
      if (p) projects.push(p);
    }
    return JSON.stringify({ format: BACKUP_FORMAT, version: 1, exportedAt: Date.now(), projects });
  }

  async importAny(json: string): Promise<{ imported: ProjectData[]; failed: number }> {
    let raw: unknown;
    try { raw = JSON.parse(json); } catch { throw new InvalidProjectError('JSONとして読み込めません'); }
    const b = raw as { format?: string; projects?: unknown[] };
    if (b?.format !== BACKUP_FORMAT) return { imported: [await this.importJson(json)], failed: 0 };
    if (!Array.isArray(b.projects)) throw new InvalidProjectError('バックアップの形式が正しくありません');
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
    await this.db.projects.delete(id);
  }

  async duplicate(id: string, newName: string): Promise<ProjectData> {
    const p = await this.load(id);
    if (!p) throw new InvalidProjectError('現場が見つかりません');
    const now = Date.now();
    const copy: ProjectData = { ...structuredClone(p), id: newId('p'), name: newName, createdAt: now, updatedAt: now };
    await this.save(copy);
    return copy;
  }

  async exportJson(id: string): Promise<string> {
    const p = await this.load(id);
    if (!p) throw new InvalidProjectError('現場が見つかりません');
    return JSON.stringify(p, null, 2);
  }

  /** 読み込んだ現場は常に新しいIDで追加する（既存を上書きしない） */
  async importJson(json: string): Promise<ProjectData> {
    const p = parseProject(json);
    const imported: ProjectData = { ...p, id: newId('p'), updatedAt: Date.now() };
    await this.save(imported);
    return imported;
  }

  /** テスト用: 生データを書き換える */
  async _corrupt(id: string, json: string) {
    await this.db.projects.update(id, { json });
  }

  close() {
    this.db.close();
  }
}
