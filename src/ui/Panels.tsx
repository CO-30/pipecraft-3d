/**
 * 編集画面のパネル類：プロパティ（選択対象の設定）、階バー、表示切替、ツールバー。
 */
import { AddNoteButton, NoteEditor } from './Notes';
import { noteNumbers } from '../model/notes';
import { isUnderfloorDrain, underfloorLevels } from '../model/underfloorSlope';
import { resolveSupplyRules } from '../model/hydraulics/supplyRules';
import { useEffect, useMemo, useRef, useState } from 'react';
import { activeFloorElevation, branchDeletionPreview, isUnderFloor, presetVisibility, useStore, VIS_CATEGORIES, type FloorFilter, type Tool, type VisMode, type VisPreset } from '../state/store';
import { clampSection, sectionRange, type SectionMode } from '../model/section';
import { connectedComponent, segmentLength, segmentsAt, type SystemType } from '../model/network';
import { floorById, roomArea, wallLength } from '../model/building';
import { MEMBER_LABEL, stairSteps } from '../model/members';
import { detour, findHits } from '../model/obstacles';
import { DEFAULT_DROP_DEPTH, DROP_MAX, DROP_MIN } from '../model/dropPipes';
import { levelSummary, levelText } from '../model/levels';
import { minSlopeFor, resolveProfile } from '../model/municipality';
import { useProfiles } from './useProfiles';
import { FIXTURE_CATALOG, FIXTURE_GROUPS, fixtureConnected, type FixtureType, fixtureSize, groundZ, isHeader, isManhole, manholeDepth, manholeInvertZ, portNodes } from '../model/fixtures';
import { portCandidates } from '../model/portRoute';
import { UnderlayPanel } from './UnderlayPanel';
import { WallPhotoDialog } from './WallPhotoDialog';
import { ElevationDialog } from './ElevationDialog';
import { SYSTEMS, defaultSystemColor, systemColor, systemLabel, useColors } from './colors';
import { familyOf, type SystemFamily } from '../model/trace';
import { useTrace } from './useTrace';
import { defaultEstimate, measureSegment } from '../model/estimate';
import { findConnectCandidate } from '../model/connect';
import { SYSTEM_NAME } from '../model/systems';
import { actualSlope, defaultSlope, isDrain, isSlopePinned, maxSlope, slopeEnough, slopeLabel } from '../model/slope';
import { defaultSupportSettings, SUBSTRATE_LABEL, SUPPORT_LABEL, supportKindOf } from '../model/supports';
import { analyzeFittings, FITTING_LABEL, FITTING_TYPES, fittingName, type FittingChoice } from '../model/fittings';
import { PB_MATERIAL_LABEL, PB_MATERIALS, WATER_MATERIAL_OPTIONS } from '../model/materials';

const DIAMETERS = [13, 16, 20, 25, 30, 40, 50, 65, 75, 100, 125, 150];
const HEIGHT_PRESETS: { label: string; z: number }[] = [
  { label: '床下', z: -300 }, { label: '床上', z: 100 }, { label: '壁内', z: 1200 }, { label: '天井裏', z: 2600 },
];

/** 確定時（フォーカスを外す・Enter）だけ反映する数値入力 */
export function NumField({ label, value, onCommit, unit = 'mm', testId, min, max, decimals = 0 }: { label: string; value: number; onCommit: (v: number) => void; unit?: string; testId?: string; min?: number; max?: number; decimals?: number }) {
  const [text, setText] = useState(fmtDec(value, decimals));
  useEffect(() => setText(fmtDec(value, decimals)), [value, decimals]);
  const commit = () => {
    if (text === fmtDec(value, decimals)) return; // 表示上の丸めだけで値を変えない
    const n = Number(text);
    if (text.trim() !== '' && Number.isFinite(n) && (min === undefined || n >= min) && (max === undefined || n <= max)) onCommit(n);
    else setText(fmtDec(value, decimals));
  };
  return (
    <label className="field inline">{label}
      <span className="unit-input">
        <input type="number" inputMode={decimals ? 'decimal' : 'numeric'} data-testid={testId} value={text} onChange={(e) => setText(e.target.value)}
          onBlur={commit} onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }} />
        <span>{unit}</span>
      </span>
    </label>
  );
}

const fmtDec = (x: number, d: number) => String(Math.round(x * 10 ** d) / 10 ** d);

function ElementVisibility({ id }: { id: string }) {
  const hidden = useStore((s) => s.hiddenIds.includes(id));
  const ghost = useStore((s) => s.ghostIds.includes(id));
  const cur: VisMode = hidden ? 'hide' : ghost ? 'ghost' : 'show';
  const st = useStore.getState();
  return (
    <div className="seg-btns small" aria-label="この部分の表示">
      {(['show', 'ghost', 'hide'] as VisMode[]).map((m) => (
        <button key={m} className={cur === m ? 'on' : ''} onClick={() => st.setElementVisibility(id, m)}>{m === 'show' ? '表示' : m === 'ghost' ? '半透明' : 'この部分だけ非表示'}</button>
      ))}
    </div>
  );
}

/** 梁・軒などにぶつかっている区間: 避け方を選ぶ */
function AvoidFields({ segId }: { segId: string }) {
  const doc = useStore((s) => s.doc);
  const [msg, setMsg] = useState('');
  const hits = useMemo(() => findHits(doc, [segId]).map((h) => ({ h, sq: detour(doc, h, 'square'), dg: detour(doc, h, 'diagonal') })), [doc, segId]);
  const seg = doc.network.segments[segId];
  const pens = (seg?.penetrations ?? []).filter((id) => doc.building.members?.[id]);
  if (!hits.length && !pens.length) return null;
  const st = useStore.getState();
  return (
    <div className="avoid" data-testid="avoid-panel">
      {hits.map(({ h, sq, dg }) => {
        return (
          <div key={h.memberId} className="avoid-hit">
            <b>⚠ {MEMBER_LABEL[h.kind]}にぶつかっています</b>
            <div className="row">
              <button data-testid="avoid-square" disabled={'error' in sq} title={'error' in sq ? sq.error : undefined} onClick={() => setMsg(st.avoidObstacle(segId, h.memberId, 'square') ?? '')}>
                A {'error' in sq ? '回れません' : sq.label}：90°エルボ×4</button>
              <button data-testid="avoid-diagonal" disabled={'error' in dg} title={'error' in dg ? dg.error : undefined} onClick={() => setMsg(st.avoidObstacle(segId, h.memberId, 'diagonal') ?? '')}>
                B 45°で逃げる：45°エルボ×4</button>
              <button data-testid="avoid-sleeve" onClick={() => st.setPenetration(segId, h.memberId, true)}>C 貫通（スリーブ・要確認）</button>
            </div>
            {[...new Set(['error' in sq ? `A: ${sq.error}` : '', 'error' in dg ? `B: ${dg.error}` : ''].filter(Boolean))].map((t) => <p key={t} className="muted small">{t}</p>)}
          </div>
        );
      })}
      {pens.map((id) => (
        <div key={id} className="avoid-hit">貫通（スリーブ）: {MEMBER_LABEL[doc.building.members![id].kind]}・構造の確認が必要
          <button data-testid="avoid-unsleeve" onClick={() => st.setPenetration(segId, id, false)}>貫通をやめる</button></div>
      ))}
      {msg && <p className="err" role="alert">{msg}</p>}
    </div>
  );
}

