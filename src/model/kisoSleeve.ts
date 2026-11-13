/**
 * 基礎貫通スリーブ（前澤化成工業「基礎貫通スリーブカタログ」2024年12月版・資料 NO. G-07）。
 * 外周の基礎を通る排水は KSA（さや管＋フレキ管＋パッキン＋スリーブホルダー 2 個のセット）、給水・給湯は KSS。
 * 内部の立上りを通る所は、スリーブ用の VU 管（呼び径はスリーブ径の一般値）を切って使う。
 * 立ち下げ（立ち上げ）の高さ H はモデルの値から測り、いちばん近い品番を選ぶ。差が大きいときは「要確認」。
 */
import type { Doc } from './doc';
import { segmentsAt, type Network, type Segment } from './network';
import { isRiserLike } from './slope';
import { FOOTING_SLEEVE, SUPPLY_PER_SLEEVE, sleeveSchedule, type SleeveRow } from './sleeves';
/** 同じ φ50 の貫通パイプにまとめる、立上りを通る給水・給湯の管どうしの離れ(mm) */
const BUNDLE_MM = 200;

export const KISO_CATALOG_SOURCE = '前澤化成工業 基礎貫通スリーブカタログ（2024年12月版）の設計価格（税抜・参考。沖縄・離島は別途）';

export type KisoProduct = {
  code: string;
  /** 排水用 KSA・給水用 KSS */
  use: 'drain' | 'water';
  /** 呼び径（さや管の大きさ） */
  size: number;
  /** 外の口の芯から床下の口までの高さ(mm) */
  H: number;
  /** 深基礎用（90° 曲がり）。標準は 45° */
  deep: boolean;
  /** 防蟻品（-B）か */
  antiTermite: boolean;
  /** 設計価格（セット・税抜・円） */
  price: number;
  /** メーカーの申込番号（Mコード） */
  mcode: string;
  /** セットに入っていない物の注意 */
  note?: string;
};

const P = (code: string, use: 'drain' | 'water', size: number, H: number, deep: boolean, antiTermite: boolean, price: number, mcode: string, note?: string): KisoProduct =>
  ({ code, use, size, H, deep, antiTermite, price, mcode, ...(note ? { note } : {}) });

/** カタログの品番（普及型 E は長さを現場で継ぎ足す物なので、自動では選ばない） */
export const KISO_PRODUCTS: KisoProduct[] = [
  P('KSA50N×230H', 'drain', 50, 230, false, false, 14000, '73513'),
  P('KSA50N×280H', 'drain', 50, 280, false, false, 14500, '73514'),
  P('KSA75N×230H', 'drain', 75, 230, false, false, 19000, '73552'),
  P('KSA75N×280H', 'drain', 75, 280, false, false, 19600, '73553'),
  P('KSA100×333H', 'drain', 100, 333, false, false, 25300, '71593'),
  P('KSA50NF×430H', 'drain', 50, 430, true, false, 16500, '73584'),
  P('KSA75NF×430H', 'drain', 75, 430, true, false, 21600, '73583'),
  P('KSA100F×680H', 'drain', 100, 680, true, false, 30400, '71592'),
  P('KSA-B50N×230H', 'drain', 50, 230, false, true, 17100, '73469'),
  P('KSA-B50N×280H', 'drain', 50, 280, false, true, 17700, '73470'),
  P('KSA-B75N×230H', 'drain', 75, 230, false, true, 22100, '73471'),
  P('KSA-B75N×280H', 'drain', 75, 280, false, true, 22800, '73472'),
  P('KSA-B100×333H', 'drain', 100, 333, false, true, 28500, '71473'),
  P('KSA-B50NF×430H', 'drain', 50, 430, true, true, 19600, '73474'),
  P('KSA-B75NF×430H', 'drain', 75, 430, true, true, 24600, '73475'),
  P('KSA-B100F×680H', 'drain', 100, 680, true, true, 33600, '71476'),
  P('KSS45L50×230H', 'water', 50, 230, false, false, 2780, '71281'),
  P('KSS45L75×280H', 'water', 75, 280, false, false, 4430, '71282', '給水用パッキンが入っていないので、市販のパテかモルタルですき間を埋めます'),
  P('KSS90L50×430H', 'water', 50, 430, true, false, 3800, '71283'),
  P('KSS45L-B50×230H', 'water', 50, 230, false, true, 4810, '71398'),
  P('KSS90L-B50×430H', 'water', 50, 430, true, true, 6070, '71399'),
];

