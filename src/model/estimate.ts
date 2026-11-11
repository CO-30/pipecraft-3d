/**
 * 自動積算（テスト可能な独立モジュール）。Doc から毎回計算し、結果は保存しない（二重管理なし）。
 * - 長さ: 実測長（field）を優先、なければ 3D 経路長（model）。どちらを使ったか区間ごとに記録。
 * - 必要長 = 使用長 ×（1＋余長率）、発注数量 = 販売単位へ切り上げ。
 * - 金額: 行ごとに 数量×単価 を円未満四捨五入。諸経費（率 or 金額）、消費税 = floor(小計×税率)。
 */
import { findHits, penetrationsOf } from './obstacles';
import { MEMBER_LABEL } from './members';
import type { Doc } from './doc';
import { segmentLength, type Network, type Segment, type SystemType } from './network';
import { analyzeFittings, fittingName, isWire, type FittingType, type NodeFitting } from './fittings';
import { catalogFittingPrice, catalogPipePrice, catalogSupportPrice, effectiveMaterial, pbRollLength } from './priceCatalog';
import { isPB } from './materials';
import { computeConsumables, defaultConsumableSettings, GLUE_LABEL, type ConsumableSettings, type GlueKind } from './consumables';
import { computeSupports, defaultSupportSettings, SUBSTRATE_LABEL, SUPPORT_LABEL, type SupportMark, type SupportSettings } from './supports';
import { orderChain, pointsAlong } from './chain';
import type { Vec3 } from './network';

/** 単価の出どころ: user=現場で入力 / catalog=メーカー参考単価 / none=なし */
export type PriceSource = 'user' | 'catalog' | 'none';

export type SaleUnit =
  | { kind: 'perLength'; step: number } // step mm 刻み。単価は 円/m
  | { kind: 'straight'; length: number } // 定尺。単価は 円/本
  | { kind: 'roll'; length: number }; // 巻。単価は 円/巻

export type PriceItem = { material: number; labor: number; saleUnit?: SaleUnit };
export type ExtraItem = { id: string; name: string; quantity: number; unit: string; unitPrice: number };

export type EstimateSettings = {
  /** 既定の余長率（0.05 = 5%） */
  extraRate: number;
  taxRate: number;
  overhead: { mode: 'rate' | 'amount'; value: number };
  prices: Record<string, PriceItem>;
  extras: ExtraItem[];
  /** 支持金具・ビスの設定（未設定なら既定値） */
  supports?: SupportSettings;
  /** シールテープ・接着剤の設定（未設定なら既定値） */
  consumables?: ConsumableSettings;
  client?: string;
  title?: string;
  issuer?: string;
  note?: string;
};

export const defaultEstimate = (): EstimateSettings => ({
  extraRate: 0, taxRate: 0.1, overhead: { mode: 'rate', value: 0 }, prices: {}, extras: [],
});

export const SYSTEM_LABEL: Record<SystemType, string> = {
  water: '給水', hotWater: '給湯', drain: '排水', sewage: '汚水', vent: '通気', gas: 'ガス',
  refrigerant: '冷媒', condensate: 'ドレン', electric: '電気', telecom: '通信', other: 'その他',
};

/** 実測長とモデル長の差の許容: max(100mm, 10%) */
export const DIFF_ABS_MM = 100;
export const DIFF_REL = 0.1;
const EPS = 1e-6;

export const pipeKey = (s: Pick<Segment, 'system' | 'material' | 'diameter'>) => `pipe|${s.system}|${s.material ?? ''}|${s.diameter}`;
export const fittingKey = (type: FittingType, s: Pick<Segment, 'system' | 'material'>, size: string) => `fit|${type}|${s.system}|${s.material ?? ''}|${size}`;

/** 販売単位の初期値。PB（プッシュマスター）はカタログの巻、電気・通信・冷媒は m、その他は定尺 4m */
export const defaultSaleUnit = (s: SystemType | { system: SystemType; material?: string; diameter?: number }): SaleUnit => {
  const { system, material, diameter } = typeof s === 'string' ? { system: s, material: undefined, diameter: undefined } : s;
  if (isWire(system) || system === 'refrigerant') return { kind: 'perLength', step: 1000 };
  if (isPB(material)) return { kind: 'roll', length: pbRollLength(material!, diameter ?? 13) };
  return { kind: 'straight', length: 4000 };
};

