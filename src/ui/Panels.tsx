/**
 * 編集画面のパネル類：プロパティ（選択対象の設定）、階バー、表示切替、ツールバー。
 */
import { useEffect, useState } from 'react';
import { activeFloorElevation, branchDeletionPreview, useStore, VIS_CATEGORIES, type Tool, type VisMode } from '../state/store';
import { segmentLength, type SystemType } from '../model/network';
import { floorById, roomArea, wallLength } from '../model/building';
import { SYSTEMS, systemLabel } from './colors';

const DIAMETERS = [13, 16, 20, 25, 30, 40, 50, 65, 75, 100, 125, 150];
const HEIGHT_PRESETS: { label: string; z: number }[] = [
  { label: '床下', z: -300 }, { label: '床上', z: 100 }, { label: '壁内', z: 1200 }, { label: '天井裏', z: 2600 },
];

/** 確定時（フォーカスを外す・Enter）だけ反映する数値入力 */
export function NumField({ label, value, onCommit, unit = 'mm', testId, min }: { label: string; value: number; onCommit: (v: number) => void; unit?: string; testId?: string; min?: number }) {
  const [text, setText] = useState(String(Math.round(value)));
  useEffect(() => setText(String(Math.round(value))), [value]);
  const commit = () => {
    const n = Number(text);
    if (text.trim() !== '' && Number.isFinite(n) && (min === undefined || n >= min)) onCommit(n);
    else setText(String(Math.round(value)));
  };
  return (
    <label className="field inline">{label}
      <span className="unit-input">
        <input type="number" inputMode="numeric" data-testid={testId} value={text} onChange={(e) => setText(e.target.value)}
          onBlur={commit} onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }} />
        <span>{unit}</span>
      </span>
    </label>
  );
}

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

