/** 2D平面図（表示中の階）と3D表示を PNG にする */

const toPngBytes = (c: HTMLCanvasElement) => new Promise<Uint8Array>((resolve, reject) => c.toBlob((b) => (b ? b.arrayBuffer().then((x) => resolve(new Uint8Array(x)), reject) : reject(new Error('画像を作れませんでした'))), 'image/png'));

export async function planPng(svg: SVGSVGElement, scale = 2): Promise<Uint8Array> {
  const r = svg.getBoundingClientRect();
  const w = Math.max(1, Math.round(r.width)), h = Math.max(1, Math.round(r.height));
  const clone = svg.cloneNode(true) as SVGSVGElement;
  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  clone.setAttribute('xmlns:xlink', 'http://www.w3.org/1999/xlink');
  clone.setAttribute('width', String(w));
  clone.setAttribute('height', String(h));
  clone.setAttribute('viewBox', `0 0 ${w} ${h}`);
  const bg = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
  bg.setAttribute('width', '100%'); bg.setAttribute('height', '100%'); bg.setAttribute('fill', '#ffffff');
  clone.insertBefore(bg, clone.firstChild);
  const url = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(new XMLSerializer().serializeToString(clone));
  const img = new Image();
  img.src = url;
  await img.decode();
  const c = document.createElement('canvas');
  c.width = w * scale; c.height = h * scale;
  const ctx = c.getContext('2d')!;
  ctx.scale(scale, scale);
  ctx.drawImage(img, 0, 0, w, h);
  return toPngBytes(c);
}

export async function view3dPng(canvas: HTMLCanvasElement): Promise<Uint8Array> {
  const c = document.createElement('canvas');
  c.width = canvas.width; c.height = canvas.height;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#eef2f7';
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.drawImage(canvas, 0, 0);
  return toPngBytes(c);
}

/** 図面の SVG 文字列（width="297mm" など）を PNG にする。widthPx は出力の横幅 */
export async function svgStringToPng(svg: string, widthPx = 1400): Promise<Uint8Array> {
  const m = /viewBox="0 0 ([\d.]+) ([\d.]+)"/.exec(svg);
  const vw = m ? Number(m[1]) : 297, vh = m ? Number(m[2]) : 210;
  const w = Math.max(1, Math.round(widthPx)), h = Math.max(1, Math.round(widthPx * vh / vw));
  const sized = svg.replace(/<svg([^>]*)\swidth="[^"]*"\sheight="[^"]*"/, `<svg$1 width="${w}" height="${h}"`);
  const img = new Image();
  img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(sized);
  await img.decode();
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, w, h);
  ctx.drawImage(img, 0, 0, w, h);
  return toPngBytes(c);
}
