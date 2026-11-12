/**
 * 図面・3D のメモ（現場への指示・確認事項）。
 * 配管・器具・接続口に付けたメモは付けた先について動く（syncNotes を commit の中で呼ぶ）。
 * 申請図面・DXF には出さない（社内の指示）。
 */
import { floorById, type Building } from './building';
import type { Doc } from './doc';
import { FIXTURE_CATALOG, fixtureBaseZ } from './fixtures';
import { newId } from './id';
import { memberCorners } from './members';
import type { Vec3 } from './network';

export type NoteTargetKind = 'segment' | 'fixture' | 'node' | 'wall' | 'room' | 'opening' | 'member' | 'corner';
export type NoteTarget = { kind: NoteTargetKind; id: string };
export type Note = {
  id: string;
  floorId: string;
  /** 平面の位置 mm */
  x: number;
  y: number;
  /** 付けた先がある時だけ: 付けた先の高さ（絶対 mm） */
  z?: number;
  /** 床下の図で置いた（付けていない時の 3D の高さに使う） */
  under?: boolean;
  text: string;
  done?: boolean;
  target?: NoteTarget;
  createdAt: number;
  updatedAt?: number;
};
export type NewNote = Omit<Note, 'id' | 'createdAt' | 'updatedAt'>;

export const NOTE_MAX_TEXT = 1000;
/** 付けていないメモの 3D の高さ（床から）。床下で置いたものは床の下 */
const FREE_Z = 1200, UNDER_Z = -300;

/** 1000 字（UTF-16 の長さ、保存形式と同じ数え方）で切る。絵文字などを半分に割らない */
export function clipNoteText(t: string): string {
  if (t.length <= NOTE_MAX_TEXT) return t;
  const c = t.slice(0, NOTE_MAX_TEXT);
  const last = c.charCodeAt(c.length - 1);
  return last >= 0xd800 && last <= 0xdbff ? c.slice(0, -1) : c;
}

export function addNote(doc: Doc, n: NewNote, now = Date.now()): { doc: Doc; id: string } {
  const id = newId('m');
  const note: Note = { ...n, text: clipNoteText(n.text), id, createdAt: now };
  return { doc: { ...doc, notes: { ...(doc.notes ?? {}), [id]: note } }, id };
}

export function updateNote(doc: Doc, id: string, patch: Partial<Pick<Note, 'text' | 'done' | 'x' | 'y' | 'target' | 'z' | 'under' | 'floorId'>>, now = Date.now()): Doc {
  const cur = doc.notes?.[id];
  if (!cur) return doc;
  const next: Note = { ...cur, ...patch, ...(patch.text !== undefined ? { text: clipNoteText(patch.text) } : {}), updatedAt: now };
  if ('target' in patch && !patch.target) { delete next.target; delete next.z; }
  if (patch.done === false) delete next.done;
  return { ...doc, notes: { ...doc.notes, [id]: next } };
}

export function removeNote(doc: Doc, id: string): Doc {
  if (!doc.notes?.[id]) return doc;
  const notes = { ...doc.notes };
  delete notes[id];
  return { ...doc, notes };
}

export function removeNotesOnFloor(doc: Doc, floorId: string): Doc {
  if (!doc.notes || !Object.values(doc.notes).some((n) => n.floorId === floorId)) return doc;
  return { ...doc, notes: Object.fromEntries(Object.entries(doc.notes).filter(([, n]) => n.floorId !== floorId)) };
}

/** 置いた順の番号（1 から、全階通し） */
export function noteNumbers(notes: Record<string, Note> | undefined): Map<string, number> {
  const list = Object.values(notes ?? {}).sort((a, b) => a.createdAt - b.createdAt || (a.id < b.id ? -1 : 1));
  return new Map(list.map((n, i) => [n.id, i + 1]));
}

/** 線分 ab 上で p に一番近い点 */
function closestOnSegment(a: Vec3, b: Vec3, p: Vec3): Vec3 {
  const d = { x: b.x - a.x, y: b.y - a.y, z: b.z - a.z };
  const len2 = d.x * d.x + d.y * d.y + d.z * d.z;
  const t = len2 > 0 ? Math.max(0, Math.min(1, ((p.x - a.x) * d.x + (p.y - a.y) * d.y + (p.z - a.z) * d.z) / len2)) : 0;
  return { x: a.x + d.x * t, y: a.y + d.y * t, z: a.z + d.z * t };
}

