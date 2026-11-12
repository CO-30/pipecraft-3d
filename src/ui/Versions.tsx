/** ⑩ 版（保存した時点）: 残す・比べる・戻す・消す、比較の帯と一覧 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { projectToDoc, solveDoc, useStore } from '../state/store';
import { repo } from '../storage/instance';
import { MAX_VERSIONS, type VersionSummary } from '../storage/repository';
import { FIXTURE_CATALOG } from '../model/fixtures';
import { segmentLength } from '../model/network';
import { systemColor, systemLabel } from './colors';
import { DIFF_COLOR, useCompare } from './useCompare';

const two = (n: number) => String(n).padStart(2, '0');
const versionTime = (t: number) => { const d = new Date(t); return `${d.getMonth() + 1}/${d.getDate()} ${two(d.getHours())}:${two(d.getMinutes())}`; };
const mb = (bytes: number) => (bytes >= 1e6 ? `${(bytes / 1e6).toFixed(1)}MB` : `${Math.max(1, Math.round(bytes / 1e3))}KB`);

/** 表示パネルの下: 版の一覧 */
export function VersionsPanel() {
  const projectId = useStore((s) => s.meta?.id);
  const comparing = useStore((s) => s.compare?.id ?? null);
  // 一覧は工事ごと（別の工事を開いたら前の工事の版は出さない）
  const [listState, setListState] = useState<{ pid?: string; items: VersionSummary[] }>({ items: [] });
  const list = listState.pid === projectId ? listState.items : [];
  const [name, setName] = useState('');
  const [status, setStatus] = useState<string | null>(null);
  const [armed, setArmed] = useState<{ id: string; what: 'restore' | 'delete' } | null>(null);
  const [busy, setBusy] = useState(false);
  // 速い 2 度押しでも 1 回だけ（state は次の描画まで変わらないため ref で）
  const busyRef = useRef(false);
  const refresh = useCallback(async () => { if (projectId) setListState({ pid: projectId, items: await repo.listVersions(projectId) }); }, [projectId]);
  useEffect(() => {
    let alive = true;
    if (projectId) void repo.listVersions(projectId).then((l) => { if (alive) setListState({ pid: projectId, items: l }); });
    return () => { alive = false; };
  }, [projectId]);
  if (!projectId) return null;
  const st = useStore.getState();

  const run = async (f: () => Promise<void>) => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    try { await f(); } catch (e) { setStatus(`できませんでした: ${(e as Error).message}`); } finally { busyRef.current = false; setBusy(false); }
  };
  const saveNow = (label: string) => run(async () => {
    const p = useStore.getState().toProjectData();
    if (!p) return;
    const r = await repo.saveVersion(p, label);
    dropNotice(r.dropped);
    setStatus(`版「${label}」を残しました${r.dropped.length ? `（${MAX_VERSIONS} 版を超えたので ${r.dropped.length} 版を消しました。自動で残した「戻す前」から消します）` : ''}`);
    setName('');
    await refresh();
  });
  const compare = (v: VersionSummary) => run(async () => {
    if (comparing === v.id) { st.setCompare(null); return; }
    const p = await repo.loadVersion(v.id);
    if (!p) { setStatus('版が見つかりません'); await refresh(); return; }
    st.select(null);
    st.setTrace(null);
    // 今と同じく排水の高さを計算し直してから比べる（計算の違いを「変わった」と出さない）
    st.setCompare({ id: v.id, name: v.name, createdAt: v.createdAt, doc: solveDoc(projectToDoc(p)).doc });
    setStatus(null);
  });
  const restore = (v: VersionSummary) => run(async () => {
    const p = await repo.loadVersion(v.id);
    const cur = useStore.getState().toProjectData();
    if (!p || !cur) { setArmed(null); setStatus('版が見つかりませんでした（消されたかもしれません）'); await refresh(); return; }
    // 戻す前の状態も版に残す（元に戻すの履歴は工事を開き直すと消えるため）。戻す版は消さない
    const r = await repo.saveVersion(cur, `戻す前 ${versionTime(Date.now())}`, Date.now(), { auto: true, keep: v.id });
    dropNotice(r.dropped);
    st.restoreProject(p);
    setArmed(null);
    setStatus(`版「${v.name}」に戻しました（元に戻すで取り消せます。戻す前の状態も版に残しました${r.dropped.length ? `。版が ${MAX_VERSIONS} を超えたので ${r.dropped.length} 版を消しました` : ''}。下敷き・外壁の写真は今のままです）`);
    await refresh();
  });
  /** 消えた版と比べていたら比較をやめる */
  const dropNotice = (ids: string[]) => { const c = useStore.getState().compare; if (c && ids.includes(c.id)) useStore.getState().setCompare(null); };
  const remove = (v: VersionSummary) => run(async () => {
    if (comparing === v.id) st.setCompare(null);
    await repo.deleteVersion(v.id);
    setArmed(null);
    await refresh();
  });

  return (
    <details className="versions" data-testid="versions">
      <summary>🕘 版（保存した時点） <span className="muted small">{list.length} 版</span></summary>
      <div className="muted small">申請を出した時などの状態を残して、今と比べたり戻したりできます（この端末の中だけ。下敷きの画像・外壁の写真は版に入れません）</div>
      <div className="row">
        <input data-testid="version-name" className="version-name" value={name} maxLength={40} placeholder="名前（例: 申請提出）。空なら日時" onChange={(e) => setName(e.target.value)} />
        <button className="primary" data-testid="version-save" disabled={busy} onClick={() => saveNow(name.trim() || versionTime(Date.now()))}>＋ 今の状態を版にする</button>
      </div>
      {status && <div className="small" role="status" data-testid="version-status">{status}</div>}
      <ul>
        {list.map((v) => (
          <li key={v.id} data-testid="version-row" data-version={v.id} className={comparing === v.id ? 'on' : ''}>
            <div className="version-head"><b>{v.name}</b>{v.auto && <span className="muted small">（自動）</span>} <span className="muted small">{versionTime(v.createdAt)}・{mb(v.bytes)}</span></div>
            <div className="row">
              <button data-testid="version-compare" aria-pressed={comparing === v.id} className={comparing === v.id ? 'on' : ''} disabled={busy} onClick={() => compare(v)}>{comparing === v.id ? '比較をやめる' : '⇆ 今と比べる'}</button>
              {armed?.id === v.id && armed.what === 'restore'
                ? <button className="danger" data-testid="version-restore-ok" disabled={busy} onClick={() => restore(v)}>この版に戻す（取り消せます）</button>
                : <button data-testid="version-restore" disabled={busy} onClick={() => setArmed({ id: v.id, what: 'restore' })}>↩ 戻す…</button>}
              {armed?.id === v.id && armed.what === 'delete'
                ? <button className="danger" data-testid="version-delete-ok" disabled={busy} onClick={() => remove(v)}>本当に消す</button>
                : <button data-testid="version-delete" disabled={busy} onClick={() => setArmed({ id: v.id, what: 'delete' })}>🗑</button>}
              {armed?.id === v.id && <button onClick={() => setArmed(null)}>やめる</button>}
            </div>
          </li>
        ))}
      </ul>
    </details>
  );
}

