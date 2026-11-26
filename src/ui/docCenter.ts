/**
 * 提出書類の一覧（書類センター）: この工事で出す書類と、いまの状態（出力できる・確認が必要・作れない）を決める純粋関数。
 * 「出力できます」と言うのは、必須の項目が入り、注意が 1 件も無いときだけ。未確認の値・未登録の様式を正しいものとして扱わない。
 */
import type { ApplicationValues, Contractor, FormSet } from '../forms/types';

export type DocId = 'water' | 'sewer' | 'products' | 'nanbu' | 'nanbuProducts' | 'haebaruSewer' | 'road' | 'drawings' | 'unregistered';
export type DocStatus = 'ready' | 'check' | 'blocked';
export type DocRow = {
  id: DocId; label: string; format: 'PDF' | 'Excel'; status: DocStatus;
  /** 確認が必要・作れない理由（使う人の言葉で、直し方が分かるように） */
  reasons: string[];
  /** 直す場所: 申請書の入力・道路の手続き・申請図面 */
  fixAt?: 'forms' | 'road' | 'drawings';
};
/** 申請図面 1 種類の状態（まとめてPDF の一覧と同じ判定） */
export type DrawingState = { label: string; ready: boolean; picked: boolean; warnings: number; text: string };

export type DocCenterInput = {
  set: FormSet | undefined; profileName: string;
  values: ApplicationValues; contractor: Contractor;
  hasSupply: boolean; hasDrain: boolean;
  /** 道路の手続きで「する」にした取出しの数 */
  roadCount: number;
  /** 取出しを「する／しない」を使う人が選んだか（選んでいなければ初期値のままなので確認を促す） */
  roadConfirmed: boolean;
  /** 道路の書類の注意（未入力の提出先・着工日など） */
  roadWarnings: string[];
  /** 製品一覧表に載る行の数 */
  productCount: number;
  /** まだ答えていない確認の質問の数 */
  openQuestions?: number;
  /** 様式ごとの注意（南部水道企業団の nanbuWarnings など） */
  formWarnings: string[];
  drawings: DrawingState[];
  /** 検査の結果（排水の勾配不足・水圧不足・つなぎ忘れ。src/ui/inspection.ts）。関係する書類の理由に並べる */
  inspection?: { drain: string[]; supply: string[] };
};

/** 必須の項目: 様式にその項目があるときだけ調べる（どれかが入っていればよい） */
const REQUIRED: { ids: string[]; label: string }[] = [
  { ids: ['siteAddress'], label: '設置場所' },
  { ids: ['applicantName', 'ownerName'], label: '申込者の氏名' },
  { ids: ['applicantAddress', 'ownerAddress'], label: '申込者の住所' },
];

function commonReasons(i: DocCenterInput): string[] {
  const out: string[] = [];
  if (i.openQuestions) out.push(`確認の質問が ${i.openQuestions} 件 残っています（この一覧のいちばん上で答えられます）`);
  if (!i.contractor.name.trim()) out.push(NO_CONTRACTOR);
  const has = new Set((i.set?.fields ?? []).map((f) => f.id));
  for (const r of REQUIRED) {
    const ids = r.ids.filter((id) => has.has(id));
    if (ids.length && !ids.some((id) => (i.values[id] ?? '').trim())) out.push(`${r.label}が未入力です`);
  }
  const unverified = (i.set?.fields ?? []).filter((f) => f.unverified && (i.values[f.id] ?? '').trim()).map((f) => f.label);
  if (unverified.length) out.push(`${unverified.join('・')}は実例から取った値です。自治体に確認してください`);
  return out;
}

const NO_CONTRACTOR = '工事店の情報が未入力です（申請書の「工事店の情報」で入れると、全部の書類に入ります）';
const NO_SUPPLY = '給水の配管が無いため、図の欄は空欄になります';
const NO_DRAIN = '排水の配管が無いため、図の欄は空欄になります';
const NO_PRODUCTS = '載せる製品がありません（給水の配管・器具を置くと入ります）';
const form = (id: DocId, label: string, format: DocRow['format'], reasons: string[]): DocRow => ({ id, label, format, reasons, status: reasons.length ? 'check' : 'ready', fixAt: 'forms' });

export function docRows(i: DocCenterInput): DocRow[] {
  const rows: DocRow[] = [];
  const common = commonReasons(i);
  const set = i.set;
  const drainChk = i.inspection?.drain ?? [];
  const supplyChk = i.inspection?.supply ?? [];
  const products = [...(i.contractor.name.trim() ? [] : [NO_CONTRACTOR]), ...(i.productCount > 0 ? [] : [NO_PRODUCTS])];
  if (!set) {
    rows.push({ id: 'unregistered', label: '給水・下水道の申請書', format: 'PDF', status: 'blocked', reasons: [`「${i.profileName}」の申請書の様式はまだ登録していません。窓口の様式を使ってください（図面と道路の書類は作れます）`] });
  } else if (set.water === 'nanbu') {
    rows.push(form('nanbu', '給水申請書類一式', 'PDF', [...common, ...i.formWarnings, ...(i.hasSupply ? [] : [NO_SUPPLY]), ...supplyChk]));
    rows.push(form('nanbuProducts', '給水装置使用製品一覧表', 'PDF', products));
    if (set.sewer === 'haebaru') rows.push(form('haebaruSewer', '排水設備計画確認申請書', 'PDF', [...common, ...(i.hasDrain ? [] : [NO_DRAIN]), ...drainChk]));
  } else {
    rows.push(form('water', '給水装置申込及び工事申請書', 'Excel', [...common, ...i.formWarnings, ...(i.hasSupply ? [] : [NO_SUPPLY]), ...supplyChk]));
    rows.push(form('sewer', '下水道排水設備計画確認申請書', 'PDF', [...common, ...(i.hasDrain ? [] : [NO_DRAIN]), ...drainChk]));
    rows.push(form('products', '給水装置使用製品一覧表', 'PDF', products));
  }
  if (i.roadCount > 0) {
    const reasons = [
      ...(i.roadConfirmed ? [] : ['本管からの取出し（道路を掘る工事）をするかどうかが、まだ選ばれていません。「道路の手続き」で確かめてください']),
      ...(i.contractor.name.trim() ? [] : [NO_CONTRACTOR]),
      ...i.roadWarnings,
    ];
    rows.push({ id: 'road', label: '道路の申請書類一式', format: 'PDF', status: reasons.length ? 'check' : 'ready', reasons, fixAt: 'road' });
  }

  const picked = i.drawings.filter((d) => d.ready && d.picked);
  const reasons = i.drawings.filter((d) => !d.ready || !d.picked || d.warnings > 0).map((d) => `${d.label}: ${d.text}`).concat(drainChk, supplyChk);
  rows.push({ id: 'drawings', label: `申請図面一式（${picked.length} 種類）`, format: 'PDF', status: picked.length === 0 ? 'blocked' : reasons.length ? 'check' : 'ready', reasons, fixAt: 'drawings' });
  return rows;
}

export function statusText(r: DocRow): string {
  if (r.status === 'ready') return '✓ 出力できます';
  if (r.status === 'check') return `⚠ 確認が必要（${r.reasons.length} 件）。このままでも出せます`;
  return '作れません';
}

/** まとめて保存する書類の中に、確認が必要なものがあるときの一言（無ければ空） */
export function checkSummary(chosen: DocRow[]): string {
  const c = chosen.filter((r) => r.status === 'check');
  return c.length ? `確認が必要な書類が ${c.length} 種類 入っています（${c.map((r) => r.label).join('・')}）。提出の前に、理由の所を確かめてください` : '';
}
