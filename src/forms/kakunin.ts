/**
 * 建築確認の書類（確認申請書 第二号様式・確認済証 第十五号様式。全国共通）の文字から、
 * 給水・下水・道路の申請書に写す値を読む。純粋関数（PDF の文字は src/import/pdfText.ts で行にする）。
 * スキャンした PDF（文字が無い）は何も読めない。読めた値は「空欄の項目にだけ」入れる（applyKakunin）。
 */
import type { ApplicationValues } from './types';

export type KakuninInfo = Partial<Record<
  | 'ownerName' | 'ownerKana' | 'ownerZip' | 'ownerAddress' | 'ownerTel'
  | 'siteAddress' | 'confirmNo' | 'confirmDate' | 'totalArea' | 'floorsAbove' | 'floorsBelow'
  | 'structure' | 'use' | 'workKind' | 'roadWidth' | 'workStart' | 'workEnd', string>>;

/** 全角英数・半角カナ・㎡ などを揃え、空白の続きを 1 つにする */
const norm = (s: string) => s.normalize('NFKC').replace(/【/g, '〔').replace(/】/g, '〕').replace(/\s+/g, ' ').trim();
const KIND = /(新築|増築|改築|移転|用途変更|大規模の修繕|大規模の模様替)/;

/** 「令和 8 年 12 月 01 日」→ 2026-12-01 */
export function reiwaToIso(s: string): string | undefined {
  const m = /令和\s*(\d+)\s*年\s*(\d+)\s*月\s*(\d+)\s*日/.exec(s);
  if (!m) return undefined;
  const p = (n: string) => n.padStart(2, '0');
  return `${2018 + Number(m[1])}-${p(m[2])}-${p(m[3])}`;
}

export function parseKakunin(raw: string[]): KakuninInfo {
  const lines = raw.map(norm).filter(Boolean);
  const out: KakuninInfo = {};
  const set = (k: keyof KakuninInfo, v: string | undefined) => { const t = v?.trim(); if (t && out[k] === undefined) out[k] = t; };
  const first = (re: RegExp, from = 0, to = lines.length) => { for (let i = from; i < to; i++) { const m = re.exec(lines[i]); if (m) return m[1]; } return undefined; };

  // 建築主（第二面「1.建築主」から「2.代理者」まで。代理者・設計者の氏名と取り違えない）
  const s0 = lines.findIndex((l) => /^〔1\.建築主〕/.test(l));
  if (s0 >= 0) {
    let s1 = lines.findIndex((l, i) => i > s0 && /^〔2\./.test(l));
    if (s1 < 0) s1 = Math.min(lines.length, s0 + 8);
    set('ownerKana', first(/フリガナ〕\s*(.+)$/, s0, s1));
    set('ownerName', first(/〔ロ\.氏 ?名〕\s*(.+)$/, s0, s1));
    set('ownerZip', first(/郵便番号〕\s*(\d{3}-?\d{4})/, s0, s1));
    set('ownerAddress', first(/〔ニ\.住 ?所〕\s*(.+)$/, s0, s1));
    set('ownerTel', first(/電話番号〕\s*([\d-]{9,})/, s0, s1));
  }
  // 確認済証: 宛名（「〇〇 様／殿」）・確認番号（「第 … 号」。漢字を含む番号も）・交付日。「確認済証」の行より後ろだけを見る
  const z = lines.findIndex((l) => /^確認済証$/.test(l.replace(/ /g, '')));
  if (z >= 0) {
    const to = Math.min(lines.length, z + 12);
    set('ownerName', first(/^(.+?) ?[様殿]$/, z + 1, to));
    const n = lines.findIndex((l, i) => i > z && i < to && /^第 ?\S*\d\S* ?号$/.test(l));
    if (n >= 0) {
      set('confirmNo', /^第 ?(.+?) ?号$/.exec(lines[n])?.[1]);
      for (let i = n + 1; i < Math.min(lines.length, n + 3); i++) { const d = reiwaToIso(lines[i]); if (d) { set('confirmDate', d); break; } }
    }
  }
  set('siteAddress', first(/地名地番〕\s*(.+)$/) ?? first(/建築場所、設置場所、\s*(.+)$/));
  set('totalArea', first(/延べ面積(?:〕|\(申請部分\))\s*([\d,]+\.\d+)\s*m2/)?.replace(/,/g, ''));
  set('floorsAbove', first(/地階を除く階数〕?\s*(\d+)\s*階/));
  set('floorsBelow', first(/地階の階数〕?\s*(\d+)\s*階/));
  set('structure', (first(/〔[4ハ]\.構 ?造〕\s*(\S+)/) ?? first(/主たる建築物の構造\s*(\S+)/))?.replace(/\(.*$/, ''));
  set('use', first(/主要用途.*?\d{5}:(\S+)/));
  const k = lines.findIndex((l) => /工事種別/.test(l));
  if (k >= 0) set('workKind', KIND.exec(lines[k].replace(/^.*工事種別〕?/, ''))?.[1] ?? first(/■ ?(新築|増築|改築|移転|用途変更|大規模の修繕|大規模の模様替)/, k + 1, k + 3));
  set('roadWidth', first(/〔イ\.幅 ?員〕\s*([\d.]+)\s*m/));
  const ws = first(/工事着手予定年月日〕\s*(令和.+)$/), we = first(/工事完了予定年月日〕\s*(令和.+)$/);
  set('workStart', ws ? reiwaToIso(ws) : undefined);
  set('workEnd', we ? reiwaToIso(we) : undefined);
  return out;
}

/** candidates のうち、current にキーが無い（＝まだ触っていない）項目だけ入れる */
export function applyKakunin(candidates: ApplicationValues, current: ApplicationValues): { values: ApplicationValues; filled: string[] } {
  const values = { ...current };
  const filled: string[] = [];
  for (const [k, v] of Object.entries(candidates)) {
    if (!v || k in current) continue;
    values[k] = v;
    filled.push(k);
  }
  return { values, filled };
}

/** 構造の名前を沖縄市の様式の選択肢（木・鉄筋コンクリート・鉄骨・コンクリートブロック・その他）に */
export function structureChoice(s: string | undefined): string | undefined {
  if (!s) return undefined;
  if (/木/.test(s)) return '木';
  if (/鉄骨鉄筋|鉄筋コンクリート|RC/.test(s)) return '鉄筋コンクリート';
  if (/鉄骨|S造/.test(s)) return '鉄骨';
  if (/ブロック/.test(s)) return 'コンクリートブロック';
  return 'その他';
}

/** 道路の手続きに写す値（幅員） */
export const roadFromKakunin = (k: KakuninInfo): ApplicationValues => (k.roadWidth ? { 'road.roadWidth': String(Number(k.roadWidth)) } : {});
