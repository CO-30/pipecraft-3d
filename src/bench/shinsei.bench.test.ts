/**
 * 実物の図面で「新しい工事 → 器具の候補を置く → 汚水・水・湯をまとめてつなぐ → 申請図面」を画面と同じ流れで再現し、
 * 申請画面の注意（⚠）・エラー・干渉・排水の注意を数える（手元だけ。図面は個人情報を含むのでリポジトリに入れない）。
 *   BENCH_DIR=<フォルダ> npx vitest run src/bench/shinsei.bench.test.ts（WHERE=1 で注意の管の位置、SVG_OUT=<フォルダ> で縦断図・平面図・ます表の SVG も出す）
 * フォルダの中は 1 件 = 1 フォルダ（PDF 一式。address.txt があれば現場の住所。public.json {x,y,invertZ?} があれば、つなぐ前にそこへ公共汚水ますを置く）。結果は <フォルダ>/shinsei.md と画面に出す。
 */
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { readPlanInputs } from '../import/planSet';
import { buildFromSheets } from '../model/planRead/assemble';
import { emptyNetwork } from '../model/network';
import { defaultEstimate } from '../model/estimate';
import { applySite } from '../model/siteApply';
import { placeFixture } from '../model/fixtures';
import { minSlopeFor, resolveProfile } from '../model/municipality';
import { resolveSupplyRules } from '../model/hydraulics/supplyRules';
import { outletCandidates } from '../model/outlets';
import { defaultRiserRoot } from '../model/riser';
import { findPipeClashes } from '../model/clash';
import { calcSupply } from '../model/hydraulics/calc';
import { readSuiriSettings } from '../model/hydraulics/settings';
import { useStore } from '../state/store';
import { computeEstimate } from '../model/estimate';
import { BUNDLE_KINDS, buildShinsei, type ShinseiCtx } from '../ui/shinseiBuild';

const dir = process.env.BENCH_DIR;

/** 申請画面の全タブの注意・エラー（画面と同じ既定の選択: 最初の下流端・最初の起点・枝は全部） */
export function shinseiReport(): { lines: string[]; total: number } {
  const st = useStore.getState();
  const doc = st.doc;
  const profile = resolveProfile(doc.site?.municipalityProfileId, []);
  const outletId = outletCandidates(doc)[0]?.id ?? '';
  const rootId = defaultRiserRoot(doc) ?? '';
  const rules = resolveSupplyRules({ address: st.meta?.address });
  const ctx: ShinseiCtx = {
    doc, outletId, rootId, pick: {}, profile, profileMissing: false, siteName: st.meta?.name ?? '現場', date: new Date(2026, 10, 18), matAxis: 'place', asBuiltOn: false,
    suiri: calcSupply(doc, rules, readSuiriSettings(doc.site?.application)), mitori: { build: null, loading: false },
  };
  const lines: string[] = [];
  let total = 0;
  for (const k of BUNDLE_KINDS) {
    if (k === 'mitori') continue; // 地図（ネット）が要る
    const b = buildShinsei(k, ctx);
    if (process.env.SVG_OUT && (k === 'profile' || k === 'plan' || k === 'masu')) writeFileSync(join(process.env.SVG_OUT, `${st.meta?.name}-${k}.svg`), b.svg);
    if (b.error) { lines.push(`- [${k}] エラー: ${b.error}`); total++; }
    for (const w of b.warnings) { lines.push(`- [${k}] ⚠ ${w}`); total++; }
  }
  const clashes = findPipeClashes(doc);
  for (const c of clashes) lines.push(`- [干渉] ${JSON.stringify(c).slice(0, 240)}`);
  for (const i of st.drainIssues) {
    const s = i.target.kind === 'segment' ? doc.network.segments[i.target.id] : undefined;
    const at = s && process.env.WHERE ? ` @${JSON.stringify([doc.network.nodes[s.a].pos, doc.network.nodes[s.b].pos].map((p) => [Math.round(p.x), Math.round(p.y), Math.round(p.z)]))}` : '';
    lines.push(`- [排水の注意] ${i.message}${at}`);
  }
  // 積算の要確認（単価の未登録は単価タブで入れるものなので数だけ）
  const est = computeEstimate(doc).issues;
  for (const i of est.filter((x) => x.kind !== 'noPrice')) lines.push(`- [積算の要確認] ${i.message}`);
  lines.push(`- [積算] 単価の未登録 ${est.filter((x) => x.kind === 'noPrice').length} 件`);
  return { lines, total };
}

describe.skipIf(!dir)('実物の図面で申請画面の注意を数える（BENCH_DIR）', () => {
  it('フォルダごとに 読み取り → まとめてつなぐ → 申請図面の注意', async () => {
    const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
    const cases = readdirSync(dir!).filter((n) => statSync(join(dir!, n)).isDirectory()).sort();
    expect(cases.length).toBeGreaterThan(0);
    const out: string[] = [`# 申請画面の注意（${new Date().toISOString().slice(0, 10)}）`, ''];
    for (const c of cases) {
      const files = readdirSync(join(dir!, c)).filter((n) => /\.pdf$/i.test(n)).sort()
        .map((n) => { const b = readFileSync(join(dir!, c, n)); return { name: n, data: b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer }; });
      const address = existsSync(join(dir!, c, 'address.txt')) ? readFileSync(join(dir!, c, 'address.txt'), 'utf8').trim() : undefined;
      const { inputs } = await readPlanInputs(files, pdfjs);
      const res = buildFromSheets(inputs);
      // App.tsx の create と同じ
      const doc0 = { building: res.building, network: emptyNetwork(), fixtures: {}, estimate: defaultEstimate(), underlays: {}, elevations: {}, site: res.designGL === undefined ? {} : { designGL: res.designGL } };
      const f1 = doc0.building.floors[0]?.id;
      const withSite = res.site && f1 ? applySite(doc0, f1, res.site).doc : doc0;
      const st = useStore.getState();
      st.newDoc(withSite, { id: 'bench', name: c, address, createdAt: 1 });
      st.placeFixtureCandidates(res.fixtures.map((f) => ({ floorId: f.floorId, type: f.type, x: f.x, y: f.y, rotation: f.rotation })));
      if (existsSync(join(dir!, c, 'public.json'))) {
        const pub = JSON.parse(readFileSync(join(dir!, c, 'public.json'), 'utf8')) as { x: number; y: number; invertZ?: number };
        const d = useStore.getState().doc;
        st.newDoc(placeFixture(d, d.building.floors[0].id, 'publicSewage', { x: pub.x, y: pub.y }, 0, pub.invertZ !== undefined ? { invertZ: pub.invertZ } : undefined).doc, useStore.getState().meta!);
      }
      // Panels.tsx の auto-connect と同じ
      const p = resolveProfile(useStore.getState().doc.site?.municipalityProfileId, []);
      const supply = resolveSupplyRules({ profileName: p.id === 'standard' ? undefined : p.name, address });
      useStore.getState().autoConnectAll({ drainRules: { cover: p.profileTable.minCover, slopeFor: (d) => minSlopeFor(p, d) }, supply });
      const fx = Object.values(useStore.getState().doc.fixtures).map((f) => f.type);
      const r = shinseiReport();
      out.push(`## ${c}`, '', `器具: ${fx.join('・')}`, '', `知らせ: ${useStore.getState().notice}`, '', `申請画面の注意・エラー: ${r.total} 件`, '', ...r.lines, '');
    }
    const md = out.join('\n');
    writeFileSync(join(dir!, 'shinsei.md'), md);
    console.log(md);
  }, 600_000);
});