export function PropertyPanel() {
  const [photoWall, setPhotoWall] = useState<string | null>(null);
  const sel = useStore((s) => s.selection);
  const doc = useStore((s) => s.doc);
  const tool = useStore((s) => s.tool);
  const drawAttrs = useStore((s) => s.drawAttrs);
  const drawHeight = useStore((s) => s.drawHeight);
  const ortho = useStore((s) => s.orthoSnap);
  const splitWithWall = useStore((s) => s.splitWithWall);
  const floorElev = useStore((s) => floorById(s.doc.building, s.activeFloorId)?.elevation ?? 0);
  const st = useStore.getState();
  const { building: b, network: net } = doc;

  if (sel?.kind === 'note' && doc.notes?.[sel.id]) return <NoteEditor key={sel.id} id={sel.id} />;
  if (sel?.kind === 'segment' && net.segments[sel.id]) {
    const seg = net.segments[sel.id];
    const preview = branchDeletionPreview(net, seg.id);
    const za = net.nodes[seg.a].pos.z, zb = net.nodes[seg.b].pos.z;
    const vertical = Math.hypot(net.nodes[seg.a].pos.x - net.nodes[seg.b].pos.x, net.nodes[seg.a].pos.y - net.nodes[seg.b].pos.y) < 1;
    const run = connectedComponent(net, seg.id);
    const runLen = run.segmentIds.reduce((a, id) => a + segmentLength(net, id), 0);
    return (
      <div className="props">
        <div className="ptitle">{vertical ? '立て管' : '配管区間'} <b data-testid="sel-length">{Math.round(segmentLength(net, seg.id))}</b>mm
          {seg.measuredLength !== undefined && <span className="muted small">（実測 {Math.round(seg.measuredLength)}mm{seg.measuredApprox ? '・概算' : ''}）</span>}</div>
        {seg.measuredLength === undefined && <button className="primary" data-testid="jump-measure" onClick={() => {
          const el = document.querySelector<HTMLInputElement>('[data-testid="seg-measured"]');
          el?.scrollIntoView({ block: 'center', behavior: 'smooth' });
          el?.focus();
        }}>📏 実測長を入れる</button>}
        <label className="field inline">種類<select data-testid="seg-system" value={seg.system} onChange={(e) => st.updateSegment(seg.id, { system: e.target.value as SystemType })}>
          {SYSTEMS.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}</select></label>
        <label className="field inline">口径<select data-testid="seg-diameter" value={seg.diameter} onChange={(e) => st.updateSegment(seg.id, { diameter: Number(e.target.value) })}>
          {[...new Set([...DIAMETERS, seg.diameter])].sort((x, y) => x - y).map((d) => <option key={d} value={d}>φ{d}</option>)}</select></label>
        {seg.diameterPin && <button className="small" data-testid="seg-diameter-unpin" title="手で決めた管径の固定を外します。自動はつながる器具から太くするだけで、細くはしません" onClick={() => st.unpinSegmentDiameter(seg.id)}>📌 管径を自動に戻す</button>}
        <MaterialField id={seg.id} value={seg.material ?? ''} />
        <SystemColor system={seg.system} />
        <NumField label="長さ" value={segmentLength(net, seg.id)} min={1} testId="seg-length" onCommit={(v) => st.setSegmentLength(seg.id, v)} />
        {!vertical && <NumField label="床からの高さ" value={(za + zb) / 2 - floorElev} testId="seg-height" onCommit={(v) => st.setSegmentHeight(seg.id, floorElev + v)} />}
        <AvoidFields segId={seg.id} />
        <MeasureFields key={seg.id} segId={seg.id} />
        <SupportFields key={'s' + seg.id} segId={seg.id} />
        <div className="row">
          <button onClick={() => st.setTool('pipe')}>ここから分岐</button>
          <button data-testid="cut-seg" onClick={() => st.cutSelected()}>✂ ここで切断</button>
          <button data-testid="add-valve" onClick={() => st.insertValveAtSelection()}>バルブを入れる</button>
          <button className="danger" data-testid="delete-seg" onClick={() => st.deleteSelected()}>区間削除</button>
          <button className="danger" disabled={!preview} title={preview ? '' : '本管の途中、または分岐のない配管です'} onClick={() => {
            if (!preview) return;
            const len = preview.reduce((a, id) => a + segmentLength(net, id), 0);
            if (window.confirm(`分岐点から先の枝管 ${preview.length}区間（計 ${Math.round(len)}mm）を削除します。よろしいですか？`)) st.deleteSelectedBranch();
          }}>枝管ごと削除</button>
        </div>
        <DetachEnds segId={seg.id} />
        <button data-testid="trace-system" aria-label="この系統をたどる" onClick={() => st.setTrace(seg.id)} title="同じ系統につながる管・器具をまとめて強調し、長さ・器具の数を出します">🔗 この系統をたどる</button>
        <div className="subhead">つながった配管全体（{run.segmentIds.length}区間・{Math.round(runLen)}mm）</div>
        <div className="row">
          <button onClick={() => st.setRunHeightDelta(seg.id, -100)}>高さ−100</button>
          <button onClick={() => st.setRunHeightDelta(seg.id, 100)}>高さ＋100</button>
          <button data-testid="duplicate-run" onClick={() => st.duplicateRun(seg.id)}>複製</button>
          <button className="danger" data-testid="delete-run" onClick={() => {
            if (window.confirm(`つながった配管 ${run.segmentIds.length}区間（計 ${Math.round(runLen)}mm）をすべて削除します。よろしいですか？`)) st.deleteRun(seg.id);
          }}>全体を削除</button>
        </div>
        <div className="muted small">選択した区間をもう一度ドラッグすると移動できます</div>
      </div>
    );
  }
  if (sel?.kind === 'node' && net.nodes[sel.id]) {
    const n = net.nodes[sel.id];
    const rel = n.pos.z - floorElev;
    const deg = segmentsAt(net, n.id).length;
    const fx = n.fixtureId ? doc.fixtures[n.fixtureId] : undefined;
    const portLabel = fx ? FIXTURE_CATALOG[fx.type].ports.find((p) => p.id === n.portId)?.label : undefined;
    const fi = b.floors.findIndex((f) => f.id === (n.floorId ?? st.activeFloorId));
    return (
      <div className="props">
        <div className="ptitle">{fx ? `${FIXTURE_CATALOG[fx.type].label}の接続口（${portLabel}）` : `配管の点（${KIND[n.kind] ?? n.kind}）`}
          <span className="muted small"> 床から {Math.round(rel)}mm</span></div>
        <ConnectBox nodeId={n.id} />
        <PortConnect nodeId={n.id} />
        {!fx && (
          <>
            <NumField label="床からの高さ" value={rel} testId="node-height" onCommit={(v) => st.setNodeHeight(n.id, floorElev + v)} />
            <div className="row">
              <button onClick={() => st.setNodeHeight(n.id, n.pos.z - 100)}>−100</button>
              <button onClick={() => st.setNodeHeight(n.id, n.pos.z + 100)}>＋100</button>
              {HEIGHT_PRESETS.map((h) => <button key={h.label} onClick={() => st.setNodeHeight(n.id, floorElev + h.z)}>{h.label}</button>)}
            </div>
          </>
        )}
        <div className="subhead">立て管（この点から縦に配管）</div>
        <div className="row">
          <button data-testid="riser-up" disabled={fi < 0 || fi >= b.floors.length - 1} onClick={() => st.addRiserFromNode(n.id, 'up')}>↑ 上の階へ</button>
          <button data-testid="riser-down" disabled={fi <= 0} onClick={() => st.addRiserFromNode(n.id, 'down')}>↓ 下の階へ</button>
        </div>
        <NumField label="立て管の上端/下端（床から）" value={rel} testId="riser-to" onCommit={(v) => st.addRiserFromNode(n.id, floorElev + v)} />
        {!fx && (
          <div className="row">
            <button data-testid="detach-node" disabled={deg < 2} onClick={() => st.detachSelectedNode()}>つながりを全部外す</button>
            <button className="danger" data-testid="delete-fitting" disabled={deg >= 3 && n.kind !== 'valve'} title={deg >= 3 ? '分岐点は「枝管ごと削除」を使ってください' : ''}
              onClick={() => st.deleteSelectedFitting()}>{n.kind === 'valve' ? 'バルブを外す' : deg === 1 ? 'この区間を削除' : 'この部品を削除'}</button>
          </div>
        )}
        {deg > 0 && <FittingField key={n.id} nodeId={n.id} />}
        {segmentsAt(net, n.id).some((x) => isDrain(x.system)) && <SlopeField key={'sl' + n.id} nodeId={n.id} />}
        {deg === 1 && !fx && <div className="muted small">端点をドラッグして他の配管の上で離すとつながります</div>}
      </div>
    );
  }
  if (sel?.kind === 'fixture' && doc.fixtures[sel.id]) {
    const f = doc.fixtures[sel.id];
    const def = FIXTURE_CATALOG[f.type];
    const ports = portNodes(net, f.id);
    const fl = floorById(doc.building, f.floorId);
    const size = fixtureSize(f, doc.building, doc.site);
    const manhole = isManhole(f.type) && fl;
    return (
      <div className="props">
        <div className="ptitle">{def.label} <span className="muted small">{manhole ? `φ${size.w}` : `${size.w}×${size.d}mm`}・向き {f.rotation}°</span></div>
        <div className="row" data-testid="fixture-type-row">
          <label className="small">種類
            <select data-testid="fixture-type-change" value={f.type} disabled={fixtureConnected(doc, f.id)} onChange={(e) => st.changeFixtureType(f.id, e.target.value as FixtureType)}>
              {FIXTURE_GROUPS.map((g) => <optgroup key={g.label} label={g.label}>{g.types.map((t) => <option key={t} value={t}>{FIXTURE_CATALOG[t].label}</option>)}</optgroup>)}
            </select>
          </label>
          {fixtureConnected(doc, f.id) && <span className="small muted">配管がつながっているので、種類は配管を外してから変えます</span>}
        </div>
        {manhole && (
          <div className="row" data-testid="manhole-params">
            <NumField label="口径" value={f.params?.diameter ?? 300} min={100} max={2000} testId="manhole-diameter" onCommit={(v) => st.updateFixtureParams(f.id, { diameter: v })} />
            <label className="small">形状
              <select data-testid="manhole-shape" value={f.params?.shape ?? 'round'} onChange={(e) => st.updateFixtureParams(f.id, { shape: e.target.value as 'round' | 'square' })}>
                <option value="round">丸</option><option value="square">角</option>
              </select>
            </label>
            <label className="small inline" title={f.type.startsWith('public') ? '既存の公共マスなら付ける（申請図面では青。新設なら赤）' : '申請図面では既設を青で描きます'}><input type="checkbox" data-testid="manhole-existing" checked={!!f.params?.existing} onChange={(e) => st.updateFixtureParams(f.id, { existing: e.target.checked || undefined })} /> 既設</label>
            <NumField label="管底高 FL" value={manholeInvertZ(f, doc.building, doc.site) - fl.elevation} testId="manhole-invert" onCommit={(v) => st.updateFixtureParams(f.id, { invertZ: v + fl.elevation })} />
            <span className="small muted" data-testid="manhole-depth">深さ {Math.round(manholeDepth(f, doc.building, doc.site))}mm（GL {doc.site?.designGL === undefined ? '仮 ' : ''}1階FL{groundZ(doc.building, doc.site) >= 0 ? '+' : ''}{Math.round(groundZ(doc.building, doc.site))}）</span>
            <NumField label="落差（流入側の管底が高い分）" value={f.params?.drop ?? 0} testId="manhole-drop" onCommit={(v) => st.updateFixtureParams(f.id, { drop: v > 0 ? Math.round(v) : undefined })} />
            {(f.params?.drop ?? 0) > 0 && <span className="small muted" data-testid="manhole-drop-note">落差桝: 上流からの管は管底 +{Math.round(f.params!.drop!)} に着きます（縦断図は H{Math.round(manholeDepth(f, doc.building, doc.site) - f.params!.drop!)}-{Math.round(manholeDepth(f, doc.building, doc.site))}）</span>}
          </div>
        )}
        {isHeader(f.type) && fl && (
          <div className="row" data-testid="header-mount">
            <NumField label="設置の高さ（床から）" value={f.params?.mountZ ?? (def.base as number)} min={doc.building.floors[0]?.id === f.floorId ? -1000 : 0} max={Math.max(0, fl.height - fl.slabThickness - def.size.h)} testId="header-mount-z" onCommit={(v) => st.updateFixtureParams(f.id, { mountZ: Math.round(v) })} />
            <button data-testid="header-under" onClick={() => st.updateFixtureParams(f.id, { mountZ: -400 })}>床下（出口 −300）</button>
            <button onClick={() => st.updateFixtureParams(f.id, { mountZ: undefined })}>床上（標準）</button>
          </div>
        )}
        <div className="subhead">接続口（押すと選択して立て管などを追加できます。✓=配管あり）</div>
        <div className="row">{def.ports.map((p) => {
          const n = ports.find((x) => x.portId === p.id);
          const used = n ? segmentsAt(net, n.id).length > 0 : false;
          return <button key={p.id} data-testid={`port-${p.id}`} disabled={!n} onClick={() => n && st.select({ kind: 'node', id: n.id })}>{p.label} φ{p.diameter}{used ? ' ✓' : ''}</button>;
        })}</div>
        <TraceButtons fixtureId={f.id} />
        {ports.filter((n) => segmentsAt(net, n.id).length === 0).map((n) => <PortConnect key={n.id} nodeId={n.id} title={`${def.ports.find((p) => p.id === n.portId)?.label}から`} />)}
        <div className="row">
          <button data-testid="rotate-fixture" onClick={() => st.rotateFixture(f.id)}>⟳ 90°回転</button>
          <button onClick={() => st.setTool('pipe')}>接続口から配管</button>
          <button className="danger" data-testid="delete-fixture" onClick={() => {
            if (!fixtureConnected(doc, f.id) || window.confirm(`${def.label}を削除します。つながっている配管は残ります。よろしいですか？`)) st.deleteSelected();
          }}>器具を削除</button>
        </div>
        <div className="muted small">ドラッグで移動。配管の端も一緒に動きます</div>
      </div>
    );
  }
  if (sel?.kind === 'wall' && b.walls[sel.id]) {
    const w = b.walls[sel.id];
    const openFace = (mode: 'pipe' | 'build') => { const err = st.openWallFace(w.id, mode); if (err) useStore.setState({ notice: err }); };
    return (
      <div className="props">
        <div className="ptitle">{w.kind === 'exterior' ? '外壁' : '内壁'} 長さ <b data-testid="wall-length">{Math.round(wallLength(b, w.id))}</b>mm{w.lengthSet === false && <span className="tag-warn">寸法未確定</span>}</div>
        <div className="face-open" data-testid="face-open">
          <div className="small muted">🧱 この壁を正面から見る（壁の幅・高さはそのまま使います）</div>
          <div className="row">
            {w.kind === 'exterior' && <button data-testid="wall-face" onClick={() => openFace('build')}>🏠 窓・梁・軒・張り出し・階段</button>}
            <button className="primary" data-testid="wall-elevation" onClick={() => openFace('pipe')}>〰️ 外配管を描く</button>
          </div>
        </div>
        <NumField label="厚さ" value={w.thickness} min={10} onCommit={(v) => st.updateWall(w.id, { thickness: v })} />
        <div className="seg-btns small">
          <button className={w.kind === 'exterior' ? 'on' : ''} onClick={() => st.updateWall(w.id, { kind: 'exterior' })}>外壁</button>
          <button className={w.kind === 'interior' ? 'on' : ''} onClick={() => st.updateWall(w.id, { kind: 'interior' })}>内壁</button>
        </div>
        <ElementVisibility id={w.id} />
        <div className="row">
          <button onClick={() => st.setTool('door')}>ドアを付ける</button>
          <button onClick={() => st.setTool('window')}>窓を付ける</button>
          {w.kind === 'exterior' && <button data-testid="wall-dims" onClick={() => st.openDimWizard(w.floorId, w.id)}>📏 外形の寸法を順番に入れる</button>}
          <button data-testid="wall-photo" onClick={() => setPhotoWall(w.id)}>📷 写真から窓・ドア</button>
          <button className="danger" onClick={() => st.deleteSelected()}>壁を削除</button>
        </div>
        {photoWall === w.id && <WallPhotoDialog wallId={w.id} onClose={() => setPhotoWall(null)} />}
      </div>
    );
  }
  if (sel?.kind === 'member' && b.members?.[sel.id]) {
    const m = b.members[sel.id];
    const len = Math.hypot(m.b.x - m.a.x, m.b.y - m.a.y);
    return (
      <div className="props" data-testid="member-panel">
        <div className="ptitle">{MEMBER_LABEL[m.kind]} 長さ <b>{Math.round(len)}</b>mm{m.kind === 'stair' && <>（{stairSteps(m)}段）</>}</div>
        <NumField label={m.kind === 'beam' || m.kind === 'stair' || m.kind === 'footing' ? '幅' : '出幅'} testId="member-width" value={m.width} min={50} max={5000} onCommit={(v) => st.updateMember(m.id, { width: v })} />
        {m.kind !== 'balcony' && m.kind !== 'stair' && <>
          <NumField label="下端（床から）" value={m.z0} onCommit={(v) => st.updateMember(m.id, { z0: v })} />
          <NumField label="上端（床から）" value={m.z1} onCommit={(v) => st.updateMember(m.id, { z1: v })} />
        </>}
        {m.kind === 'balcony' && <NumField label="手すりの高さ" value={m.z1} min={300} max={2000} onCommit={(v) => st.updateMember(m.id, { z1: v })} />}
        <ElementVisibility id={m.id} />
        <div className="row"><button className="danger" data-testid="member-delete" onClick={() => st.deleteSelected()}>削除</button></div>
      </div>
    );
  }
  if (sel?.kind === 'opening' && b.openings[sel.id]) {
    const o = b.openings[sel.id];
    return (
      <div className="props">
        <div className="ptitle">{o.type === 'door' ? 'ドア' : '窓'}</div>
        <NumField label="幅" value={o.width} min={100} onCommit={(v) => st.updateOpening(o.id, { width: v })} />
        <NumField label="高さ" value={o.height} min={100} onCommit={(v) => st.updateOpening(o.id, { height: v })} />
        <NumField label="床から" value={o.sill} min={0} onCommit={(v) => st.updateOpening(o.id, { sill: v })} />
        <NumField label="壁端から中心" value={o.offset} min={0} onCommit={(v) => st.updateOpening(o.id, { offset: v })} />
        <ElementVisibility id={o.id} />
        <div className="row"><button className="danger" onClick={() => st.deleteSelected()}>削除</button></div>
      </div>
    );
  }
  if (sel?.kind === 'room' && b.rooms[sel.id]) {
    const r = b.rooms[sel.id];
    return (
      <div className="props">
        <div className="ptitle">部屋 {roomArea(r).toFixed(2)}㎡</div>
        <RoomName id={r.id} name={r.name} />
        <ElementVisibility id={r.id} />
        <div className="row">
          <button data-testid="merge-room" onClick={() => st.startMerge()}>隣の部屋と結合</button>
          <button onClick={() => { st.setTool('split'); st.select(null); }}>✂ 分割</button>
          <button className="danger" onClick={() => st.deleteSelected()}>部屋を削除</button>
        </div>
        <MergeHint />
      </div>
    );
  }
  if (sel?.kind === 'corner' && b.corners[sel.id]) {
    const c = b.corners[sel.id];
    return <div className="props"><div className="ptitle">壁の角（{Math.round(c.x)}, {Math.round(c.y)}）ドラッグで移動</div></div>;
  }
  // 選択なし: ツールの設定
  if (tool === 'underlay') return <UnderlayPanel />;
  return (
    <div className="props">
      {tool === 'fixture' && <FixturePicker />}
      {tool === 'pipe' ? (
        <>
          <div className="howto pipe-howto">① 下で種類を選ぶ　② 器具の<b>丸（接続口）</b>から指でなぞる　③ 終わりで指を離す<br /><span className="small">配管の途中からなぞると分岐。曲がり角は自動で直角になります</span></div>
          <div className="sys-chips" role="radiogroup" aria-label="配管の種類" onKeyDown={(e) => {
            const ids = SYSTEMS.slice(0, 5).map((x) => x.id);
            const i = ids.indexOf(drawAttrs.system);
            const d = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0;
            if (!d) return;
            e.preventDefault();
            const next = ids[(Math.max(0, i) + d + ids.length) % ids.length];
            st.setDrawAttrs({ system: next });
            (e.currentTarget.querySelector(`[data-testid="sys-${next}"]`) as HTMLElement | null)?.focus();
          }}>
            {SYSTEMS.slice(0, 5).map((x) => (
              <button key={x.id} role="radio" aria-checked={drawAttrs.system === x.id} tabIndex={drawAttrs.system === x.id || (x.id === 'water' && !SYSTEMS.slice(0, 5).some((y) => y.id === drawAttrs.system)) ? 0 : -1} data-testid={`sys-${x.id}`} className={drawAttrs.system === x.id ? 'on' : ''}
                style={{ '--sys': systemColor(x.id) } as React.CSSProperties} onClick={() => st.setDrawAttrs({ system: x.id })}>
                <i className="sys-dot" />{x.label}
              </button>
            ))}
          </div>
          <label className="field inline">{SYSTEMS.slice(0, 5).some((x) => x.id === drawAttrs.system) ? 'その他' : '種類'}<select data-testid="draw-system" value={drawAttrs.system} onChange={(e) => st.setDrawAttrs({ system: e.target.value as SystemType })}>
            {SYSTEMS.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}</select></label>
          <label className="field inline">口径<select value={drawAttrs.diameter} onChange={(e) => st.setDrawAttrs({ diameter: Number(e.target.value) })}>
            {DIAMETERS.map((d) => <option key={d} value={d}>φ{d}</option>)}</select></label>
          {(drawAttrs.system === 'water' || drawAttrs.system === 'hotWater') && (
            <label className="field inline">管<select data-testid="draw-material" value={drawAttrs.material ?? ''} onChange={(e) => st.setDrawAttrs({ material: e.target.value || undefined })}>
              {WATER_MATERIAL_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</select></label>
          )}
          <label className="field inline">高さ<select data-testid="draw-height" value={drawHeight} onChange={(e) => st.setDrawHeight(Number(e.target.value))}>
            {[...HEIGHT_PRESETS, ...(HEIGHT_PRESETS.some((h) => h.z === drawHeight) ? [] : [{ label: '指定', z: drawHeight }])].map((h) => <option key={h.label} value={h.z}>{h.label}（{h.z}mm）</option>)}</select></label>
        </>
      ) : <div className="ptitle muted tool-help">{TOOL_HELP[tool]}</div>}
      {tool === 'split' && (
        <label className="field inline"><input type="checkbox" data-testid="split-with-wall" checked={splitWithWall} onChange={(e) => st.setSplitWithWall(e.target.checked)} /> 分割線に壁も作る</label>
      )}
      {(tool === 'pipe' || tool === 'wall' || tool === 'split' || tool === 'outline') && (
        <label className="field inline"><input type="checkbox" checked={ortho} onChange={(e) => st.setOrthoSnap(e.target.checked)} /> 直角に補正</label>
      )}
    </div>
  );
}

/** 器具の真下に配管を落とす（床下まで。まだ配管のつながっていない給水・給湯・排水の接続口が対象） */
function DropPipes() {
  const count = useStore((s) => Object.keys(s.doc.fixtures).length);
  // 入力した値をそのまま持つ（数字を打ってすぐボタンを押しても、打った深さで落とす）
  const [text, setText] = useState(String(DEFAULT_DROP_DEPTH));
  if (!count) return null;
  const v = Number(text);
  const ok = text.trim() !== '' && Number.isFinite(v) && v >= DROP_MIN && v <= DROP_MAX;
  return (
    <div className="drop-pipes" data-testid="drop-pipes">
      <div className="row">
        <button className="primary auto-connect" data-testid="auto-connect" title="器具の真下に管を下ろす → 排水を床下で集めて基礎貫通スリーブで外の汚水マスへ（置いたマスがあればそこへ）→ 外のマスを公共汚水マスまで → 水・お湯を床下で枝分かれさせて（止水栓も）→ キッチン・洗面台に通気弁、を 1 回で。元に戻す 1 回で全部戻ります" onClick={() => {
          // 外の排水管の土かぶり・勾配、給水の埋設深さは、申請図面で選んでいる自治体と現場の住所に合わせる
          const st = useStore.getState();
          const p = resolveProfile(st.doc.site?.municipalityProfileId, useProfiles.getState().user);
          const supply = resolveSupplyRules({ profileName: p.id === 'standard' ? undefined : p.name, address: st.meta?.address });
          useStore.setState({ notice: '汚水・水・湯をまとめてつないでいます…' });
          setTimeout(() => {
            try {
              // 床下へ落とす深さは下の入力欄の値（正しくなければ既定の 300mm）
              useStore.getState().autoConnectAll({ drainRules: { cover: p.profileTable.minCover, slopeFor: (d) => minSlopeFor(p, d) }, supply, dropDepth: ok ? v : undefined });
            } catch (e) {
              useStore.setState({ notice: `つなげませんでした: ${(e as Error).message}。1 つずつのボタンで試してください` });
            }
          }, 30);
        }}>🔗 汚水・水・湯をまとめてつなぐ（案）</button>
      </div>
      <div className="muted small">器具・公共汚水マス・水道メーターを置いてから押すと、床下に管を下ろして、排水は公共マスまで、水・お湯は床下で枝分かれさせて、止水栓・通気弁も入れてつなぎます。汚水マスを自分で置いておくと、その近くの基礎から外へ出して、そこへ集めます。水を分ける部品（ヘッダー）がどうしても要るときは、質問でお聞きします。下のボタンで 1 つずつもできます。</div>
      <div className="row">
        <label className="field inline">床から下へ
          <span className="unit-input"><input type="number" inputMode="numeric" data-testid="drop-depth" value={text} min={DROP_MIN} max={DROP_MAX} onChange={(e) => setText(e.target.value)} /><span>mm</span></span>
        </label>
        <button className="primary" data-testid="drop-run" disabled={!ok} title="トイレ・洗面・キッチン・浴槽・洗濯機・水栓の接続口から、床下まで立て管を作ります（屋外の水栓は地中へ）" onClick={() => useStore.getState().dropFixturePipes(v)}>🔽 器具の真下に配管を落とす</button>
      </div>
      {!ok && <div className="err small">{DROP_MIN}〜{DROP_MAX}mm で入力してください</div>}
      <div className="muted small">すべての階の器具が対象です。配管がつながっている接続口には足しません。</div>
      <div className="row">
        <button data-testid="drain-route" title="床下へ落とした排水・汚水を、いちばん出しやすい外壁の外に汚水マスを置いてつなぎます。基礎の立上りの貫通が少ない向きを選びます" onClick={() => {
          // 外の排水管の土かぶり・勾配は、申請図面で選んでいる自治体の決まりに合わせる
          const p = resolveProfile(useStore.getState().doc.site?.municipalityProfileId, useProfiles.getState().user);
          useStore.getState().routeDrainsOut({ cover: p.profileTable.minCover, slopeFor: (d) => minSlopeFor(p, d) });
        }}>🚽 排水を外の桝までつなぐ（案）</button>
      </div>
      <div className="muted small">1 階の床下の排水が対象です。給水・給湯はつなぎません。3D で確かめて、合わない所は直してください。</div>
      <div className="row">
        <button data-testid="supply-route" title="メーター → 床下の給水ヘッダー → 各器具、給湯器 → 床下の給湯ヘッダー → 各器具 をつなぎます（ヘッダー工法）。基礎の立上りは人通口などの切れ目を通ります" onClick={() => {
          // 埋設深さ・水理計算は、申請図面で選んでいる自治体と現場の住所に合わせる
          const st = useStore.getState();
          const p = resolveProfile(st.doc.site?.municipalityProfileId, useProfiles.getState().user);
          const rules = resolveSupplyRules({ profileName: p.id === 'standard' ? undefined : p.name, address: st.meta?.address });
          // 大きい家では少し時間がかかるので、先に知らせを出してから計算する（画面が止まって見えないように）
          useStore.setState({ notice: '給水・給湯の配管の案を作っています…' });
          setTimeout(() => useStore.getState().routeSupplies(rules), 30);
        }}>🚰 給水・給湯を床下でつなぐ（案）</button>
      </div>
      <div className="muted small">1 階の器具が対象です（屋外の水栓は除く）。つながっていない給水・給湯口だけをつなぐので、何度押しても増えません。</div>
    </div>
  );
}

function FixturePicker() {
  const t = useStore((s) => s.fixtureType);
  const st = useStore.getState();
  return (
    <>
      <div className="howto fixture-howto"><b>① 種類を選ぶ → ② 図面の置きたい所をタップ</b><br />置いた器具の丸（接続口）から配管を描けます。屋上タンクは一番上の階に置くと屋上に載ります</div>
      <DropPipes />
      <div className="fixture-picker" data-testid="fixture-picker">
      {FIXTURE_GROUPS.map((g) => (
        <div key={g.label} className="fixture-group">
          <div className="fgroup-label">{g.label}</div>
          <div className="fixture-grid">
            {g.types.map((x) => <button key={x} data-testid={`fixture-${x}`} className={t === x ? 'on' : ''} onClick={() => st.setFixtureType(x)}>{FIXTURE_CATALOG[x].label}</button>)}
          </div>
        </div>
      ))}
      </div>
    </>
  );
}

/** 空欄を許す数値入力（確定時のみ反映）。空欄 → undefined */
export function OptNumField({ label, value, onCommit, unit = 'mm', testId, placeholder, max, positive }: { label: string; value: number | undefined; onCommit: (v: number | undefined) => void; unit?: string; testId?: string; placeholder?: string; max?: number; positive?: boolean }) {
  const fmt = (x: number | undefined) => (x === undefined ? '' : String(Math.round(x * 100) / 100));
  const [text, setText] = useState(fmt(value));
  useEffect(() => setText(fmt(value)), [value]);
  const commit = () => {
    if (text.trim() === '') { if (value !== undefined) onCommit(undefined); return; }
    const n = Number(text);
    if (Number.isFinite(n) && (positive ? n > 0 : n >= 0) && (max === undefined || n <= max)) onCommit(n);
    else setText(fmt(value));
  };
  return (
    <label className="field inline">{label}
      <span className="unit-input">
        <input type="number" inputMode="decimal" data-testid={testId} value={text} placeholder={placeholder} onChange={(e) => setText(e.target.value)}
          onBlur={commit} onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }} />
        <span>{unit}</span>
      </span>
    </label>
  );
}

