/**
 * DXF を読み、下敷き用の線画データ（Jw_cad 取込と同じ CadDrawing）にする。端末の中だけで解析する。
 * 対応: LINE・LWPOLYLINE（ふくらみの弧）・POLYLINE/VERTEX・CIRCLE・ARC・ELLIPSE・SPLINE・TEXT・MTEXT・INSERT（ブロック、入れ子 8 まで）・DIMENSION。
 * 単位は $INSUNITS（無ければ mm）で mm に直し、実寸（縮尺 1）で置く。文字は R12 などは Shift_JIS、R2007 以降は UTF-8。
 * 見えない画層（色が負・凍結）とペーパー空間の図形は飛ばす。
 */
import { MAX_CAD_LINES, type CadDrawing, type CadLine, type CadText } from '../model/cadDrawing';

type Pair = [number, string];
type Ent = { type: string; p: Pair[]; verts?: Pair[][] };
type M = [number, number, number, number, number, number]; // x' = a x + c y + e, y' = b x + d y + f
const ID: M = [1, 0, 0, 1, 0, 0];
const mul = (m: M, n: M): M => [m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1], m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3], m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5]];
const ap = (m: M, x: number, y: number) => ({ x: m[0] * x + m[2] * y + m[4], y: m[1] * x + m[3] * y + m[5] });
const UNIT_MM: Record<number, number> = { 1: 25.4, 2: 304.8, 4: 1, 5: 10, 6: 1000, 14: 100 };
const MAX_NEST = 8;
const SEG = Math.PI / 18; // 円弧を折れ線にするときの 1 区間（10°）

function decode(bytes: Uint8Array): string {
  const head = new TextDecoder('latin1').decode(bytes.subarray(0, Math.min(bytes.length, 20000)));
  const ver = /\$ACADVER\s*\r?\n\s*1\s*\r?\n\s*AC(\d{4})/.exec(head)?.[1];
  const sjis = /\$DWGCODEPAGE\s*\r?\n\s*3\s*\r?\n\s*ANSI_932/i.test(head);
  if (ver && Number(ver) >= 1021) return new TextDecoder('utf-8').decode(bytes);
  if (sjis) return new TextDecoder('shift_jis').decode(bytes);
  try { return new TextDecoder('utf-8', { fatal: true }).decode(bytes); } catch { return new TextDecoder('shift_jis').decode(bytes); }
}

function pairs(text: string): Pair[] {
  const l = text.split(/\r\n|\r|\n/);
  const out: Pair[] = [];
  for (let i = 0; i + 1 < l.length; i += 2) {
    const t = l[i].trim();
    if (!/^-?\d+$/.test(t)) { i--; continue; } // 空行・ずれた行を読み飛ばして合わせる
    out.push([Number(t), l[i + 1].replace(/\s+$/, '')]);
  }
  return out;
}

const num = (p: Pair[], c: number, d = 0) => { const v = p.find(([k]) => k === c)?.[1]; const n = v === undefined ? NaN : Number(v); return Number.isFinite(n) ? n : d; };
const str = (p: Pair[], c: number) => p.find(([k]) => k === c)?.[1];