/** 比較しているときの帯: 版の名前・増えた／なくなった／変わった数・管の長さの差。一覧からその場所へ */
export function CompareBar() {
  const c = useCompare();
  const inElevation = useStore((s) => !!s.activeElevationId);
  const doc = useStore((s) => s.doc);
  const [open, setOpen] = useState(false);
  if (!c || inElevation) return null;
  const old = c.target.doc;
  const m = (mm: number) => `${(mm / 1000).toFixed(1)}m`;
  // 0.1m 未満の差は mm で（「+0.0m」と出さない）
  const sign = (mm: number) => (Math.abs(mm) < 100 ? (mm > 0 ? `+${mm}mm` : mm < 0 ? `−${-mm}mm` : '±0') : mm > 0 ? `+${m(mm)}` : `−${m(-mm)}`);
  const label = (t: string) => FIXTURE_CATALOG[t as keyof typeof FIXTURE_CATALOG]?.label ?? t;
  const nAdd = c.segments.added.length + c.fixtures.added.length;
  const nRm = c.segments.removed.length + c.segments.removedParts.length + c.fixtures.removed.length;
  const nCh = c.segments.changed.length + c.fixtures.moved.length + c.fixtures.changed.length;
  const lens = c.lengths.filter((l) => l.before !== l.after);
  // 押したときの状態で（描いたときの階ではなく）。今の工事に無い階へは移らない
  const goFloor = (floorId: string | undefined) => {
    const st = useStore.getState();
    if (floorId && st.activeFloorId !== floorId && st.doc.building.floors.some((f) => f.id === floorId)) st.setActiveFloor(floorId);
  };
  /** 区間の階: 点の階、無ければ高さから */
  const segFloor = (d: typeof doc, id: string) => {
    const s = d.network.segments[id];
    if (!s) return undefined;
    const tagged = d.network.nodes[s.a].floorId ?? d.network.nodes[s.b].floorId;
    if (tagged) return tagged;
    const z = Math.min(d.network.nodes[s.a].pos.z, d.network.nodes[s.b].pos.z);
    const fs = [...doc.building.floors].sort((a, b) => a.elevation - b.elevation);
    return [...fs].reverse().find((f) => z >= f.elevation - 1000)?.id ?? fs[0]?.id;
  };
  const sel = (sel: Parameters<ReturnType<typeof useStore.getState>['select']>[0]) => useStore.getState().select(sel);
  type Row = { key: string; kind: 'added' | 'removed' | 'changed'; text: string; go: () => void };
  const rows: Row[] = [
    ...c.segments.added.map((id): Row => { const s = doc.network.segments[id]; return { key: 'sa' + id, kind: 'added', text: `${systemLabel(s.system)}の管 φ${s.diameter} ${m(segmentLength(doc.network, id))}`, go: () => { goFloor(segFloor(doc, id)); sel({ kind: 'segment', id }); } }; }),
    ...c.segments.changed.map((x): Row => { const s = doc.network.segments[x.id]; return { key: 'sc' + x.id, kind: 'changed', text: `${systemLabel(s.system)}の管 ${x.what.join('・')}`, go: () => { goFloor(segFloor(doc, x.id)); sel({ kind: 'segment', id: x.id }); } }; }),
    ...c.segments.removed.map((id): Row => { const s = old.network.segments[id]; return { key: 'sr' + id, kind: 'removed', text: `${systemLabel(s.system)}の管 φ${s.diameter} ${m(segmentLength(old.network, id))}`, go: () => { goFloor(segFloor(old, id)); sel(null); } }; }),
    ...c.segments.removedParts.map((r, i): Row => { const s = old.network.segments[r.oldId]; return { key: `sp${r.oldId}-${i}`, kind: 'removed', text: `${systemLabel(s.system)}の管 φ${s.diameter} の一部 ${m(r.length)}`, go: () => { goFloor(segFloor(old, r.oldId)); sel(null); } }; }),
    ...c.fixtures.added.map((id): Row => ({ key: 'fa' + id, kind: 'added', text: label(doc.fixtures[id].type), go: () => { goFloor(doc.fixtures[id].floorId); sel({ kind: 'fixture', id }); } })),
    ...c.fixtures.moved.map((x): Row => ({ key: 'fm' + x.id, kind: 'changed', text: `${label(doc.fixtures[x.id].type)} ${x.what.join('・')}`, go: () => { goFloor(doc.fixtures[x.id].floorId); sel({ kind: 'fixture', id: x.id }); } })),
    ...c.fixtures.changed.map((x): Row => ({ key: 'fc' + x.id, kind: 'changed', text: `器具 ${x.what.join('・')}`, go: () => { goFloor(doc.fixtures[x.id].floorId); sel({ kind: 'fixture', id: x.id }); } })),
    ...c.fixtures.removed.map((id): Row => ({ key: 'fr' + id, kind: 'removed', text: label(old.fixtures[id].type), go: () => { goFloor(old.fixtures[id].floorId); sel(null); } })),
  ];
  const mark = { added: '＋', removed: '−', changed: '△' } as const;
  return (
    <div className="sel-bar compare-bar" data-testid="compare-bar" role="status" aria-live="polite">
      <div className="compare-main">
        <span>
          版「<b data-testid="compare-name">{c.target.name}</b>」<span className="muted small">{versionTime(c.target.createdAt)}</span> と比べて —{' '}
          {c.total === 0 && !c.building.changed && !lens.length ? <b data-testid="compare-none">違いはありません</b> : <>
            <b style={{ color: DIFF_COLOR.added }} data-testid="compare-added">増えた {nAdd}</b>・<b style={{ color: DIFF_COLOR.removed }} data-testid="compare-removed">なくなった {nRm}</b>・<b style={{ color: DIFF_COLOR.changed }} data-testid="compare-changed">変わった {nCh}</b>
            {lens.length > 0 && <span className="compare-lens" data-testid="compare-lengths">（{lens.map((l) => <span key={l.system}><i className="sys-dot" style={{ background: systemColor(l.system) }} />{systemLabel(l.system)} {sign(l.after - l.before)} </span>)}）</span>}
            {c.building.changed && <span className="muted small" data-testid="compare-building">・建物も変わっています{c.building.walls ? `（壁 ${c.building.walls > 0 ? '+' : ''}${c.building.walls}）` : ''}</span>}
          </>}
        </span>
        {rows.length > 0 && <button data-testid="compare-list-toggle" aria-expanded={open} onClick={() => setOpen(!open)}>{open ? '一覧を閉じる' : '一覧'}</button>}
        <button data-testid="compare-clear" aria-label="比較をやめる" onClick={() => useStore.getState().setCompare(null)}>✕ 比較をやめる</button>
      </div>
      {open && (
        <ul className="compare-list" data-testid="compare-list">
          {rows.map((r) => (
            <li key={r.key}><button data-testid="compare-row" data-fb="比較の一覧から選ぶ" data-kind={r.kind} onClick={r.go}><b style={{ color: DIFF_COLOR[r.kind] }}>{mark[r.kind]}</b> {r.text}</button></li>
          ))}
        </ul>
      )}
    </div>
  );
}
