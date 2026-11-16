/**
 * 道路の申請書・届・占用内訳調書（A4 縦）。項目は国の道路占用許可申請書・道路交通法施行規則 別記様式第六に合わせた共通様式。
 * 自治体独自の様式がある所は ROAD_FORM_OVERRIDES に足す（方式 C の上書き口。今は空）。
 */
import { drawFrame, GRAY, type Sheet } from '../export/sheet';
import type { ApplicationValues } from '../forms/types';
import { applicantBlock, isoOf, jaDate, label, table, title, wrap, type RoadMeta, type Row } from './draw';
import { roadLayers, workPeriod, type Takeoff } from './model';

/** 自治体（市町村名）→ 独自様式で描く関数。届いた様式をここに足す */
export const ROAD_FORM_OVERRIDES: Record<string, { occupancy?: typeof renderOccupancyForm }> = {};

const A4 = (): Sheet => { const s: Sheet = { width: 210, height: 297, ops: [] }; drawFrame(s); return s; };
const m2 = (a: number) => (a / 1e6).toFixed(2);
const m1 = (a: number) => (a / 1000).toFixed(2);
const X = 20, LW = 36, VW = 134;

function purpose(t: Takeoff[]): string {
  if (!t.length) return '';
  return `${t.map((x) => x.label).join('・')}の埋設（宅地への引込み）のため`;
}
function place(v: ApplicationValues): string {
  const side = v['road.sidewalk'] === '有り' ? '車道・歩道' : '車道';
  return [v['road.routeName'] && `路線名: ${v['road.routeName']}`, v['road.place'] && `場所: ${v['road.place']}`, `（${side}）`].filter(Boolean).join('　');
}
function period(v: ApplicationValues): string {
  const p = workPeriod(v);
  return p.from ? `${jaDate(p.from)} から ${jaDate(p.to)} まで（${p.days}日間）` : `${jaDate(undefined)} から ${jaDate(undefined)} まで`;
}
const layersText = (v: ApplicationValues, ph: 'temp' | 'final') => roadLayers(v, ph).map((l) => `${l.name} ${l.t}mm`).join('、');

function head(s: Sheet, name: string, to: string, m: RoadMeta, toDefault: string): number {
  title(s, name);
  s.ops.push({ t: 'text', x: 190, y: 42, s: jaDate(isoOf(m.date)), size: 3.2, anchor: 'end' });
  label(s, X, 52, `${to || toDefault}　殿`, 3.6, 100);
  return 62;
}

export function renderOccupancyForm(v: ApplicationValues, t: Takeoff[], m: RoadMeta): Sheet {
  const s = A4();
  s.ops.push({ t: 'text', x: 190, y: 18, s: '新規', size: 2.8, anchor: 'end', color: GRAY });
  let y = head(s, '道路占用許可申請書', v['road.roadAdmin'], m, '（道路管理者）');
  y = applicantBlock(s, y, v) + 4;
  s.ops.push({ t: 'text', x: X, y, s: '道路法第32条の規定により、許可を申請します。', size: 3.2 });
  y += 5;
  const rows: Row[] = [
    { label: '占用の目的', value: purpose(t) },
    { label: '占用の場所', value: place(v), lines: 2 },
    { label: '占用物件', value: t.map((x) => `${x.label}　${x.pipe || '（管種・口径）'}　延長 ${m1(x.length)} m`).join('\n') || '　', lines: Math.max(1, t.length) },
    { label: '占用の期間', value: v['road.period'] ?? '' },
    { label: '占用物件の構造', value: t.map((x) => `${x.label}: 本管${x.main ? `（${x.main}）` : ''}から分岐、埋設深さ ${x.depth ? m1(x.depth) : '　　'} m（土かぶり）`).join('\n') || '　', lines: Math.max(1, t.length) },
    { label: '工事の期間', value: period(v) },
    { label: '工事実施の方法', value: `開削工法（舗装切断 → 掘削 → 分岐・布設 → 埋戻し → 仮復旧 → 本復旧）。交通規制: ${v['road.traffic'] || '　'}、作業時間 ${v['road.hours'] || '　'}`, lines: 2 },
    { label: '道路の復旧方法', value: `占用者復旧。仮復旧: ${layersText(v, 'temp')}\n本復旧: ${layersText(v, 'final')}`, lines: 3 },
    { label: '添付書類', value: '位置図、平面図、横断図・復旧断面図、交通規制図、工程表、占用内訳調書、現況写真', lines: 2 },
    { label: '施工業者', value: [v['road.applicantName'], v['road.applicantTel'] && `TEL ${v['road.applicantTel']}`].filter(Boolean).join('　') },
    { label: '備考', value: '', lines: 2 },
  ];
  y = table(s, X, y, LW, VW, rows);
  wrap('※ 占用の期間・復旧の方法は道路管理者の指定に合わせてください。', 2.6, 170, 2).forEach((l, i) => s.ops.push({ t: 'text', x: X, y: y + 5 + i * 3.8, s: l, size: 2.6, color: GRAY }));
  return s;
}

