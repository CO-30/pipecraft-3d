/**
 * 申請書類を作る（画面の出力ボタンと「提出書類一式」で共通）。ファイルの中身・名前・お知らせを返し、保存は呼ぶ側でする。
 */
import type { Doc } from '../model/doc';
import type { MunicipalityProfile } from '../model/municipality';
import type { Sheet } from '../export/sheet';
import { todayIso, type ApplicationValues, type Contractor } from './types';
import { drainageSheetsFor, drawingTitleValues, waterSheetFor } from './formSets';
import { roadValues } from '../road/fields';
import type { ProductMemory } from './fixtureProducts';

export type FormWhat = 'water' | 'sewer' | 'products' | 'nanbu' | 'nanbuProducts' | 'haebaruSewer';
export type Produced = { bytes: Uint8Array; filename: string; mime: string; notes: string[] };
export type ProduceEnv = {
  doc: Doc; profile: MunicipalityProfile; siteName: string; date: Date;
  /** 現場の住所（meta.address） */
  address?: string;
  values: ApplicationValues; contractor: Contractor;
  /** 画面の 2D 平面図（表示中なら。沖縄市の給水申請書の裏面に貼る） */
  planEl?: SVGSVGElement | null;
  fontBytes: () => Promise<ArrayBuffer>;
  formBytes: (path: string) => Promise<ArrayBuffer>;
  productMemory: () => Promise<ProductMemory | undefined>;
};

const PDF = 'application/pdf';
const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
/** YYYY-MM-DD をその日の 0 時（端末の時刻）に。読めなければ今日 */
const localDate = (iso: string | undefined) => { const m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(iso ?? ''); return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : new Date(); };

