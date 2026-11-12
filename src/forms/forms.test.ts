import { describe, expect, test } from 'vitest';
import { readFileSync } from 'node:fs';
import ExcelJS from 'exceljs';
import { PDFArray, PDFDocument } from 'pdf-lib';
import { addFloor, emptyBuilding } from '../model/building';
import type { Doc } from '../model/doc';
import { addPolyline, emptyNetwork } from '../model/network';
import { placeFixture, portNodes } from '../model/fixtures';
import { BUILTIN_PROFILES } from '../model/municipality';
import { buildIsometric } from '../model/isometric';
import { buildProfile, extractRoute } from '../model/profileDrawing';
import { renderProfileSheet } from '../export/profileSheet';
import { renderIsoSheet } from '../export/isoSheet';
import { sheetsToPdf, sheetToSvg } from '../export/sheet';
import { circled, EMPTY_CONTRACTOR, markChoice, markWord, reiwa, withDefaults, type Contractor } from './types';
import { FEES, meterDiameter, OKINAWA_FIELDS, OKINAWA_FORMS } from './okinawaCity';
import { BACK_SHEET_NAME, boxPx, buildWaterApplication, CELLS, IMAGE_BOXES, pngSize, SHEET_NAME } from './waterExcel';
import { buildSewerApplication } from './sewerPdf';
import { productRows, renderProductListSheets } from './productList';

const v = (x: number, y: number, z = 0) => ({ x, y, z });
const font = () => readFileSync('public/fonts/NotoSansJP-JIS.ttf');
const waterTpl = () => readFileSync('public/forms/okinawa-city/water-application.xlsx');
const sewerTpl = () => readFileSync('public/forms/okinawa-city/sewer-application.pdf');

const contractor: Contractor = { ...EMPTY_CONTRACTOR, name: 'テスト設備', licenseNo: '123', sewerLicenseNo: '下 45', zip: '904-0000', address: '沖縄市テスト1-1', representative: '代表 太郎', tel: '098-000-0000', chiefEngineer: '主任 花子', drainageEngineer: '排水 次郎', drainageEngineerNo: '登 678' };

function doc(): Doc {
  let d: Doc = { building: addFloor(emptyBuilding(), { height: 3000 }).b, network: emptyNetwork(), fixtures: {}, site: { designGL: -100 } };
  const fl = d.building.floors[0].id;
  const m = placeFixture(d, fl, 'waterMeter', { x: 0, y: 0 }); d = m.doc;
  const mp = portNodes(d.network, m.fixtureId!).find((p) => p.portId === 'out') ?? portNodes(d.network, m.fixtureId!)[0];
  const f = placeFixture(d, fl, 'faucet', { x: 3000, y: 0 }); d = f.doc;
  const fp = portNodes(d.network, f.fixtureId!)[0];
  d = { ...d, network: addPolyline(d.network, [mp.pos, v(3000, 0, 1000), fp.pos], { system: 'water', diameter: 20, material: 'HI' }, { startNodeId: mp.id, endNodeId: fp.id }).net };
  const a = placeFixture(d, fl, 'manholeSewage', { x: 0, y: 5000 }); d = a.doc;
  const b = placeFixture(d, fl, 'publicSewage', { x: 8000, y: 5000 }); d = b.doc;
  const ap = portNodes(d.network, a.fixtureId!)[0], bp = portNodes(d.network, b.fixtureId!)[0];
  d = { ...d, network: addPolyline(d.network, [ap.pos, bp.pos], { system: 'sewage', diameter: 100, material: 'VU' }, { startNodeId: ap.id, endNodeId: bp.id }).net };
  return d;
}

