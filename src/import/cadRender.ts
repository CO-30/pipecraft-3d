/** CAD図面の線画を canvas に描いて PNG の下敷き画像にする */
import { fitDrawing, type CadDrawing, type DrawingFit } from '../model/cadDrawing';
import { TARGET_UNDERLAY_SRC } from '../model/underlay';
import type { Raster } from './image';

/** 線画の長辺の画素数（写真より細かくして線と文字を読めるようにする） */
export const CAD_PX = 4000;
const MIN_CAD_PX = 800;
/** これより小さい文字は読めないので描かない(px) */
const MIN_TEXT_PX = 4;

type Ctx = Pick<CanvasRenderingContext2D,
  'fillStyle' | 'strokeStyle' | 'lineWidth' | 'lineCap' | 'font' | 'textBaseline'
  | 'fillRect' | 'beginPath' | 'moveTo' | 'lineTo' | 'stroke' | 'save' | 'restore' | 'translate' | 'rotate' | 'fillText'>;

export function drawCad(ctx: Ctx, d: Pick<CadDrawing, 'lines' | 'texts'>, f: DrawingFit): void {
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, f.widthPx, f.heightPx);
  ctx.strokeStyle = '#111';
  ctx.lineCap = 'round';
  ctx.lineWidth = Math.max(1, Math.max(f.widthPx, f.heightPx) / 1600);
  // まとめて描くと速いが、1パスが長すぎると遅くなる端末があるので区切る
  for (let i = 0; i < d.lines.length; i += 2000) {
    ctx.beginPath();
    for (const l of d.lines.slice(i, i + 2000)) {
      const p = f.toPx(l.x1, l.y1), q = f.toPx(l.x2, l.y2);
      ctx.moveTo(p.x, p.y);
      ctx.lineTo(q.x, q.y);
    }
    ctx.stroke();
  }
  ctx.fillStyle = '#111';
  ctx.textBaseline = 'alphabetic';
  for (const t of d.texts) {
    const px = t.h / f.paperMmPerPx;
    if (px < MIN_TEXT_PX) continue;
    const p = f.toPx(t.x, t.y);
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.rotate((-t.angle * Math.PI) / 180);
    ctx.font = `${Math.round(px * 10) / 10}px sans-serif`;
    // 元図面の文字幅を超えないように（フォントが違っても隣の図形に重ならない）
    ctx.fillText(t.content, 0, 0, Math.max(px, ([...t.content].length * t.w) / f.paperMmPerPx * 1.1));
    ctx.restore();
  }
}

/** 保存できる大きさに収まるまで画素数を下げて PNG にする */
export function renderCad(d: CadDrawing, maxPx = CAD_PX): Raster & { mmPerPx: number } {
  for (let px = maxPx; px >= MIN_CAD_PX; px = Math.round(px * 0.75)) {
    const f = fitDrawing(d, px);
    const c = document.createElement('canvas');
    c.width = f.widthPx;
    c.height = f.heightPx;
    const ctx = c.getContext('2d');
    if (!ctx) throw new Error('画像を作れませんでした');
    drawCad(ctx, d, f);
    const src = c.toDataURL('image/png');
    c.width = c.height = 0; // iPhone は canvas の合計メモリに上限があるので、すぐ手放す
    // 大きすぎる canvas は中身の無い "data:," を返す端末がある。その場合は小さくしてやり直す
    if (src.startsWith('data:image/png;base64,') && src.length <= TARGET_UNDERLAY_SRC) return { src, widthPx: f.widthPx, heightPx: f.heightPx, mmPerPx: f.mmPerPx };
  }
  throw new Error('図面が細かすぎて取り込めません');
}