export const saleUnitLabel = (u: SaleUnit) =>
  u.kind === 'perLength' ? `${u.step / 1000}m単位` : u.kind === 'straight' ? `定尺${u.length / 1000}m` : `${u.length / 1000}m巻`;
export const orderUnitName = (u: SaleUnit) => (u.kind === 'perLength' ? 'm' : u.kind === 'straight' ? '本' : '巻');

/** 浮動小数点誤差を除いてから円未満を四捨五入 */
export const roundYen = (x: number) => Math.round(Number(x.toFixed(6)));
/** 小数 d 桁に四捨五入（数量表示・施工数量） */
export const roundTo = (x: number, d: number) => {
  const f = 10 ** d;
  return Math.round(Number((x * f).toFixed(6))) / f;
};
const ceilDiv = (a: number, b: number) => Math.max(0, Math.ceil(a / b - EPS));

export type SegmentMeasure = {
  segId: string;
  modelLength: number;
  usedLength: number;
  method: 'field' | 'model';
  approx: boolean;
  extraRate: number;
  diff?: number;
  warning?: string;
};

export type PipeLine = {
  key: string;
  system: SystemType;
  material: string;
  diameter: number;
  name: string;
  segmentIds: string[];
  /** 使用長（実測優先）の合計 mm */
  usedLength: number;
  modelLength: number;
  fieldCount: number;
  modelCount: number;
  /** 必要長（余長込み） mm */
  needLength: number;
  saleUnit: SaleUnit;
  /** 発注数量（perLength は m、他は本・巻） */
  orderQty: number;
  orderUnit: string;
  /** 施工数量 m（小数1桁） */
  laborQty: number;
  price: PriceItem | undefined;
  priceSource: PriceSource;
  materialAmount: number;
  laborAmount: number;
};

export type FittingLine = {
  key: string;
  type: FittingType;
  name: string;
  system: SystemType;
  material: string;
  size: string;
  count: number;
  nodeIds: string[];
  /** 定尺の継ぎ足しで加えた個数 */
  stockJoints: number;
  price: PriceItem | undefined;
  priceSource: PriceSource;
  materialAmount: number;
  laborAmount: number;
};

/** 支持金具・ビス・コンクリキリの行 */
export type SupportLine = {
  key: string;
  name: string;
  spec: string;
  count: number;
  unit: string;
  note: string;
  price: PriceItem | undefined;
  priceSource: PriceSource;
  materialAmount: number;
  laborAmount: number;
};

export type QuoteLine = {
  section: 'material' | 'labor' | 'extra';
  name: string;
  spec: string;
  quantity: number;
  unit: string;
  unitPrice: number;
  amount: number;
  priceKey?: string;
};

export type Issue = {
  kind: 'confirmFitting' | 'lengthDiff' | 'approx' | 'noPrice' | 'obstacle' | 'sleeve';
  target: { kind: 'node' | 'segment' | 'price'; id: string };
  message: string;
};

export type Estimate = {
  measures: Record<string, SegmentMeasure>;
  pipes: PipeLine[];
  fittings: FittingLine[];
  supports: SupportLine[];
  /** シールテープ・接着剤 */
  consumables: SupportLine[];
  /** 部材図用: 支持金具の位置 */
  supportMarks: SupportMark[];
  /** 部材図用: 定尺の継ぎ足しソケットの位置 */
  stockJointMarks: { pos: Vec3; segId: string; key: string }[];
  nodeFittings: NodeFitting[];
  lines: QuoteLine[];
  issues: Issue[];
  materialTotal: number;
  laborTotal: number;
  extrasTotal: number;
  overhead: number;
  subtotal: number;
  tax: number;
  total: number;
};

