/**
 * 申請図面（排水縦断図・給水立面図）の全画面。
 * 自治体プロファイルと経路を選ぶと、配管データから図面をその場で作ってプレビューし、PDF / SVG に出力する。
 * 表示はすべて doc から計算する（保存しない）。
 */
import { useEffect, useMemo, useState } from 'react';
import { useStore } from '../state/store';
import { FIXTURE_CATALOG, isManhole, MANHOLE_TYPES } from '../model/fixtures';
import { isDrain } from '../model/slope';
import { isBuiltinProfile, resolveProfile, type MunicipalityProfile } from '../model/municipality';
import { branchPoints, buildProfile, extractRoute, trimToManholes, type ProfileModel } from '../model/profileDrawing';
import { buildRiser, defaultRiserRoot, type RiserModel } from '../model/riser';
import { renderProfileSheet } from '../export/profileSheet';
import { renderRiserSheet } from '../export/riserSheet';
import { buildIsometric } from '../model/isometric';
import { renderIsoSheet } from '../export/isoSheet';
import { sheetsToSvg, sheetToSvg, type Sheet } from '../export/sheet';
import { useProfiles } from './useProfiles';
import { outletCandidates } from '../model/outlets';
import { ShinseiForms } from './ShinseiForms';
import { NumField } from './Panels';
import { ProfileSettingsDialog } from './ProfileSettingsDialog';
import { calcSupply } from '../model/hydraulics/calc';
import { readSuiriSettings, writeSuiriSettings, type SuiriSettings } from '../model/hydraulics/settings';
import { suggestDiameters } from '../model/hydraulics/suggest';
import { resolveSupplyRules } from '../model/hydraulics/supplyRules';
import { renderSuiriSheets } from '../export/suiriSheet';
import { SuiriPanel } from './SuiriPanel';
import { MAT_AXIS_LABEL, materialSummary, type MatAxis } from '../model/materialSummary';
import { renderMaterialSheets } from '../export/materialSheet';
import { AsBuiltPanel } from './AsBuiltPanel';
import { applyMeasuredToProfile, approxSegments, asBuiltTitle, suspiciousMeasured, measuredLengthOf, readAsBuilt, unmeasuredSegments, writeAsBuilt, type AsBuiltSettings } from '../model/asBuilt';
import { stampAsBuilt } from '../export/asBuiltStamp';
import { dateJa } from '../export/report';
import { LocationPanel } from './LocationPanel';
import { offsetLatLon, readMapSettings, writeMapSettings, type MapSettings } from '../model/locationMap';
import { MAP_FRAME, MAP_PX } from '../export/locationSheet';
import type { LocationBuild } from '../import/locationMap';

type Kind = 'profile' | 'riser' | 'forms' | 'suiri' | 'mitori' | 'material';
const PROFILE_TITLE = '排水設備 縦断図';
const RISER_TITLE = '給水装置 立面図';
const ALL = '__all__';

/** 立面図の起点の候補: メーター出口 → 止水栓 → 給水の端点 */
function rootCandidates(doc = useStore.getState().doc): { id: string; label: string }[] {
  const out: { id: string; label: string; rank: number }[] = [];
  const net = doc.network;
  const def = defaultRiserRoot(doc);
  for (const n of Object.values(net.nodes)) {
    const segs = Object.values(net.segments).filter((s) => (s.system === 'water' || s.system === 'hotWater') && (s.a === n.id || s.b === n.id));
    if (!segs.length) continue;
    const fx = n.fixtureId ? doc.fixtures[n.fixtureId] : undefined;
    if (fx?.type === 'waterMeter' && n.portId === 'out') out.push({ id: n.id, label: '水道メーター（出口）', rank: 0 });
    else if (n.kind === 'valve') out.push({ id: n.id, label: `止水栓・バルブ 高さ ${Math.round(n.pos.z)}`, rank: 1 });
    else if (!fx && segs.length === 1) out.push({ id: n.id, label: `給水の端点 高さ ${Math.round(n.pos.z)}`, rank: 2 });
  }
  return out.sort((a, b) => (a.id === def ? -1 : b.id === def ? 1 : a.rank - b.rank)).map(({ id, label }) => ({ id, label }));
}