/** 特別な書き方（%%c・\U+XXXX）を字に */
function plain(s: string): string {
  return s.replace(/%%[cC]/g, 'φ').replace(/%%[dD]/g, '°').replace(/%%[pP]/g, '±').replace(/%%%/g, '%')
    .replace(/\\U\+([0-9A-Fa-f]{4})/g, (_, h) => String.fromCharCode(parseInt(h, 16)));
}
/** MTEXT の書式を除いて行に分ける */
export function mtextLines(s: string): string[] {
  const t = s
    .replace(/\\P/g, '\n').replace(/\\~/g, ' ')
    .replace(/\\S([^;^/#]*)[\^/#]([^;]*);/g, '$1/$2')
    .replace(/\\[ACFHQTWfacfhqtwp][^;\\]*;/g, '')
    .replace(/\\[LlOoKkNX]/g, '')
    .replace(/[{}]/g, '').replace(/\\\\/g, '\\');
  return plain(t).split('\n').map((x) => x.trim()).filter((x) => x.length > 0);
}

/** 文字の幅の見積もり（全角 1・半角 0.6 × 高さ） */
const widthOf = (s: string, h: number) => [...s].reduce((a, ch) => a + (ch.charCodeAt(0) < 0x2000 ? 0.6 : 1), 0) * h;

const MAX_COPIES = 2000; // 配列挿入の数の上限
const MIRROR: M = [-1, 0, 0, 1, 0, 0];

export function parseDxf(bytes: Uint8Array): CadDrawing {
  if (new TextDecoder('latin1').decode(bytes.subarray(0, 18)) === 'AutoCAD Binary DXF') {
    throw new Error('バイナリ形式の DXF は読めません。CAD で「ASCII（テキスト）形式」の DXF に保存し直してください');
  }
  const P = pairs(decode(bytes));
  // セクションに分ける
  const sections = new Map<string, Pair[]>();
  for (let i = 0; i < P.length; i++) {
    if (P[i][0] === 0 && P[i][1] === 'SECTION' && P[i + 1]?.[0] === 2) {
      const name = P[i + 1][1];
      let j = i + 2;
      while (j < P.length && !(P[j][0] === 0 && P[j][1] === 'ENDSEC')) j++;
      sections.set(name, P.slice(i + 2, j));
      i = j;
    }
  }
  const header = sections.get('HEADER') ?? [];
  const hv = (name: string, code: number) => { const i = header.findIndex(([c, v]) => c === 9 && v === name); return i >= 0 ? header.slice(i + 1).find(([c]) => c === code)?.[1] : undefined; };
  const insunits = Number(hv('$INSUNITS', 70) ?? 4);
  const unit = UNIT_MM[insunits] ?? 1;
  const notes: string[] = [];
  if (unit !== 1) notes.push(`DXF の単位（${insunits === 6 ? 'm' : insunits === 5 ? 'cm' : insunits === 1 ? 'インチ' : insunits === 2 ? 'フィート' : '単位'}）を mm に直して置きました`);

  // 見えない画層（色が負・凍結）
  const hidden = new Set<string>();
  const tables = sections.get('TABLES') ?? [];
  for (const e of entitiesOf(tables)) if (e.type === 'LAYER') {
    const name = str(e.p, 2);
    if (name && (num(e.p, 62, 7) < 0 || (num(e.p, 70) & 1))) hidden.add(name);
  }

  // ブロック
  const blocks = new Map<string, { base: { x: number; y: number }; ents: Ent[] }>();
  const bl = sections.get('BLOCKS') ?? [];
  let cur: { name: string; base: { x: number; y: number }; ents: Ent[] } | null = null;
  for (const e of entitiesOf(bl)) {
    if (e.type === 'BLOCK') { cur = { name: str(e.p, 2) ?? '', base: { x: num(e.p, 10), y: num(e.p, 20) }, ents: [] }; continue; }
    if (e.type === 'ENDBLK') { if (cur) blocks.set(cur.name, cur); cur = null; continue; }
    cur?.ents.push(e);
  }

  const lines: CadLine[] = [];
  const texts: CadText[] = [];
  const skipped = new Set<string>();
  const add = (m: M, x1: number, y1: number, x2: number, y2: number) => {
    if (lines.length >= MAX_CAD_LINES) throw new Error('図面が大きすぎます（線が多すぎます）。CAD で必要な範囲だけにして保存し直してください');
    const a = ap(m, x1, y1), b = ap(m, x2, y2);
    lines.push({ x1: a.x * unit, y1: a.y * unit, x2: b.x * unit, y2: b.y * unit });
  };
  const path = (m: M, pts: { x: number; y: number }[]) => { for (let i = 1; i < pts.length; i++) add(m, pts[i - 1].x, pts[i - 1].y, pts[i].x, pts[i].y); };
  const arcPts = (cx: number, cy: number, r: number, a0: number, sweep: number) => {
    const n = Math.max(2, Math.ceil(Math.abs(sweep) / SEG));
    return Array.from({ length: n + 1 }, (_, k) => ({ x: cx + r * Math.cos(a0 + (sweep * k) / n), y: cy + r * Math.sin(a0 + (sweep * k) / n) }));
  };
  /** ふくらみ b の弧（P→Q、正は反時計回り） */
  const bulge = (p: { x: number; y: number }, q: { x: number; y: number }, b: number) => {
    if (Math.abs(b) < 1e-9) return [p, q];
    const dx = q.x - p.x, dy = q.y - p.y, L = Math.hypot(dx, dy);
    if (L < 1e-12) return [p, q];
    const off = ((1 - b * b) / (4 * b)) * L;
    const cx = (p.x + q.x) / 2 - (dy / L) * off, cy = (p.y + q.y) / 2 + (dx / L) * off;
    const r = Math.hypot(p.x - cx, p.y - cy);
    return arcPts(cx, cy, r, Math.atan2(p.y - cy, p.x - cx), 4 * Math.atan(b));
  };
  const textAt = (m: M, x: number, y: number, h: number, angDeg: number, content: string) => {
    if (!content) return;
    const a = ap(m, x, y);
    // 変換の回転と倍率を文字にも
    const sx = Math.hypot(m[0], m[1]);
    const rot = (Math.atan2(m[1], m[0]) * 180) / Math.PI;
    texts.push({ x: a.x * unit, y: a.y * unit, h: h * sx * unit, w: h * sx * unit, angle: angDeg + rot, content });
  };

  const draw = (ents: Ent[], m0: M, depth: number) => {
    for (const e of ents) {
      const p = e.p;
      if (num(p, 67) === 1) continue; // ペーパー空間
      const layer = str(p, 8);
      if (layer && hidden.has(layer)) continue;
      // 押し出し方向が裏（下から見た図形）は、図形の座標系（OCS）の x が逆向き。LINE 等は世界座標なので関係しない
      const m = num(p, 230, 1) < 0 ? mul(m0, MIRROR) : m0;
      switch (e.type) {
        case 'LINE': add(m0, num(p, 10), num(p, 20), num(p, 11), num(p, 21)); break;
        case 'LWPOLYLINE': {
          const vs: { x: number; y: number; b: number }[] = [];
          for (const [c, v] of p) {
            if (c === 10) vs.push({ x: Number(v), y: 0, b: 0 });
            else if (c === 20 && vs.length) vs[vs.length - 1].y = Number(v);
            else if (c === 42 && vs.length) vs[vs.length - 1].b = Number(v);
          }
          polyline(m, vs, (num(p, 70) & 1) === 1);
          break;
        }
        case 'POLYLINE': {
          const vs = (e.verts ?? []).filter((v) => !(num(v, 70) & 16)).map((v) => ({ x: num(v, 10), y: num(v, 20), b: num(v, 42) }));
          polyline(m, vs, (num(p, 70) & 1) === 1);
          break;
        }
        case 'CIRCLE': path(m, arcPts(num(p, 10), num(p, 20), num(p, 40), 0, Math.PI * 2)); break;
        case 'ARC': {
          const a0 = (num(p, 50) * Math.PI) / 180, a1 = (num(p, 51) * Math.PI) / 180;
          let sw = a1 - a0; while (sw <= 0) sw += Math.PI * 2;
          path(m, arcPts(num(p, 10), num(p, 20), num(p, 40), a0, sw));
          break;
        }
        case 'ELLIPSE': {
          const cx = num(p, 10), cy = num(p, 20), mx = num(p, 11), my = num(p, 21), ratio = num(p, 40, 1);
          const t0 = num(p, 41, 0); let t1 = num(p, 42, Math.PI * 2); while (t1 <= t0) t1 += Math.PI * 2;
          const n = Math.max(8, Math.ceil((t1 - t0) / SEG));
          const pts = Array.from({ length: n + 1 }, (_, k) => { const t = t0 + ((t1 - t0) * k) / n; return { x: cx + mx * Math.cos(t) - my * ratio * Math.sin(t), y: cy + my * Math.cos(t) + mx * ratio * Math.sin(t) }; });
          path(m, pts);
          break;
        }
        case 'SPLINE': {
          // 通過点があればそれ、無ければ制御点を折れ線に（下敷きの目安には十分）
          const fit: { x: number; y: number }[] = [], ctl: { x: number; y: number }[] = [];
          for (const [c, v] of p) {
            if (c === 11) fit.push({ x: Number(v), y: 0 }); else if (c === 21 && fit.length) fit[fit.length - 1].y = Number(v);
            else if (c === 10) ctl.push({ x: Number(v), y: 0 }); else if (c === 20 && ctl.length) ctl[ctl.length - 1].y = Number(v);
          }
          path(m, fit.length >= 2 ? fit : ctl);
          break;
        }
        case 'TEXT': case 'ATTRIB': {
          if (e.type === 'ATTRIB' && num(p, 70) & 1) break; // 見えない属性
          const h = num(p, 40, 2.5), content = plain(str(p, 1) ?? ''), ang = num(p, 50);
          const ha = num(p, 72), va = num(p, 73);
          let x = num(p, 10), y = num(p, 20);
          if ((ha && ha !== 3 && ha !== 5) || va) {
            x = num(p, 11, x); y = num(p, 21, y);
            const w = widthOf(content, h), k = ha === 1 || ha === 4 ? 0.5 : ha === 2 ? 1 : 0;
            const dv = va === 2 || ha === 4 ? -h / 2 : va === 3 ? -h : 0;
            const r = (ang * Math.PI) / 180;
            x += -w * k * Math.cos(r) - dv * Math.sin(r);
            y += -w * k * Math.sin(r) + dv * Math.cos(r);
          }
          textAt(m, x, y, h, ang, content);
          break;
        }
        case 'MTEXT': {
          const raw = p.filter(([c]) => c === 3).map(([, v]) => v).join('') + (str(p, 1) ?? '');
          const ls = mtextLines(raw);
          const h = num(p, 40, 2.5), att = num(p, 71, 1);
          let ang = num(p, 50);
          if (p.some(([c]) => c === 11)) ang = (Math.atan2(num(p, 21), num(p, 11)) * 180) / Math.PI;
          const r = (ang * Math.PI) / 180, cos = Math.cos(r), sin = Math.sin(r);
          const gap = h * 1.6, total = h + gap * (ls.length - 1);
          const col = (att - 1) % 3, row = Math.floor((att - 1) / 3);
          const top = row === 0 ? 0 : row === 1 ? total / 2 : total; // 基準点から最初の行の上端まで（上へ）
          ls.forEach((s, i) => {
            const w = widthOf(s, h);
            const dx = col === 0 ? 0 : col === 1 ? -w / 2 : -w;
            const dy = top - h - gap * i; // 最初の行の文字の下端
            textAt(m, num(p, 10) + dx * cos - dy * sin, num(p, 20) + dx * sin + dy * cos, h, ang, s);
          });
          break;
        }
        case 'INSERT': case 'DIMENSION': {
          if (depth >= MAX_NEST) break;
          const b = blocks.get(str(p, 2) ?? '');
          if (!b) break;
          if (e.type === 'DIMENSION') { draw(b.ents, m, depth + 1); break; }
          const sx = num(p, 41, 1), sy = num(p, 42, 1), r = (num(p, 50) * Math.PI) / 180;
          const base: M = [1, 0, 0, 1, -b.base.x, -b.base.y];
          // 配列の挿入：列 70 × 行 71、間隔 44・45（挿入の向きに回した方向へずらす）
          const cols = Math.max(1, num(p, 70, 1)), rows = Math.max(1, num(p, 71, 1));
          const cs = num(p, 44), rs = num(p, 45), cos = Math.cos(r), sin = Math.sin(r);
          let copies = 0;
          for (let ri = 0; ri < rows; ri++) for (let ci = 0; ci < cols; ci++) {
            if (++copies > MAX_COPIES) break;
            const dx = ci * cs, dy = ri * rs;
            const t: M = [cos * sx, sin * sx, -sin * sy, cos * sy, num(p, 10) + dx * cos - dy * sin, num(p, 20) + dx * sin + dy * cos];
            draw(b.ents, mul(m, mul(t, base)), depth + 1);
          }
          break;
        }
        case 'SEQEND': case 'VERTEX': case 'POINT': case 'ATTDEF': case 'VIEWPORT': break;
        default: skipped.add(e.type);
      }
    }
  };
  const polyline = (m: M, vs: { x: number; y: number; b: number }[], closed: boolean) => {
    const n = vs.length;
    for (let i = 0; i < (closed ? n : n - 1); i++) path(m, bulge(vs[i], vs[(i + 1) % n], vs[i].b));
  };

  draw(entitiesOf(sections.get('ENTITIES') ?? []), ID, 0);
  if (skipped.has('HATCH') || skipped.has('SOLID') || skipped.has('IMAGE')) notes.push('塗りつぶし・画像は取り込んでいません（線と文字だけ）');

  const empty = lines.length === 0 && texts.length === 0;
  const bounds = empty ? { minX: 0, minY: 0, maxX: 0, maxY: 0 } : boundsOf(lines, texts, notes);
  return { lines, texts, bounds, scale: 1, scales: [1], notes, empty };
}

/**
 * 図の範囲。文字は書いた幅と高さまで入れる。消し忘れなど遠く離れた少しの図形は外す
 * （端から 2% ずつの点の範囲の 2 倍より外にあり、外すのが 2% 以下のとき）。点が多くても落ちないよう配列で数える。
 */
function boundsOf(lines: CadLine[], texts: CadText[], notes: string[]) {
  const n = lines.length * 2 + texts.length * 4;
  const xs = new Float64Array(n), ys = new Float64Array(n);
  let k = 0;
  for (const l of lines) { xs[k] = l.x1; ys[k++] = l.y1; xs[k] = l.x2; ys[k++] = l.y2; }
  for (const t of texts) {
    const r = (t.angle * Math.PI) / 180, c = Math.cos(r), s = Math.sin(r), w = widthOf(t.content, t.h), h = t.h;
    for (const [u, v] of [[0, 0], [w, 0], [0, h], [w, h]]) { xs[k] = t.x + u * c - v * s; ys[k++] = t.y + u * s + v * c; }
  }
  const range = (a: Float64Array) => {
    const sorted = Float64Array.from(a).sort();
    const q = (f: number) => sorted[Math.min(sorted.length - 1, Math.floor(f * (sorted.length - 1)))];
    const lo = q(0.02), hi = q(0.98), span = Math.max(hi - lo, 1);
    return [lo - span * 2, hi + span * 2];
  };
  const [ax, bx] = range(xs), [ay, by] = range(ys);
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity, kept = 0;
  for (let i = 0; i < n; i++) {
    if (xs[i] < ax || xs[i] > bx || ys[i] < ay || ys[i] > by) continue;
    kept++;
    if (xs[i] < minX) minX = xs[i]; if (xs[i] > maxX) maxX = xs[i];
    if (ys[i] < minY) minY = ys[i]; if (ys[i] > maxY) maxY = ys[i];
  }
  if (kept < n && kept >= n * 0.98) {
    notes.push(`遠く離れた所にある図形（${n - kept} 点）を除いて図の範囲を決めました`);
    return { minX, minY, maxX, maxY };
  }
  minX = minY = Infinity; maxX = maxY = -Infinity;
  for (let i = 0; i < n; i++) {
    if (xs[i] < minX) minX = xs[i]; if (xs[i] > maxX) maxX = xs[i];
    if (ys[i] < minY) minY = ys[i]; if (ys[i] > maxY) maxY = ys[i];
  }
  return { minX, minY, maxX, maxY };
}

/** 0 の組で区切った図形の並び。POLYLINE は続く VERTEX を中に持つ */
function entitiesOf(ps: Pair[]): Ent[] {
  const out: Ent[] = [];
  let poly: Ent | null = null;
  for (const pr of ps) {
    if (pr[0] === 0) {
      const e: Ent = { type: pr[1], p: [] };
      if (e.type === 'VERTEX' && poly) { poly.verts!.push(e.p); continue; }
      if (e.type === 'SEQEND') { poly = null; continue; }
      if (e.type === 'POLYLINE') { e.verts = []; poly = e; }
      out.push(e);
      continue;
    }
    if (poly && poly.verts!.length) poly.verts![poly.verts!.length - 1].push(pr);
    else (out.at(-1)?.p ?? []).push(pr);
  }
  return out;
}
