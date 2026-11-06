/**
 * 編集画面のパネル類：プロパティ（選択対象の設定）、階バー、表示切替、ツールバー。
 */
import { useEffect, useMemo, useState } from 'react';
import { activeFloorElevation, branchDeletionPreview, useStore, VIS_CATEGORIES, type FloorFilter, type Tool, type VisMode } from '../state/store';
import { clampSection, sectionRange, type SectionMode } from '../model/section';
import { connectedComponent, segmentLength, segmentsAt, type SystemType } from '../model/network';
import { floorById, roomArea, wallLength } from '../model/building';
import { MEMBER_LABEL, stairSteps } from '../model/members';
import { detour, findHits } from '../model/obstacles';
import { FIXTURE_CATALOG, FIXTURE_TYPES, fixtureConnected, portNodes } from '../model/fixtures';
import { UnderlayPanel } from './UnderlayPanel';
import { WallPhotoDialog } from './WallPhotoDialog';
import { ElevationDialog } from './ElevationDialog';
import { SYSTEMS, defaultSystemColor, systemColor, systemLabel, useColors } from './colors';
import { defaultEstimate, measureSegment } from '../model/estimate';
import { findConnectCandidate } from '../model/connect';
import { SYSTEM_NAME } from '../model/systems';
import { actualSlope, defaultSlope, isDrain, slopeEnough, slopeLabel } from '../model/slope';
import { defaultSupportSettings, SUBSTRATE_LABEL, SUPPORT_LABEL, supportKindOf } from '../model/supports';
import { analyzeFittings, FITTING_LABEL, FITTING_TYPES, fittingName, type FittingChoice } from '../model/fittings';

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
        <label className="field inline">種類<select data-testid="seg-system" value={seg.system} onChange={(e) => st.updateSegment(seg.id, { system: e.target.value as SystemType })}>
          {SYSTEMS.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}</select></label>
        <label className="field inline">口径<select data-testid="seg-diameter" value={seg.diameter} onChange={(e) => st.updateSegment(seg.id, { diameter: Number(e.target.value) })}>
          {[...new Set([...DIAMETERS, seg.diameter])].sort((x, y) => x - y).map((d) => <option key={d} value={d}>φ{d}</option>)}</select></label>
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
    return (
      <div className="props">
        <div className="ptitle">{def.label} <span className="muted small">{def.size.w}×{def.size.d}mm・向き {f.rotation}°</span></div>
        <div className="subhead">接続口（押すと選択して立て管などを追加できます。✓=配管あり）</div>
        <div className="row">{def.ports.map((p) => {
          const n = ports.find((x) => x.portId === p.id);
          const used = n ? segmentsAt(net, n.id).length > 0 : false;
          return <button key={p.id} data-testid={`port-${p.id}`} disabled={!n} onClick={() => n && st.select({ kind: 'node', id: n.id })}>{p.label} φ{p.diameter}{used ? ' ✓' : ''}</button>;
        })}</div>
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
        <NumField label={m.kind === 'beam' || m.kind === 'stair' ? '幅' : '出幅'} testId="member-width" value={m.width} min={50} max={5000} onCommit={(v) => st.updateMember(m.id, { width: v })} />
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
          <label className="field inline">種類<select data-testid="draw-system" value={drawAttrs.system} onChange={(e) => st.setDrawAttrs({ system: e.target.value as SystemType })}>
            {SYSTEMS.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}</select></label>
          <label className="field inline">口径<select value={drawAttrs.diameter} onChange={(e) => st.setDrawAttrs({ diameter: Number(e.target.value) })}>
            {DIAMETERS.map((d) => <option key={d} value={d}>φ{d}</option>)}</select></label>
          <label className="field inline">高さ<select value={drawHeight} onChange={(e) => st.setDrawHeight(Number(e.target.value))}>
            {HEIGHT_PRESETS.map((h) => <option key={h.label} value={h.z}>{h.label}（{h.z}mm）</option>)}</select></label>
        </>
      ) : <div className="ptitle muted">{TOOL_HELP[tool]}</div>}
      {tool === 'split' && (
        <label className="field inline"><input type="checkbox" data-testid="split-with-wall" checked={splitWithWall} onChange={(e) => st.setSplitWithWall(e.target.checked)} /> 分割線に壁も作る</label>
      )}
      {(tool === 'pipe' || tool === 'wall' || tool === 'split' || tool === 'outline') && (
        <label className="field inline"><input type="checkbox" checked={ortho} onChange={(e) => st.setOrthoSnap(e.target.checked)} /> 直角に補正</label>
      )}
    </div>
  );
}

