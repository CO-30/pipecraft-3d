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
import { branchPoints } from '../model/profileDrawing';
import { defaultRiserRoot } from '../model/riser';
import { sheetsToSvg } from '../export/sheet';
import { useProfiles } from './useProfiles';
import { outletCandidates } from '../model/outlets';
import { ShinseiForms } from './ShinseiForms';
import { NumField } from './Panels';
import { ProfileSettingsDialog } from './ProfileSettingsDialog';
import { calcSupply } from '../model/hydraulics/calc';
import { readSuiriSettings, writeSuiriSettings, type SuiriSettings } from '../model/hydraulics/settings';
import { suggestDiameters } from '../model/hydraulics/suggest';
import { resolveSupplyRules } from '../model/hydraulics/supplyRules';
import { SuiriPanel } from './SuiriPanel';
import { MAT_AXIS_LABEL, materialSummary, type MatAxis } from '../model/materialSummary';
import { AsBuiltPanel } from './AsBuiltPanel';
import { readAsBuilt, writeAsBuilt, type AsBuiltSettings } from '../model/asBuilt';
import { LocationPanel } from './LocationPanel';
import { BUNDLE_KINDS, buildShinsei, nodeLabelOf, stampAsBuiltBuild, type Kind, type ShinseiBuild, type ShinseiCtx } from './shinseiBuild';
import { ShinseiBundleDialog } from './ShinseiBundleDialog';
import { repo } from '../storage/instance';
import { CONTRACTOR_KEY, drawingTitleValues } from '../forms/formSets';
export type { ShinseiBuild } from './shinseiBuild';
import { offsetLatLon, readMapSettings, writeMapSettings, type MapSettings } from '../model/locationMap';
import { MAP_FRAME, MAP_PX } from '../export/locationSheet';
import type { LocationBuild } from '../import/locationMap';

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

