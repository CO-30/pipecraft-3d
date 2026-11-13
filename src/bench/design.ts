/**
 * 読み取り結果 → 「新しい工事」と同じように工事を作り、器具の候補を全部置いて「汚水・水・湯をまとめてつなぐ」を押した状態にする。
 * 数量の照合（quantity.ts）の「自動」側。画面の操作（App.tsx の create → 候補を置く → store.autoConnectAll）と同じ関数を使う。
 */
import { autoConnect } from '../model/autoConnect';
import type { Doc } from '../model/doc';
import { defaultEstimate } from '../model/estimate';
import { placeFixture } from '../model/fixtures';
import { materialSummary, type MatSummary } from '../model/materialSummary';
import { assignAutoMaterials } from '../model/materials';
import { emptyNetwork } from '../model/network';
import { tagNodeFloors } from '../model/pipeFloors';
import type { PlanSetResult } from '../model/planRead/assemble';
import { applySite } from '../model/siteApply';

export function designFromReading(res: PlanSetResult): { doc: Doc; summary: MatSummary; notes: string[] } {
  let doc: Doc = {
    building: res.building, network: emptyNetwork(), fixtures: {}, estimate: defaultEstimate(), underlays: {}, elevations: {},
    site: res.designGL === undefined ? {} : { designGL: res.designGL },
  };
  const f1 = doc.building.floors[0]?.id;
  if (res.site && f1) doc = applySite(doc, f1, res.site).doc;
  for (const c of res.fixtures) doc = placeFixture(doc, c.floorId, c.type, { x: c.x, y: c.y }, c.rotation).doc;
  const r = autoConnect(doc);
  const added = Object.keys(r.doc.network.segments).filter((id) => !doc.network.segments[id]);
  const net = assignAutoMaterials(r.doc.network, r.doc.building, added.filter((id) => !r.doc.network.segments[id].material));
  const out: Doc = { ...r.doc, network: tagNodeFloors(net, r.doc.building.floors, f1) };
  return { doc: out, summary: materialSummary(out, 'place'), notes: r.summary };
}
