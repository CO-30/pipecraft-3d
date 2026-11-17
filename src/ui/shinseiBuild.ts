/**
 * 申請図面の作図（画面のタブ表示と「まとめてPDF」で共通）。doc と選択から、図面のページ・注意・エラーを作る純粋関数。
 */
import { useStore } from '../state/store';
import { FIXTURE_CATALOG } from '../model/fixtures';
import type { MunicipalityProfile } from '../model/municipality';
import { buildRouteProfiles, extractRoute, manholeNodes, type ProfileModel } from '../model/profileDrawing';
import { buildRiser, type RiserModel } from '../model/riser';
import { renderProfileSheet } from '../export/profileSheet';
import { renderRiserSheet } from '../export/riserSheet';
import { buildIsometric, isoManholeLabels } from '../model/isometric';
import { renderIsoSheet } from '../export/isoSheet';
import { renderDrainPlanSheet } from '../export/drainPlanSheet';
import { sheetToSvg, type Sheet } from '../export/sheet';
import { renderSuiriSheets } from '../export/suiriSheet';
import { materialSummary, type MatAxis } from '../model/materialSummary';
import { renderMaterialSheets } from '../export/materialSheet';
import { sleeveSchedule } from '../model/sleeves';
import { renderSleeveSheets } from '../export/sleeveSheet';
import { renderManholeSheets } from '../export/manholeSheet';
import { manholeTable } from '../model/manholeTable';
import { findPipeClashes } from '../model/clash';
import { applyMeasuredToProfile, approxSegments, asBuiltTitle, suspiciousMeasured, measuredLengthOf, unmeasuredSegments, type AsBuiltSettings } from '../model/asBuilt';
import { stampAsBuilt } from '../export/asBuiltStamp';
import { dateJa } from '../export/report';
import type { calcSupply } from '../model/hydraulics/calc';
import type { LocationBuild } from '../import/locationMap';

type Doc = ReturnType<typeof useStore.getState>['doc'];
export type Kind = 'profile' | 'plan' | 'riser' | 'forms' | 'suiri' | 'mitori' | 'sleeve' | 'material' | 'masu';
export const PROFILE_TITLE = '排水設備 縦断図';
export const RISER_TITLE = '給水装置 立面図';

/** 図面の名前（タブ・ファイル名・まとめ出力の一覧） */
export const KIND_LABEL: Record<Exclude<Kind, 'forms'>, string> = {
  profile: '排水縦断図', plan: '排水平面図', riser: '給水立面図', suiri: '水理計算書', sleeve: 'スリーブ表', masu: 'ます表', material: '材料表', mitori: '見取図',
};
/** 「まとめてPDF」の並び（提出の順: 案内図 → 排水 → 給水 → その他） */
export const BUNDLE_KINDS: Exclude<Kind, 'forms'>[] = ['mitori', 'plan', 'profile', 'masu', 'riser', 'suiri', 'sleeve', 'material'];

export const nodeLabelOf = (doc: Doc, nodeId: string): string => {
  const n = doc.network.nodes[nodeId];
  const fx = n?.fixtureId ? doc.fixtures[n.fixtureId] : undefined;
  return fx ? FIXTURE_CATALOG[fx.type].label : `点 ${nodeId.slice(-4)}`;
};

/** 区間の図面上の長さ（実測を無視した 3D の長さ） */
const geometricLength = (doc: ReturnType<typeof useStore.getState>['doc']) => measuredLengthOf({ ...doc, network: { ...doc.network, segments: Object.fromEntries(Object.entries(doc.network.segments).map(([k, v]) => [k, { ...v, measuredLength: undefined }])) } });

export type ShinseiBuild = { sheets: Sheet[]; svg: string; warnings: string[]; error: string | null; kind: Kind;
  /** 竣工図: 図に出ている区間（実測長の一覧に出す）と図面の長さ */
  /** 見取図: 地図が取れず枠だけ */
  mapMissing?: boolean;
  asBuilt?: { segIds: string[]; unmeasured: number; modelLen: Record<string, number>; labels: Record<string, string>; /** この図には長さを書かない（立面図） */ noLengths?: boolean } };