describe('様式の共通部品', () => {
  test('丸数字・選択肢の印・和暦', () => {
    expect(circled(1)).toBe('①'); expect(circled(8)).toBe('⑧');
    expect(markChoice('1. 直結　2. 受水槽　3. 直結増圧給水', 2)).toBe('1. 直結　②受水槽　3. 直結増圧給水');
    expect(markChoice('   1.   一般用    2.   公衆浴場用', 1)).toBe('   ①一般用    2.   公衆浴場用');
    expect(markWord('　有  　　無', '無')).toBe('　有  　　○無');
    expect(reiwa('2026-11-10')).toEqual({ year: 8, month: 11, day: 10 });
    expect(reiwa('')).toBeUndefined();
  });
  test('既定値は現場から（メーター口径・公共ます・階数）。入力済みの値が優先', () => {
    const d = doc();
    expect(meterDiameter(d)).toBe(20);
    const vals = withDefaults(OKINAWA_FORMS, d, { name: '現場', address: '沖縄市美里5-28-2' });
    expect(vals.diameter).toBe('20');
    expect(vals.feeAdmission).toBe(String(FEES.admission[20]));
    expect(vals.sewerConnection).toBe('公共ます');
    expect(vals.sewerConnected).toBe('有');
    expect(vals.siteAddress).toBe('沖縄市美里5-28-2');
    const d2 = { ...d, site: { ...d.site, application: { diameter: '25', applicantName: '上里', feeDesign: '', lending: '' } } };
    const vals2 = withDefaults(OKINAWA_FORMS, d2, { name: '現場' });
    expect(vals2.diameter).toBe('25');
    expect(vals2.applicantName).toBe('上里');
    // 空にした項目は既定値に戻らない（手書きしたい手数料など）
    expect(vals2.feeDesign).toBe('');
    expect(vals2.lending).toBe('');
    expect(vals2.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    // 項目 id は重複しない
    const ids = OKINAWA_FIELDS.map((f) => f.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('給水装置申込及び工事申請書（Excel）', () => {
  test('同梱テンプレートに記入例の個人情報・画像が残っていない', async () => {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(waterTpl() as unknown as ArrayBuffer);
    const ws = wb.getWorksheet(SHEET_NAME)!;
    expect(ws).toBeTruthy();
    expect(wb.worksheets.map((w) => w.name)).toEqual([SHEET_NAME, '申請書（裏）']);
    expect(ws.getImages().length).toBe(0);
    for (const addr of ['D14', 'O15', 'M16', 'O16', 'M20', 'M24', 'M25', 'M27', 'D39', 'B41', 'D46', 'N34', 'O35', 'V31', 'V35']) expect(ws.getCell(addr).value ?? null).toBeNull();
    // 文書のプロパティにも名前を残さない
    expect(wb.creator ?? '').toBe('');
    expect(wb.lastModifiedBy ?? '').toBe('');
    expect(wb.company ?? '').toBe('');
    expect(String(ws.getCell('A14').value)).toBe('設置場所');
    expect(String(ws.getCell('K15').value)).toBe('交付番号');
    expect(String(ws.getCell('D29').value)).toContain('一般家庭用');
    expect(String(ws.getCell('I31').value)).toContain('直結');
  });
  test('値を差し込む: 住所・氏名・工事店・丸数字・手数料の合計', async () => {
    const d = doc();
    const vals = { ...withDefaults(OKINAWA_FORMS, d, { name: '現場', address: '沖縄市美里5-28-2' }), date: '2026-11-10', applicantName: '水道 太郎', applicantKana: 'スイドウ タロウ', applicantAddress: '沖縄市仲宗根町26-1', applicantTel: '098-937-5093', supplyType: '受水槽', useType: '一般家庭用（アパート）', households: '4', purpose: '一般用' };
    const bytes = await buildWaterApplication(waterTpl(), vals, contractor);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(bytes as unknown as ArrayBuffer);
    const ws = wb.getWorksheet(SHEET_NAME)!;
    const s = (a: string) => String(ws.getCell(a).value ?? '');
    expect(s(CELLS.date)).toContain('令和　8　年　11　月　10　日');
    expect(s(CELLS.workKind['新設'])).toBe('○新設');
    expect(s(CELLS.siteAddress)).toBe('沖縄市美里5-28-2');
    expect(s(CELLS.applicantName)).toBe('水道 太郎');
    expect(s(CELLS.userName)).toBe('水道 太郎'); // 使用者は申込者と同じ
    expect(ws.getCell(CELLS.licenseNo).value).toBe(123);
    expect(s(CELLS.zip)).toBe('〒904-0000');
    expect(s(CELLS.name)).toBe('テスト設備');
    expect(s(CELLS.chiefEngineer)).toBe('主任 花子');
    expect(s(CELLS.useType1)).toContain('①');
    expect(s(CELLS.useType1)).toContain('○アパート');
    expect(s(CELLS.supplyType)).toContain('②受水槽');
    expect(s(CELLS.sewerConnected)).toContain('○有');
    expect(s(CELLS.purpose)).toContain('①一般用');
    expect(ws.getCell(CELLS.households).value).toBe(4);
    expect(ws.getCell(CELLS.diameter).value).toBe(20);
    expect(ws.getCell(CELLS.meterDiameter).value).toBe(20);
    expect(ws.getCell(CELLS.feeAdmission).value).toBe(32450);
    expect(ws.getCell(CELLS.feeTotal).value).toBe(32450 + 160 + 980);
    expect(wb.lastModifiedBy).toBe('PipeCraft 3D');
    expect(wb.creator).toBe('PipeCraft 3D');
    // 階数・構造を空にするとテンプレートの記入例が残らない。空白だけの数値は書かない
    const bytes2 = await buildWaterApplication(waterTpl(), { ...vals, floors: '', structure: '', households: '  ' }, contractor);
    const wb2 = new ExcelJS.Workbook(); await wb2.xlsx.load(bytes2 as unknown as ArrayBuffer);
    const ws2 = wb2.getWorksheet(SHEET_NAME)!;
    expect(ws2.getCell(CELLS.floors).value ?? null).toBeNull();
    expect(ws2.getCell(CELLS.structure).value ?? null).toBeNull();
    expect(ws2.getCell(CELLS.households).value ?? null).toBeNull();
  });
  test('図の画像（PNG）を 表の建物側面図・裏の平面図とアイソメ の欄に貼る', async () => {
    // 1×1 の PNG
    const png = Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64'));
    const bytes = await buildWaterApplication(waterTpl(), { date: '2026-11-10' }, contractor, { sideView: png, plan: png, iso: png });
    const wb = new ExcelJS.Workbook(); await wb.xlsx.load(bytes as unknown as ArrayBuffer);
    const front = wb.getWorksheet(SHEET_NAME)!, back = wb.getWorksheet(BACK_SHEET_NAME)!;
    expect(front.getImages().length).toBe(1);
    expect(back.getImages().length).toBe(2);
    const r = front.getImages()[0].range;
    expect(r.tl.nativeCol).toBe(IMAGE_BOXES.sideView.tl.col);
    expect(r.tl.nativeRow).toBe(IMAGE_BOXES.sideView.tl.row);
    // 縦横比を保って欄に収める（1×1 の PNG → 欄の短い辺に合わせた正方形）
    const box = boxPx(front, IMAGE_BOXES.sideView);
    expect(box.width).toBeGreaterThan(100); expect(box.height).toBeGreaterThan(100);
    expect(pngSize(png)).toEqual({ width: 1, height: 1 });
    const ext = (front.getImages()[0].range as unknown as { ext?: { width: number; height: number } }).ext;
    if (ext) { expect(ext.width).toBe(ext.height); expect(ext.width).toBeLessThanOrEqual(Math.min(box.width, box.height)); }
    // 画像なしなら貼らない
    const wb2 = new ExcelJS.Workbook(); await wb2.xlsx.load((await buildWaterApplication(waterTpl(), {}, contractor)) as unknown as ArrayBuffer);
    expect(wb2.getWorksheet(SHEET_NAME)!.getImages().length).toBe(0);
  });
  test('選択肢は全部に印が付く（様式が変わったら気づける）', async () => {
    const wb = new ExcelJS.Workbook(); await wb.xlsx.load(waterTpl() as unknown as ArrayBuffer);
    const tpl = wb.getWorksheet(SHEET_NAME)!;
    const { USE_TYPES: U, SUPPLY_TYPES: S, PURPOSES: P, WATER_WORK_KINDS: W } = await import('./okinawaCity');
    const { fillWaterApplication } = await import('./waterExcel');
    const str = (ws: ExcelJS.Worksheet, a: string) => String(ws.getCell(a).value ?? '');
    const marked = (ws: ExcelJS.Worksheet, a: string) => str(ws, a) !== str(tpl, a) && /[①-⑳○]/.test(str(ws, a));
    for (const [i, u] of U.entries()) {
      const wbx = new ExcelJS.Workbook(); await wbx.xlsx.load(waterTpl() as unknown as ArrayBuffer); const ws = wbx.getWorksheet(SHEET_NAME)!;
      fillWaterApplication(ws, { useType: u, useTypeOther: 'x' }, contractor);
      expect(marked(ws, i <= 5 ? CELLS.useType1 : CELLS.useType2), u).toBe(true);
    }
    for (const [list, key, cell] of [[S, 'supplyType', CELLS.supplyType], [P, 'purpose', CELLS.purpose]] as const) {
      for (const o of list) {
        const wbx = new ExcelJS.Workbook(); await wbx.xlsx.load(waterTpl() as unknown as ArrayBuffer); const ws = wbx.getWorksheet(SHEET_NAME)!;
        fillWaterApplication(ws, { [key]: o }, contractor);
        expect(marked(ws, cell), o).toBe(true);
      }
    }
    for (const w of W) {
      const wbx = new ExcelJS.Workbook(); await wbx.xlsx.load(waterTpl() as unknown as ArrayBuffer); const ws = wbx.getWorksheet(SHEET_NAME)!;
      fillWaterApplication(ws, { waterWorkKind: w }, contractor);
      expect(str(ws, CELLS.workKind[w])).toBe(`○${w}`);
    }
  });
});

describe('下水道排水設備計画確認申請書（PDF）', () => {
  test('1 面に文字、2 面に縦断図、3 面に立面図。4 面は空のまま', async () => {
    const d = doc();
    const p = BUILTIN_PROFILES.find((x) => x.id === 'okinawa-city')!;
    const outlet = Object.values(d.network.nodes).find((n) => n.fixtureId && d.fixtures[n.fixtureId]?.type === 'publicSewage')!;
    const r = extractRoute(d.network, outlet.id);
    const model = buildProfile(d, 'route' in r ? r.route : [], p, '排水設備 縦断図');
    const meta = { siteName: '現場', date: new Date(2026, 10, 10) };
    const profileSheet = renderProfileSheet(model, meta, buildIsometric(d, 'drain', p));
    const isoSheet = renderIsoSheet(buildIsometric(d, 'drain', p), p, { ...meta, title: '配管立図' });
    const vals = { ...withDefaults(OKINAWA_FORMS, d, { name: '現場', address: '沖縄市美里5-28-2' }), date: '2026-11-10', applicantName: '水道 太郎', applicantAddress: '沖縄市仲宗根町26-1', workFrom: '2026-12-01', workTo: '2026-12-10', people: '4', sewerBuildingUse: 'アパート', apartmentHouseholds: '2' };
    const bytes = await buildSewerApplication(sewerTpl(), font(), vals, contractor, { profile: profileSheet, iso: isoSheet });
    const pdf = await PDFDocument.load(bytes);
    expect(pdf.getPageCount()).toBe(4);
    const sizes = pdf.getPages().map((pg) => pg.getSize());
    expect(sizes[0].width).toBeCloseTo(595.32, 0);
    // 2・3 面には図面が描かれ、4 面は元のまま（内容の長さで比べる）
    // 描き足したページは内容が配列（元のストリーム＋追加分）になる
    const added = (i: number) => pdf.getPages()[i].node.Contents() instanceof PDFArray;
    expect(added(0)).toBe(true);
    expect(added(1)).toBe(true);
    expect(added(2)).toBe(true);
    expect(added(3)).toBe(false);
  });
  test('見取図を渡すと 4 面に地図の画像ごと描かれる', async () => {
    const { renderLocationSheet, MAP_PX } = await import('../export/locationSheet');
    const { PDFDict, PDFName } = await import('pdf-lib');
    const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
    const location = renderLocationSheet({ map: { href: PNG, wPx: MAP_PX.w, hPx: MAP_PX.h, mpp: 1.07 }, siteName: '現場', address: '沖縄市美里5-28-2', date: new Date(2026, 10, 12) });
    const pdf = await PDFDocument.load(await buildSewerApplication(sewerTpl(), font(), { date: '2026-11-12' }, contractor, { location }));
    const p4 = pdf.getPages()[3];
    expect(p4.node.Contents() instanceof PDFArray).toBe(true);
    expect(p4.node.Resources()?.lookup(PDFName.of('XObject'), PDFDict)?.keys().length).toBeGreaterThanOrEqual(1);
  });
  test('フォントに無い字（髙・﨑）は置き換えて例外にせず、missing に集める', async () => {
    const vals = { date: '2026-11-10', applicantName: '髙橋 﨑夫', applicantAddress: '沖縄市' };
    const missing = new Set<string>();
    const bytes = await buildSewerApplication(sewerTpl(), font(), vals, contractor, {}, { missing });
    expect(bytes.length).toBeGreaterThan(1000);
    expect([...missing].sort()).toEqual(['髙', '﨑']);
    const sheet = { width: 210, height: 297, ops: [{ t: 'text' as const, x: 10, y: 10, s: '髙', size: 3 }] };
    const m2 = new Set<string>();
    await sheetsToPdf([sheet], font(), { missing: m2 });
    expect([...m2]).toEqual(['髙']);
  });
  test('様式の面数が足りなければエラー', async () => {
    const one = await PDFDocument.create(); one.addPage([595, 842]);
    await expect(buildSewerApplication(await one.save(), font(), {}, contractor, {})).rejects.toThrow('4');
  });
});

describe('給水装置使用製品一覧表', () => {
  test('給水の管・部品・メーターの行。15 行で 1 枚、超えたら 2 枚', async () => {
    const d = doc();
    const rows = productRows(d);
    expect(rows.some((r) => r.name.includes('給水') && r.spec.includes('HI') && r.qty.endsWith('m'))).toBe(true);
    expect(rows.some((r) => r.name === '水道メーター')).toBe(true);
    expect(rows.some((r) => r.spec.includes('VU'))).toBe(false); // 排水は入れない
    const sheets = renderProductListSheets(rows, { siteName: '現場', date: new Date(2026, 10, 10) }, contractor);
    expect(sheets.length).toBe(1);
    const svg = sheetToSvg(sheets[0]);
    expect(svg).toContain('給水装置使用製品一覧表');
    expect(svg).toContain('工事名：現場');
    expect(svg).toContain('テスト設備');
    expect(svg).toContain('主任 花子');
    expect(svg).toContain('viewBox="0 0 297 210"');
    const many = Array.from({ length: 16 }, (_, i) => ({ name: `品${i}`, spec: '', qty: '1 個', maker: '' }));
    expect(renderProductListSheets(many, { siteName: 'x', date: new Date() }, contractor).length).toBe(2);
    const pdf = await sheetsToPdf(sheets, font());
    expect(pdf.length).toBeGreaterThan(1000);
  });
});
