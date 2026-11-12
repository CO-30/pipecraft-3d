/** テスト用の工事: 8000 × 6000 の外壁で囲んだ平屋（FL 0、土間 −550）。西の外に公共ます（管底 pubZ） */
import { emptyDoc } from '../../state/store';
import type { Doc } from '../doc';
import { addFloor, addWall, emptyBuilding, type Building } from '../building';
import { placeFixture, portNodes } from '../fixtures';

export function testSite(pubZ = -1200, pubX = -10700): { doc: Doc; pub: string; floorId: string } {
  const f = addFloor(emptyBuilding(), { height: 2900 });
  let b: Building = { ...f.b, foundation: { slabTop: -550 } };
  const P = [{ x: 0, y: 0 }, { x: 8000, y: 0 }, { x: 8000, y: 6000 }, { x: 0, y: 6000 }];
  for (let i = 0; i < 4; i++) b = addWall(b, f.floorId, P[i], P[(i + 1) % 4], { kind: 'exterior' }).b;
  const p = placeFixture({ ...emptyDoc(), building: b, site: { designGL: -600 } }, f.floorId, 'publicSewage', { x: pubX, y: 3000 }, 0, { invertZ: pubZ });
  return { doc: p.doc, pub: portNodes(p.doc.network, p.fixtureId!)[0].id, floorId: f.floorId };
}