const EXTRA_CHOICES = [0, 0.05, 0.1];

/** 区間の実測長・余長（積算） */
function MeasureFields({ segId }: { segId: string }) {
  const net = useStore((s) => s.doc.network);
  const defExtra = useStore((s) => (s.doc.estimate ?? defaultEstimate()).extraRate);
  const st = useStore.getState();
  const seg = net.segments[segId];
  const m = measureSegment(net, seg, defExtra);
  const custom = seg.extraRate !== undefined && !EXTRA_CHOICES.includes(seg.extraRate);
  const [showCustom, setShowCustom] = useState(custom);
  return (
    <>
      <div className="subhead">積算</div>
      <OptNumField label="現場実測長" positive value={seg.measuredLength} testId="seg-measured" placeholder="未入力" onCommit={(v) => st.setSegmentMeasured(seg.id, v)} />
      <div className="small" data-testid="seg-used">積算に使う長さ: <b>{m.method === 'field' ? '実測' : 'モデル'} {Math.round(m.usedLength)}mm</b>
        {m.approx && m.method === 'field' && <span className="warn">（按分した概算値）</span>}</div>
      {m.warning && <div className="warn small" data-testid="seg-diff-warning">⚠ {m.warning}</div>}
      <label className="field inline">余長
        <select data-testid="seg-extra" value={showCustom || custom ? 'custom' : seg.extraRate === undefined ? 'default' : String(seg.extraRate)}
          onChange={(e) => {
            const v = e.target.value;
            setShowCustom(v === 'custom');
            if (v === 'default') st.setSegmentExtraRate(seg.id, undefined);
            else if (v !== 'custom') st.setSegmentExtraRate(seg.id, Number(v));
          }}>
          <option value="default">現場の既定（{Math.round(defExtra * 1000) / 10}%）</option>
          {EXTRA_CHOICES.map((r) => <option key={r} value={String(r)}>{r === 0 ? 'なし' : `${r * 100}%`}</option>)}
          <option value="custom">任意</option>
        </select></label>
      {(showCustom || custom) && <OptNumField label="余長率" unit="%" max={1000} value={seg.extraRate === undefined ? undefined : seg.extraRate * 100} onCommit={(v) => st.setSegmentExtraRate(seg.id, v === undefined ? undefined : v / 100)} />}
    </>
  );
}