/** メモを付ける位置（配管: 指定した点に一番近い管の上、器具: 器具の上、接続口: その点）。付けた先が無い・建物の部材なら null */
export function noteAnchor(doc: Doc, target: NoteTarget, near?: Vec3): Vec3 | null {
  if (target.kind === 'segment') {
    const s = doc.network.segments[target.id];
    if (!s) return null;
    const a = doc.network.nodes[s.a].pos, b = doc.network.nodes[s.b].pos;
    return closestOnSegment(a, b, near ?? { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, z: (a.z + b.z) / 2 });
  }
  if (target.kind === 'fixture') {
    const f = doc.fixtures[target.id];
    const floor = f && floorById(doc.building, f.floorId);
    if (!f || !floor) return null;
    return { x: f.x, y: f.y, z: fixtureBaseZ(f, floor) + FIXTURE_CATALOG[f.type].size.h };
  }
  if (target.kind === 'node') return doc.network.nodes[target.id]?.pos ?? null;
  return null;
}

/** 建物の部材に付けるときの位置（壁: 真ん中、開口: 中心、部屋・梁など: 中心、角: その点）。無ければ null */
export function buildingNotePoint(b: Building, t: NoteTarget): { x: number; y: number } | null {
  const avg = (ps: { x: number; y: number }[]) => (ps.length ? { x: ps.reduce((a, p) => a + p.x, 0) / ps.length, y: ps.reduce((a, p) => a + p.y, 0) / ps.length } : null);
  if (t.kind === 'corner') { const c = b.corners[t.id]; return c ? { x: c.x, y: c.y } : null; }
  if (t.kind === 'wall' || t.kind === 'opening') {
    const o = t.kind === 'opening' ? b.openings[t.id] : undefined;
    const w = b.walls[o ? o.wallId : t.id];
    if (!w || (t.kind === 'opening' && !o)) return null;
    const ca = b.corners[w.a], cb = b.corners[w.b];
    const len = Math.hypot(cb.x - ca.x, cb.y - ca.y) || 1;
    const s = o ? o.offset / len : 0.5;
    return { x: ca.x + (cb.x - ca.x) * s, y: ca.y + (cb.y - ca.y) * s };
  }
  if (t.kind === 'room') { const r = b.rooms[t.id]; return r ? avg(r.polygon) : null; }
  if (t.kind === 'member') { const m = b.members?.[t.id]; return m ? avg(memberCorners(m)) : null; }
  return null;
}

const FOLLOW = new Set<NoteTargetKind>(['segment', 'fixture', 'node']);
/** 分けた・切った区間へ付け直す範囲: 平面で 60mm（切断の隙間 50mm を含む）、高さは 300mm まで */
const REATTACH_XY = 60, REATTACH_Z = 300;

/** 付けた先の階（配管・接続口は点の階、器具は器具の階、建物の部材はその階）。分からなければ undefined */
export function targetFloorId(doc: Doc, t: NoteTarget): string | undefined {
  const { network: net, building: b } = doc;
  switch (t.kind) {
    case 'fixture': return doc.fixtures[t.id]?.floorId;
    case 'node': { const n = net.nodes[t.id]; return n?.fixtureId ? doc.fixtures[n.fixtureId]?.floorId ?? n.floorId : n?.floorId; }
    case 'segment': { const s = net.segments[t.id]; return s ? net.nodes[s.a]?.floorId ?? net.nodes[s.b]?.floorId : undefined; }
    case 'wall': return b.walls[t.id]?.floorId;
    case 'room': return b.rooms[t.id]?.floorId;
    case 'corner': return b.corners[t.id]?.floorId;
    case 'member': return b.members?.[t.id]?.floorId;
    case 'opening': { const o = b.openings[t.id]; return o ? b.walls[o.wallId]?.floorId : undefined; }
  }
}

/** 消えた区間の代わり: この編集で増えた同じ種類の区間のうち、メモに一番近いもの */
function reattachSegment(doc: Doc, prev: Doc, oldId: string, here: Vec3): string | null {
  const old = prev.network.segments[oldId];
  if (!old) return null; // 前から無い（この編集で消えたのではない）
  let best: { id: string; d: number } | null = null;
  for (const s of Object.values(doc.network.segments)) {
    if (prev.network.segments[s.id] || s.system !== old.system) continue;
    const c = closestOnSegment(doc.network.nodes[s.a].pos, doc.network.nodes[s.b].pos, here);
    const dxy = Math.hypot(c.x - here.x, c.y - here.y);
    if (dxy > REATTACH_XY || Math.abs(c.z - here.z) > REATTACH_Z) continue;
    if (!best || dxy < best.d) best = { id: s.id, d: dxy };
  }
  return best?.id ?? null;
}