const nodeLabel = (nodeId: string): string => nodeLabelOf(useStore.getState().doc, nodeId);

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
  /** 「まとめてPDF」の一覧を開いている */
  const [bundleOpen, setBundleOpen] = useState(false);
  const [busy, setBusy] = useState('');
  const [err, setErr] = useState('');
  /** 図面の作成日（画面を開いたとき） */
  const [date] = useState(() => new Date());

  useEffect(() => { if (!profiles.loaded) void profiles.load(); }, [profiles]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !showProfiles && !bundleOpen) { (document.activeElement as HTMLElement | null)?.blur?.(); onClose(); } };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, showProfiles, bundleOpen]);

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
  const mitoriKey = kind === 'mitori' || bundleOpen ? JSON.stringify([mapSettings.lat, mapSettings.lon, mapSettings.zoom, siteName, siteAddress]) : '';
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

  // 表題欄（申請地・申請者・指定工事店）: 申請書の入力と、この端末に保存した工事店の名前から
  const [contractorName, setContractorName] = useState('');
  useEffect(() => {
    let alive = true;
    repo.getSetting<{ name?: string }>(CONTRACTOR_KEY).then((c) => { if (alive) setContractorName(c?.name ?? ''); }).catch(() => undefined);
    return () => { alive = false; };
  }, [kind]);
  const titleValues = useMemo(() => drawingTitleValues(doc.site?.application, contractorName, meta?.address), [doc.site?.application, contractorName, meta?.address]);
  const ctx: ShinseiCtx = useMemo(() => ({
    doc, outletId, rootId, pick, profile, profileId, profileMissing, siteName, date, matAxis, asBuiltOn: asBuilt.on, suiri,
    mapLat: mapSettings.lat, mitori: { build: mitori.build, loading: mitori.loading || mitori.key !== mitoriKey }, titleValues,
  }), [doc, outletId, rootId, pick, profile, profileId, profileMissing, siteName, date, suiri, asBuilt.on, mapSettings.lat, mitori, mitoriKey, matAxis, titleValues]);
  const built0: ShinseiBuild = useMemo(() => buildShinsei(kind, ctx), [kind, ctx]);
  /** 「まとめてPDF」用: どの図面もタブと同じ作図（水理計算はここで計算する） */
  const buildFor = useMemo(() => (k: (typeof BUNDLE_KINDS)[number]) =>
    stampAsBuiltBuild(buildShinsei(k, k === 'suiri' ? { ...ctx, suiri: suiri ?? calcSupply(doc, suiriRules, suiriSettings) } : ctx), asBuilt),
  [ctx, suiri, doc, suiriRules, suiriSettings, asBuilt]);

  // 竣工図の印（縦断図・立面図だけ）。SVG はここで作り直す
  const built: ShinseiBuild = useMemo(() => stampAsBuiltBuild(built0, asBuilt), [built0, asBuilt]);

  const [info, setInfo] = useState('');
  const download = async (fmt: 'pdf' | 'svg' | 'dxf') => {
    setBusy(fmt); setErr(''); setInfo('');
    try {
      const [{ downloadBytes, safeName }, { dateStamp }] = await Promise.all([import('../export/download'), import('../export/report')]);
      const base = `${safeName(siteName)}_${built.asBuilt && asBuilt.on ? '竣工' : ''}${kind === 'profile' ? '縦断図' : kind === 'plan' ? '排水平面図' : kind === 'suiri' ? '水理計算書' : kind === 'mitori' ? '見取図' : kind === 'material' ? '材料集計表' : kind === 'sleeve' ? 'スリーブ表' : kind === 'masu' ? 'ます表' : '立面図'}_${dateStamp(new Date())}`;
      if (fmt === 'dxf') {
        // DXF（R12・Shift_JIS）: AutoCAD・Jw_cad で開ける。ページは横に並べる
        const { sheetsToDxf } = await import('../export/dxf');
        const r = sheetsToDxf(built.sheets);
        downloadBytes(r.bytes, `${base}.dxf`, 'application/dxf');
        const notes = [...r.notes, ...(r.missing.size ? [`Shift_JIS に無い文字を ? にしました: ${[...r.missing].join(' ')}`] : [])];
        if (notes.length) setInfo(notes.join('。'));
      } else if (fmt === 'svg') {
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

  const [bundleErr, setBundleErr] = useState('');
  const downloadBundle = async (builds: ShinseiBuild[]) => {
    setBusy('bundle'); setErr(''); setInfo(''); setBundleErr('');
    try {
      const [{ downloadBytes, safeName }, { dateStamp }, { sheetsToPdf }, font] = await Promise.all([
        import('../export/download'), import('../export/report'), import('../export/sheet'),
        fetch(`${import.meta.env.BASE_URL}fonts/NotoSansJP-JIS.ttf`).then((r) => { if (!r.ok) throw new Error('フォントを読み込めません'); return r.arrayBuffer(); }),
      ]);
      downloadBytes(await sheetsToPdf(builds.flatMap((b) => b.sheets), font), `${safeName(siteName)}_${asBuilt.on ? '竣工' : ''}申請図面一式_${dateStamp(new Date())}.pdf`, 'application/pdf');
      setBundleOpen(false); setBundleErr('');
      setInfo(`${builds.length} 種類の図面を 1 つの PDF にしました`);
    } catch (e) {
      // 一覧を開いたまま、その中に理由を出す（背面の画面に出しても見えない）
      setBundleErr(`出力できませんでした: ${e instanceof Error ? e.message : String(e)}`);
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
        <button data-testid="shinsei-bundle" disabled={!!busy} onClick={() => setBundleOpen(true)} title="作れる図面をまとめて 1 つの PDF に">📦 まとめてPDF</button>
        <button className="primary" data-testid="shinsei-pdf" disabled={!!busy || !!built.error || kind === 'forms' || built.sheets.length === 0} onClick={() => download('pdf')}>{busy === 'pdf' ? '作成中…' : '🖨 PDF'}</button>
 <button data-testid="shinsei-dxf" disabled={!!busy || !!built.error || kind === 'forms' || built.sheets.length === 0} onClick={() => download('dxf')} title="AutoCAD・Jw_cad で開ける DXF（R12）">DXF</button>
        <button data-testid="shinsei-svg" disabled={!!busy || !!built.error || kind === 'forms' || built.sheets.length === 0} onClick={() => download('svg')}>SVG</button>
      </header>
      <div className="shinsei-controls">
        <label className="field inline">自治体プロファイル
          <select data-testid="shinsei-profile" data-fb-skip value={profile.id} onChange={(e) => updateSite({ municipalityProfileId: e.target.value })}>
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
        <div className="seg-btns shinsei-kinds" role="group" aria-label="図の種類">
          <button data-testid="shinsei-kind-plan" className={kind === 'plan' ? 'on' : ''} onClick={() => setKind('plan')}>排水平面図</button>
          <button data-testid="shinsei-kind-profile" className={kind === 'profile' ? 'on' : ''} onClick={() => setKind('profile')}>排水縦断図</button>
          <button data-testid="shinsei-kind-riser" className={kind === 'riser' ? 'on' : ''} onClick={() => setKind('riser')}>給水立面図</button>
          <button data-testid="shinsei-kind-suiri" className={kind === 'suiri' ? 'on' : ''} onClick={() => setKind('suiri')}>水理計算書</button>
          <button data-testid="shinsei-kind-sleeve" className={kind === 'sleeve' ? 'on' : ''} onClick={() => setKind('sleeve')}>スリーブ表</button>
          <button data-testid="shinsei-kind-masu" className={kind === 'masu' ? 'on' : ''} onClick={() => setKind('masu')}>ます表</button>
          <button data-testid="shinsei-kind-material" className={kind === 'material' ? 'on' : ''} onClick={() => setKind('material')}>材料表</button>
          <button data-testid="shinsei-kind-mitori" className={kind === 'mitori' ? 'on' : ''} onClick={() => setKind('mitori')}>見取図</button>
          <button data-testid="shinsei-kind-forms" className={kind === 'forms' ? 'on' : ''} onClick={() => setKind('forms')}>申請書</button>
        </div>
        {kind === 'forms' || kind === 'sleeve' ? null : kind === 'material' ? (
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
        ) : kind === 'profile' || kind === 'masu' ? (
          <>
            <label className="field inline">下流端（公共マスなど）
              <select data-testid="shinsei-outlet" data-fb-skip value={outletId} onChange={(e) => { setOutlet(e.target.value); setChoice({}); }}>
                {outlets.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
              </select>
            </label>
            {branches.map((b) => (
              <label key={b.nodeId} className="field inline">分岐（{nodeLabel(b.nodeId)}）
                <select data-testid={`shinsei-branch-${b.nodeId}`} data-fb-skip value={choice[b.nodeId] ?? ALL} onChange={(e) => setChoice({ ...choice, [b.nodeId]: e.target.value })}>
                  <option value={ALL}>{kind === 'masu' ? '全部（枝のマスも表に入れる）' : '全部（枝は別図）'}</option>
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
            <select data-testid="shinsei-root" data-fb-skip value={rootId} onChange={(e) => setRoot(e.target.value)}>
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
      {info && <p className="small muted" data-testid="shinsei-info">{info}</p>}
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
      {bundleOpen && <ShinseiBundleDialog buildFor={buildFor} busy={busy === 'bundle'} asBuilt={asBuilt.on} error={bundleErr} onPdf={(b) => void downloadBundle(b)}
        onShow={(k) => { setBundleOpen(false); setKind(k); }} onClose={() => { setBundleOpen(false); setBundleErr(''); }} />}
    </div>
  );
}