/** 端点・器具の接続口: 近くの配管へワンタップでつなぐ／つながっている点: 外す */
function ConnectBox({ nodeId }: { nodeId: string }) {
  const doc = useStore((s) => s.doc);
  const st = useStore.getState();
  const deg = segmentsAt(doc.network, nodeId).length;
  if (deg >= 2) {
    return (
      <div className="connect-box">
        <button data-testid="detach-here" onClick={() => st.detachSelectedNode()}>✂ この点のつながりを外す</button>
        <span className="muted small">区間ごとに外すときは配管を選んで「端を外す」</span>
      </div>
    );
  }
  const c = findConnectCandidate(doc.network, doc.fixtures, nodeId);
  if (!c) return <div className="muted small">近く（60cm以内）につなげる同じ種類の配管はありません。端をドラッグして配管の上で離してもつながります</div>;
  const dz = Math.round(c.dz);
  return (
    <div className="connect-box">
      <button className="primary" data-testid="connect-near" onClick={() => st.connectNearest(nodeId)}>
        🔗 近くの{SYSTEM_NAME[c.system]}管{c.diameter ? ` φ${c.diameter}` : ''}に{c.type === 'segment' ? '分岐でつなぐ' : 'つなぐ'}（{Math.round(c.planDist)}mm{Math.abs(dz) >= 1 ? `・高さ${dz > 0 ? '+' : ''}${dz}mm` : ''}）
      </button>
      {Math.abs(dz) > 150 && <span className="warn small">高さが違うため、端の高さを相手の配管に合わせます</span>}
    </div>
  );
}

