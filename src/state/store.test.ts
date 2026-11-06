import { beforeEach, describe, expect, it } from 'vitest';
import { findUpstreamBranchPoint, useStore } from './store';
import { emptyNetwork, totalLength, validateNetwork } from '../model/network';

const v = (x: number, y: number, z = 0) => ({ x, y, z });
const s = () => useStore.getState();

beforeEach(() => s().load(emptyNetwork()));

describe('共通ストア', () => {
  it('描画→分岐→Undo→Redo', () => {
    s().drawPolyline([v(0, 0), v(4000, 0)]);
    const seg = Object.keys(s().network.segments)[0];
    s().branch(seg, v(2000, 0), [v(2000, 1000)]);
    expect(totalLength(s().network)).toBe(5000);
    s().undo();
    expect(totalLength(s().network)).toBe(4000);
    s().redo();
    expect(totalLength(s().network)).toBe(5000);
    expect(validateNetwork(s().network)).toEqual([]);
  });

  it('ドラッグ移動は確定時に履歴1件だけ', () => {
    s().drawPolyline([v(0, 0), v(4000, 0)]);
    const node = Object.keys(s().network.nodes)[0];
    const before = s().past.length;
    s().beginDrag();
    for (let i = 1; i <= 20; i++) s().dragNode(node, v(-i * 10, 0));
    s().endDrag();
    expect(s().past.length).toBe(before + 1);
    s().undo();
    expect(s().network.nodes[node].pos.x).toBe(0);
  });

  it('枝管を選んで分岐単位削除すると本管だけ残る', () => {
    s().drawPolyline([v(0, 0), v(4000, 0)]);
    const seg = Object.keys(s().network.segments)[0];
    s().branch(seg, v(2000, 0), [v(2000, 1000), v(3000, 1000)]);
    // branch 後は枝の最終区間が選択されている
    s().deleteSelectedBranch();
    expect(totalLength(s().network)).toBe(4000);
    expect(validateNetwork(s().network)).toEqual([]);
  });
});

describe('枝管ごと削除の対象', () => {
  it('両側に分岐点がある本管区間は曖昧なので対象なし(null)', () => {
    s().drawPolyline([v(0, 0), v(6000, 0)]);
    let seg = Object.keys(s().network.segments)[0];
    s().branch(seg, v(2000, 0), [v(2000, 1000)]);
    seg = Object.values(s().network.segments).find((x) => s().network.nodes[x.b].pos.x === 6000 || s().network.nodes[x.a].pos.x === 6000)!.id;
    s().branch(seg, v(4000, 0), [v(4000, 1000)]);
    const mid = Object.values(s().network.segments).find((x) => {
      const xs = [s().network.nodes[x.a].pos.x, s().network.nodes[x.b].pos.x].sort((a, b) => a - b);
      return xs[0] === 2000 && xs[1] === 4000;
    })!;
    expect(findUpstreamBranchPoint(s().network, mid.id)).toBeNull();
  });
  it('存在しない区間IDでも例外を出さない', () => {
    expect(findUpstreamBranchPoint(s().network, 'nope')).toBeNull();
  });
});