/** 竣工図の注意: 未入力・図面とかけ離れた実測（単位の入れ違いなど）・按分の概算 */
function asBuiltNotes(doc: Doc, segIds: string[], modelLen: Record<string, number>, labels: Record<string, string>, unmeasured: number): string[] {
  const out: string[] = [];
  if (unmeasured) out.push(`実測長が未入力の区間が ${unmeasured} あります（その区間は図面の長さで描いています）`);
  for (const id of suspiciousMeasured(doc, segIds, modelLen)) out.push(`${labels[id] ?? '区間'}: 実測 ${Math.round(doc.network.segments[id].measuredLength! * 10) / 10}mm が図面 ${Math.round(modelLen[id])}mm と大きく違います（単位は mm）`);
  const approx = approxSegments(doc, segIds);
  if (approx.length) out.push(`区間を分けたときに長さの比で分けた概算の実測長が ${approx.length} 区間あります（測り直すと正確になります）`);
  return out;
}

/** 作図に要るもの（画面の選択・設定） */
export type ShinseiCtx = {
  doc: Doc; outletId: string; rootId: string; pick: Record<string, string>;
  profile: MunicipalityProfile; profileId?: string; profileMissing: boolean;
  siteName: string; date: Date; matAxis: MatAxis; asBuiltOn: boolean;
  /** 水理計算（kind === 'suiri' のときだけ使う） */
  suiri: ReturnType<typeof calcSupply> | null;
  /** 見取図: 工事場所の緯度（未設定なら undefined）・作った地図・読み込み中か */
  mapLat?: number; mitori: { build: LocationBuild | null; loading: boolean };
  /** 表題欄の値（申請地・申請者・指定工事店。drawingTitleValues） */
  titleValues?: Record<string, string>;
};