export async function produceForm(what: FormWhat, env: ProduceEnv): Promise<Produced> {
  const { doc, profile, siteName, date, values, contractor, address } = env;
  const [{ safeName }, { dateStamp }] = await Promise.all([import('../export/download'), import('../export/report')]);
  const base = `${safeName(siteName)}_${dateStamp(new Date())}`;
  const vals = { ...values, date: values.date || todayIso() };
  const notes: string[] = [];
  if (what === 'water') {
    const [{ buildWaterApplication }, { svgStringToPng, planPng }, { sheetToSvg }, tpl] = await Promise.all([import('./waterExcel'), import('../export/images'), import('../export/sheet'), env.formBytes('okinawa-city/water-application.xlsx')]);
    // 図の欄: 建物側面図 ← 給水の立面図、裏の平面図 ← 画面の 2D 平面図（表示中なら）、裏のアイソメ ← 給水の立面図
    const images: { sideView?: Uint8Array; plan?: Uint8Array; iso?: Uint8Array } = {};
    try {
      const ws = waterSheetFor(doc, profile, siteName, date);
      if (ws) { const png = await svgStringToPng(sheetToSvg(ws), 1400); images.sideView = png; images.iso = png; }
      else notes.push('給水の配管が無いため、建物側面図の欄は空欄です');
      if (env.planEl) images.plan = await planPng(env.planEl, 2);
      else notes.push('裏面の平面図は空欄です（2D 平面図を表示した状態で出すと貼られます）');
    } catch (e) { console.error('図の画像', e); notes.push('図の画像を作れなかったため、図の欄は空欄です'); }
    return { bytes: await buildWaterApplication(tpl, vals, contractor, images), filename: `${base}_給水装置申込及び工事申請書.xlsx`, mime: XLSX, notes };
  }
  if (what === 'sewer') {
    const [{ buildSewerApplication }, tpl, font] = await Promise.all([import('./sewerPdf'), env.formBytes('okinawa-city/sewer-application.pdf'), env.fontBytes()]);
    const { profile: pf, iso: isoSheet } = drainageSheetsFor(doc, profile, siteName, date, drawingTitleValues(vals, contractor.name, address));
    const sheets: { profile?: Sheet; iso?: Sheet; location?: Sheet } = { ...(pf ? { profile: pf } : {}), ...(isoSheet ? { iso: isoSheet } : {}) };
    const { buildLocationSheet } = await import('../import/locationMap');
    const loc = await buildLocationSheet(doc.site?.application, { siteName, address: (vals as ApplicationValues).siteAddress || address || '', date });
    if (loc?.mapOk) sheets.location = loc.sheet;
    const missing = new Set<string>();
    const bytes = await buildSewerApplication(tpl, font, vals, contractor, sheets, { missing });
    if (!sheets.profile) notes.push('排水の配管が無いため、2・3 面の図面は空欄です');
    else if (profile.paper.orientation === 'landscape') notes.push('プロファイルの用紙が横のため、2・3 面の図は小さくなります（A4 縦のプロファイルを使うと読みやすくなります）');
    if (!loc) notes.push('4 面の見取図は空欄です（申請図面の「見取図」で工事場所を決めると貼られます）');
    else if (!loc.mapOk) notes.push(`4 面の見取図は空欄です（${loc.notes[0] ?? '地図を取得できませんでした'}）`);
    else notes.push(...loc.notes);
    if (missing.size) notes.push(`フォントに無い文字を置き換えました: ${[...missing].join(' ')}（出力後に手で直してください）`);
    return { bytes, filename: `${base}_下水道排水設備計画確認申請書.pdf`, mime: PDF, notes };
  }
  if (what === 'haebaruSewer') {
    // 南風原町の排水設備計画確認申請書: 4 面（申請書・平面図及び縦断面図・配管立図・見取図）＋ 実寸の平面図（A3）と縦断面図（A4）
    const [{ haebaruSewerSheets }, { sheetsToPdf }, font, { buildLocationSheet }] = await Promise.all([import('./haebaruSewer'), import('../export/sheet'), env.fontBytes(), import('../import/locationMap')]);
    const tv = drawingTitleValues(vals, contractor.name, address);
    const ds = drainageSheetsFor(doc, profile, siteName, date, tv, { extra: true });
    const loc = await buildLocationSheet(doc.site?.application, { siteName, address: (vals as ApplicationValues).siteAddress || address || '', date });
    if (!ds.plan) notes.push('排水の配管が無いため、2・3 面の図は空欄です');
    else if (!ds.profile) notes.push('公共マスまでつながっていないため、縦断面図と配管立図は空欄です（平面図だけ入れています）');
    if (!loc) notes.push('4 面の見取図は空欄です（申請図面の「見取図」で工事場所を決めると入ります）');
    else if (!loc.mapOk) notes.push(`4 面の見取図は空欄です（${loc.notes[0] ?? '地図を取得できませんでした'}）`);
    const sheets = [...haebaruSewerSheets(vals, contractor, { plan: ds.plan, profile: ds.profileOnly ?? ds.profile, iso: ds.iso, map: loc?.mapOk ? loc.sheet : undefined }), ...(ds.plan ? [ds.plan] : []), ...(ds.profile ? [ds.profile] : [])];
    const missing = new Set<string>();
    const bytes = await sheetsToPdf(sheets, font, { missing });
    if (ds.plan) notes.push('5 枚目に平面図（A3）、6 枚目に立面図・縦断面図（A4）を付けています');
    if (missing.size) notes.push(`フォントに無い文字を置き換えました: ${[...missing].join(' ')}`);
    return { bytes, filename: `${base}_排水設備計画確認申請書.pdf`, mime: PDF, notes };
  }
  if (what === 'nanbu' || what === 'nanbuProducts') {
    const [{ nanbuSheets }, { fixtureProducts, renderNanbuProductSheets }, { sheetsToPdf }, font] = await Promise.all([import('./nanbuSheets'), import('./fixtureProducts'), import('../export/sheet'), env.fontBytes()]);
    const memory = (await env.productMemory().catch(() => undefined)) ?? {};
    const products = renderNanbuProductSheets(fixtureProducts(doc, vals, memory), { date: localDate(vals.date) }, contractor);
    const missing = new Set<string>();
    const fontNote = () => { if (missing.size) notes.push(`フォントに無い文字を置き換えました: ${[...missing].join(' ')}`); };
    if (what === 'nanbuProducts') {
      const bytes = await sheetsToPdf(products, font, { missing });
      fontNote();
      return { bytes, filename: `${base}_給水装置使用製品一覧表.pdf`, mime: PDF, notes };
    }
    const { buildLocationSheet } = await import('../import/locationMap');
    const loc = await buildLocationSheet(doc.site?.application, { siteName, address: (vals as ApplicationValues).siteAddress || address || '', date });
    if (!loc) notes.push('見取図は空欄です（申請図面の「見取図」で工事場所を決めると入ります）');
    else if (!loc.mapOk) notes.push(`見取図は空欄です（${loc.notes[0] ?? '地図を取得できませんでした'}）`);
    const rv = roadValues(doc, { name: siteName, address }, contractor, {});
    let roadSection: Sheet | undefined;
    if (rv['road.water'] === 'する') {
      const [{ renderRoadSection }, { roadTakeoffs }] = await Promise.all([import('../road/drawSheets'), import('../road/model')]);
      roadSection = renderRoadSection(rv, roadTakeoffs(rv), { siteName, address: address ?? '', date });
    } else notes.push('横断面図は空欄です（道路の手続きで「水道の取出し」を「する」にすると入ります）');
    const iso = waterSheetFor(doc, profile, siteName, date);
    if (!iso) notes.push('給水の配管が無いため、立面図は入っていません');
    const sheets = [...nanbuSheets(vals, contractor, { siteName, date, products: [], map: loc?.mapOk ? loc.sheet : undefined, roadSection }), ...(iso ? [iso] : []), ...products];
    const bytes = await sheetsToPdf(sheets, font, { missing });
    notes.push('平面図・水理計算書（所要水頭計算書）は申請図面の「まとめてPDF」から出せます');
    fontNote();
    return { bytes, filename: `${base}_給水申請書類一式.pdf`, mime: PDF, notes };
  }
  const [{ productRows, renderProductListSheets }, { sheetsToPdf }, font] = await Promise.all([import('./productList'), import('../export/sheet'), env.fontBytes()]);
  const missing = new Set<string>();
  const bytes = await sheetsToPdf(renderProductListSheets(productRows(doc), { siteName, date }, contractor), font, { missing });
  if (missing.size) notes.push(`フォントに無い文字を置き換えました: ${[...missing].join(' ')}`);
  return { bytes, filename: `${base}_給水装置使用製品一覧表.pdf`, mime: PDF, notes };
}

