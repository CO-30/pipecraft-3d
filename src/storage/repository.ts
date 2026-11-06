/**
 * 保存処理の抽象。将来 Supabase 等へ差し替えられるよう、UIはこのインターフェースだけに依存する。
 */
import Dexie, { type Table } from 'dexie';
import { projectSchema, type ProjectData } from '../model/schema';
import { validateNetwork } from '../model/network';

export interface ProjectRepository {
  save(p: ProjectData): Promise<void>;
  load(id: string): Promise<ProjectData | undefined>;
  list(): Promise<Pick<ProjectData, 'id' | 'name' | 'updatedAt'>[]>;
}

type Row = { id: string; name: string; updatedAt: number; json: string; backupJson?: string };

class PipeCraftDB extends Dexie {
  projects!: Table<Row, string>;
  constructor(name: string) {
    super(name);
    this.version(1).stores({ projects: 'id, updatedAt, name' });
  }
}

export class InvalidProjectError extends Error {}

/** JSON文字列を検証して ProjectData に変換。不正データは例外 */
export function parseProject(json: string): ProjectData {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    throw new InvalidProjectError('JSONとして読み込めません');
  }
  const r = projectSchema.safeParse(raw);
  if (!r.success) throw new InvalidProjectError('データ形式が正しくありません: ' + r.error.issues[0]?.message);
  const errs = validateNetwork(r.data.network);
  if (errs.length) throw new InvalidProjectError('配管の接続情報が壊れています: ' + errs[0]);
  return r.data;
}

export class DexieProjectRepository implements ProjectRepository {
  private db: PipeCraftDB;
  constructor(dbName = 'pipecraft3d') {
    this.db = new PipeCraftDB(dbName);
  }

  /** 保存時は直前の正常データを backupJson に残す（破損時の復旧用）。不正データは InvalidProjectError */
  async save(p: ProjectData): Promise<void> {
    // 読み込めないデータは保存しない（保存時にも不変条件を強制）
    const json = JSON.stringify(p);
    parseProject(json);
    await this.db.transaction('rw', this.db.projects, async () => {
      const prev = await this.db.projects.get(p.id);
      await this.db.projects.put({ id: p.id, name: p.name, updatedAt: p.updatedAt, json, backupJson: prev?.json });
    });
  }

  /** 本体が壊れていればバックアップから復旧する */
  async load(id: string): Promise<ProjectData | undefined> {
    const row = await this.db.projects.get(id);
    if (!row) return undefined;
    try {
      return parseProject(row.json);
    } catch (e) {
      if (row.backupJson) return parseProject(row.backupJson);
      throw e;
    }
  }

  async list() {
    const rows = await this.db.projects.orderBy('updatedAt').reverse().toArray();
    return rows.map(({ id, name, updatedAt }) => ({ id, name, updatedAt }));
  }

  /** テスト用: 生データを書き換える */
  async _corrupt(id: string, json: string) {
    await this.db.projects.update(id, { json });
  }

  close() {
    this.db.close();
  }
}