/** 区間の端を片方ずつ外す（方角で表示） */
function DetachEnds({ segId }: { segId: string }) {
  const net = useStore((s) => s.doc.network);
  const st = useStore.getState();
  const s = net.segments[segId];
  const pa = net.nodes[s.a], pb = net.nodes[s.b];
  const dir = (p: typeof pa, q: typeof pa) => {
    const dx = p.pos.x - q.pos.x, dy = p.pos.y - q.pos.y, dzz = p.pos.z - q.pos.z;
    if (Math.hypot(dx, dy) < 1) return dzz > 0 ? '上' : '下';
    return Math.abs(dx) >= Math.abs(dy) ? (dx < 0 ? '西' : '東') : (dy < 0 ? '南' : '北');
  };
  const can = (id: string) => segmentsAt(net, id).length >= 2 || !!net.nodes[id].fixtureId;
  if (!can(s.a) && !can(s.b)) return null;
  return (
    <div className="row">
      {can(s.a) && <button data-testid="detach-end-a" onClick={() => st.detachSegmentEnd(segId, 'a')}>✂ {dir(pa, pb)}側の端を外す</button>}
      {can(s.b) && <button data-testid="detach-end-b" onClick={() => st.detachSegmentEnd(segId, 'b')}>✂ {dir(pb, pa)}側の端を外す</button>}
    </div>
  );
}

const SLOPES = [1 / 50, 1 / 75, 1 / 100, 1 / 150, 1 / 200];

