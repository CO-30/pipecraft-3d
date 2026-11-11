/** 排水の自動計算（ストア）: 描く・つなぐ・固定する・戻す */
import { beforeEach, describe, expect, it } from 'vitest';
import { setDrainRulesSource, useStore } from './store';
import { createBuildingFromDims } from '../model/building';
import { emptyNetwork } from '../model/network';
import { resolveDrainRules } from '../model/drainRules';
import { STANDARD_PROFILE } from '../model/municipality';
import { portNodes } from '../model/fixtures';

const s = () => useStore.getState();
const v = (x: number, y: number, z: number) => ({ x, y, z });
const zs = () => Object.values(s().doc.network.nodes).filter((n) => !n.fixtureId).map((n) => n.pos.z).sort((a, b) => a - b);

describe('排水の自動計算（ストア）', () => {
  beforeEach(() => {
    setDrainRulesSource(() => resolveDrainRules(STANDARD_PROFILE));
    const b = createBuildingFromDims({ width: 8000, depth: 6000, floors: 1, floorHeight: 2900, wallThickness: 150, slabThickness: 200 });
    s().newDoc({ building: { ...b, foundation: { slabTop: -550 } }, network: emptyNetwork(), fixtures: {}, site: { designGL: -600 } }, { id: 'p', name: 'テスト', createdAt: 1 });
    s().setDrawAttrs({ system: 'sewage', diameter: 100 });
  });

  it('床下に描くと、外壁に近い端（床下から出る所）が土間、器具の方が 2/100 で高くなる。1 回で戻せる', () => {
    s().drawPolyline([v(4000, 3000, -300), v(300, 3000, -300)]);
    const [lo, hi] = zs();
    expect(lo).toBe(-550);
    expect(hi).toBeCloseTo(-550 + 3700 * 0.02, 1);
    s().undo();
    expect(Object.keys(s().doc.network.nodes)).toHaveLength(0);
  });

  it('公共ますへつなぐと屋外は公共ますから上がり、検査が更新される', () => {
    s().setFixtureType('publicSewage');
    s().placeFixtureAt({ x: -10000, y: 3000 });
    const pub = Object.values(s().doc.fixtures)[0];
    s().updateFixtureParams(pub.id, { invertZ: -1300 });
    const port = portNodes(s().doc.network, pub.id)[0];
    s().drawPolyline([port.pos, v(-500, 3000, -1000)], { startNodeId: port.id });
    const end = Object.values(s().doc.network.nodes).find((n) => n.pos.x === -500)!;
    expect(end.pos.z).toBeCloseTo(-1300 + 9500 * 0.022, 1);
    expect(s().drainIssues.some((i) => i.kind === 'unverifiedRule')).toBe(true);
  });

  it('区間の勾配を固定すると計算し直しても変わらず、外すと既定に戻る。点の高さは手で決めると固定（📌）', () => {
    s().drawPolyline([v(4000, 3000, -300), v(300, 3000, -300)]);
    const seg = Object.values(s().doc.network.segments)[0];
    s().setSegmentSlope(seg.id, 30);
    expect(zs()[1]).toBeCloseTo(-550 + 3700 / 30, 1);
    s().setSegmentSlopeLocked(seg.id, false);
    expect(zs()[1]).toBeCloseTo(-550 + 3700 * 0.02, 1);
    const hiNode = Object.values(s().doc.network.nodes).find((n) => Math.abs(n.pos.x - 4000) < 1)!;
    s().setNodeHeight(hiNode.id, -400);
    expect(s().doc.network.nodes[hiNode.id]).toMatchObject({ zPin: true, pos: { z: -400 } });
    s().drawPolyline([v(4000, 1000, -300), v(300, 1000, -300)]); // 別の配管を描いても固定は残る
    expect(s().doc.network.nodes[hiNode.id].pos.z).toBe(-400);
    s().unpinNodeHeight(hiNode.id);
    expect(s().doc.network.nodes[hiNode.id].pos.z).toBeCloseTo(-550 + 3700 * 0.02, 1);
  });
});

describe('排水の自動計算（読み込み）', () => {
  it('保存された排水の z を書き換えても、開くと計算どおりに戻る', () => {
    setDrainRulesSource(() => resolveDrainRules(STANDARD_PROFILE));
    const b = createBuildingFromDims({ width: 8000, depth: 6000, floors: 1, floorHeight: 2900, wallThickness: 150, slabThickness: 200 });
    s().newDoc({ building: { ...b, foundation: { slabTop: -550 } }, network: emptyNetwork(), fixtures: {}, site: { designGL: -600 } }, { id: 'p', name: 'テスト', createdAt: 1 });
    s().setDrawAttrs({ system: 'sewage', diameter: 100 });
    s().drawPolyline([v(4000, 3000, -300), v(300, 3000, -300)]);
    const p = s().toProjectData()!;
    const nodes = Object.fromEntries(Object.entries(p.network.nodes).map(([id, n]) => [id, { ...n, pos: { ...n.pos, z: -100 } }]));
    s().openProject({ ...p, network: { ...p.network, nodes } });
    const [lo, hi] = zs();
    expect(lo).toBe(-550);
    expect(hi).toBeCloseTo(-550 + 3700 * 0.02, 1);
  });
});

describe('最終レビューの指摘（ストア）', () => {
  beforeEach(() => {
    setDrainRulesSource(() => resolveDrainRules(STANDARD_PROFILE));
    const b = createBuildingFromDims({ width: 8000, depth: 6000, floors: 1, floorHeight: 2900, wallThickness: 150, slabThickness: 200 });
    s().newDoc({ building: { ...b, foundation: { slabTop: -550 } }, network: emptyNetwork(), fixtures: {}, site: { designGL: -600 } }, { id: 'p', name: 'テスト', createdAt: 1 });
    s().setDrawAttrs({ system: 'sewage', diameter: 100 });
  });
  it('取り消し・やり直しで検査も計算し直す', () => {
    s().drawPolyline([v(-500, 3000, -900), v(-5000, 3000, -900)]);
    expect(s().drainIssues.length).toBeGreaterThan(0);
    s().undo();
    expect(s().drainIssues).toEqual([]);
    s().redo();
    expect(s().drainIssues.length).toBeGreaterThan(0);
  });
  it('「勾配を固定」を外すと slopePin も外れる', () => {
    s().drawPolyline([v(4000, 3000, -300), v(300, 3000, -300)]);
    const seg = Object.values(s().doc.network.segments)[0];
    useStore.setState({ doc: { ...s().doc, network: { ...s().doc.network, segments: { ...s().doc.network.segments, [seg.id]: { ...seg, slope: 0.03, slopePin: true } } } } });
    s().setSegmentSlopeLocked(seg.id, false);
    expect(s().doc.network.segments[seg.id].slopePin).toBeUndefined();
  });
  it('排水の点を上下にドラッグすると、その高さで固定（📌）。動かさずに離すと履歴は増えない', () => {
    s().drawPolyline([v(4000, 3000, -300), v(300, 3000, -300)]);
    const n = Object.values(s().doc.network.nodes).find((x) => Math.abs(x.pos.x - 4000) < 1)!;
    const before = s().past.length;
    s().beginDrag(); s().dragNode(n.id, n.pos); s().endDrag();
    expect(s().past.length).toBe(before);
    s().beginDrag(); s().dragNode(n.id, { ...n.pos, z: -200 }); s().endDrag();
    expect(s().doc.network.nodes[n.id]).toMatchObject({ zPin: true, pos: { z: -200 } });
    expect(s().past.length).toBe(before + 1);
  });
});
