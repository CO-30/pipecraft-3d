/**
 * 写真を選び、壁の四隅（左上・右上・右下・左下）を合わせて正面に補正する部品。
 * 補正後の画像は 横:縦 = aspectW:aspectH（実寸の比）で、長い辺が maxPx。
 */
import { useRef, useState } from 'react';
import { rectify } from '../model/homography';
import { checkRefRect, refRectPx, type RefRect } from '../model/facadePhoto';
import { canvasFrom, loadBitmap } from '../import/image';
import type { Vec2 } from '../model/building';

export type Face = { url: string; w: number; h: number };
const LABELS = ['左上', '右上', '右下', '左下'];

/** SVG 上のポインター位置を viewBox 座標へ */
export function svgPoint(svg: SVGSVGElement, e: React.PointerEvent): Vec2 {
  const pt = svg.createSVGPoint();
  pt.x = e.clientX; pt.y = e.clientY;
  const m = svg.getScreenCTM();
  const p = m ? pt.matrixTransform(m.inverse()) : pt;
  return { x: p.x, y: p.y };
}

/** 四隅が凸の四角形になっているか（交差・へこみがない） */
export const convexQuad = (q: Vec2[]) => {
  const s = q.map((p, i) => { const a = q[(i + 1) % 4], b = q[(i + 2) % 4]; return Math.sign((a.x - p.x) * (b.y - a.y) - (a.y - p.y) * (b.x - a.x)); });
  return s.every((v) => v > 0) || s.every((v) => v < 0);
};

/**
 * allowPartial: 壁全体が写っていないとき「壁の一部（大きさの分かる四角）」で合わせられる。
 * その場合 aspectW×aspectH は立面全体の実寸(mm)で、四角の外も同じ変換で延長する。
 */
export function PhotoRectify({ aspectW, aspectH, maxPx = 1000, quality = 0.85, intro, onDone, hidden, allowPartial }: {
  aspectW: number; aspectH: number; maxPx?: number; quality?: number; intro: string; onDone: (f: Face) => void; hidden?: boolean; allowPartial?: boolean;
}) {
  const [partial, setPartial] = useState(false);
  const [ref, setRef] = useState<Record<keyof RefRect, string>>({ left: '0', bottom: '0', width: String(Math.round(aspectW)), height: String(Math.round(aspectH)) });
  const fileRef = useRef<HTMLInputElement>(null);
  const [photo, setPhoto] = useState<{ url: string; w: number; h: number; data: ImageData } | null>(null);
  const [quad, setQuad] = useState<Vec2[]>([]);
  const [msg, setMsg] = useState('');
  const drag = useRef<number | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);

  const load = async (f: File) => {
    setMsg('');
    try {
      const c = canvasFrom(await loadBitmap(f), 1600);
      const data = c.getContext('2d')!.getImageData(0, 0, c.width, c.height);
      setPhoto({ url: c.toDataURL('image/jpeg', 0.85), w: c.width, h: c.height, data });
      const mx = c.width * 0.2, my = c.height * 0.2;
      setQuad([{ x: mx, y: my }, { x: c.width - mx, y: my }, { x: c.width - mx, y: c.height - my }, { x: mx, y: c.height - my }]);
    } catch (e) { setMsg(`写真を読み込めませんでした: ${(e as Error).message}`); }
  };

  const doRectify = () => {
    if (!photo) return;
    if (!convexQuad(quad)) { setMsg('四隅の順番が入れ替わっています。左上・右上・右下・左下の印をそれぞれの角に合わせてください'); return; }
    setMsg('');
    const k = maxPx / Math.max(aspectW, aspectH);
    const w = Math.max(50, Math.round(aspectW * k)), h = Math.max(50, Math.round(aspectH * k));
    let dst;
    if (partial) {
      const r: RefRect = { left: Number(ref.left), bottom: Number(ref.bottom), width: Number(ref.width), height: Number(ref.height) };
      const err = checkRefRect(r, aspectW, aspectH);
      if (err) { setMsg(err); return; }
      dst = refRectPx(r, aspectW, aspectH, w, h);
    }
    const out = rectify(photo.data, quad, w, h, dst);
    if (!out) { setMsg('四隅の位置を見直してください（一直線に並んでいます）'); return; }
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    c.getContext('2d')!.putImageData(new ImageData(out as ImageDataArray, w, h), 0, 0);
    onDone({ url: c.toDataURL('image/jpeg', quality), w, h });
  };

  return (
    <div style={hidden ? { display: 'none' } : undefined}>
      <input ref={fileRef} type="file" accept="image/*" hidden data-testid="wp-file" onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void load(f); }} />
      {!photo && (
        <>
          <p className="muted">{intro}</p>
          <button className="primary big" data-testid="wp-pick" onClick={() => fileRef.current?.click()}>📷 写真を選ぶ・撮る</button>
        </>
      )}
      {photo && (
        <>
          {allowPartial && (
            <div className="row">
              <span className="small">四隅は</span>
              <span className="seg-btns small">
                <button type="button" data-testid="wp-mode-whole" className={partial ? '' : 'on'} onClick={() => setPartial(false)}>壁全体の角</button>
                <button type="button" data-testid="wp-mode-partial" className={partial ? 'on' : ''} onClick={() => setPartial(true)}>壁の一部（大きさの分かる四角）</button>
              </span>
            </div>
          )}
          {partial ? (
            <>
              <p className="small">壁の端が写っていないときは、実寸の分かる四角（窓1つ、1階の床から屋上までの柱の間 など）に印を合わせ、その大きさと位置を入れます。四角の外も同じ割合で延ばします。</p>
              <div className="row ref-fields">
                {([['width', '四角の横幅'], ['height', '四角の高さ'], ['left', '壁の左端から'], ['bottom', '下端の高さ']] as [keyof RefRect, string][]).map(([k, label]) => (
                  <label key={k} className="field inline small">{label}
                    <input type="number" inputMode="numeric" data-testid={`wp-ref-${k}`} value={ref[k]} onChange={(e) => setRef({ ...ref, [k]: e.target.value })} />mm
                  </label>
                ))}
              </div>
              <p className="small muted">立面全体: 横幅 {Math.round(aspectW)}mm × 高さ {Math.round(aspectH)}mm（左下が 0）</p>
            </>
          ) : (
            <p className="small">印（左上・右上・右下・左下）を、写真の壁の四隅に合わせてください。</p>
          )}
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
      {msg && <p className="err" role="alert">{msg}</p>}
    </div>
  );
}