const nodeLabel = (nodeId: string): string => {
  const { doc } = useStore.getState();
  const n = doc.network.nodes[nodeId];
  const fx = n?.fixtureId ? doc.fixtures[n.fixtureId] : undefined;
  return fx ? FIXTURE_CATALOG[fx.type].label : `点 ${nodeId.slice(-4)}`;
};

/** 枝の先にある器具名（選択肢の表示用） */
function branchDescription(doc: ReturnType<typeof useStore.getState>['doc'], from: string, next: string): string {
  // next から先（from を通らず）に到達する器具
  const names = new Set<string>();
  const seen = new Set([from, next]);
  const stack = [next];
  while (stack.length) {
    const cur = stack.pop()!;
    const n = doc.network.nodes[cur];
    const fx = n?.fixtureId ? doc.fixtures[n.fixtureId] : undefined;
    if (fx) { names.add(FIXTURE_CATALOG[fx.type].label); if (!isManhole(fx.type)) continue; }
    for (const s of Object.values(doc.network.segments)) {
      if (!isDrain(s.system) || (s.a !== cur && s.b !== cur)) continue;
      const o = s.a === cur ? s.b : s.a;
      if (!seen.has(o)) { seen.add(o); stack.push(o); }
    }
  }
  return names.size ? [...names].join('・') + ' の側' : nodeLabel(next) + ' の側';
}

/** 区間の図面上の長さ（実測を無視した 3D の長さ） */
const geometricLength = (doc: ReturnType<typeof useStore.getState>['doc']) => measuredLengthOf({ ...doc, network: { ...doc.network, segments: Object.fromEntries(Object.entries(doc.network.segments).map(([k, v]) => [k, { ...v, measuredLength: undefined }])) } });

export type ShinseiBuild = { sheets: Sheet[]; svg: string; warnings: string[]; error: string | null; kind: Kind;
  /** 竣工図: 図に出ている区間（実測長の一覧に出す）と図面の長さ */
  asBuilt?: { segIds: string[]; unmeasured: number; modelLen: Record<string, number>; labels: Record<string, string>; /** この図には長さを書かない（立面図） */ noLengths?: boolean } };

/** 竣工図の注意: 未入力・図面とかけ離れた実測（単位の入れ違いなど）・按分の概算 */
function asBuiltNotes(doc: ReturnType<typeof useStore.getState>['doc'], segIds: string[], modelLen: Record<string, number>, labels: Record<string, string>, unmeasured: number): string[] {
  const out: string[] = [];
  if (unmeasured) out.push(`実測長が未入力の区間が ${unmeasured} あります（その区間は図面の長さで描いています）`);
  for (const id of suspiciousMeasured(doc, segIds, modelLen)) out.push(`${labels[id] ?? '区間'}: 実測 ${Math.round(doc.network.segments[id].measuredLength! * 10) / 10}mm が図面 ${Math.round(modelLen[id])}mm と大きく違います（単位は mm）`);
  const approx = approxSegments(doc, segIds);
  if (approx.length) out.push(`区間を分けたときに長さの比で分けた概算の実測長が ${approx.length} 区間あります（測り直すと正確になります）`);
  return out;
}