/** 排水の勾配: この点を流末にして上流へ勾配をつける */
/** 区間の設計勾配 1/n の入力と固定。固定中は上流端を動かすと下流端が追従する（下流端がマスならマスの管底に合わせる） */
function SegmentSlopeInput({ segId }: { segId: string }) {
  const st = useStore();
  const seg = st.doc.network.segments[segId];
  // 設計勾配が変わったら親の key で作り直す（効果で setState しない）
  const [text, setText] = useState(seg.slope ? String(Math.round(1 / seg.slope)) : '');
  const commit = () => {
    const n = Number(text);
    if (text.trim() === '' || !Number.isFinite(n) || n <= 0) return;
    if (seg.slope && Math.round(1 / seg.slope) === n && seg.slopeLocked) return;
    st.setSegmentSlope(segId, n);
  };
  return (
    <div className="row" data-testid="seg-slope-row">
      <label className="field inline">設計勾配 1/
        <input data-testid="seg-slope-input" inputMode="numeric" size={5} value={text} placeholder={String(Math.round(1 / defaultSlope(seg.diameter)))}
          onChange={(e) => setText(e.target.value)} onBlur={commit} onKeyDown={(e) => { if (e.key === 'Enter') { commit(); (e.target as HTMLInputElement).blur(); } }} />
      </label>
      <label className="small inline"><input type="checkbox" data-testid="seg-slope-lock" checked={isSlopePinned(seg)} onChange={(e) => st.setSegmentSlopeLocked(segId, e.target.checked)} /> 勾配を固定</label>
      <label className="small inline" title="申請図面では既設を青、新設・増設を赤で描きます"><input type="checkbox" data-testid="seg-existing" checked={!!seg.existing} onChange={(e) => st.updateSegment(segId, { existing: e.target.checked || undefined })} /> 既設</label>
      <span className="muted small">固定すると、上流の高さを変えても下流端がこの勾配で動きます</span>
    </div>
  );
}

function SlopeField({ nodeId }: { nodeId: string }) {
  const [v, setV] = useState<string>('auto');
  const st = useStore.getState();
  return (
    <>
      <div className="subhead">排水の勾配（この点を流末＝下流の出口として、上流ほど高くします）</div>
      <div className="row">
        <select data-testid="slope-select" value={v} onChange={(e) => setV(e.target.value)}>
          <option value="auto">管径別の標準（65以下 1/50・75〜100 1/100・125 1/150・150以上 1/200）</option>
          {SLOPES.map((r) => <option key={r} value={String(r)}>{slopeLabel(r)}</option>)}
        </select>
        <button className="primary" data-testid="apply-slope" onClick={() => st.setSlopeFromOutlet(nodeId, v === 'auto' ? 'auto' : Number(v))}>この点を流末にして勾配をつける</button>
      </div>
    </>
  );
}

/** 区間の勾配の確認・支持金具・取付下地 */
function SupportFields({ segId }: { segId: string }) {
  const doc = useStore((s) => s.doc);
  const st = useStore.getState();
  const seg = doc.network.segments[segId];
  const sst = doc.estimate?.supports ?? defaultSupportSettings();
  const auto = supportKindOf({ ...doc, network: { ...doc.network, segments: { ...doc.network.segments, [segId]: { ...seg, support: undefined } } } }, seg);
  const slope = isDrain(seg.system) ? actualSlope(doc.network, seg) : null;
  const need = defaultSlope(seg.diameter);
  const lv = underfloorLevels(doc);
  const uf = lv && isUnderfloorDrain(doc.network, seg, lv) ? (([p, q]) => ({ lo: Math.round(Math.min(p, q) - lv.slab), hi: Math.round(Math.max(p, q) - lv.slab) }))([doc.network.nodes[seg.a].pos.z, doc.network.nodes[seg.b].pos.z]) : null;
  return (
    <>
      {slope !== null && (
        <div className={`small ${!slopeEnough(doc.network, seg, need) || slope > maxSlope(seg.diameter) ? 'warn' : ''}`} data-testid="seg-slope">
          勾配 {slope < 1e-6 ? '水平' : slopeLabel(slope)}{seg.slope ? `（設計 ${slopeLabel(seg.slope)}${isSlopePinned(seg) ? ' 📌' : ''}）` : ''}
          {!slopeEnough(doc.network, seg, need) && `　⚠ φ${seg.diameter} の最小勾配 ${slopeLabel(need)} より緩い（流末の点を選んで勾配をつけてください）`}
          {slope > maxSlope(seg.diameter) && `　⚠ 急すぎる勾配（φ${seg.diameter} は ${slopeLabel(maxSlope(seg.diameter))} まで。流速が標準の 1.5m/秒を超え、水だけ流れて汚物が残ります。高さを下げる所は立て管やドロップますで）`}
        </div>
      )}
      {slope !== null && <SegmentSlopeInput key={`${segId}:${seg.slope ?? ''}`} segId={segId} />}
      {uf && (
        <div className="small muted" data-testid="seg-underfloor">床下の排水: 土間から管底 {uf.lo}〜{uf.hi}mm（レベルバンドの高さ）</div>
      )}
      <label className="field inline">支持金具
        <select data-testid="seg-support" value={seg.support ?? 'auto'} onChange={(e) => st.setSegmentSupport(segId, { support: e.target.value === 'auto' ? null : (e.target.value as 'saddle' | 'levelBand' | 'tBracket' | 'none') })}>
          <option value="auto">自動（{auto ? SUPPORT_LABEL[auto] : 'なし'}）</option>
          <option value="saddle">サドルバンド</option>
          <option value="levelBand">レベルバンド</option>
          <option value="tBracket">T字金具</option>
          <option value="none">支持しない</option>
        </select></label>
      <label className="field inline">取付下地
        <select data-testid="seg-substrate" value={seg.substrate ?? 'default'} onChange={(e) => st.setSegmentSupport(segId, { substrate: e.target.value === 'default' ? null : (e.target.value as 'concrete' | 'wood') })}>
          <option value="default">現場の既定（{SUBSTRATE_LABEL[sst.substrate]}）</option>
          <option value="concrete">コンクリート</option>
          <option value="wood">木</option>
        </select></label>
    </>
  );
}

/** 点の部品（自動判定・確定） */
function FittingField({ nodeId }: { nodeId: string }) {
  const net = useStore((s) => s.doc.network);
  const fixtures = useStore((s) => s.doc.fixtures);
  const st = useStore.getState();
  const f = analyzeFittings(net, fixtures).find((x) => x.nodeId === nodeId);
  if (!f) return null;
  const autoLabel = f.auto === 'none' ? 'なし' : fittingName(f.auto, f.size);
  return (
    <>
      <div className="subhead">部品（積算）</div>
      <label className="field inline">部品
        <select data-testid="node-fitting" value={f.confirmed ? f.type : 'auto'} onChange={(e) => st.setNodeFitting(nodeId, e.target.value === 'auto' ? undefined : (e.target.value as FittingChoice))}>
          <option value="auto">自動（{autoLabel}）</option>
          {FITTING_TYPES.map((t) => <option key={t} value={t}>{FITTING_LABEL[t]}</option>)}
          <option value="none">なし</option>
        </select></label>
      <span className="small muted">{f.size.split('×').map((d) => `φ${d}`).join('×')}</span>
      {f.needsConfirm && <div className="warn small" data-testid="fitting-confirm">⚠ {f.reason ?? '部品を確定してください'}</div>}
      {!f.needsConfirm && f.reason && <div className="muted small" data-testid="fitting-note">{f.reason}{f.auto === 'none' ? '。曲げられない所は部品を選んでください' : ''}</div>}
    </>
  );
}

function MaterialField({ id, value }: { id: string; value: string }) {
  const [v, setV] = useState(value);
  useEffect(() => setV(value), [value]);
  return (
    <label className="field inline">材質<input value={v} placeholder="例: VP, HIVP, PB保温5mm, VVF" data-testid="seg-material" list="material-list" onChange={(e) => setV(e.target.value)}
      onBlur={() => { if (v.trim() !== value) useStore.getState().updateSegment(id, { material: v.trim() || undefined }); }}
      onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }} />
      <datalist id="material-list">
        {[...PB_MATERIALS, 'HIVP', 'HTVP', 'VP', 'VU'].map((m) => <option key={m} value={m}>{(PB_MATERIAL_LABEL as Record<string, string>)[m] ?? m}</option>)}
      </datalist></label>
  );
}

/** 種類ごとの表示色（この端末の設定） */
function SystemColor({ system }: { system: SystemType }) {
  useColors((c) => c.overrides[system]);
  const custom = useColors.getState().overrides[system];
  return (
    <label className="field inline">{systemLabel(system)}の色
      <input type="color" data-testid="seg-color" value={systemColor(system)} onChange={(e) => useColors.getState().setColor(system, e.target.value)} />
      {custom && <button onClick={() => useColors.getState().setColor(system, null)} title={`初期色 ${defaultSystemColor(system)}`}>初期色</button>}
    </label>
  );
}

function MergeHint() {
  const pending = useStore((s) => s.pendingMerge);
  if (!pending) return null;
  return (
    <div className="row muted small">結合する隣の部屋を図面でタップしてください
      <button onClick={() => useStore.getState().cancelMerge()}>取消</button></div>
  );
}

function RoomName({ id, name }: { id: string; name: string }) {
  const [v, setV] = useState(name);
  useEffect(() => setV(name), [name]);
  return (
    <label className="field inline">部屋名<input value={v} onChange={(e) => setV(e.target.value)}
      onBlur={() => { if (v.trim() && v !== name) useStore.getState().renameRoom(id, v.trim()); else setV(name); }}
      onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }} /></label>
  );
}