export function renderUseForm(v: ApplicationValues, m: RoadMeta): Sheet {
  const s = A4();
  s.ops.push({ t: 'text', x: 190, y: 18, s: '別記様式第六（第十条関係）', size: 2.8, anchor: 'end', color: GRAY });
  let y = head(s, '道路使用許可申請書', v['road.police'], m, '　　　　警察署長');
  y = applicantBlock(s, y, v) + 4;
  const what = [v['road.water'] === 'する' ? '給水管' : '', v['road.sewer'] === 'する' ? '下水道取付管' : ''].filter(Boolean).join('・');
  const p = workPeriod(v);
  const rows: Row[] = [
    { label: '道路使用の目的', value: what ? `${what}の埋設工事` : '' },
    { label: '場所又は区間', value: place(v), lines: 2 },
    { label: '期間', value: `${p.from ? `${jaDate(p.from)} から ${jaDate(p.to)} まで` : `${jaDate(undefined)} から ${jaDate(undefined)} まで`}（毎日 ${v['road.hours'] || '　時から　時まで'}）`, lines: 2 },
    { label: '方法又は形態', value: `開削工事。${v['road.traffic'] || '　'}、交通誘導員 ${v['road.guards'] || '　'} 人。使用の範囲は交通規制図のとおり`, lines: 2 },
    { label: '添付書類', value: '位置図、交通規制図、工程表' },
    { label: '現場責任者 住所', value: v['road.applicantAddress'] ?? '', lines: 2 },
    { label: '現場責任者 氏名', value: v['road.siteManager'] ?? '' },
    { label: '現場責任者 電話', value: v['road.siteManagerTel'] ?? '' },
  ];
  y = table(s, X, y, LW, VW, rows) + 8;
  // 許可証の欄（警察が書く）
  s.ops.push({ t: 'rect', x: X, y, w: LW + VW, h: 46, lw: 0.3 });
  s.ops.push({ t: 'text', x: X + 3, y: y + 6, s: '第　　　　　号', size: 3.2 });
  s.ops.push({ t: 'text', x: 105, y: y + 12, s: '道 路 使 用 許 可 証', size: 4.2, anchor: 'middle', bold: true });
  s.ops.push({ t: 'text', x: X + 3, y: y + 20, s: '上記のとおり許可する。ただし、次の条件に従うこと。', size: 3.2 });
  s.ops.push({ t: 'text', x: X + 3, y: y + 28, s: '条件', size: 3.2 });
  s.ops.push({ t: 'text', x: 150, y: y + 40, s: '年　　月　　日', size: 3.2, anchor: 'end' });
  s.ops.push({ t: 'text', x: 186, y: y + 40, s: '警察署長　印', size: 3.2, anchor: 'end' });
  wrap('備考　申請者が法人であるときは、名称・主たる事務所の所在地・代表者の氏名を書く。方法又は形態の欄には、工事の方法・使用面積など使用について必要な事項を書く。', 2.6, 170, 3).forEach((l, i) => s.ops.push({ t: 'text', x: X, y: y + 52 + i * 3.8, s: l, size: 2.6, color: GRAY }));
  return s;
}

/** 着手届・完了届 */
export function renderNoticeForms(v: ApplicationValues, m: RoadMeta): Sheet[] {
  const p = workPeriod(v);
  return (['着手', '完了'] as const).map((kind) => {
    const s = A4();
    let y = head(s, `工事${kind}届`, v['road.roadAdmin'], m, '（道路管理者）');
    y = applicantBlock(s, y, v, '届出者') + 4;
    wrap(`${jaDate(undefined)}付け　第　　　　号で許可を受けた道路占用の工事を、次のとおり${kind === '着手' ? '着手します' : '完了しました'}ので届け出ます。`, 3.2, 170, 2).forEach((l, i) => s.ops.push({ t: 'text', x: X, y: y + i * 4.8, s: l, size: 3.2 }));
    y += 12;
    const rows: Row[] = [
      { label: '許可番号', value: '第　　　　号' },
      { label: '占用の場所', value: place(v), lines: 2 },
      { label: '占用物件', value: [v['road.water'] === 'する' ? '給水管' : '', v['road.sewer'] === 'する' ? '下水道取付管' : ''].filter(Boolean).join('・') },
      { label: kind === '着手' ? '着手年月日' : '完了年月日', value: kind === '着手' ? jaDate(p.from) : jaDate(p.to) },
      { label: '工事の期間', value: period(v) },
      { label: '現場責任者', value: [v['road.siteManager'], v['road.siteManagerTel'] && `携帯 ${v['road.siteManagerTel']}`].filter(Boolean).join('　') },
      { label: '添付書類', value: kind === '着手' ? '占用許可書の写し、道路使用許可書の写し、工程表' : '完成写真（着工前・施工中・完成）', lines: 2 },
      { label: '備考', value: '', lines: 2 },
    ];
    table(s, X, y, LW, VW, rows);
    return s;
  });
}