export function measureSegment(net: Network, s: Segment, defaultExtra: number): SegmentMeasure {
  const modelLength = segmentLength(net, s.id);
  const field = s.measuredLength !== undefined;
  const usedLength = field ? s.measuredLength! : modelLength;
  const m: SegmentMeasure = {
    segId: s.id, modelLength, usedLength, method: field ? 'field' : 'model', approx: !!s.measuredApprox, extraRate: s.extraRate ?? defaultExtra,
  };
  if (field) {
    m.diff = usedLength - modelLength;
    if (Math.abs(m.diff) > Math.max(DIFF_ABS_MM, modelLength * DIFF_REL) + EPS) {
      m.warning = `実測長 ${Math.round(usedLength)}mm とモデル長 ${Math.round(modelLength)}mm の差が ${Math.round(Math.abs(m.diff))}mm あります`;
    }
  }
  return m;
}

/** 継手なしで一直線に続く同じ材料行の区間のまとまり（定尺の継ぎ足しソケットの計算用） */
function straightRuns(net: Network, segs: Segment[], through: Set<string>): Segment[][] {
  const bySeg = new Map(segs.map((s) => [s.id, s]));
  const byNode = new Map<string, Segment[]>();
  for (const s of segs) for (const n of [s.a, s.b]) { const arr = byNode.get(n); if (arr) arr.push(s); else byNode.set(n, [s]); }
  const seen = new Set<string>();
  const runs: Segment[][] = [];
  for (const s of segs) {
    if (seen.has(s.id)) continue;
    const run: Segment[] = [];
    const stack = [s];
    seen.add(s.id);
    while (stack.length) {
      const cur = stack.pop()!;
      run.push(cur);
      for (const n of [cur.a, cur.b]) {
        if (!through.has(n)) continue;
        for (const t of byNode.get(n) ?? []) if (!seen.has(t.id) && bySeg.has(t.id)) { seen.add(t.id); stack.push(t); }
      }
    }
    runs.push(run);
  }
  void net;
  return runs;
}