/** 道路の申請書類一式。values は roadValues（提出先の記憶を合わせたもの） */
export async function produceRoad(env: { doc: Doc; siteName: string; date: Date; address: string; values: ApplicationValues; fontBytes: () => Promise<ArrayBuffer> }): Promise<Produced> {
  const { doc, siteName, date, values, address } = env;
  const [{ roadSheets }, { sheetsToPdf }, { safeName }, { dateStamp }, { buildLocationSheet }, font] = await Promise.all([import('../road/drawSheets'), import('../export/sheet'), import('../export/download'), import('../export/report'), import('../import/locationMap'), env.fontBytes()]);
  const m = { siteName, address: values['road.place'] || address, date };
  const sheets = roadSheets(values, m);
  const notes: string[] = [];
  const loc = await buildLocationSheet(doc.site?.application, { siteName, address: m.address, date }).catch(() => null);
  if (loc?.mapOk) sheets.splice(2, 0, loc.sheet);
  else notes.push(loc ? `位置図は入れていません（${loc.notes[0] ?? '地図を取得できませんでした'}）` : '位置図は入れていません（申請図面の「見取図」で工事場所を決めると 3 枚目に入ります）');
  const missing = new Set<string>();
  const bytes = await sheetsToPdf(sheets, font, { missing });
  if (missing.size) notes.push(`フォントに無い文字を置き換えました: ${[...missing].join(' ')}（出力後に手で直してください）`);
  return { bytes, filename: `${safeName(siteName)}_${dateStamp(new Date())}_道路の申請書類.pdf`, mime: PDF, notes };
}
