/**
 * 出力用の表データ（PDF・Excel 共通）。数量表から見積書への転記を不要にするため、
 * すべて computeEstimate の結果から作る。
 */
import type { Doc } from '../model/doc';
import {
  computeEstimate, defaultEstimate, fittingSpec, pipeSpec, roundTo, saleUnitLabel, SYSTEM_LABEL,
  type Estimate, type EstimateSettings,
} from '../model/estimate';


export type ReportMeta = { name: string; address?: string; date: Date };
export type Cell = string | number;
export type Table = { title: string; head: string[]; rows: Cell[][]; numeric: boolean[] };

export type Report = {
  meta: ReportMeta;
  settings: EstimateSettings;
  est: Estimate;
  quote: { section: string; rows: Cell[][] }[];
  totals: [string, number][];
  tables: Table[];
  segments: Table;
  issues: Table;
};

export const yen = (n: number) => `${n < 0 ? '-' : ''}¥${Math.abs(n).toLocaleString('ja-JP')}`;
export const m2 = (mm: number) => roundTo(mm / 1000, 2);
export const dateJa = (d: Date) => `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`;
export const dateStamp = (d: Date) => `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
const pct = (r: number) => `${roundTo(r * 100, 1)}%`;

const SECTION: Record<string, string> = { material: '材料費', labor: '施工費', extra: 'その他' };

export function buildReport(doc: Doc, meta: ReportMeta): Report {
  const settings = doc.estimate ?? defaultEstimate();
  const est = computeEstimate(doc);
  const quote = (['material', 'labor', 'extra'] as const)
    .map((sec) => ({ section: SECTION[sec], rows: est.lines.filter((l) => l.section === sec).map((l) => [l.name, l.spec, l.quantity, l.unit, l.unitPrice, l.amount] as Cell[]) }))
    .filter((s) => s.rows.length > 0);
  const totals: [string, number][] = [
    ['材料費 計', est.materialTotal], ['施工費 計', est.laborTotal],
    ...(est.extrasTotal ? [['その他 計', est.extrasTotal] as [string, number]] : []),
    [settings.overhead.mode === 'rate' ? `諸経費（${pct(settings.overhead.value)}）` : '諸経費', est.overhead],
    ['小計', est.subtotal], [`消費税（${pct(settings.taxRate)}）`, est.tax], ['合計', est.total],
  ];

  const quantities: Table = {
    title: '配管・配線 数量表',
    head: ['種類', '仕様', '使用長(m)', '計測', '余長込み(m)', '販売単位', '発注数量', '施工数量(m)'],
    numeric: [false, false, true, false, true, false, true, true],
    rows: est.pipes.map((p) => [
      p.name, pipeSpec(p), m2(p.usedLength),
      p.fieldCount && p.modelCount ? `実測${p.fieldCount}・モデル${p.modelCount}` : p.fieldCount ? '実測' : 'モデル',
      m2(p.needLength), saleUnitLabel(p.saleUnit), `${p.orderQty}${p.orderUnit}`, p.laborQty,
    ]),
  };
  const fittings: Table = {
    title: '接続部品一覧',
    head: ['部品', '仕様', '個数', '備考'],
    numeric: [false, false, true, false],
    rows: est.fittings.map((f) => [f.name, fittingSpec(f), f.count, f.stockJoints ? `定尺の継ぎ足し ${f.stockJoints}個を含む` : '']),
  };
  const supportsT: Table = {
    title: '支持金具・ビス・消耗品',
    head: ['品名', '仕様', '数量', '単位', '備考'],
    numeric: [false, false, true, false, false],
    rows: [...est.supports, ...est.consumables].map((l) => [l.name, l.spec, l.count, l.unit, l.note]),
  };
  const confirm = new Set(est.nodeFittings.filter((n) => n.needsConfirm).map((n) => n.nodeId));
  if (confirm.size) fittings.rows.push(['（要確認の点）', '', confirm.size, '部品を確定してください']);

  const segments: Table = {
    title: '区間明細',
    head: ['区間', '種類', '仕様', 'モデル長(mm)', '実測長(mm)', '使用長(mm)', '計測方式', '余長率', '警告'],
    numeric: [false, false, false, true, true, true, false, false, false],
    rows: Object.values(doc.network.segments).map((s, i) => {
      const m = est.measures[s.id];
      return [
        i + 1, SYSTEM_LABEL[s.system], pipeSpec({ material: s.material ?? '', diameter: s.diameter, system: s.system }),
        Math.round(m.modelLength), s.measuredLength === undefined ? '' : Math.round(s.measuredLength), Math.round(m.usedLength),
        m.method === 'field' ? (m.approx ? '現場実測（按分）' : '現場実測') : '3Dモデル', pct(m.extraRate), m.warning ?? '',
      ];
    }),
  };
  const issues: Table = {
    title: '要確認',
    head: ['種類', '内容'],
    numeric: [false, false],
    rows: est.issues.map((i) => [ISSUE_LABEL[i.kind], i.message]),
  };
  return { meta, settings, est, quote, totals, tables: [quantities, fittings, supportsT], segments, issues };
}

export const ISSUE_LABEL = { confirmFitting: '部品の確定', lengthDiff: '長さの差', approx: '概算の実測長', noPrice: '単価未登録', obstacle: '部材とのぶつかり', sleeve: '貫通（スリーブ）' } as const;
export const DISCLAIMER = '本書は積算支援ツールによる集計です。施工図・法令適合・耐圧・流量・電気容量などは施工前に専門的な確認を行ってください。';