/** 給水用のさや管の内径（mm）。管と保温がこれより太ければ 75 */
const KSS_BORE: Record<number, number> = { 50: 56, 75: 83 };
/** 品番の H とモデルの高さの差がこれを超えたら「要確認」(mm)。パッキンの位置で 2cm、フレキ管を外へ 3cm まで出せる（カタログ P.2・P.10） */
export const H_TOLERANCE = 50;
/** 立上りの幅（スリーブ用 VU 管の長さの目安）(mm) */
const FOOT_W = 150;

/** 排水の口径に合う KSA の呼び径（50・75・100。これより太い管は扱わない） */
const ksaSize = (d: number) => (d <= 50 ? 50 : d <= 75 ? 75 : d <= 100 ? 100 : null);

/** 排水: 口径と立ち下げの高さに一番近い KSA */
export function pickKsa(diameter: number, H: number, antiTermite = false): KisoProduct | null {
  const size = ksaSize(diameter);
  if (!size) return null;
  const c = KISO_PRODUCTS.filter((p) => p.use === 'drain' && p.size === size && p.antiTermite === antiTermite);
  return c.sort((a, b) => Math.abs(a.H - H) - Math.abs(b.H - H) || a.H - b.H)[0] ?? null;
}

/** 排水: その口径で選べる KSA の高さ H（標準・深基礎。小さい順） */
export function ksaHeights(diameter: number, antiTermite = false): number[] {
  const size = ksaSize(diameter);
  return size ? KISO_PRODUCTS.filter((p) => p.use === 'drain' && p.size === size && p.antiTermite === antiTermite).map((p) => p.H).sort((a, b) => a - b) : [];
}
/** 給水用 KSS の高さ H（内径 56 の 50 の物。小さい順） */
export const KSS_HEIGHTS = [230, 430];

/** 給水・給湯: 管の外径（保温込み）と立ち上げの高さから KSS。深い（330mm 以上）は深基礎 90L */
export function pickKss(od: number, H: number, antiTermite = false): KisoProduct | null {
  const deep = H >= 330;
  const size = od + 10 <= KSS_BORE[50] ? 50 : od + 10 <= KSS_BORE[75] ? 75 : null;
  if (!size) return null;
  const c = KISO_PRODUCTS.filter((p) => p.use === 'water' && p.antiTermite === antiTermite && p.deep === deep && p.size >= size);
  // 防蟻品・深基礎には 75 が無い。50 で入らなければ防蟻なし・標準の 75（KSS45L75）
  return c.sort((a, b) => a.size - b.size)[0] ?? { ...KISO_PRODUCTS.find((p) => p.code === 'KSS45L75×280H')!, note: '管が太く 50 に入らないため 75 を選びました（75 は防蟻品・深基礎用が無く、給水用パッキンも入っていないので、パテかモルタルですき間を埋めます）' };
}

/** スリーブの点（区間の端）からの、縦の区間の高さ（区間が基礎を抜けた先で、基礎の内側で上がる・下がる高さ）。capZ より上は数えない */
export function riseAt(net: Network, seg: Segment, capZ = Infinity): number {
  let best = 0;
  for (const nid of [seg.a, seg.b]) {
    const n = net.nodes[nid];
    for (const t of segmentsAt(net, nid)) {
      if (t.id === seg.id) continue;
      const o = net.nodes[t.a === nid ? t.b : t.a];
      if (Math.hypot(o.pos.x - n.pos.x, o.pos.y - n.pos.y) < 1 && o.pos.z > n.pos.z) best = Math.max(best, Math.min(o.pos.z, capZ) - n.pos.z);
    }
  }
  return Math.round(best);
}

export type KisoItem = {
  /** 単価の鍵 `kiso|<品番>` または `kiso|vu|<呼び径>` */
  key: string;
  name: string;
  spec: string;
  count: number;
  unit: string;
  note: string;
  price: number | undefined;
  /** その所のスリーブ表の番号 */
  rows: number[];
};
export type KisoCheck = { segId: string; message: string };

const isDrain = (s: SleeveRow) => s.system === 'drain' || s.system === 'sewage';
const isSupply = (s: SleeveRow) => s.system === 'water' || s.system === 'hotWater';

/**
 * スリーブ表から、基礎の貫通に使う材料。外周の基礎（地中を通る所）は KSA・KSS のセット、
 * 床下の高さで外周の基礎を抜ける所と内部の立上りは VU 管（4m 定尺の本数）
 */