function FixturePicker() {
  const t = useStore((s) => s.fixtureType);
  const st = useStore.getState();
  return (
    <>
      <div className="ptitle muted">種類を選んで図面をタップ</div>
      <div className="fixture-grid">
        {FIXTURE_TYPES.map((x) => <button key={x} data-testid={`fixture-${x}`} className={t === x ? 'on' : ''} onClick={() => st.setFixtureType(x)}>{FIXTURE_CATALOG[x].label}</button>)}
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
  return (
    <>
      {slope !== null && (
        <div className={`small ${!slopeEnough(doc.network, seg, need) ? 'warn' : ''}`} data-testid="seg-slope">
          勾配 {slope < 1e-6 ? '水平' : slopeLabel(slope)}{seg.slope ? `（設計 ${slopeLabel(seg.slope)}）` : ''}
          {!slopeEnough(doc.network, seg, need) && `　⚠ φ${seg.diameter} の最小勾配 ${slopeLabel(need)} より緩い（流末の点を選んで勾配をつけてください）`}
        </div>
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
    </>
  );
}

function MaterialField({ id, value }: { id: string; value: string }) {
  const [v, setV] = useState(value);
  useEffect(() => setV(value), [value]);
  return (
    <label className="field inline">材質<input value={v} placeholder="例: VP, HIVP, VVF" data-testid="seg-material" onChange={(e) => setV(e.target.value)}
      onBlur={() => { if (v.trim() !== value) useStore.getState().updateSegment(id, { material: v.trim() || undefined }); }}
      onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }} /></label>
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
};

export function FloorBar() {
  const floors = useStore((s) => s.doc.building.floors);
  const active = useStore((s) => s.activeFloorId);
  const st = useStore.getState();
  const f = floors.find((x) => x.id === active);
  return (
    <div className="floorbar">
      <div className="chips">
        {floors.map((x) => (
          <button key={x.id} data-testid="floor-chip" className={x.id === active ? 'on' : ''} onClick={() => st.setActiveFloor(x.id)}>{x.name}</button>
        ))}
        <button data-testid="add-floor" onClick={() => st.addFloor(true)} title="現在の階の外壁をコピーして上に階を追加">＋階</button>
        <ElevationChips />
      </div>
      {f && (
        <div className="row">
          <NumField label="階高" value={f.height} min={1000} testId="floor-height" onCommit={(v) => st.updateFloor(f.id, { height: v })} />
          <span className="muted small">床高 {activeFloorElevation()}mm</span>
          <button className="danger" disabled={floors.length <= 1} onClick={() => {
            if (window.confirm(`${f.name}を削除します。この階の壁・部屋・ドア・窓・器具も削除されます（配管は残ります）。上の階は下がります。（「戻す」で取り消せます）`)) st.deleteFloor(f.id);
          }}>この階を削除</button>
        </div>
      )}
    </div>
  );
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
        <button key={e.id} data-testid="elev-chip" className={e.id === active ? 'on' : ''} onClick={() => st.openElevation(e.id === active ? null : e.id)}>{e.label}</button>
      ))}
      <button data-testid="elev-new" onClick={() => {
        if (hasWalls) { st.openElevation(null); useStore.setState({ notice: '図面で外壁をタップし「立面図で配管を描く」を押してください', tool: 'select' }); }
        else setOpen(true);
      }}>＋立面</button>
      {open && <ElevationDialog wallId={null} onClose={() => setOpen(false)} />}
    </>
  );
}

export function VisibilityPanel() {
  const vis = useStore((s) => s.visibility);
  const nHidden = useStore((s) => s.hiddenIds.length + s.ghostIds.length);
  const st = useStore.getState();
  return (
    <div className="vispanel" data-testid="vis-panel">
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

const TOOLS: { id: Tool; icon: string; label: string }[] = [
  { id: 'select', icon: '👆', label: '選択' }, { id: 'outline', icon: '✏️', label: '外形' }, { id: 'pipe', icon: '〰️', label: '配管' }, { id: 'wall', icon: '▭', label: '壁' },
  { id: 'room', icon: '⬚', label: '部屋' }, { id: 'door', icon: '🚪', label: 'ドア' }, { id: 'window', icon: '🪟', label: '窓' },
  { id: 'fixture', icon: '🚽', label: '器具' }, { id: 'underlay', icon: '🗺️', label: '下敷き' },
];

export function Toolbar() {
  const tool = useStore((s) => s.tool);
  const canUndo = useStore((s) => s.past.length > 0);
  const canRedo = useStore((s) => s.future.length > 0);
  const st = useStore.getState();
  return (
    <nav className="toolbar">
      {TOOLS.map((t) => (
        <button key={t.id} data-testid={`tool-${t.id}`} className={tool === t.id ? 'on' : ''} onClick={() => { st.setTool(t.id); st.select(null); }}>
          {t.icon}<span>{t.label}</span>
        </button>
      ))}
      <button data-testid="undo" disabled={!canUndo} onClick={() => st.undo()}>↶<span>戻す</span></button>
      <button data-testid="redo" disabled={!canRedo} onClick={() => st.redo()}>↷<span>やり直し</span></button>
    </nav>
  );
}

export { systemLabel };