/** 外径の代表値（mm）。製品で違うので表では「代表値」と書く */
const OUTER: Record<string, Record<number, number>> = {
  VP: { 13: 18, 20: 26, 25: 32, 30: 38, 40: 48, 50: 60, 75: 89, 100: 114 },
  HIVP: { 13: 18, 20: 26, 25: 32, 30: 38, 40: 48, 50: 60, 75: 89, 100: 114 },
  VU: { 100: 114, 125: 140, 150: 165, 200: 216 },
  PE: { 13: 21.5, 20: 27, 25: 34, 30: 42, 40: 48, 50: 60 },
};
export function outerDia(t: Takeoff): number | undefined {
  const key = Object.keys(OUTER).find((k) => t.pipe.toUpperCase().startsWith(k));
  return key ? OUTER[key][t.dia] : undefined;
}

export function renderTakeoffTable(t: Takeoff[], v: ApplicationValues, m: RoadMeta): Sheet {
  const s = A4();
  title(s, '占用内訳調書');
  s.ops.push({ t: 'text', x: 190, y: 42, s: jaDate(isoOf(m.date)), size: 3.2, anchor: 'end' });
  label(s, X, 48, `路線名: ${v['road.routeName'] || '（未入力）'}`, 3.2, 170);
  label(s, X, 54, `場所: ${v['road.place'] || m.address || '（未入力）'}`, 3.2, 170);
  const cols = [{ w: 10, h: 'No' }, { w: 28, h: '物件名' }, { w: 26, h: '管種・口径' }, { w: 16, h: '外径 mm' }, { w: 16, h: '延長 m' }, { w: 16, h: '掘削幅 m' }, { w: 20, h: '掘削面積 ㎡' }, { w: 20, h: '復旧面積 ㎡' }, { w: 18, h: '深さ m' }];
  const top = 62, hh = 9, rh = 8, n = Math.max(6, t.length + 1);
  const W = cols.reduce((a, c) => a + c.w, 0);
  s.ops.push({ t: 'rect', x: X, y: top, w: W, h: hh + rh * n, lw: 0.4 });
  s.ops.push({ t: 'line', x1: X, y1: top + hh, x2: X + W, y2: top + hh, w: 0.4 });
  let cx = X;
  cols.forEach((c, i) => {
    if (i) s.ops.push({ t: 'line', x1: cx, y1: top, x2: cx, y2: top + hh + rh * n, w: 0.25 });
    const ls = wrap(c.h, 2.6, c.w - 1.5, 2);
    ls.forEach((l, k) => s.ops.push({ t: 'text', x: cx + c.w / 2, y: top + (ls.length === 1 ? 5.6 : 3.8 + 3.4 * k), s: l, size: 2.6, anchor: 'middle' }));
    cx += c.w;
  });
  for (let r = 1; r < n; r++) s.ops.push({ t: 'line', x1: X, y1: top + hh + rh * r, x2: X + W, y2: top + hh + rh * r, w: 0.2 });
  const put = (row: string[], r: number, bold = false) => {
    let x = X;
    row.forEach((val, i) => { label(s, i <= 2 ? x + 1.5 : x + cols[i].w - 1.5, top + hh + rh * r + 5.3, val, 2.9, cols[i].w - 3, { anchor: i <= 2 ? 'start' : 'end', bold }); x += cols[i].w; });
  };
  t.forEach((x, r) => put([String(r + 1), x.label, x.pipe, outerDia(x)?.toString() ?? '', m1(x.length), m1(x.width), m2(x.digArea), m2(x.restoreArea), x.depth ? m1(x.depth) : ''], r));
  if (t.length) put(['', '合計', '', '', m1(t.reduce((a, x) => a + x.length, 0)), '', m2(t.reduce((a, x) => a + x.digArea, 0)), m2(t.reduce((a, x) => a + x.restoreArea, 0)), ''], n - 1, true);
  const ny = top + hh + rh * n + 6;
  ['※ 外径は代表値です。使う製品の外径を確かめてください（占用料は外径で決まることがあります）。', '※ 延長は官民境界から本管までの道路の中の長さです。'].forEach((l, i) => s.ops.push({ t: 'text', x: X, y: ny + i * 4.2, s: l, size: 2.6, color: GRAY }));
  return s;
}