const KIND: Record<string, string> = { end: '端点', joint: '接続', elbow: '曲がり', tee: '分岐', cross: '十字', valve: 'バルブ', fixture: '設備' };
const TOOL_HELP: Record<Tool, string> = {
  select: '図面や3Dをタップして選択できます',
  outline: '建物の外周を指で1周なぞると、直線・直角に整えて外壁にします。壁のない上の階にも同じ外壁が入ります。寸法はあとで実測を入れます',
  pipe: '', wall: '指でなぞって壁を描きます（既存の角・壁に自動でつながります）',
  room: '対角にドラッグして部屋を作ります', split: '部屋を横切るように線を引くと2つに分かれます', door: '壁をタップしてドアを付けます', window: '壁をタップして窓を付けます',
  fixture: '種類を選んで図面をタップすると器具を置きます',
  underlay: '下敷き（図面・写真・航空写真）を読み込み、ドラッグで位置を合わせます',
  note: '図面をタップした所にメモを置きます（配管・器具の上をタップするとそれに付き、動かすとついてきます）',
};

export function FloorBar({ compact = false }: { compact?: boolean }) {
  const [settings, setSettings] = useState(false);
  const floors = useStore((s) => s.doc.building.floors);
  const active = useStore((s) => s.activeFloorId);
  const underFloor = useStore(isUnderFloor);
  const st = useStore.getState();
  const f = floors.find((x) => x.id === active);
  return (
    <div className="floorbar">
      <div className="chips">
        {floors.length > 0 && (
          <button data-testid="underfloor-chip" className={underFloor ? 'on' : ''} title="1階の床の下（基礎の中）の配管を描く・見る" onClick={() => (underFloor ? st.setActiveFloor(floors[0].id) : st.setUnderFloor(true))}>床下</button>
        )}
        {floors.map((x) => (
          <button key={x.id} data-testid="floor-chip" data-fb="階を選ぶ" className={x.id === active && !underFloor ? 'on' : ''} onClick={() => st.setActiveFloor(x.id)}>{x.name}</button>
        ))}
        <button data-testid="add-floor" onClick={() => st.addFloor(true)} title="現在の階の外壁をコピーして上に階を追加">＋階</button>
        <ElevationChips />
        {compact && <button data-testid="floor-settings" className={settings ? 'on' : ''} onClick={() => setSettings(!settings)} aria-expanded={settings}>⚙ 階の設定</button>}
      </div>
      {f && (!compact || settings) && (
        <div className="row">
          <NumField label="階高" value={f.height} min={1000} testId="floor-height" onCommit={(v) => st.updateFloor(f.id, { height: v })} />
          <span className="muted small">床高 {activeFloorElevation()}mm</span>
          {f.id === floors[0]?.id && <LevelsLine />}
          <button className="danger" disabled={floors.length <= 1} onClick={() => {
            if (window.confirm(`${f.name}を削除します。この階の壁・部屋・ドア・窓・器具も削除されます（配管は残ります）。上の階は下がります。（「戻す」で取り消せます）`)) st.deleteFloor(f.id);
          }}>この階を削除</button>
        </div>
      )}
    </div>
  );
}

/** 1 階の床・基礎天端・床下の底の GL からの高さ（図面から読み取った・申請で入れた設計 GL） */
function LevelsLine() {
  const building = useStore((s) => s.doc.building);
  const site = useStore((s) => s.doc.site);
  const t = levelText(levelSummary(building, site));
  return t ? <span className="muted small" data-testid="floor-levels">{t}</span> : null;
}

/** 立面図（外壁）の一覧と追加 */
function ElevationChips() {
  const els = useStore((s) => s.doc.elevations);
  const active = useStore((s) => s.activeElevationId);
  const hasWalls = useStore((s) => Object.keys(s.doc.building.walls).length > 0);
  const [open, setOpen] = useState(false);
  const st = useStore.getState();
  const list = Object.values(els ?? {});
  return (
    <>
      <span className="small muted elev-sep">立面</span>
      {list.map((e) => (
        <button key={e.id} data-testid="elev-chip" data-fb="立面を選ぶ" className={e.id === active ? 'on' : ''} onClick={() => st.openElevation(e.id === active ? null : e.id)}>{e.label}</button>
      ))}
      <button data-testid="elev-new" onClick={() => {
        if (hasWalls) { st.openElevation(null); useStore.setState({ notice: '図面で外壁をタップし「立面図で配管を描く」を押してください', tool: 'select' }); }
        else setOpen(true);
      }}>＋立面</button>
      {open && <ElevationDialog wallId={null} onClose={() => setOpen(false)} />}
    </>
  );
}

const VIS_PRESETS: { id: VisPreset; label: string }[] = [
  { id: 'all', label: 'すべて' }, { id: 'pipes', label: '配管だけ' }, { id: 'fixtures', label: '設備だけ' }, { id: 'building', label: '建物だけ' },
];

export function VisibilityPanel({ compact = false }: { compact?: boolean }) {
  const vis = useStore((s) => s.visibility);
  const nHidden = useStore((s) => s.hiddenIds.length + s.ghostIds.length);
  const st = useStore.getState();
  return (
    <div className="vispanel" data-testid="vis-panel">
      <div className="vis-presets" role="group" aria-label="表示の切り替え">
        {VIS_PRESETS.map((p) => {
          const on = VIS_CATEGORIES.every((c) => presetVisibility(p.id)[c.id] === vis[c.id]);
          return <button key={p.id} data-testid={`vis-preset-${p.id}`} aria-pressed={on} className={on ? 'on' : ''} onClick={() => st.setVisibilityPreset(p.id)}>{p.label}</button>;
        })}
      </div>
      <details className="vis-details" open={!compact}>
      <summary>部分ごとに切り替える</summary>
      {VIS_CATEGORIES.map((c) => (
        <div key={c.id} className="visrow">
          <span>{c.label}</span>
          <div className="seg-btns small">
            {(['show', 'ghost', 'hide'] as VisMode[]).map((m) => (
              <button key={m} data-testid={`vis-${c.id}-${m}`} className={vis[c.id] === m ? 'on' : ''} onClick={() => st.setVisibility(c.id, m)}>
                {m === 'show' ? '表示' : m === 'ghost' ? '半透明' : '非表示'}
              </button>
            ))}
          </div>
        </div>
      ))}
      </details>
      {nHidden > 0 && <button onClick={() => st.resetElementVisibility()}>個別に隠した{nHidden}件を元に戻す</button>}
      <SectionControls />
    </div>
  );
}

const SECTION_MODES: { id: SectionMode; label: string }[] = [
  { id: 'off', label: 'なし' }, { id: 'z', label: '水平' }, { id: 'x', label: '縦(東西)' }, { id: 'y', label: '縦(南北)' },
];
const FLOOR_FILTERS: { id: FloorFilter; label: string }[] = [
  { id: 'all', label: '全部' }, { id: 'upToActive', label: 'この階まで' }, { id: 'activeOnly', label: 'この階だけ' },
];

/** 3D の断面・階ごとの表示 */
function SectionControls() {
  const rawSection = useStore((s) => s.section);
  const ff = useStore((s) => s.floorFilter);
  const building = useStore((s) => s.doc.building);
  const st = useStore.getState();
  const section = clampSection(building, rawSection); // 建物の変更（階の削除・Undo）で範囲外になっても表示は範囲内
  const [lo, hi] = section.mode === 'off' ? [0, 0] : sectionRange(building, section.mode);
  return (
    <>
      <div className="visrow stack">
        <span>3Dで表示する階</span>
        <div className="seg-btns small">
          {FLOOR_FILTERS.map((f) => <button key={f.id} data-testid={`floor-filter-${f.id}`} className={ff === f.id ? 'on' : ''} onClick={() => st.setFloorFilter(f.id)}>{f.label}</button>)}
        </div>
      </div>
      <div className="visrow stack">
        <span>断面（建物を切って中を見る）</span>
        <div className="seg-btns small">
          {SECTION_MODES.map((m) => <button key={m.id} data-testid={`section-${m.id}`} className={section.mode === m.id ? 'on' : ''} onClick={() => st.setSectionMode(m.id)}>{m.label}</button>)}
        </div>
      </div>
      {section.mode !== 'off' && (
        <label className="section-slider"><span>{section.mode === 'z' ? '切る高さ' : '切る位置'}</span>
          <input type="range" data-testid="section-value" min={lo} max={hi} step={50} value={section.value} onChange={(e) => st.setSectionValue(Number(e.target.value))} />
          <span className="muted small">{Math.round(section.value)}mm</span>
        </label>
      )}
    </>
  );
}