export function ShinseiScreen({ onClose }: { onClose: () => void }) {
  const doc = useStore((s) => s.doc);
  const meta = useStore((s) => s.meta);
  const updateSite = useStore((s) => s.updateSite);
  const updateSegments = useStore((s) => s.updateSegments);
  const profiles = useProfiles();
  const [kind, setKind] = useState<Kind>('profile');
  const [outlet, setOutlet] = useState<string>('');
  const [root, setRoot] = useState<string>('');
  const [choice, setChoice] = useState<Record<string, string>>({});
  const [zoom, setZoom] = useState(1);
  const [showProfiles, setShowProfiles] = useState(false);
  const [busy, setBusy] = useState('');
  const [err, setErr] = useState('');
  /** 図面の作成日（画面を開いたとき） */
  const [date] = useState(() => new Date());

  useEffect(() => { if (!profiles.loaded) void profiles.load(); }, [profiles]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !showProfiles) { (document.activeElement as HTMLElement | null)?.blur?.(); onClose(); } };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, showProfiles]);

  const profileId = doc.site?.municipalityProfileId;
  const profile: MunicipalityProfile = resolveProfile(profileId, profiles.user);
  /** 現場が指すプロファイルがこの端末に無い（別端末の現場・削除後など） */
  const profileMissing = !!profileId && profiles.loaded && !isBuiltinProfile(profileId) && !profiles.user.some((p) => p.id === profileId);
  const outlets = useMemo(() => outletCandidates(doc), [doc]);
  const roots = useMemo(() => rootCandidates(doc), [doc]);
  const outletId = outlets.some((o) => o.id === outlet) ? outlet : outlets[0]?.id ?? '';
  const rootId = roots.some((o) => o.id === root) ? root : roots[0]?.id ?? '';
  const pick = useMemo(() => {
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(choice)) if (v && v !== ALL) out[k] = v;
    return out;
  }, [choice]);
  const branches = useMemo(() => (outletId ? branchPoints(doc.network, outletId, pick) : []), [doc, outletId, pick]);
  const siteName = meta?.name ?? '現場';

  // 水理計算（給水の口径決定）。設定は site.application の suiri.*
  const suiriSettings: SuiriSettings = useMemo(() => readSuiriSettings(doc.site?.application), [doc.site?.application]);
  const suiriRules = useMemo(() => resolveSupplyRules({ profileName: profile.id === 'standard' ? undefined : profile.name, address: meta?.address }), [profile.id, profile.name, meta?.address]);
  const suiri = useMemo(() => (kind === 'suiri' ? calcSupply(doc, suiriRules, suiriSettings) : null), [kind, doc, suiriRules, suiriSettings]);
  const suiriSuggest = useMemo(() => (suiri && !('error' in suiri) && !suiri.ok ? suggestDiameters(doc, suiriRules, suiriSettings) : null), [suiri, doc, suiriRules, suiriSettings]);
  const setSuiri = (patch: Partial<SuiriSettings>) => updateSite({ application: writeSuiriSettings(doc.site?.application, patch) });

  // 材料集計表の分け方（site.application の zairyo.axis）
  const axisRaw = doc.site?.application?.['zairyo.axis'];
  const matAxis: MatAxis = axisRaw === 'floor' || axisRaw === 'status' ? axisRaw : 'place';
  const setMatAxis = (a: MatAxis) => updateSite({ application: { ...(doc.site?.application ?? {}), 'zairyo.axis': a } });
  const downloadMaterialXlsx = async () => {
    setBusy('xlsx'); setErr('');
    try {
      const [{ materialXlsx }, { downloadBytes, safeName }, { dateStamp }] = await Promise.all([import('../export/materialSheet'), import('../export/download'), import('../export/report')]);
      downloadBytes(await materialXlsx(materialSummary(doc, matAxis), { siteName, date }), `${safeName(siteName)}_材料集計表_${dateStamp(new Date())}.xlsx`, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    } catch (e) { setErr(`出力できませんでした: ${e instanceof Error ? e.message : String(e)}`); } finally { setBusy(''); }
  };

  // 見取図（案内図）。場所と縮尺は site.application の mitori.*、地図はその都度取り込む（端末のメモリだけ）
  const mapSettings: MapSettings = useMemo(() => readMapSettings(doc.site?.application), [doc.site?.application]);
  const setMap = (patch: Partial<MapSettings>) => updateSite({ application: writeMapSettings(doc.site?.application, patch) });
  const siteAddress = doc.site?.application?.siteAddress || meta?.address || '';
  const [mitori, setMitori] = useState<{ key: string; build: LocationBuild | null; loading: boolean }>({ key: '', build: null, loading: false });
  const mitoriKey = kind === 'mitori' ? JSON.stringify([mapSettings.lat, mapSettings.lon, mapSettings.zoom, siteName, siteAddress]) : '';
  useEffect(() => {
    if (!mitoriKey) return;
    let live = true;
    setMitori((m) => ({ ...m, key: mitoriKey, loading: true }));
    void import('../import/locationMap').then(({ buildLocationSheet }) => buildLocationSheet(doc.site?.application, { siteName, address: siteAddress, date }))
      .then((build) => { if (live) setMitori({ key: mitoriKey, build, loading: false }); })
      .catch((e) => { console.error('見取図', e); if (live) setMitori({ key: mitoriKey, build: null, loading: false }); });
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mitoriKey が場所・縮尺・表記をまとめて持つ
  }, [mitoriKey]);
  /** 見取図のプレビューをタップ → その点を新しい工事場所（地図の中心）にする。いま表示している地図の中心から測る（読み込み中の連打で二重に動かない） */
  const tapMap = (e: React.MouseEvent<HTMLDivElement>) => {
    const shown = mitori.build;
    if (kind !== 'mitori' || !shown?.mapOk) return;
    const svg = (e.target as Element).closest('svg');
    if (!svg) return;
    const r = svg.getBoundingClientRect();
    const mx = ((e.clientX - r.left) / r.width) * 210, my = ((e.clientY - r.top) / r.height) * 297;
    const F = MAP_FRAME;
    if (mx < F.x || mx > F.x + F.w || my < F.y || my > F.y + F.h) return;
    const p = offsetLatLon(shown.center, shown.zoom, (mx - (F.x + F.w / 2)) * (MAP_PX.w / F.w), (my - (F.y + F.h / 2)) * (MAP_PX.h / F.h));
    setMap({ lat: Math.round(p.lat * 1e7) / 1e7, lon: Math.round(p.lon * 1e7) / 1e7 });
  };

  // 竣工図（site.application の shunko.*）。縦断図・立面図を実測長で描き、表題に「竣工」、右上に竣工の印
  const asBuilt: AsBuiltSettings = useMemo(() => readAsBuilt(doc.site?.application), [doc.site?.application]);
  const setAsBuilt = (patch: Partial<AsBuiltSettings>) => {
    const p = { ...patch };
    if (p.on && !asBuilt.date && !('date' in p)) { const d = new Date(); p.date = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; }
    updateSite({ application: writeAsBuilt(doc.site?.application, p) });
  };

  const built0: ShinseiBuild = useMemo(() => {
    if (kind === 'forms') return { sheets: [], svg: '', warnings: [], error: null, kind };
    if (kind === 'material') {
      // 材料集計表: 管・部品・器具・マスを分け方（屋内外／階／新設既設）の列で
      const sheets = renderMaterialSheets(materialSummary(doc, matAxis), { siteName, date });
      if (!sheets.length) return { sheets: [], svg: '', warnings: [], error: '材料（配管・器具）がありません。図面で配管や器具を置いてください', kind };
      return { sheets, svg: sheets.map(sheetToSvg).join(''), warnings: [], error: null, kind };
    }
    if (kind === 'mitori') {
      if (mapSettings.lat === undefined) return { sheets: [], svg: '', warnings: [], error: '工事場所が決まっていません。住所を入れて「探す」を押してください（緯度,経度でも指定できます）', kind };
      // 新しい地図ができるまでは前の見取図を出したまま「読み込んでいます」（出力は新しい地図ができてから）
      const loading = mitori.loading || mitori.key !== mitoriKey;
      const b = mitori.build;
      if (!b) return { sheets: [], svg: '', warnings: [loading ? '地図を読み込んでいます…' : '見取図を作れませんでした'], error: null, kind };
      const notes = b.mapOk ? b.notes : [...b.notes, '地図が無いため、枠だけの見取図です（手で書き込んで使えます）'];
      return { sheets: loading ? [] : [b.sheet], svg: sheetToSvg(b.sheet), warnings: loading ? ['地図を読み込んでいます…'] : notes, error: null, kind };
    }
    if (kind === 'suiri') {
      if (!suiri) return { sheets: [], svg: '', warnings: [], error: null, kind };
      if ('error' in suiri) return { sheets: [], svg: '', warnings: [], error: suiri.error, kind };
      const sheets = renderSuiriSheets(suiri, { siteName, date });
      return { sheets, svg: sheets.map(sheetToSvg).join(''), warnings: [...suiri.unverified.map((u) => `要確認: ${u}`), ...suiri.warnings], error: null, kind };
    }
    if (kind === 'profile') {
      if (!outletId) return { sheets: [], svg: '', warnings: [], error: '排水の配管がありません。図面でマスを置き、排水の配管をつないでください', kind };
      const r = extractRoute(doc.network, outletId, pick);
      if ('error' in r) return { sheets: [], svg: '', warnings: [], error: r.error, kind };
      // 分岐の枝は別図。本線の分岐点に「→別図 枝n」と記す
      const notes: Record<string, string> = {};
      r.branches.forEach((b, i) => { notes[b.atNodeId] = [notes[b.atNodeId], `→別図 枝${i + 1}`].filter(Boolean).join(' '); });
      const ab = asBuilt.on;
      const T = ab ? asBuiltTitle(PROFILE_TITLE) : PROFILE_TITLE;
      const main = buildProfile(doc, trimToManholes(doc, r.route), profile, T, notes);
      const models: ProfileModel[] = [main];
      // 枝は本線の基準（公共桝の管底）と桝番号の続きを使う
      let manholeNoStart = main.manholeCount;
      r.branches.forEach((b, i) => {
        const bm = buildProfile(doc, trimToManholes(doc, b.nodeIds), profile, `${T}（枝${i + 1}: ${nodeLabel(b.atNodeId)} から）`, {}, { datumZ: main.datumZ, manholeNoStart });
        manholeNoStart += bm.manholeCount;
        models.push(bm);
      });
      // 沖縄市の様式: 縦断図の上に排水のアイソメ図（立面図・展開図）
      const iso = profile.profileTable.drainageIsometric ? buildIsometric(doc, 'drain', profile, ab ? { lengthOf: measuredLengthOf(doc) } : {}) : undefined;
      // 竣工図: 延長を実測にする（図面の長さは一覧に出す）
      const modelLen: Record<string, number> = {};
      for (const m of models) for (const sg of m.segments) if (sg.distance >= 1) modelLen[sg.segId] = sg.distance;
      const unmeasured = new Set<string>();
      const drawn = ab ? models.map((m) => { const x = applyMeasuredToProfile(m, doc); x.unmeasured.forEach((u) => unmeasured.add(u)); return x.model; }) : models;
      const sheets = drawn.map((m, i) => renderProfileSheet(m, { siteName, date }, i === 0 ? iso : undefined));
      // 注意は描いたモデルから（竣工図では勾配の注意を実測で出し直している）
      const warnings = drawn.flatMap((m) => m.warnings.map((w) => w.message));
      if (iso && iso.lines.length === 0) warnings.push('排水の立面図（展開図）を描く配管がないため、縦断図だけを出しています');
      for (const o of r.omitted) warnings.push(`枝の中の分岐（${nodeLabel(o.atNodeId)}）は図に含めていません。別の下流端を選んで別に作図してください`);
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
      const sheet = renderIsoSheet(iso, profile, { siteName, date, title: asBuilt.on ? asBuiltTitle('立面図（展開図）') : '立面図（展開図）' });
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
  }, [doc, kind, outletId, rootId, pick, profile, profileId, profileMissing, siteName, date, suiri, asBuilt.on, mapSettings.lat, mitori, mitoriKey, matAxis]);

  // 竣工図の印（縦断図・立面図だけ）。SVG はここで作り直す
  const built: ShinseiBuild = useMemo(() => {
    if (!built0.asBuilt || !asBuilt.on) return built0;
    const dateText = asBuilt.date ? dateJa(new Date(`${asBuilt.date}T00:00:00`)) : '';
    const warnings = [...built0.warnings];
    const sheets = built0.sheets.map((sh) => {
      const copy: Sheet = { ...sh, ops: [...sh.ops] };
      if (stampAsBuilt(copy, dateText || '　　年　月　日').collided) warnings.push('竣工の印を置く空きが無く、文字に重なっています');
      return copy;
    });
    if (!asBuilt.date) warnings.push('竣工日が未入力です（印の日付は空欄）');
    return { ...built0, sheets, svg: sheets.map(sheetToSvg).join(''), warnings };
  }, [built0, asBuilt.on, asBuilt.date]);

  const download = async (fmt: 'pdf' | 'svg') => {
    setBusy(fmt); setErr('');
    try {
      const [{ downloadBytes, safeName }, { dateStamp }] = await Promise.all([import('../export/download'), import('../export/report')]);
      const base = `${safeName(siteName)}_${built.asBuilt && asBuilt.on ? '竣工' : ''}${kind === 'profile' ? '縦断図' : kind === 'suiri' ? '水理計算書' : kind === 'mitori' ? '見取図' : kind === 'material' ? '材料集計表' : '立面図'}_${dateStamp(new Date())}`;
      if (fmt === 'svg') {
        // 枝が別図のときは、ページを縦に並べた 1 つの SVG
        downloadBytes(new TextEncoder().encode(sheetsToSvg(built.sheets)), `${base}.svg`, 'image/svg+xml');
      } else {
        const [{ sheetsToPdf }, font] = await Promise.all([
          import('../export/sheet'),
          fetch(`${import.meta.env.BASE_URL}fonts/NotoSansJP-JIS.ttf`).then((r) => { if (!r.ok) throw new Error('フォントを読み込めません'); return r.arrayBuffer(); }),
        ]);
        downloadBytes(await sheetsToPdf(built.sheets, font), `${base}.pdf`, 'application/pdf');
      }
    } catch (e) {
      setErr(`出力できませんでした: ${e instanceof Error ? e.message : String(e)}`);
    } finally { setBusy(''); }
  };

  const gl = doc.site?.designGL;
  return (
    <div className="estimate shinsei" data-testid="shinsei-screen" role="dialog" aria-label="申請図面">
      <header>
        <button className="back" data-testid="close-shinsei" onClick={onClose}>‹ 図面へ</button>
        <strong>申請図面</strong>
        <span className="muted small">配管データから縦断図・立面図・水理計算書を自動で作ります</span>
        <span className="grow" />
        <button className="primary" data-testid="shinsei-pdf" disabled={!!busy || !!built.error || kind === 'forms' || built.sheets.length === 0} onClick={() => download('pdf')}>{busy === 'pdf' ? '作成中…' : '🖨 PDF'}</button>
        <button data-testid="shinsei-svg" disabled={!!busy || !!built.error || kind === 'forms' || built.sheets.length === 0} onClick={() => download('svg')}>SVG</button>
      </header>
      <div className="shinsei-controls">
        <label className="field inline">自治体プロファイル
          <select data-testid="shinsei-profile" value={profile.id} onChange={(e) => updateSite({ municipalityProfileId: e.target.value })}>
            {profiles.all().map((p) => <option key={p.id} value={p.id}>{p.name}{p.unverified.length ? '（要確認あり）' : ''}</option>)}
          </select>
        </label>
        <button data-testid="shinsei-manage-profiles" onClick={() => setShowProfiles(true)}>⚙ プロファイルを管理</button>
        <span className="field inline">
          <NumField label="設計GL（1階床 FL± mm）" value={gl ?? 0} testId="shinsei-gl" onCommit={(v) => updateSite({ designGL: v })} />
          {gl === undefined
            ? <span className="badge warn" data-testid="shinsei-gl-tentative" title="未入力のため仮の地盤高で描きます">仮</span>
            : <button className="linkish small" data-testid="shinsei-gl-clear" onClick={() => updateSite({ designGL: undefined })}>未入力に戻す</button>}
        </span>
        <div className="seg-btns">
          <button data-testid="shinsei-kind-profile" className={kind === 'profile' ? 'on' : ''} onClick={() => setKind('profile')}>排水縦断図</button>
          <button data-testid="shinsei-kind-riser" className={kind === 'riser' ? 'on' : ''} onClick={() => setKind('riser')}>給水立面図</button>
          <button data-testid="shinsei-kind-suiri" className={kind === 'suiri' ? 'on' : ''} onClick={() => setKind('suiri')}>水理計算書</button>
          <button data-testid="shinsei-kind-material" className={kind === 'material' ? 'on' : ''} onClick={() => setKind('material')}>材料表</button>
          <button data-testid="shinsei-kind-mitori" className={kind === 'mitori' ? 'on' : ''} onClick={() => setKind('mitori')}>見取図</button>
          <button data-testid="shinsei-kind-forms" className={kind === 'forms' ? 'on' : ''} onClick={() => setKind('forms')}>申請書</button>
        </div>
        {kind === 'forms' ? null : kind === 'material' ? (
          <>
            <label className="field inline">分け方
              <select data-testid="material-axis" value={matAxis} onChange={(e) => setMatAxis(e.target.value as MatAxis)}>
                {(Object.keys(MAT_AXIS_LABEL) as MatAxis[]).map((a) => <option key={a} value={a}>{MAT_AXIS_LABEL[a]}</option>)}
              </select>
            </label>
            <button data-testid="material-xlsx" disabled={!!busy || !!built.error} onClick={() => void downloadMaterialXlsx()}>{busy === 'xlsx' ? '作成中…' : 'Excel'}</button>
          </>
        ) : kind === 'mitori' ? (
          <LocationPanel settings={mapSettings} defaultQuery={siteAddress} onChange={setMap} />
        ) : kind === 'suiri' ? (
          <SuiriPanel calc={suiri && !('error' in suiri) ? suiri : null} rules={suiriRules} settings={suiriSettings} onChange={setSuiri} suggestion={suiriSuggest}
            onApply={() => suiriSuggest && updateSegments(Object.fromEntries(suiriSuggest.changes.map((c) => [c.segId, { diameter: c.to }])))} />
        ) : kind === 'profile' ? (
          <>
            <label className="field inline">下流端（公共マスなど）
              <select data-testid="shinsei-outlet" value={outletId} onChange={(e) => { setOutlet(e.target.value); setChoice({}); }}>
                {outlets.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
              </select>
            </label>
            {branches.map((b) => (
              <label key={b.nodeId} className="field inline">分岐（{nodeLabel(b.nodeId)}）
                <select data-testid={`shinsei-branch-${b.nodeId}`} value={choice[b.nodeId] ?? ALL} onChange={(e) => setChoice({ ...choice, [b.nodeId]: e.target.value })}>
                  <option value={ALL}>全部（枝は別図）</option>
                  {b.options.map((o) => <option key={o} value={o}>{branchDescription(doc, b.nodeId, o)}</option>)}
                </select>
              </label>
            ))}
            {!MANHOLE_TYPES.some((t) => Object.values(doc.fixtures).some((f) => f.type === t)) && outletId && (
              <span className="muted small">マスがありません。器具の「マス（排水）」から置くと、管底高・深さが図面に入ります</span>
            )}
          </>
        ) : (
          <label className="field inline">起点
            <select data-testid="shinsei-root" value={rootId} onChange={(e) => setRoot(e.target.value)}>
              {roots.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
            </select>
          </label>
        )}
        {(kind === 'profile' || kind === 'riser') && (
          <AsBuiltPanel settings={asBuilt} onChange={setAsBuilt} segIds={built.asBuilt?.segIds ?? []} unmeasured={built.asBuilt?.unmeasured ?? 0} modelLength={(id) => built.asBuilt?.modelLen[id] ?? 0} labels={built.asBuilt?.labels ?? {}} noLengths={!!built.asBuilt?.noLengths} />
        )}
        {kind !== 'forms' && <div className="seg-btns small">
          <button onClick={() => setZoom((z) => Math.max(0.25, z / 1.25))} aria-label="縮小">−</button>
          <button onClick={() => setZoom(1)}>等倍</button>
          <button onClick={() => setZoom((z) => Math.min(6, z * 1.25))} aria-label="拡大">＋</button>
        </div>}
      </div>
      {built.error && <p className="est-provisional" role="alert" data-testid="shinsei-error">{built.error}</p>}
      {err && <p className="est-provisional" role="alert">{err}</p>}
      {profiles.error && <p className="est-provisional" role="alert">保存したプロファイルを読み込めませんでした: {profiles.error}</p>}
      {built.warnings.length > 0 && (
        <ul className="shinsei-warnings small" data-testid="shinsei-warnings">
          {built.warnings.map((w, i) => <li key={i} className="warn">⚠ {w}</li>)}
        </ul>
      )}
      {kind === 'forms' ? <div className="shinsei-preview forms"><ShinseiForms profile={profile} siteName={siteName} date={date} /></div> : <div className={`shinsei-preview${kind === 'mitori' ? ' mitori' : ''}`} data-testid="shinsei-preview" onClick={tapMap}>
        <div className="shinsei-pages" style={{ width: `${zoom * 100}%`, ...(kind === 'mitori' ? { maxWidth: 760 * zoom } : {}) }} dangerouslySetInnerHTML={{ __html: built.error ? '' : built.svg }} />
      </div>}
      {showProfiles && <ProfileSettingsDialog onClose={() => setShowProfiles(false)} />}
    </div>
  );
}
