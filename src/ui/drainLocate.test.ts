/** 排水の注意の一覧（書類センター）: 並べ方と、図面のどこへ移動するか */
import { describe, expect, it } from 'vitest';
import { drainRows, locateTarget, MAX_DRAIN_ROWS } from './drainLocate';
import type { DrainIssue } from '../model/drainSolve';
import type { Doc } from '../model/doc';

const issue = (level: DrainIssue['level'], target: DrainIssue['target'], message = 'm'): DrainIssue => ({ kind: 'minSlope', level, target, message, fixes: [] });
const doc = {
  building: { floors: [{ id: 'f1' }, { id: 'f2' }] },
  fixtures: { m1: { id: 'm1', floorId: 'f2', type: 'masu', x: 0, y: 0, rotation: 0 } },
  network: {
    nodes: { a: { id: 'a', floorId: 'f2', pos: { x: 0, y: 0, z: 0 } }, b: { id: 'b', pos: { x: 1, y: 0, z: 0 } } },
    segments: { s1: { id: 's1', a: 'a', b: 'b', system: 'sewage', diameter: 100 } },
  },
} as unknown as Doc;

describe('drainRows', () => {
  it('お知らせ（info）は出さず、ストアの何番目の注意かを持つ（直すボタンがずれないように）', () => {
    const rows = drainRows([issue('info', { kind: 'site', id: '' }), issue('error', { kind: 'segment', id: 's1' }, 'x'), issue('warn', { kind: 'node', id: 'a' }, 'y')]);
    expect(rows.map((r) => [r.index, r.issue.message])).toEqual([[1, 'x'], [2, 'y']]);
  });
  it('上限は 6 件', () => { expect(MAX_DRAIN_ROWS).toBe(6); });
});

describe('locateTarget', () => {
  it('配管は端の点の階に切り替えて選ぶ', () => {
    expect(locateTarget(doc, { kind: 'segment', id: 's1' })).toEqual({ floorId: 'f2', selection: { kind: 'segment', id: 's1' } });
  });
  it('マス（器具）はその器具の階', () => {
    expect(locateTarget(doc, { kind: 'fixture', id: 'm1' })).toEqual({ floorId: 'f2', selection: { kind: 'fixture', id: 'm1' } });
  });
  it('階の分からない点は階を変えずに選ぶ', () => {
    expect(locateTarget(doc, { kind: 'node', id: 'b' })).toEqual({ selection: { kind: 'node', id: 'b' } });
  });
  it('もう無い配管・敷地全体の注意は移動先なし（押しても何も起きないボタンを出さない）', () => {
    expect(locateTarget(doc, { kind: 'segment', id: 'gone' })).toBeNull();
    expect(locateTarget(doc, { kind: 'site', id: '' })).toBeNull();
  });
});