/** いつも見える道具（スマホでも横にはみ出さない数） */
const MAIN_TOOLS: { id: Tool; icon: string; label: string }[] = [
  { id: 'select', icon: '👆', label: '選択' }, { id: 'fixture', icon: '🚽', label: '器具' }, { id: 'pipe', icon: '〰️', label: '配管' }, { id: 'note', icon: '📝', label: 'メモ' },
];
/** 「建物」を押すと出る道具 */
const BUILD_TOOLS: { id: Tool; icon: string; label: string }[] = [
  { id: 'outline', icon: '✏️', label: '外形' }, { id: 'wall', icon: '▭', label: '壁' }, { id: 'room', icon: '⬚', label: '部屋' },
  { id: 'door', icon: '🚪', label: 'ドア' }, { id: 'window', icon: '🪟', label: '窓' }, { id: 'underlay', icon: '🗺️', label: '下敷き' },
];
const BUILD_IDS = new Set<Tool>([...BUILD_TOOLS.map((t) => t.id), 'split']);

export function Toolbar() {
  const tool = useStore((s) => s.tool);
  const canUndo = useStore((s) => s.past.length > 0);
  const canRedo = useStore((s) => s.future.length > 0);
  // 建物の道具の行は、開いた時の道具のままの間だけ開く（道具が変わったら閉じる）。Esc・外のタップでも閉じる
  const [openFor, setOpenFor] = useState<Tool | null>(null);
  const buildOpen = openFor === tool;
  const setBuildOpen = (v: boolean) => setOpenFor(v ? tool : null);
  const navRef = useRef<HTMLElement>(null);
  const st = useStore.getState();
  useEffect(() => {
    if (!buildOpen) return;
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpenFor(null); };
    const down = (e: PointerEvent) => { if (!navRef.current?.contains(e.target as Node)) setOpenFor(null); };
    window.addEventListener('keydown', key);
    window.addEventListener('pointerdown', down, true);
    return () => { window.removeEventListener('keydown', key); window.removeEventListener('pointerdown', down, true); };
  }, [buildOpen]);
  const pick = (id: Tool) => { st.setTool(id); st.select(null); setOpenFor(null); };
  const inBuild = BUILD_IDS.has(tool);
  const cur = BUILD_TOOLS.find((t) => t.id === tool);
  const btn = (t: { id: Tool; icon: string; label: string }) => (
    <button key={t.id} data-testid={`tool-${t.id}`} className={tool === t.id ? 'on' : ''} onClick={() => pick(t.id)}>
      {t.icon}<span>{t.label}</span>
    </button>
  );
  return (
    <nav className="toolbar" aria-label="道具" ref={navRef}>
      {buildOpen && (
        <div className="subtools" data-testid="building-tools" role="group" aria-label="建物の道具">
          <span className="subtools-label">建物を描く</span>
          {BUILD_TOOLS.map(btn)}
        </div>
      )}
      <div className="tb-row">
        {btn(MAIN_TOOLS[0])}
        <button data-testid="tool-building" aria-expanded={buildOpen} aria-label={inBuild && cur ? `建物: ${cur.label}` : '建物'} className={`${inBuild ? 'on' : ''} ${buildOpen ? 'open' : ''}`} onClick={() => setBuildOpen(!buildOpen)}>
          {cur?.icon ?? '🏠'}<span>建物 ▴</span>
        </button>
        {MAIN_TOOLS.slice(1).map(btn)}
        <button data-testid="undo" className="hist" disabled={!canUndo} onClick={() => st.undo()}>↶<span>戻す</span></button>
        <button data-testid="redo" className="hist" disabled={!canRedo} onClick={() => st.redo()}>↷<span>やり直し</span></button>
      </div>
    </nav>
  );
}

export { systemLabel };

/** 何を選んでいるかを設定パネルの上に出す。✕ で選択をやめる */
export function SelectionBar() {
  const sel = useStore((s) => s.selection);
  const doc = useStore((s) => s.doc);
  if (!sel) return null;
  const { building: b, network: net } = doc;
  let label = '';
  let color: string | undefined;
  if (sel.kind === 'segment' && net.segments[sel.id]) {
    const g = net.segments[sel.id];
    label = `${systemLabel(g.system)}の配管 φ${g.diameter}`;
    color = systemColor(g.system);
  } else if (sel.kind === 'node' && net.nodes[sel.id]) {
    const n = net.nodes[sel.id];
    const fx = n.fixtureId ? doc.fixtures[n.fixtureId] : undefined;
    label = fx ? `${FIXTURE_CATALOG[fx.type].label}の接続口` : '配管の点（曲がり・分岐・端）';
  } else if (sel.kind === 'fixture' && doc.fixtures[sel.id]) label = FIXTURE_CATALOG[doc.fixtures[sel.id].type].label;
  else if (sel.kind === 'wall' && b.walls[sel.id]) label = b.walls[sel.id].kind === 'exterior' ? '外壁' : '内壁';
  else if (sel.kind === 'corner') label = '壁の角';
  else if (sel.kind === 'opening' && b.openings[sel.id]) label = b.openings[sel.id].type === 'door' ? 'ドア' : '窓';
  else if (sel.kind === 'room' && b.rooms[sel.id]) label = `部屋「${b.rooms[sel.id].name}」`;
  else if (sel.kind === 'member') label = '梁・軒・バルコニー・階段';
  else if (sel.kind === 'note' && doc.notes?.[sel.id]) label = `メモ ${noteNumbers(doc.notes).get(sel.id)}`;
  else return null;
  return (
    <div className="sel-bar" data-testid="sel-bar">
      {color && <i className="sys-dot" style={{ background: color }} />}
      <span>選択中: <b>{label}</b></span>
      <AddNoteButton />
      <button data-testid="sel-clear" onClick={() => useStore.getState().select(null)}>✕ 選択をやめる</button>
    </div>
  );
}

const familyLabel = (f: SystemFamily) => (f === 'drain' ? '排水' : systemLabel(f));

/** 器具につながる系統ごとの「たどる」ボタン */
function TraceButtons({ fixtureId }: { fixtureId: string }) {
  const net = useStore((s) => s.doc.network);
  const seen = new Map<SystemFamily, string>();
  for (const n of portNodes(net, fixtureId)) for (const g of segmentsAt(net, n.id)) if (!seen.has(familyOf(g.system))) seen.set(familyOf(g.system), g.id);
  if (!seen.size) return null;
  return (
    <div className="row">{[...seen].map(([fam, segId]) => (
      <button key={fam} data-testid={`trace-${fam}`} aria-label={`${familyLabel(fam)}の系統をたどる`} onClick={() => useStore.getState().setTrace(segId)}>🔗 {familyLabel(fam)}をたどる</button>
    ))}</div>
  );
}

/** 系統を強調しているときの帯: 系統の名前・管の長さ（口径別）・器具・マス・設備・バルブの数 */
export function TraceBar() {
  const t = useTrace();
  const inElevation = useStore((s) => !!s.activeElevationId);
  if (!t || inElevation) return null;
  const m = (mm: number) => `${(mm / 1000).toFixed(1)}m`;
  const dias = t.byDiameter.map((d) => `φ${d.diameter} ${m(d.length)}`).join('・');
  const c = t.counts;
  const parts = [c.fixtures ? `器具 ${c.fixtures}` : '', c.manholes ? `マス ${c.manholes}` : '', c.equipment ? `メーター・ヘッダー等 ${c.equipment}` : '', t.valveCount ? `バルブ ${t.valveCount}` : ''].filter(Boolean);
  return (
    <div className="sel-bar trace-bar" data-testid="trace-bar" role="status" aria-live="polite">
      <i className="sys-dot" style={{ background: systemColor(t.family) }} />
      <span title={`長さは実測があれば実測（余長の割増は入れていません）。${dias}`}>
        系統: <b data-testid="trace-label">{t.label}</b> — 管 <b data-testid="trace-length">{m(t.totalLength)}</b>
        {t.byDiameter.length > 1 && <span className="trace-dias">（{dias}）</span>}
        {parts.length > 0 && <>・<span data-testid="trace-counts">{parts.join('・')}</span></>}
      </span>
      <button data-testid="trace-clear" aria-label="系統の強調をやめる" onClick={() => useStore.getState().setTrace(null)}>✕ 強調をやめる</button>
    </div>
  );
}

/** 器具の接続口へつなぐ候補（別の階・屋上も）。押すと仮のルートで配管を作る */
function PortConnect({ nodeId, title }: { nodeId: string; title?: string }) {
  const doc = useStore((s) => s.doc);
  const dragging = useStore((s) => s.dragBase !== null);
  // ドラッグ中は計算しない（動かすたびに全接続口を調べると重くなる）
  const cands = useMemo(() => (dragging ? [] : portCandidates(doc, nodeId, 4)), [doc, nodeId, dragging]);
  if (!cands.length) return null;
  return (
    <div className="port-connect" data-testid="port-connect">
      <div className="subhead">🔗 {title ? `${title} ` : ''}器具につなぐ（自動でルートを作ります）</div>
      <div className="row">
        {cands.map((c) => <button key={c.nodeId} data-testid="port-cand" data-fb="接続先の器具を選ぶ" data-target={c.nodeId} onClick={() => useStore.getState().connectToPort(nodeId, c.nodeId)}>→ {c.label}{c.diameterNote && <small className="warn"> 口径 {c.diameterNote}</small>}</button>)}
      </div>
    </div>
  );
}
