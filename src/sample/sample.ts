/**
 * サンプル工事（練習用）。2階建ての家に 水道メーター → 屋上タンク → 1階の器具 の給水と、トイレの汚水を配管した例。
 * 画面の操作と同じストアの操作で組み立てるので、手で作った工事と同じデータになる。毎回新しく作るので壊しても良い。
 */
import { useStore, type ProjectMeta } from '../state/store';
import { createBuildingFromDims } from '../model/building';
import { emptyNetwork, projectOnSegment, dist, type Vec3 } from '../model/network';
import { defaultEstimate } from '../model/estimate';
import type { FixtureType } from '../model/fixtures';

export const SAMPLE_NAME = 'サンプル工事（練習用）';

const v = (x: number, y: number, z: number): Vec3 => ({ x, y, z });

export function buildSample(meta: ProjectMeta): void {
  const st = () => useStore.getState();
  const building = createBuildingFromDims({ width: 9100, depth: 7280, floors: 2, floorHeight: 2900, wallThickness: 150, slabThickness: 200 });
  st().newDoc({ building, network: emptyNetwork(), fixtures: {}, estimate: defaultEstimate(), underlays: {}, elevations: {} }, meta);
  const [f1, f2] = building.floors;

  const place = (floorId: string, type: FixtureType, x: number, y: number) => {
    st().setActiveFloor(floorId);
    st().setFixtureType(type);
    st().placeFixtureAt({ x, y });
    return Object.values(st().doc.fixtures).find((f) => f.type === type)!.id;
  };
  const port = (fixtureId: string, portId: string) => Object.values(st().doc.network.nodes).find((n) => n.fixtureId === fixtureId && n.portId === portId)!;

  const meter = place(f1.id, 'waterMeter', -1000, 3000);
  const tank = place(f2.id, 'roofTank', 4000, 3500);
  const toilet = place(f1.id, 'toilet', 1000, 1000);
  const basin = place(f1.id, 'washbasin', 2500, 1000);
  const kitchen = place(f1.id, 'kitchen', 6500, 6000);
  st().setActiveFloor(f1.id);

  const ROOF_RUN = 6900; // 屋上の配管の高さ（タンクの入口と同じ）
  const UNDER = -300; // 床下

  // メーター → 外壁沿いに立ち上げ → 屋上を通って屋上タンクの入口へ
  st().setDrawAttrs({ system: 'water', diameter: 20 });
  const mOut = port(meter, 'out'), tIn = port(tank, 'in');
  st().drawPolyline([mOut.pos, v(-500, mOut.pos.y, mOut.pos.z), v(-500, mOut.pos.y, ROOF_RUN), v(-500, tIn.pos.y, ROOF_RUN), tIn.pos], { startNodeId: mOut.id, endNodeId: tIn.id });

  // 屋上タンクの出口 → 下ろして床下の本管
  st().setDrawAttrs({ system: 'water', diameter: 25 });
  const tOut = port(tank, 'out');
  st().drawPolyline([tOut.pos, v(5000, tOut.pos.y, tOut.pos.z), v(5000, tOut.pos.y, UNDER), v(800, tOut.pos.y, UNDER)], { startNodeId: tOut.id });

  // 本管から各器具へ分岐（φ20）
  const mainY = tOut.pos.y;
  const segAt = (p: Vec3) => Object.keys(st().doc.network.segments).find((id) => dist(projectOnSegment(st().doc.network, id, p).pos, p) < 1)!;
  const branchTo = (x: number, fixtureId: string, portId: string, via: Vec3[] = []) => {
    const end = port(fixtureId, portId);
    const at = v(x, mainY, UNDER);
    st().setDrawAttrs({ system: 'water', diameter: 20 });
    st().branch(segAt(at), at, [...via, v(end.pos.x, end.pos.y, UNDER), end.pos], { endNodeId: end.id });
  };
  const tw = port(toilet, 'water').pos, bw = port(basin, 'water').pos, kw = port(kitchen, 'water').pos;
  branchTo(tw.x, toilet, 'water');
  branchTo(bw.x, basin, 'water');
  branchTo(4000, kitchen, 'water', [v(4000, kw.y, UNDER)]);

  // トイレの汚水 → 床下へ下ろして屋外へ
  const ts = port(toilet, 'sewage');
  st().setDrawAttrs({ system: 'sewage', diameter: 75 });
  st().drawPolyline([ts.pos, v(ts.pos.x, ts.pos.y, -400), v(ts.pos.x, -800, -400)], { startNodeId: ts.id });

  // 描画の初期値を戻し、練習用なので履歴は空にする（「戻す」でサンプルが消えないように）
  st().setDrawAttrs({ system: 'water', diameter: 20 });
  useStore.setState({ past: [], future: [], selection: null, tool: 'select', notice: null });
}
