/**
 * ます表。公共マス ← 汚水マス 3 個（枝あり）の工事で、申請画面の「ます表」→ 番号・高さ・延長 → PDF。
 */
import { expect, test } from '@playwright/test';
import { createProject, evidence, freshApp, isMobile } from './helpers';
import { testSite } from '../src/model/drainSolve/testSite';
import { placeFixture, portNodes } from '../src/model/fixtures';
import { addPolyline, type Network } from '../src/model/network';
import type { Doc } from '../src/model/doc';

const S = { system: 'sewage' as const, diameter: 100, material: 'VU' };
function site(): Doc {
  const t = testSite(-1200, -4000);
  let doc = t.doc;
  const mh = (x: number, y: number) => { const r = placeFixture(doc, t.floorId, 'manholeSewage', { x, y }); doc = r.doc; return portNodes(doc.network, r.fixtureId!)[0]; };
  const m1 = mh(-2000, 3000), m2 = mh(-2000, 6000), m3 = mh(-2000, 0);
  let net: Network = doc.network;
  net = addPolyline(net, [m1.pos, doc.network.nodes[t.pub].pos], S, { startNodeId: m1.id, endNodeId: t.pub }).net;
  net = addPolyline(net, [m2.pos, m1.pos], S, { startNodeId: m2.id, endNodeId: m1.id }).net;
  net = addPolyline(net, [m3.pos, m1.pos], S, { startNodeId: m3.id, endNodeId: m1.id }).net;
  return { ...doc, network: net };
}

test('ます表: 縦断図と同じ番号・高さ・次のますまでの延長 → PDF', async ({ page }) => {
  await freshApp(page);
  await createProject(page, 'ます表テスト');
  await page.evaluate((d) => { const s = (window as any).__pc.getState(); s.newDoc(d, s.meta); }, site());
  await page.getByTestId('open-shinsei').click();
  await page.getByTestId('shinsei-kind-masu').click();
  const preview = page.getByTestId('shinsei-preview');
  await expect(preview).toContainText('ます表');
  for (const t of ['NO.1', 'NO.2', 'NO.3', '公共', '地盤高', '管底高', '3.00→NO.2', '2.00→公共']) await expect(preview).toContainText(t);
  await page.screenshot({ path: evidence('masu-01') });
  if (!isMobile()) {
    const [pdf] = await Promise.all([page.waitForEvent('download'), page.getByTestId('shinsei-pdf').click()]);
    expect(pdf.suggestedFilename()).toMatch(/ます表.*\.pdf$/);
    if (test.info().project.name === 'pc-chrome') await pdf.saveAs('test-evidence/pc-chrome-masu-02.pdf');
  }
});