export function kisoSleeveItems(doc: Doc, opts: { antiTermite?: boolean } = {}): { items: KisoItem[]; checks: KisoCheck[] } {
  const rows = sleeveSchedule(doc);
  const net = doc.network;
  const by = new Map<string, KisoItem>();
  const checks: KisoCheck[] = [];
  const vu = new Map<number, { len: number; rows: number[] }>();
  const bundles: { x: number; y: number; n: number }[] = [];
  const floorZ = Math.min(...doc.building.floors.map((f) => f.elevation));
  // スリーブの床下の口は土間（スラブ天端）。その上は床下の配管なので H に入れない
  const slab = doc.building.foundation?.slabTop;
  const capZ = slab !== undefined ? floorZ + slab : Infinity;
  for (const r of rows) {
    if (r.part !== 'footingOuter' && r.part !== 'footing') continue;
    const seg = net.segments[r.segId];
    if (!seg) continue;
    // 45° で基礎を抜ける管は、その管の高さの差（土間まで）が H。真下へ下ろした形は、端につながる立て管の高さ
    const za = net.nodes[seg.a].pos.z, zb = net.nodes[seg.b].pos.z;
    const H = isRiserLike(net, seg) ? Math.max(0, Math.round(Math.min(Math.max(za, zb), capZ) - Math.min(za, zb))) : riseAt(net, seg, capZ);
    // 外周の基礎で、基礎の内側で立ち上がる（地中を抜ける）所はメーカーのスリーブ
    const p = r.part === 'footingOuter' && H >= 80 && r.point.z < floorZ
      ? (isDrain(r) ? pickKsa(r.diameter, H, opts.antiTermite) : isSupply(r) ? pickKss(r.od + (r.system === 'hotWater' ? 20 : 0), H, opts.antiTermite) : null)
      : null;
    if (p) {
      const key = `kiso|${p.code}`;
      const it = by.get(key) ?? by.set(key, {
        key, name: p.use === 'drain' ? '基礎貫通スリーブ（排水用）' : '基礎貫通スリーブ（給水用）', spec: p.code, count: 0, unit: 'セット',
        note: `前澤化成 Mコード ${p.mcode}・H${p.H}${p.deep ? '（深基礎）' : ''}${p.note ? `／${p.note}` : ''}`, price: p.price, rows: [],
      }).get(key)!;
      it.count++;
      it.rows.push(r.no);
      if (Math.abs(p.H - H) > H_TOLERANCE) {
        checks.push({ segId: r.segId, message: `基礎貫通スリーブ ${p.code} の高さ H${p.H} と図の高さ ${H}mm が ${Math.abs(p.H - H)}mm 違います。パッキンの位置（2cm）とフレキ管の出し（3cm）では合わせきれません。地中の管・マスの深さを直すか、長さを調整できる普及型（KSA-E）やメーカーに合う品番を問い合わせてください（スリーブ表 No.${r.no}）` });
      }
      continue;
    }
    // VU 管のスリーブ: 立上りの幅（一般的な 150mm）＋ 両側 20mm
    const v = vu.get(r.sleeve) ?? vu.set(r.sleeve, { len: 0, rows: [] }).get(r.sleeve)!;
    v.rows.push(r.no);
    // 床下の立上りの給水・給湯は、近くを通る管（BUNDLE_MM 以内）を 1 本の φ50 にまとめて通す（5 本まで）
    if (r.part === 'footing' && isSupply(r) && r.sleeve === FOOTING_SLEEVE.supply) {
      const c = bundles.find((b) => Math.hypot(b.x - r.point.x, b.y - r.point.y) <= BUNDLE_MM && b.n < SUPPLY_PER_SLEEVE);
      if (c) { c.n++; continue; }
      bundles.push({ x: r.point.x, y: r.point.y, n: 1 });
    }
    v.len += FOOT_W + 40;
  }
  const items = [...by.values()].sort((a, b) => a.key.localeCompare(b.key, 'ja'));
  for (const [d, v] of [...vu].sort((a, b) => a[0] - b[0])) {
    items.push({
      key: `kiso|vu|${d}`, name: 'スリーブ用 VU管（基礎の立上り）', spec: `φ${d}・4m`, count: Math.max(1, Math.ceil(v.len / 4000)), unit: '本',
      note: `${v.rows.length}か所・計 ${(v.len / 1000).toFixed(2)}m を切って使う（スリーブ表 No.${v.rows.join('・')}）`, price: undefined, rows: v.rows,
    });
  }
  return { items, checks };
}
