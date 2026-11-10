/**
 * 器具の真下に配管を落とす: 給水・給湯・排水・汚水の接続口から、床下（屋外の器具は地中）まで立て管を作る。
 * すでに配管のつながっている接続口には何もしない。純粋関数。
 */
import { floorById } from './building';
import type { Doc } from './doc';
import { FIXTURE_CATALOG, groundZ, portNodes, type FixtureType } from './fixtures';
import { addRiser, segmentsAt, type SystemType } from './network';

/** 床下へ落とす深さの初期値（床からの mm） */
export const DEFAULT_DROP_DEPTH = 300;
/** 屋外の器具を地中へ落とす深さ（GL からの mm） */
export const OUTDOOR_DROP_DEPTH = 300;
export const DROP_MIN = 50, DROP_MAX = 3000;

/** 真下に落とす器具（機器どうしを横につなぐ給湯器・メーター・ヘッダー・マスなどは対象外） */
const DROP_TYPES = new Set<FixtureType>(['toilet', 'washbasin', 'kitchen', 'bathtub', 'shower', 'washer', 'faucet', 'mixFaucet', 'outdoorFaucet']);
const OUTDOOR = new Set<FixtureType>(['outdoorFaucet']);
const DROP_SYSTEMS = new Set<SystemType>(['water', 'hotWater', 'drain', 'sewage']);

export type DropResult = { doc: Doc; pipes: number; fixtures: number };

/** depth: 床から下へ何 mm。fixtureIds: 省略時はすべての器具 */
export function dropFixturePipes(doc: Doc, depth = DEFAULT_DROP_DEPTH, fixtureIds?: string[]): DropResult {
  let net = doc.network;
  let pipes = 0;
  const done = new Set<string>();
  for (const f of Object.values(doc.fixtures)) {
    if (fixtureIds && !fixtureIds.includes(f.id)) continue;
    if (!DROP_TYPES.has(f.type)) continue;
    const floor = floorById(doc.building, f.floorId);
    if (!floor) continue;
    const z = OUTDOOR.has(f.type) ? groundZ(doc.building, doc.site) - OUTDOOR_DROP_DEPTH : floor.elevation - depth;
    for (const n of portNodes(net, f.id)) {
      const port = FIXTURE_CATALOG[f.type].ports.find((p) => p.id === n.portId);
      if (!port || !DROP_SYSTEMS.has(port.system)) continue;
      if (segmentsAt(net, n.id).length > 0 || n.pos.z - z < 10) continue;
      const r = addRiser(net, n.id, z, { system: port.system, diameter: port.diameter });
      if (!r) continue;
      net = r.net;
      pipes++;
      done.add(f.id);
    }
  }
  return pipes ? { doc: { ...doc, network: net }, pipes, fixtures: done.size } : { doc, pipes: 0, fixtures: 0 };
}
