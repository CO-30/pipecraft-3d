/**
 * 要望欄の「今の画面を添える」。平面図（または立面図）の SVG を見た目の色のまま画像にし、3D（WebGL）のキャンバスと横に並べた 1 枚にする。
 * 写すのは図面の部分だけ（ボタン・一覧などの文字は写さない）。写す物が無ければ null。
 */
const PROPS = ['fill', 'fill-opacity', 'stroke', 'stroke-width', 'stroke-dasharray', 'stroke-opacity', 'stroke-linecap', 'stroke-linejoin',
  'opacity', 'font-size', 'font-family', 'font-weight', 'text-anchor', 'dominant-baseline', 'display', 'visibility', 'paint-order'];
const MAX_H = 1000;

function findSvg(): SVGSVGElement | null {
  return document.querySelector<SVGSVGElement>('[data-testid="editor"] svg[data-testid="elev-svg"]')
    ?? document.querySelector<SVGSVGElement>('[data-testid="editor"] svg[data-testid="plan"]');
}
function findGl(): HTMLCanvasElement | null {
  return document.querySelector<HTMLCanvasElement>('[data-testid="editor"] [data-testid="view3d"] canvas');
}
const visible = (el: Element | null) => { const r = el?.getBoundingClientRect(); return !!r && r.width > 4 && r.height > 4; };

/** 写せる画面があるか（要望欄を描くときに「今の画面を添える」を出すか決める） */
export function canCapture(): boolean { return visible(findSvg()) || visible(findGl()); }

/** CSS で付いた色・線の太さを属性に移した SVG の写しを、画像として読み込む */
export function svgImage(svg: SVGSVGElement): Promise<HTMLImageElement> {
  const r = svg.getBoundingClientRect();
  const clone = svg.cloneNode(true) as SVGSVGElement;
  const src = [svg, ...Array.from(svg.querySelectorAll('*'))];
  const dst = [clone, ...Array.from(clone.querySelectorAll('*'))];
  src.forEach((el, i) => {
    const cs = getComputedStyle(el), d = dst[i] as SVGElement | undefined;
    if (!d) return;
    d.setAttribute('style', PROPS.map((p) => `${p}:${cs.getPropertyValue(p)}`).filter((t) => !/:$/.test(t)).join(';'));
  });
  // 画像として読むと blob: の下敷きは読めない（白くなるだけ）。外の参照は消しておく
  clone.querySelectorAll('image').forEach((im) => { const h = im.getAttribute('href') || im.getAttribute('xlink:href') || ''; if (!/^data:/.test(h)) im.remove(); });
  clone.querySelectorAll('foreignObject').forEach((f) => f.remove());
  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  clone.setAttribute('width', String(Math.round(r.width)));
  clone.setAttribute('height', String(Math.round(r.height)));
  const url = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(new XMLSerializer().serializeToString(clone));
  return new Promise((ok, ng) => { const im = new Image(); im.onload = () => ok(im); im.onerror = ng; im.src = url; });
}

function compose(parts: (HTMLImageElement | HTMLCanvasElement)[]): string {
  const h = Math.min(MAX_H, Math.max(...parts.map((p) => p.height)));
  const ws = parts.map((p) => Math.round(p.width * (h / p.height)));
  const c = document.createElement('canvas');
  c.width = ws.reduce((a, b) => a + b, 0) + (parts.length - 1) * 8; c.height = h;
  const g = c.getContext('2d')!;
  g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height);
  let x = 0;
  parts.forEach((p, i) => { g.drawImage(p, x, 0, ws[i], h); x += ws[i] + 8; });
  return c.toDataURL('image/jpeg', 0.9);
}

/** 今の画面（図面の部分）を JPEG の dataURL にする。写す物が無い・写せないときは null */
export async function captureScreen(): Promise<string | null> {
  const svg = findSvg(), gl = findGl();
  const parts: (HTMLImageElement | HTMLCanvasElement)[] = [];
  if (svg && visible(svg)) { try { parts.push(await svgImage(svg)); } catch { /* 平面図を写せなければ 3D だけ */ } }
  const glOk = gl && visible(gl) && gl.width > 0 && gl.height > 0;
  if (glOk) parts.push(gl!);
  if (!parts.length) return null;
  try { return compose(parts); } catch {
    // 平面図で画像が汚れて書き出せない端末：3D だけで作り直す
    try { return glOk ? compose([gl!]) : null; } catch { return null; }
  }
}