export function PropertyPanel() {
  const sel = useStore((s) => s.selection);
  const doc = useStore((s) => s.doc);
  const tool = useStore((s) => s.tool);
  const drawAttrs = useStore((s) => s.drawAttrs);
  const drawHeight = useStore((s) => s.drawHeight);
  const ortho = useStore((s) => s.orthoSnap);
  const floorElev = useStore((s) => floorById(s.doc.building, s.activeFloorId)?.elevation ?? 0);
  const st = useStore.getState();
  const { building: b, network: net } = doc;

  if (sel?.kind === 'segment' && net.segments[sel.id]) {
    const seg = net.segments[sel.id];
    const preview = branchDeletionPreview(net, seg.id);
    return (
      <div className="props">
        <div className="ptitle">配管区間 <b data-testid="sel-length">{Math.round(segmentLength(net, seg.id))}</b>mm</div>
        <label className="field inline">種類<select value={seg.system} onChange={(e) => st.updateSegment(seg.id, { system: e.target.value as SystemType })}>
          {SYSTEMS.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}</select></label>
        <label className="field inline">口径<select value={seg.diameter} onChange={(e) => st.updateSegment(seg.id, { diameter: Number(e.target.value) })}>
          {[...new Set([...DIAMETERS, seg.diameter])].sort((x, y) => x - y).map((d) => <option key={d} value={d}>φ{d}</option>)}</select></label>
        <div className="row">
          <button onClick={() => st.setTool('pipe')}>ここから分岐</button>
          <button className="danger" onClick={() => st.deleteSelected()}>区間削除</button>
          <button className="danger" disabled={!preview} title={preview ? '' : '本管の途中、または分岐のない配管です'} onClick={() => {
            if (!preview) return;
            const len = preview.reduce((a, id) => a + segmentLength(net, id), 0);
            if (window.confirm(`分岐点から先の枝管 ${preview.length}区間（計 ${Math.round(len)}mm）を削除します。よろしいですか？`)) st.deleteSelectedBranch();
          }}>枝管ごと削除</button>
        </div>
      </div>
    );
  }
  if (sel?.kind === 'node' && net.nodes[sel.id]) {
    const n = net.nodes[sel.id];
    const rel = n.pos.z - floorElev;
    return (
      <div className="props">
        <div className="ptitle">配管の点（{KIND[n.kind] ?? n.kind}）</div>
        <NumField label="床からの高さ" value={rel} testId="node-height" onCommit={(v) => st.setNodeHeight(n.id, floorElev + v)} />
        <div className="row">
          <button onClick={() => st.setNodeHeight(n.id, n.pos.z - 100)}>−100</button>
          <button onClick={() => st.setNodeHeight(n.id, n.pos.z + 100)}>＋100</button>
          {HEIGHT_PRESETS.map((h) => <button key={h.label} onClick={() => st.setNodeHeight(n.id, floorElev + h.z)}>{h.label}</button>)}
        </div>
      </div>
    );
  }
  if (sel?.kind === 'wall' && b.walls[sel.id]) {
    const w = b.walls[sel.id];
    return (
      <div className="props">
        <div className="ptitle">{w.kind === 'exterior' ? '外壁' : '内壁'} 長さ <b data-testid="wall-length">{Math.round(wallLength(b, w.id))}</b>mm</div>
        <NumField label="厚さ" value={w.thickness} min={10} onCommit={(v) => st.updateWall(w.id, { thickness: v })} />
        <div className="seg-btns small">
          <button className={w.kind === 'exterior' ? 'on' : ''} onClick={() => st.updateWall(w.id, { kind: 'exterior' })}>外壁</button>
          <button className={w.kind === 'interior' ? 'on' : ''} onClick={() => st.updateWall(w.id, { kind: 'interior' })}>内壁</button>
        </div>
        <ElementVisibility id={w.id} />
        <div className="row">
          <button onClick={() => st.setTool('door')}>ドアを付ける</button>
          <button onClick={() => st.setTool('window')}>窓を付ける</button>
          <button className="danger" onClick={() => st.deleteSelected()}>壁を削除</button>
        </div>
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
        <div className="row"><button className="danger" onClick={() => st.deleteSelected()}>部屋を削除</button></div>
      </div>
    );
  }
  if (sel?.kind === 'corner' && b.corners[sel.id]) {
    const c = b.corners[sel.id];
    return <div className="props"><div className="ptitle">壁の角（{Math.round(c.x)}, {Math.round(c.y)}）ドラッグで移動</div></div>;
  }
  // 選択なし: ツールの設定
  return (
    <div className="props">
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
      {(tool === 'pipe' || tool === 'wall') && (
        <label className="field inline"><input type="checkbox" checked={ortho} onChange={(e) => st.setOrthoSnap(e.target.checked)} /> 直角に補正</label>
      )}
    </div>
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
  pipe: '', wall: '指でなぞって壁を描きます（既存の角・壁に自動でつながります）',
  room: '対角にドラッグして部屋を作ります', door: '壁をタップしてドアを付けます', window: '壁をタップして窓を付けます',
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
      </div>
      {f && (
        <div className="row">
          <NumField label="階高" value={f.height} min={1000} testId="floor-height" onCommit={(v) => st.updateFloor(f.id, { height: v })} />
          <span className="muted small">床高 {activeFloorElevation()}mm</span>
          <button className="danger" disabled={floors.length <= 1} onClick={() => {
            if (window.confirm(`${f.name}を削除します。この階の壁・部屋・ドア・窓も削除されます。（「戻す」で取り消せます）`)) st.deleteFloor(f.id);
          }}>この階を削除</button>
        </div>
      )}
    </div>
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
    </div>
  );
}

const TOOLS: { id: Tool; icon: string; label: string }[] = [
  { id: 'select', icon: '👆', label: '選択' }, { id: 'pipe', icon: '〰️', label: '配管' }, { id: 'wall', icon: '▭', label: '壁' },
  { id: 'room', icon: '⬚', label: '部屋' }, { id: 'door', icon: '🚪', label: 'ドア' }, { id: 'window', icon: '🪟', label: '窓' },
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
