/**
 * 現場写真から窓・ドアを作る。
 * 1) 写真を選ぶ → 2) 壁の四隅（左下・右下・右上・左上）を合わせる → 3) 正面に補正した画像の上で窓・ドアを四角でなぞる。
 * 写真は保存しない（開口部だけを建物に追加する）。
 */
import { useEffect, useRef, useState } from 'react';
import { useStore } from '../state/store';
import { clearHeight, wallLength } from '../model/building';
import { openingToRect, rectify, rectToOpening, type FaceRect } from '../model/homography';
import { canvasFrom, loadBitmap } from '../import/image';
import type { Vec2 } from '../model/building';

type Box = FaceRect & { type: 'door' | 'window' };
const LABELS = ['左上', '右上', '右下', '左下'];

/** SVG 上のポインター位置を viewBox 座標へ */
function svgPoint(svg: SVGSVGElement, e: React.PointerEvent): Vec2 {
  const pt = svg.createSVGPoint();
  pt.x = e.clientX; pt.y = e.clientY;
  const m = svg.getScreenCTM();
  const p = m ? pt.matrixTransform(m.inverse()) : pt;
  return { x: p.x, y: p.y };
}

export function WallPhotoDialog({ wallId, onClose }: { wallId: string; onClose: () => void }) {
  const b = useStore((s) => s.doc.building);
  const wall = b.walls[wallId];
  const L = wall ? wallLength(b, wallId) : 0;
  const H = wall ? clearHeight(b, wall.floorId) : 0;
  const fileRef = useRef<HTMLInputElement>(null);
  const [photo, setPhoto] = useState<{ url: string; w: number; h: number; data: ImageData } | null>(null);
  const [quad, setQuad] = useState<Vec2[]>([]);
  const [face, setFace] = useState<{ url: string; w: number; h: number } | null>(null);
  const [flip, setFlip] = useState(false);
  const [boxes, setBoxes] = useState<Box[]>([]);
  const [draft, setDraft] = useState<FaceRect | null>(null);
  const [msg, setMsg] = useState('');
  const drag = useRef<number | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);

  useEffect(() => { if (!wall) onClose(); }, [wall, onClose]);
  if (!wall) return null;

  const load = async (f: File) => {
    setMsg('');
    try {
      const c = canvasFrom(await loadBitmap(f), 1600);
      const data = c.getContext('2d')!.getImageData(0, 0, c.width, c.height);
      setPhoto({ url: c.toDataURL('image/jpeg', 0.85), w: c.width, h: c.height, data });
      const mx = c.width * 0.2, my = c.height * 0.2;
      setQuad([{ x: mx, y: my }, { x: c.width - mx, y: my }, { x: c.width - mx, y: c.height - my }, { x: mx, y: c.height - my }]);
      setFace(null); setBoxes([]);
    } catch (e) { setMsg(`写真を読み込めませんでした: ${(e as Error).message}`); }
  };

  const doRectify = () => {
    if (!photo) return;
    if (!convex(quad)) { setMsg('四隅の順番が入れ替わっています。左上・右上・右下・左下の印をそれぞれの角に合わせてください'); return; }
    setMsg('');
    const k = 1000 / Math.max(L, H);
    const w = Math.max(50, Math.round(L * k)), h = Math.max(50, Math.round(H * k));
    const out = rectify(photo.data, quad, w, h);
    if (!out) { setMsg('四隅の位置を見直してください（一直線に並んでいます）'); return; }
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    c.getContext('2d')!.putImageData(new ImageData(out as ImageDataArray, w, h), 0, 0);
    setFace({ url: c.toDataURL('image/jpeg', 0.85), w, h });
  };

  const toOpenings = () => (face ? boxes.map((bx) => ({ type: bx.type, ...rectToOpening(bx, face.w, face.h, L, H, flip) })) : []);
  const tooSmall = toOpenings().filter((o) => o.width < 100 || o.height < 100).length;
  const create = () => {
    if (!face) return;
    const all = toOpenings();
    const okIdx = all.map((o, i) => (o.width >= 100 && o.height >= 100 ? i : -1)).filter((i) => i >= 0);
    const r = useStore.getState().addOpeningsBatch(wallId, okIdx.map((i) => all[i]));
    if (!r.failed) { onClose(); return; }
    // 作れたものは消し、作れなかった四角だけ残す（もう一度押しても二重に作らない）
    const keep = new Set(r.failedIdx.map((k) => okIdx[k]));
    setBoxes((bs) => bs.filter((_, i) => keep.has(i)));
    setMsg(`${r.added}か所を作成しました。残りの${r.failed}か所は壁に収まらない・既存の開口と重なるため作れませんでした。位置を直してください`);
  };
  /** 四隅が凸の四角形になっているか（交差・へこみがない） */
  const convex = (q: Vec2[]) => {
    const s = q.map((p, i) => { const a = q[(i + 1) % 4], b = q[(i + 2) % 4]; return Math.sign((a.x - p.x) * (b.y - a.y) - (a.y - p.y) * (b.x - a.x)); });
    return s.every((v) => v > 0) || s.every((v) => v < 0);
  };

  const existing = Object.values(b.openings).filter((o) => o.wallId === wallId);
  // 壁の両端の方角（a 端・b 端）。写真の左端がどちらかを選んでもらう
  const ca = b.corners[wall.a], cb = b.corners[wall.b];
  const side = (p: Vec2, q: Vec2) => (Math.abs(p.x - q.x) >= Math.abs(p.y - q.y) ? (p.x < q.x ? '西' : '東') : (p.y < q.y ? '南' : '北'));
  const leftEnd = flip ? side(cb, ca) : side(ca, cb);

  return (
    <div className="modal-back" onClick={onClose}>
      <div className="modal wide-modal" data-testid="wall-photo-dialog" onClick={(e) => e.stopPropagation()}>
        <h2>写真から窓・ドア（壁 {Math.round(L)}mm × 天井高 {Math.round(H)}mm）</h2>
        <input ref={fileRef} type="file" accept="image/*" hidden data-testid="wp-file" onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void load(f); }} />
        {!photo && (
          <>
            <p className="muted">壁を正面〜斜めから撮った写真を選びます。床から天井（または軒下）まで壁の端から端が写っていると正確です。</p>
            <button className="primary big" data-testid="wp-pick" onClick={() => fileRef.current?.click()}>📷 写真を選ぶ・撮る</button>
          </>
        )}
        {photo && !face && (
          <>
            <p className="small">印（左上・右上・右下・左下）を、写真の壁の四隅（天井側の左端・右端、床側の右端・左端）に合わせてください。</p>
            <svg ref={svgRef} className="wp-svg" viewBox={`0 0 ${photo.w} ${photo.h}`} data-testid="wp-photo"
              onPointerMove={(e) => { if (drag.current === null) return; const p = svgPoint(svgRef.current!, e); setQuad((q) => q.map((v, i) => (i === drag.current ? { x: Math.max(0, Math.min(photo.w, p.x)), y: Math.max(0, Math.min(photo.h, p.y)) } : v))); }}
              onPointerUp={() => { drag.current = null; }} onPointerCancel={() => { drag.current = null; }}>
              <image href={photo.url} width={photo.w} height={photo.h} />
              <polygon points={quad.map((p) => `${p.x},${p.y}`).join(' ')} fill="rgba(37,99,235,0.15)" stroke="#2563eb" strokeWidth={photo.w / 300} />
              {quad.map((p, i) => (
                <g key={i} onPointerDown={(e) => { drag.current = i; (e.target as Element).setPointerCapture?.(e.pointerId); }} data-testid={`wp-corner-${i}`} style={{ cursor: 'move' }}>
                  <circle cx={p.x} cy={p.y} r={photo.w / 30} fill="rgba(255,255,255,0.01)" />
                  <circle cx={p.x} cy={p.y} r={photo.w / 90} fill="#f59e0b" stroke="#fff" strokeWidth={photo.w / 400} />
                  <text x={p.x + photo.w / 60} y={p.y - photo.w / 60} fontSize={photo.w / 35} fill="#fff" stroke="#000" strokeWidth={photo.w / 600} paintOrder="stroke">{LABELS[i]}</text>
                </g>
              ))}
            </svg>
            <div className="row">
              <button onClick={() => fileRef.current?.click()}>写真を選び直す</button>
              <button className="primary" data-testid="wp-rectify" onClick={doRectify}>正面に補正</button>
            </div>
          </>
        )}
        {face && (
          <>
            <p className="small">窓・ドアを四角になぞってください（床に接する四角はドア）。四角を押すと種類を切り替え、×で消せます。</p>
            <svg ref={svgRef} className="wp-svg" viewBox={`0 0 ${face.w} ${face.h}`} data-testid="wp-face"
              onPointerDown={(e) => { const p = svgPoint(svgRef.current!, e); (e.currentTarget as Element).setPointerCapture?.(e.pointerId); setDraft({ x0: p.x, y0: p.y, x1: p.x, y1: p.y }); }}
              onPointerMove={(e) => { if (!draft) return; const p = svgPoint(svgRef.current!, e); setDraft({ ...draft, x1: p.x, y1: p.y }); }}
              onPointerUp={() => {
                if (draft && Math.abs(draft.x1 - draft.x0) > 8 && Math.abs(draft.y1 - draft.y0) > 8) {
                  const y1 = Math.max(draft.y0, draft.y1);
                  setBoxes((bs) => [...bs, { ...draft, type: face.h - y1 < face.h * 0.05 ? 'door' : 'window' }]);
                }
                setDraft(null);
              }}>
              <image href={face.url} width={face.w} height={face.h} />
              {existing.map((o) => { const r = openingToRect(o, face.w, face.h, L, H, flip); return <rect key={o.id} x={r.x0} y={r.y0} width={r.x1 - r.x0} height={r.y1 - r.y0} fill="rgba(100,116,139,0.3)" stroke="#64748b" strokeDasharray="6 4" />; })}
              {boxes.map((bx, i) => {
                const x = Math.min(bx.x0, bx.x1), y = Math.min(bx.y0, bx.y1), w = Math.abs(bx.x1 - bx.x0), h = Math.abs(bx.y1 - bx.y0);
                const c = bx.type === 'door' ? '#b45309' : '#0284c7';
                return (
                  <g key={i} onPointerDown={(e) => e.stopPropagation()}>
                    <rect x={x} y={y} width={w} height={h} fill={c} fillOpacity={0.25} stroke={c} strokeWidth={3} data-testid="wp-box"
                      onClick={() => setBoxes((bs) => bs.map((v, k) => (k === i ? { ...v, type: v.type === 'door' ? 'window' : 'door' } : v)))} />
                    <text x={x + 6} y={y + 22} fontSize={20} fill="#fff" stroke="#000" strokeWidth={1} paintOrder="stroke" pointerEvents="none">{bx.type === 'door' ? 'ドア' : '窓'}</text>
                    <text x={x + w - 22} y={y + 22} fontSize={22} fill="#dc2626" style={{ cursor: 'pointer' }} onClick={() => setBoxes((bs) => bs.filter((_, k) => k !== i))}>×</text>
                  </g>
                );
              })}
              {draft && <rect x={Math.min(draft.x0, draft.x1)} y={Math.min(draft.y0, draft.y1)} width={Math.abs(draft.x1 - draft.x0)} height={Math.abs(draft.y1 - draft.y0)} fill="none" stroke="#f59e0b" strokeWidth={3} strokeDasharray="8 4" />}
            </svg>
            <div className="row">
              <span className="small" data-testid="wp-left">写真の左端 ＝ 壁の<b>{leftEnd}</b>側の端</span>
              <button data-testid="wp-flip" onClick={() => setFlip(!flip)}>⇆ 左右を入れ替え</button>
              <button onClick={() => setFace(null)}>四隅をやり直す</button>
            </div>
          </>
        )}
        {tooSmall > 0 && <p className="warn small">幅または高さが 100mm 未満の四角 {tooSmall}個は作成しません</p>}
        {msg && <p className="err" role="alert">{msg}</p>}
        <div className="modal-btns">
          <button onClick={onClose}>閉じる</button>
          <button className="primary" data-testid="wp-create" disabled={!face || boxes.length - tooSmall === 0} onClick={create}>開口部を作成（{boxes.length - tooSmall}）</button>
        </div>
      </div>
    </div>
  );
}
