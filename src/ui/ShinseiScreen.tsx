/**
 * 申請図面（排水縦断図・給水立面図）の全画面。
 * 自治体プロファイルと経路を選ぶと、配管データから図面をその場で作ってプレビューし、PDF / SVG に出力する。
 * 表示はすべて doc から計算する（保存しない）。
 */
import { useEffect, useMemo, useState } from 'react';
import { useStore } from '../state/store';
import { FIXTURE_CATALOG, isManhole, MANHOLE_TYPES } from '../model/fixtures';
import { floorById } from '../model/building';
import { isDrain } from '../model/slope';
import { isBuiltinProfile, resolveProfile, type MunicipalityProfile } from '../model/municipality';
import { branchPoints, buildProfile, extractRoute, trimToManholes, type ProfileModel } from '../model/profileDrawing';
import { buildRiser, defaultRiserRoot, type RiserModel } from '../model/riser';
import { renderProfileSheet } from '../export/profileSheet';
import { renderRiserSheet } from '../export/riserSheet';
import { sheetsToSvg, sheetToSvg, type Sheet } from '../export/sheet';
import { useProfiles } from './useProfiles';
import { NumField } from './Panels';
import { ProfileSettingsDialog } from './ProfileSettingsDialog';

type Kind = 'profile' | 'riser';
const PROFILE_TITLE = '排水設備 縦断図';
const RISER_TITLE = '給水装置 立面図';
const ALL = '__all__';

/** 下流端の候補: 公共マス → 他のマス → 排水の端点 */
function outletCandidates(doc = useStore.getState().doc): { id: string; label: string }[] {
  const out: { id: string; label: string; rank: number }[] = [];
  const net = doc.network;
  for (const n of Object.values(net.nodes)) {
    const segs = Object.values(net.segments).filter((s) => isDrain(s.system) && (s.a === n.id || s.b === n.id));
    if (!segs.length) continue;
    const fx = n.fixtureId ? doc.fixtures[n.fixtureId] : undefined;
    const fl = (fx && floorById(doc.building, fx.floorId)) || (n.floorId ? floorById(doc.building, n.floorId) : undefined);
    const floorName = fl ? `（${fl.name}）` : '';
    if (fx && isManhole(fx.type)) out.push({ id: n.id, label: `${FIXTURE_CATALOG[fx.type].label}${floorName}`, rank: fx.type.startsWith('public') ? 0 : 1 });
    else if (!fx && segs.length === 1) out.push({ id: n.id, label: `排水の端点${floorName} 高さ ${Math.round(n.pos.z)}`, rank: 2 });
  }
  return out.sort((a, b) => a.rank - b.rank || a.label.localeCompare(b.label, 'ja')).map(({ id, label }) => ({ id, label }));
}

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

export type ShinseiBuild = { sheets: Sheet[]; svg: string; warnings: string[]; error: string | null; kind: Kind };

export function ShinseiScreen({ onClose }: { onClose: () => void }) {
  const doc = useStore((s) => s.doc);
  const meta = useStore((s) => s.meta);
  const updateSite = useStore((s) => s.updateSite);
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

  const built: ShinseiBuild = useMemo(() => {
    if (kind === 'profile') {
      if (!outletId) return { sheets: [], svg: '', warnings: [], error: '排水の配管がありません。図面でマスを置き、排水の配管をつないでください', kind };
      const r = extractRoute(doc.network, outletId, pick);
      if ('error' in r) return { sheets: [], svg: '', warnings: [], error: r.error, kind };
      // 分岐の枝は別図。本線の分岐点に「→別図 枝n」と記す
      const notes: Record<string, string> = {};
      r.branches.forEach((b, i) => { notes[b.atNodeId] = [notes[b.atNodeId], `→別図 枝${i + 1}`].filter(Boolean).join(' '); });
      const models: ProfileModel[] = [buildProfile(doc, trimToManholes(doc, r.route), profile, PROFILE_TITLE, notes)];
      r.branches.forEach((b, i) => models.push(buildProfile(doc, trimToManholes(doc, b.nodeIds), profile, `${PROFILE_TITLE}（枝${i + 1}: ${nodeLabel(b.atNodeId)} から）`)));
      const sheets = models.map((m) => renderProfileSheet(m, { siteName, date }));
      const warnings = models.flatMap((m) => m.warnings.map((w) => w.message));
      for (const o of r.omitted) warnings.push(`枝の中の分岐（${nodeLabel(o.atNodeId)}）は図に含めていません。別の下流端を選んで別に作図してください`);
      if (profileMissing) warnings.unshift(`現場の自治体プロファイル（${profileId}）がこの端末に見つからないため、標準で描いています`);
      return { sheets, svg: sheets.map(sheetToSvg).join(''), warnings, error: null, kind };
    }
    if (!rootId) return { sheets: [], svg: '', warnings: [], error: '給水の配管がありません。水道メーターを置き、給水の配管をつないでください', kind };
    const m: RiserModel = buildRiser(doc, rootId, profile, RISER_TITLE);
    const sheet = renderRiserSheet(m, { siteName, date });
    const warnings = [...m.warnings];
    if (profileMissing) warnings.unshift(`現場の自治体プロファイル（${profileId}）がこの端末に見つからないため、標準で描いています`);
    return { sheets: [sheet], svg: sheetToSvg(sheet), warnings, error: null, kind };
  }, [doc, kind, outletId, rootId, pick, profile, profileId, profileMissing, siteName, date]);

  const download = async (fmt: 'pdf' | 'svg') => {
    setBusy(fmt); setErr('');
    try {
      const [{ downloadBytes, safeName }, { dateStamp }] = await Promise.all([import('../export/download'), import('../export/report')]);
      const base = `${safeName(siteName)}_${kind === 'profile' ? '縦断図' : '立面図'}_${dateStamp(new Date())}`;
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
        <span className="muted small">配管データから縦断図・立面図を自動で作ります</span>
        <span className="grow" />
        <button className="primary" data-testid="shinsei-pdf" disabled={!!busy || !!built.error} onClick={() => download('pdf')}>{busy === 'pdf' ? '作成中…' : '🖨 PDF'}</button>
        <button data-testid="shinsei-svg" disabled={!!busy || !!built.error} onClick={() => download('svg')}>SVG</button>
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
        </div>
        {kind === 'profile' ? (
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
        <div className="seg-btns small">
          <button onClick={() => setZoom((z) => Math.max(0.25, z / 1.25))} aria-label="縮小">−</button>
          <button onClick={() => setZoom(1)}>等倍</button>
          <button onClick={() => setZoom((z) => Math.min(6, z * 1.25))} aria-label="拡大">＋</button>
        </div>
      </div>
      {built.error && <p className="est-provisional" role="alert" data-testid="shinsei-error">{built.error}</p>}
      {err && <p className="est-provisional" role="alert">{err}</p>}
      {profiles.error && <p className="est-provisional" role="alert">保存したプロファイルを読み込めませんでした: {profiles.error}</p>}
      {built.warnings.length > 0 && (
        <ul className="shinsei-warnings small" data-testid="shinsei-warnings">
          {built.warnings.map((w, i) => <li key={i} className="warn">⚠ {w}</li>)}
        </ul>
      )}
      <div className="shinsei-preview" data-testid="shinsei-preview">
        <div className="shinsei-pages" style={{ width: `${zoom * 100}%` }} dangerouslySetInnerHTML={{ __html: built.error ? '' : built.svg }} />
      </div>
      {showProfiles && <ProfileSettingsDialog onClose={() => setShowProfiles(false)} />}
    </div>
  );
}