/** 1 種類の図面を作る（竣工の印は stampAsBuiltBuild で押す） */
export function buildShinsei(kind: Kind, c: ShinseiCtx): ShinseiBuild {
  const { doc, outletId, rootId, pick, profile, profileId, profileMissing, siteName, date, matAxis, suiri } = c;
  const asBuilt = { on: c.asBuiltOn };
  const mapSettings = { lat: c.mapLat };
  if (kind === 'forms') return { sheets: [], svg: '', warnings: [], error: null, kind };
  const titleValues = c.titleValues;
  if (kind === 'plan') {
    // 排水平面図: 桝の番号は縦断図と同じ（下流端を選んでいればその経路の NO.n）
    let labels: Record<string, string> | undefined;
    if (outletId) {
      const r = extractRoute(doc.network, outletId, pick, manholeNodes(doc));
      if (!('error' in r)) labels = isoManholeLabels(buildRouteProfiles(doc, r, profile, PROFILE_TITLE, () => PROFILE_TITLE));
    }
    const sheet = renderDrainPlanSheet(doc, profile, { siteName, date, manholeLabels: labels, titleValues });
    if (!sheet) return { sheets: [], svg: '', warnings: [], error: '排水の配管がありません。図面でマスを置き、排水の配管をつないでください', kind };
    const warnings = profileMissing ? [`現場の自治体プロファイル（${profileId}）がこの端末に見つからないため、標準で描いています`] : [];
    if (!labels) warnings.push('下流端（公共マス）が決まっていないため、マスの番号は種類名で書いています');
    return { sheets: [sheet], svg: sheetToSvg(sheet), warnings, error: null, kind };
  }
  if (kind === 'material') {
    // 材料集計表: 管・部品・器具・マスを分け方（屋内外／階／新設既設）の列で
    const sum = materialSummary(doc, matAxis);
    const sheets = renderMaterialSheets(sum, { siteName, date });
    if (!sheets.length) return { sheets: [], svg: '', warnings: [], error: '材料（配管・器具）がありません。図面で配管や器具を置いてください', kind };
    return { sheets, svg: sheets.map(sheetToSvg).join(''), warnings: sum.warnings, error: null, kind };
  }
  if (kind === 'sleeve') {
    // スリーブ表: 配管が構造（基礎・梁・壁・床）を通る所。干渉があれば知らせる（積算の要確認から場所へ移動できる）
    const rows = sleeveSchedule(doc);
    const clashes = findPipeClashes(doc).length;
    const notes = clashes ? [`配管どうしの干渉が ${clashes} か所あります（積算の「要確認」から場所へ移動できます）`] : [];
    if (!rows.length) return { sheets: [], svg: '', warnings: notes, error: 'スリーブ（配管が基礎・梁・壁・床を通る所）はありません', kind };
    const { sheets, collisions } = renderSleeveSheets(doc, rows, { siteName, date });
    if (collisions) notes.push('位置図の番号の札が重なっている所があります。表の No. で確かめてください');
    return { sheets, svg: sheets.map(sheetToSvg).join(''), warnings: notes, error: null, kind };
  }
  if (kind === 'mitori') {
    if (mapSettings.lat === undefined) return { sheets: [], svg: '', warnings: [], error: '工事場所が決まっていません。住所を入れて「探す」を押してください（緯度,経度でも指定できます）', kind };
    // 新しい地図ができるまでは前の見取図を出したまま「読み込んでいます」（出力は新しい地図ができてから）
    const loading = c.mitori.loading;
    const b = c.mitori.build;
    if (!b) return { sheets: [], svg: '', warnings: [loading ? '地図を読み込んでいます…' : '見取図を作れませんでした'], error: null, kind };
    const notes = b.mapOk ? b.notes : [...b.notes, '地図が無いため、枠だけの見取図です（手で書き込んで使えます）'];
    return { sheets: loading ? [] : [b.sheet], svg: sheetToSvg(b.sheet), warnings: loading ? ['地図を読み込んでいます…'] : notes, error: null, kind, ...(!loading && !b.mapOk ? { mapMissing: true } : {}) };
  }
  if (kind === 'suiri') {
    if (!suiri) return { sheets: [], svg: '', warnings: [], error: null, kind };
    if ('error' in suiri) return { sheets: [], svg: '', warnings: [], error: suiri.error, kind };
    const sheets = renderSuiriSheets(suiri, { siteName, date });
    return { sheets, svg: sheets.map(sheetToSvg).join(''), warnings: [...suiri.unverified.map((u) => `要確認: ${u}`), ...suiri.warnings], error: null, kind };
  }
  if (kind === 'masu') {
    // ます表: 縦断図と同じモデルから（番号・高さの基準が縦断図と一致する。竣工図なら実測の延長・勾配）
    if (!outletId) return { sheets: [], svg: '', warnings: [], error: '排水の配管がありません。図面でマスを置き、排水の配管をつないでください', kind };
    const r = extractRoute(doc.network, outletId, pick, manholeNodes(doc));
    if ('error' in r) return { sheets: [], svg: '', warnings: [], error: r.error, kind };
    const ab = asBuilt.on;
    const models0 = buildRouteProfiles(doc, r, profile, PROFILE_TITLE, () => PROFILE_TITLE);
    let unmeasured = 0;
    const models = ab ? models0.map((m) => { const x = applyMeasuredToProfile(m, doc); unmeasured += x.unmeasured.length; return x.model; }) : models0;
    const table = manholeTable(doc, models, r.omitted.map((o) => o.atNodeId));
    if (!table.rows.length) return { sheets: [], svg: '', warnings: [], error: 'この下流端につながるマスがありません。器具の「マス（排水）」から置いて排水の管でつないでください', kind };
    const pos = Object.fromEntries(table.rows.map((row) => [row.nodeId, doc.network.nodes[row.nodeId]?.pos]).filter(([, q]) => q)) as Record<string, { x: number; y: number }>;
    const sheets = renderManholeSheets(doc, table, pos, { siteName, date, title: ab ? asBuiltTitle('ます表') : 'ます表', numbersOnProfile: profile.profileTable.manholeLabel === 'above' });
    const warnings = [...models.flatMap((m) => m.warnings.map((w) => w.message))];
    if (profileMissing) warnings.unshift(`現場の自治体プロファイル（${profileId}）がこの端末に見つからないため、標準で描いています`);
    if (table.outside) warnings.push(`この表に入っていないマスが ${table.outside} 個あります（別の系統など。下流端を選び直すと、その系統のます表になります）`);
    for (const o of r.omitted) warnings.push(`枝の中の分岐（${nodeLabelOf(doc, o.atNodeId)}）の先のマスは入っていません。別の下流端を選んで作ってください`);
    if (ab && unmeasured) warnings.push(`実測長が未入力の区間 ${unmeasured} か所は、図面の長さで延長・勾配を出しています`);
    return { sheets, svg: sheets.map(sheetToSvg).join(''), warnings: [...new Set(warnings)], error: null, kind, ...(ab ? { asBuilt: { segIds: [], unmeasured, modelLen: {}, labels: {}, noLengths: true } } : {}) };
  }
  if (kind === 'profile') {
    if (!outletId) return { sheets: [], svg: '', warnings: [], error: '排水の配管がありません。図面でマスを置き、排水の配管をつないでください', kind };
    const r = extractRoute(doc.network, outletId, pick, manholeNodes(doc));
    if ('error' in r) return { sheets: [], svg: '', warnings: [], error: r.error, kind };
    // 分岐の枝は別図。本線の分岐点に「→別図 枝n」と記す
    const notes: Record<string, string> = {};
    r.branches.forEach((b, i) => { notes[b.atNodeId] = [notes[b.atNodeId], `→別図 枝${i + 1}`].filter(Boolean).join(' '); });
    const ab = asBuilt.on;
    const T = ab ? asBuiltTitle(PROFILE_TITLE) : PROFILE_TITLE;
    // 枝は本線の基準（公共桝の管底）と桝番号の続きを使う（合流のマスは本線の名前のまま）
    const models: ProfileModel[] = buildRouteProfiles(doc, r, profile, T, (i, at) => `${T}（枝${i + 1}: ${nodeLabelOf(doc, at)} から）`, notes);
    // 沖縄市の様式: 縦断図の上に排水のアイソメ図（立面図・展開図）
    const iso = profile.profileTable.drainageIsometric ? buildIsometric(doc, 'drain', profile, { ...(ab ? { lengthOf: measuredLengthOf(doc) } : {}), ...(profile.profileTable.manholeText === 'naikeiFuka' ? { manholeLabels: isoManholeLabels(models) } : {}) }) : undefined;
    // 竣工図: 延長を実測にする（図面の長さは一覧に出す）
    const modelLen: Record<string, number> = {};
    for (const m of models) for (const sg of m.segments) if (sg.distance >= 1) modelLen[sg.segId] = sg.distance;
    const unmeasured = new Set<string>();
    const drawn = ab ? models.map((m) => { const x = applyMeasuredToProfile(m, doc); x.unmeasured.forEach((u) => unmeasured.add(u)); return x.model; }) : models;
    const sheets = drawn.map((m, i) => renderProfileSheet(m, { siteName, date, titleValues }, i === 0 ? iso : undefined));
    // 注意は描いたモデルから（竣工図では勾配の注意を実測で出し直している）
    const warnings = drawn.flatMap((m) => m.warnings.map((w) => w.message));
    if (iso && iso.lines.length === 0) warnings.push('排水の立面図（展開図）を描く配管がないため、縦断図だけを出しています');
    for (const o of r.omitted) warnings.push(`枝の中の分岐（${nodeLabelOf(doc, o.atNodeId)}）は図に含めていません。別の下流端を選んで別に作図してください`);
    if (profileMissing) warnings.unshift(`現場の自治体プロファイル（${profileId}）がこの端末に見つからないため、標準で描いています`);
    if (ab) {
      // 一覧の名前: 「枝1 区間2 NO.1→NO.2」（注意の「区間 n」と同じ番号）
      const labels: Record<string, string> = {};
      models.forEach((m, mi) => m.segments.forEach((sg, k) => {
        if (sg.distance < 1) return;
        const nm = (n: (typeof m.nodes)[number] | undefined) => n?.manhole?.name ?? '点';
        labels[sg.segId] = `${mi > 0 ? `枝${mi} ` : ''}区間${k + 1} ${nm(m.nodes[k])}→${nm(m.nodes[k + 1])}`;
      }));
      // 縦断図に載る排水の展開図（沖縄市）の区間も一覧に入れる（長さを書くため）
      if (iso) {
        const geo = geometricLength(doc);
        for (const l of iso.lines) if (!(l.segId in modelLen)) { modelLen[l.segId] = geo(l.segId); labels[l.segId] = '展開図'; }
        unmeasuredSegments(doc, iso.lines.map((l) => l.segId)).forEach((u) => unmeasured.add(u));
      }
      const segIds = Object.keys(modelLen);
      warnings.unshift(...asBuiltNotes(doc, segIds, modelLen, labels, unmeasured.size));
      return { sheets, svg: '', warnings, error: null, kind, asBuilt: { segIds, unmeasured: unmeasured.size, modelLen, labels } };
    }
    return { sheets, svg: sheets.map(sheetToSvg).join(''), warnings, error: null, kind };
  }
  if (!rootId) return { sheets: [], svg: '', warnings: [], error: '給水の配管がありません。水道メーターを置き、給水の配管をつないでください', kind };
  if (profile.riser.lineStyle === 'isometric') {
    // アイソメ図（3D を斜めから見た展開図）。沖縄市の様式
    const iso = buildIsometric(doc, 'water', profile, asBuilt.on ? { lengthOf: measuredLengthOf(doc) } : {});
    if (iso.lines.length === 0) return { sheets: [], svg: '', warnings: [], error: '給水の配管がありません。水道メーターを置き、給水の配管をつないでください', kind };
    const sheet = renderIsoSheet(iso, profile, { siteName, date, title: asBuilt.on ? asBuiltTitle('立面図（展開図）') : '立面図（展開図）', titleValues });
    const warnings: string[] = [];
    if (asBuilt.on) {
      const ids = iso.lines.map((l) => l.segId);
      const un = unmeasuredSegments(doc, ids);
      if (profileMissing) warnings.unshift(`現場の自治体プロファイル（${profileId}）がこの端末に見つからないため、標準で描いています`);
      const geo = geometricLength(doc);
      const modelLen = Object.fromEntries(ids.map((id) => [id, geo(id)]));
      const labels = Object.fromEntries(iso.lines.map((l, i) => [l.segId, `区間${i + 1} ${l.label.replace(/×[\d.]+$/, '')}`]));
      warnings.push(...asBuiltNotes(doc, ids, modelLen, labels, un.length));
      return { sheets: [sheet], svg: '', warnings, error: null, kind, asBuilt: { segIds: ids, unmeasured: un.length, modelLen, labels } };
    }
    if (profileMissing) warnings.unshift(`現場の自治体プロファイル（${profileId}）がこの端末に見つからないため、標準で描いています`);
    return { sheets: [sheet], svg: sheetToSvg(sheet), warnings, error: null, kind };
  }
  const m: RiserModel = buildRiser(doc, rootId, profile, asBuilt.on ? asBuiltTitle(RISER_TITLE) : RISER_TITLE);
  const sheet = renderRiserSheet(m, { siteName, date });
  const warnings = [...m.warnings];
  if (asBuilt.on) {
    // 立面図は長さを書かない（表題と印だけ）。実測の一覧は出さない
    if (profileMissing) warnings.unshift(`現場の自治体プロファイル（${profileId}）がこの端末に見つからないため、標準で描いています`);
    return { sheets: [sheet], svg: '', warnings, error: null, kind, asBuilt: { segIds: [], unmeasured: 0, modelLen: {}, labels: {}, noLengths: true } };
  }
  if (profileMissing) warnings.unshift(`現場の自治体プロファイル（${profileId}）がこの端末に見つからないため、標準で描いています`);
  return { sheets: [sheet], svg: sheetToSvg(sheet), warnings, error: null, kind };
}

/** 竣工図の印（縦断図・立面図・ます表だけ）。SVG はここで作り直す */
export function stampAsBuiltBuild(b: ShinseiBuild, asBuilt: AsBuiltSettings): ShinseiBuild {
  if (!b.asBuilt || !asBuilt.on) return b;
  const dateText = asBuilt.date ? dateJa(new Date(`${asBuilt.date}T00:00:00`)) : '';
  const warnings = [...b.warnings];
  const sheets = b.sheets.map((sh) => {
    const copy: Sheet = { ...sh, ops: [...sh.ops] };
    if (stampAsBuilt(copy, dateText || '　　年　月　日').collided) warnings.push('竣工の印を置く空きが無く、文字に重なっています');
    return copy;
  });
  if (!asBuilt.date) warnings.push('竣工日が未入力です（印の日付は空欄）');
  return { ...b, sheets, svg: sheets.map(sheetToSvg).join(''), warnings };
}