export function computeEstimate(doc: Doc): Estimate {
  const st = doc.estimate ?? defaultEstimate();
  const net = doc.network;
  const issues: Issue[] = [];
  const measures: Record<string, SegmentMeasure> = {};
  for (const s of Object.values(net.segments)) {
    const m = measureSegment(net, s, st.extraRate);
    measures[s.id] = m;
    if (m.warning) issues.push({ kind: 'lengthDiff', target: { kind: 'segment', id: s.id }, message: m.warning });
    if (m.method === 'field' && m.approx) issues.push({ kind: 'approx', target: { kind: 'segment', id: s.id }, message: '実測長は区間の分割で按分した概算値です。再実測してください' });
  }

  // --- 梁・軒などとのぶつかり・貫通 ---
  for (const h of findHits(doc)) issues.push({ kind: 'obstacle', target: { kind: 'segment', id: h.segId }, message: `配管が${MEMBER_LABEL[h.kind]}にぶつかっています。区間を選んで避け方（下をくぐる・45°・貫通）を選んでください` });
  for (const p of penetrationsOf(doc)) issues.push({ kind: 'sleeve', target: { kind: 'segment', id: p.segId }, message: `${MEMBER_LABEL[p.kind]}を貫通（スリーブ）: 構造の確認が必要です。スリーブの部材・単価は「その他」に入れてください` });

  // --- 部品判定（ノードごと） ---
  const nodeFittings = analyzeFittings(net, doc.fixtures);
  for (const f of nodeFittings) if (f.needsConfirm) issues.push({ kind: 'confirmFitting', target: { kind: 'node', id: f.nodeId }, message: f.reason ?? '部品を確定してください' });
  // 継手なしで通り抜ける点（接続数2のみ。分岐を「なし」に確定しても1本の直管にはならない）
  const deg2 = new Set<string>();
  {
    const cnt = new Map<string, number>();
    for (const s of Object.values(net.segments)) for (const n of [s.a, s.b]) cnt.set(n, (cnt.get(n) ?? 0) + 1);
    for (const [n, c] of cnt) if (c === 2) deg2.add(n);
  }
  const passThrough = new Set(nodeFittings.filter((f) => f.type === 'none' && !f.needsConfirm && deg2.has(f.nodeId)).map((f) => f.nodeId));

  // --- 材料（配管・配線） ---
  const groups = new Map<string, Segment[]>();
  for (const s of Object.values(net.segments)) { const k = pipeKey(s); const arr = groups.get(k); if (arr) arr.push(s); else groups.set(k, [s]); }
  const stockJointsByKey = new Map<string, { count: number; seg: Segment }>();
  const stockJointMarks: Estimate['stockJointMarks'] = [];
  const pipes: PipeLine[] = [];
  for (const [key, segs] of groups) {
    const s0 = segs[0];
    const user = st.prices[key];
    const saleUnit = user?.saleUnit ?? defaultSaleUnit(s0);
    // 参考単価はカタログの販売単位（塩ビ=定尺4m、PB=巻・m・直管）と同じときだけ使う
    const cat = user ? undefined : catalogPipePrice(s0, saleUnit);
    const price: PriceItem | undefined = user ?? (cat !== undefined ? { material: cat, labor: 0 } : undefined);
    const priceSource: PriceSource = user ? 'user' : cat !== undefined ? 'catalog' : 'none';
    let used = 0, model = 0, need = 0, fieldCount = 0;
    for (const s of segs) {
      const m = measures[s.id];
      used += m.usedLength;
      model += m.modelLength;
      need += m.usedLength * (1 + m.extraRate);
      if (m.method === 'field') fieldCount++;
    }
    const orderQty = saleUnit.kind === 'perLength'
      ? roundTo((ceilDiv(need, saleUnit.step) * saleUnit.step) / 1000, 3)
      : ceilDiv(need, saleUnit.length);
    const laborQty = roundTo(used / 1000, 1);
    if (saleUnit.kind === 'straight' && !isWire(s0.system)) {
      let joints = 0;
      for (const run of straightRuns(net, segs, passThrough)) {
        const len = run.reduce((a, r) => a + measures[r.id].usedLength, 0);
        const k = Math.max(0, ceilDiv(len, saleUnit.length) - 1);
        joints += k;
        // 位置: 端から定尺ごと
        if (k > 0) for (const p of pointsAlong(net, orderChain(run), Array.from({ length: k }, (_, i) => ((i + 1) * saleUnit.length) / len))) stockJointMarks.push({ ...p, key: fittingKey('socket', s0, String(s0.diameter)) });
      }
      if (joints > 0) stockJointsByKey.set(key, { count: joints, seg: s0 });
    }
    pipes.push({
      key, system: s0.system, material: effectiveMaterial(s0), diameter: s0.diameter,
      name: `${SYSTEM_LABEL[s0.system]}${isWire(s0.system) ? '配線' : '管'}`,
      segmentIds: segs.map((s) => s.id), usedLength: used, modelLength: model, fieldCount, modelCount: segs.length - fieldCount,
      needLength: need, saleUnit, orderQty, orderUnit: orderUnitName(saleUnit), laborQty, price, priceSource,
      materialAmount: roundYen(orderQty * (price?.material ?? 0)), laborAmount: roundYen(laborQty * (price?.labor ?? 0)),
    });
  }
  pipes.sort((a, b) => a.system.localeCompare(b.system) || a.material.localeCompare(b.material, 'ja') || a.diameter - b.diameter);

  // --- 部品 ---
  const fitMap = new Map<string, FittingLine>();
  const addFit = (type: FittingType, seg0: Segment, size: string, nodeId: string | null, n = 1) => {
    // PB の継手は保温・さや管の違いに関係なく同じ部品
    const seg = isPB(seg0.material) ? { ...seg0, material: 'PB' } : seg0;
    const key = fittingKey(type, seg, size);
    let line = fitMap.get(key);
    if (!line) {
      const user = st.prices[key];
      const cat = user ? undefined : catalogFittingPrice(type, seg, size);
      line = {
        key, type, name: fittingName(type, size), system: seg.system, material: effectiveMaterial(seg), size, count: 0, nodeIds: [], stockJoints: 0,
        price: user ?? (cat !== undefined ? { material: cat, labor: 0 } : undefined),
        priceSource: user ? 'user' : cat !== undefined ? 'catalog' : 'none', materialAmount: 0, laborAmount: 0,
      };
      fitMap.set(key, line);
    }
    line.count += n;
    if (nodeId) line.nodeIds.push(nodeId);
    else line.stockJoints += n;
  };
  for (const f of nodeFittings) if (f.type !== 'none') addFit(f.type, f.main, f.size, f.nodeId);
  for (const { count, seg } of stockJointsByKey.values()) addFit('socket', seg, String(seg.diameter), null, count);
  const fittings = [...fitMap.values()].sort((a, b) => a.key.localeCompare(b.key, 'ja'));
  for (const l of fittings) {
    l.materialAmount = roundYen(l.count * (l.price?.material ?? 0));
    l.laborAmount = roundYen(l.count * (l.price?.labor ?? 0));
  }

  // --- 支持金具・ビス ---
  const sst = st.supports ?? defaultSupportSettings();
  const sup = computeSupports(doc, sst, measures, passThrough);
  const supports: SupportLine[] = [];
  const addSup = (key: string, name: string, spec: string, count: number, unit: string, note = '') => {
    if (count <= 0) return;
    const user = st.prices[key];
    const cat = user ? undefined : catalogSupportPrice(key);
    const price = user ?? (cat !== undefined ? { material: cat, labor: 0 } : undefined);
    supports.push({
      key, name, spec, count, unit, note, price, priceSource: user ? 'user' : cat !== undefined ? 'catalog' : 'none',
      materialAmount: roundYen(count * (price?.material ?? 0)), laborAmount: roundYen(count * (price?.labor ?? 0)),
    });
  };
  for (const g of sup.supports) {
    const by = (['concrete', 'wood'] as const).filter((k) => g.bySubstrate[k] > 0).map((k) => `${SUBSTRATE_LABEL[k]}${g.bySubstrate[k]}`).join('・');
    addSup(`sup|${g.kind}|${g.diameter}`, SUPPORT_LABEL[g.kind], `φ${g.diameter}`, g.count, '個', `間隔 ${spacingNote(sst, g.diameter)}／下地 ${by}${g.maxHeight !== undefined ? `／土間から管底 最大 ${g.maxHeight}mm（長さを選ぶ目安）` : ''}`);
  }
  addSup('sup|screwConcrete', 'コンクリートビス', 'ステンレス 4×32', sup.holes.concrete, '本', `支持金具1個につき${sst.screwsPerSupport}本`);
  addSup('sup|bit', 'コンクリキリ（インパクト用）', '六角軸 3.4mm', sup.bits, '本', `${sst.holesPerBit}穴ごとに1本`);
  addSup('sup|screwWood', 'ステンレスビス', '皿木ねじ 4.1×38', sup.holes.wood, '本', `支持金具1個につき${sst.screwsPerSupport}本`);

  // --- シールテープ・接着剤 ---
  const cst = st.consumables ?? defaultConsumableSettings();
  const consumables: SupportLine[] = [];
  if (cst.enabled) {
    const con = computeConsumables(net, nodeFittings, [...stockJointsByKey.values()]);
    const supLen = supports.length;
    if (con.threads > 0) addSup('con|sealTape', 'シールテープ', `13mm×${cst.tapeRoll}m`, ceilDiv(con.tapeLength, cst.tapeRoll), '巻', `ネジ ${con.threads}か所・${roundTo(con.tapeLength, 1)}m`);
    for (const k of ['hi', 'vp', 'ht'] as GlueKind[]) {
      const g = con.glue[k];
      if (g) addSup(`con|glue|${k}`, GLUE_LABEL[k], `${cst.glueCan}g`, ceilDiv(g.grams, cst.glueCan), '缶', `接着 ${g.joints}口・約${roundTo(g.grams, 0)}g`);
    }
    consumables.push(...supports.splice(supLen));
  }

  // --- 単価未登録 ---
  for (const l of [...supports, ...consumables]) {
    if (!l.price || (l.price.material === 0 && l.price.labor === 0)) issues.push({ kind: 'noPrice', target: { kind: 'price', id: l.key }, message: `${l.name} ${l.spec} の単価が未登録です` });
  }
  for (const l of [...pipes, ...fittings]) {
    if (!l.price || (l.price.material === 0 && l.price.labor === 0)) {
      issues.push({ kind: 'noPrice', target: { kind: 'price', id: l.key }, message: `${lineName(l)} の単価が未登録です` });
    } else if (l.priceSource === 'catalog' && l.price.labor === 0) {
      issues.push({ kind: 'noPrice', target: { kind: 'price', id: l.key }, message: `${lineName(l)} は材料に参考単価を使用中です。施工単価が未登録です` });
    }
  }

  // --- 見積の行 ---
  const lines: QuoteLine[] = [];
  for (const p of pipes) lines.push({ section: 'material', name: p.name, spec: pipeSpec(p), quantity: p.orderQty, unit: p.orderUnit, unitPrice: p.price?.material ?? 0, amount: p.materialAmount, priceKey: p.key });
  for (const f of fittings) lines.push({ section: 'material', name: f.name, spec: fittingSpec(f), quantity: f.count, unit: '個', unitPrice: f.price?.material ?? 0, amount: f.materialAmount, priceKey: f.key });
  for (const l of [...supports, ...consumables]) lines.push({ section: 'material', name: l.name, spec: l.spec, quantity: l.count, unit: l.unit, unitPrice: l.price?.material ?? 0, amount: l.materialAmount, priceKey: l.key });
  for (const p of pipes) lines.push({ section: 'labor', name: `${p.name} 施工`, spec: pipeSpec(p), quantity: p.laborQty, unit: 'm', unitPrice: p.price?.labor ?? 0, amount: p.laborAmount, priceKey: p.key });
  for (const f of fittings) if ((f.price?.labor ?? 0) > 0) lines.push({ section: 'labor', name: `${f.name} 取付`, spec: fittingSpec(f), quantity: f.count, unit: '個', unitPrice: f.price!.labor, amount: f.laborAmount, priceKey: f.key });
  for (const l of [...supports, ...consumables]) if ((l.price?.labor ?? 0) > 0) lines.push({ section: 'labor', name: `${l.name} 取付`, spec: l.spec, quantity: l.count, unit: l.unit, unitPrice: l.price!.labor, amount: l.laborAmount, priceKey: l.key });
  for (const e of st.extras) lines.push({ section: 'extra', name: e.name, spec: '', quantity: e.quantity, unit: e.unit, unitPrice: e.unitPrice, amount: roundYen(e.quantity * e.unitPrice) });

  const sum = (sec: QuoteLine['section']) => lines.filter((l) => l.section === sec).reduce((a, l) => a + l.amount, 0);
  const materialTotal = sum('material'), laborTotal = sum('labor'), extrasTotal = sum('extra');
  const base = materialTotal + laborTotal + extrasTotal;
  const overhead = st.overhead.mode === 'rate' ? roundYen(base * st.overhead.value) : roundYen(st.overhead.value);
  const subtotal = base + overhead;
  const tax = Math.floor(Number((subtotal * st.taxRate).toFixed(6)));
  return { measures, pipes, fittings, supports, consumables, supportMarks: sup.marks, stockJointMarks, nodeFittings, lines, issues, materialTotal, laborTotal, extrasTotal, overhead, subtotal, tax, total: subtotal + tax };
}

const spacingNote = (st: SupportSettings, d: number) => `${(d <= 80 ? st.spacingSmall : st.spacingLarge) / 1000}m`;

export const pipeSpec = (p: Pick<PipeLine, 'material' | 'diameter' | 'system'>) =>
  `${p.material ? `${p.material} ` : ''}${isWire(p.system) ? `${p.diameter}mm` : `φ${p.diameter}`}`;
export const fittingSpec = (f: Pick<FittingLine, 'material' | 'size' | 'system'>) =>
  `${SYSTEM_LABEL[f.system]} ${f.material ? `${f.material} ` : ''}${isWire(f.system) ? '' : f.size.split('×').map((d) => `φ${d}`).join('×')}`.trim();
const lineName = (l: PipeLine | FittingLine) => ('diameter' in l ? `${l.name} ${pipeSpec(l)}` : `${l.name}（${fittingSpec(l)}）`);
export const priceLineName = lineName;

/** 長さの表示（端末設定の m/mm） */
export const formatLength = (mm: number, unit: 'mm' | 'm') => (unit === 'm' ? `${roundTo(mm / 1000, 2).toFixed(2)}m` : `${Math.round(mm)}mm`);