/**
 * 付けた先へ位置・階をそろえる。prev（編集の前）を渡すと、この編集で分けた・切った区間に付け直す。
 * 付けた先が消えていたら最後の位置に残す。変わらなければ同じ Doc を返す。
 */
export function syncNotes(doc: Doc, prev?: Doc): Doc {
  if (!doc.notes) return doc;
  let changed: Record<string, Note> | null = null;
  for (const n of Object.values(doc.notes)) {
    if (!n.target || !FOLLOW.has(n.target.kind)) continue;
    let target = n.target;
    const here: Vec3 = { x: n.x, y: n.y, z: n.z ?? 0 };
    if (target.kind === 'segment' && !doc.network.segments[target.id] && prev && n.z !== undefined) {
      const next = reattachSegment(doc, prev, target.id, here);
      if (next) target = { kind: 'segment', id: next };
    }
    const p = noteAnchor(doc, target, here);
    if (!p) continue;
    const floorId = targetFloorId(doc, target) ?? n.floorId;
    if (target === n.target && Math.abs(p.x - n.x) < 1e-6 && Math.abs(p.y - n.y) < 1e-6 && n.z !== undefined && Math.abs(p.z - n.z) < 1e-6 && floorId === n.floorId) continue;
    changed ??= { ...doc.notes };
    changed[n.id] = { ...n, target, x: p.x, y: p.y, z: p.z, floorId };
  }
  return changed ? { ...doc, notes: changed } : doc;
}

/** 付けた先から外して動かす。床より下にあったメモは床下のメモにする */
export function detachNote(doc: Doc, id: string, p: { x: number; y: number }, now = Date.now()): Doc {
  const n = doc.notes?.[id];
  if (!n) return doc;
  const elev = floorById(doc.building, n.floorId)?.elevation ?? 0;
  const under = n.z !== undefined ? n.z < elev : !!n.under;
  const next = updateNote(doc, id, { x: Math.round(p.x), y: Math.round(p.y), target: undefined }, now);
  const m: Note = { ...next.notes![id] };
  if (under) m.under = true; else delete m.under;
  return { ...next, notes: { ...next.notes, [id]: m } };
}

/** 3D に出す高さ（付けた先があればその高さ、無ければ階の床から） */
export function notes3dZ(doc: Doc, n: Note): number {
  if (n.z !== undefined) return n.z;
  const elev = floorById(doc.building, n.floorId)?.elevation ?? 0;
  return elev + (n.under ? UNDER_Z : FREE_Z);
}

/** 付けた先がもう無い（配管・器具・接続口・建物の部材が消えた） */
export function noteTargetMissing(doc: Doc, n: Note): boolean {
  const t = n.target;
  if (!t) return false;
  const b = doc.building;
  switch (t.kind) {
    case 'segment': return !doc.network.segments[t.id];
    case 'fixture': return !doc.fixtures[t.id];
    case 'node': return !doc.network.nodes[t.id];
    case 'wall': return !b.walls[t.id];
    case 'room': return !b.rooms[t.id];
    case 'opening': return !b.openings[t.id];
    case 'member': return !b.members?.[t.id];
    case 'corner': return !b.corners[t.id];
  }
}

/** 一覧を文字にする（LINE などへ送る用）。label は付けた先の名前（無ければ null） */
export function notesText(doc: Doc, projectName: string, label: (t: NoteTarget) => string | null, onlyOpen = false): string {
  const nums = noteNumbers(doc.notes);
  const all = [...nums.keys()].map((id) => doc.notes![id]);
  const open = all.filter((n) => !n.done).length;
  const lines = all.filter((n) => !onlyOpen || !n.done).map((n) => {
    const floor = floorById(doc.building, n.floorId)?.name ?? '';
    const tl = n.target && !noteTargetMissing(doc, n) ? label(n.target) : null;
    const where = [floor, tl].filter(Boolean).join('・');
    const body = n.text.trim().replace(/\s*\n\s*/g, ' ') || '（本文なし）';
    return `${nums.get(n.id)}. ${n.done ? '✓済 ' : ''}${where ? `[${where}] ` : ''}${body}`;
  });
  return [`${projectName} メモ（未対応 ${open} / 全 ${all.length}）`, ...lines].join('\n');
}
