/**
 * 沖縄市「下水道排水設備計画確認申請書」（様式第1号、PDF 4 面 = A3 両面）に値を重ねる。
 * 1 面: 申請書（文字と、選択肢の番号を囲む円）
 * 2 面「平面図及び縦断面図」: 排水の縦断図（Sheet）を縮小して載せる
 * 3 面「配管立図」: 排水の立面図（展開図、アイソメ）を載せる
 * 4 面「見取図」: 空のまま（案内図を貼る）
 * 座標は pdftotext -bbox で様式から取った pt（上端基準）。様式が更新されたら POS を直す。
 */
import { PDFDocument, rgb, type PDFFont, type PDFPage } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import { drawSheetOnPage, fontSafe, type PdfOpts, type Sheet } from '../export/sheet';
import { SEWER_BUILDING_USES, SEWER_CONNECTIONS, SEWER_WORK_KINDS, WATER_SOURCES } from './okinawaCity';
import { reiwa, type ApplicationValues, type Contractor } from './types';

const SIZE = 9;
const INK = rgb(0.1, 0.1, 0.1);

/** 文字の左下 x と行の上端 y（pt、上端基準）。行の上端 + 9 をベースラインにする */
type Pos = { x?: number; y: number; size?: number; right?: number };
const POS = {
  dateY: 95, dateX: { y: 470, m: 512, d: 545 },
  applicantAddress: { x: 410, y: 117 }, applicantKana: { x: 410, y: 131 }, applicantName: { x: 410, y: 146 }, applicantTel: { x: 440, y: 160 },
  siteAddress: { x: 212, y: 216 },
  obligorAddress: { x: 205, y: 260 }, obligorName: { x: 205, y: 278 },
  waterSourceOther: { x: 468, y: 322 },
  sewerBuildingUseOther: { x: 388, y: 354 },
  sewerBuildingUseNote: { x: 472, y: 381, size: 8 },
  households: { x: 262, y: 429 }, people: { x: 324, y: 429 }, apartmentHouseholds: { x: 464, y: 429 }, apartmentPeople: { x: 524, y: 429 },
  workY: 459, workFrom: { y: 200, m: 250, d: 288 }, workTo: { y: 358, m: 408, d: 445 }, workDays: 500,
  sewerLicenseNo: { x: 270, y: 479 }, contractorAddress: { x: 270, y: 492 }, contractorNameTel: { x: 270, y: 506 }, representative: { x: 270, y: 519 },
  drainageEngineerNo: { x: 270, y: 535 }, drainageEngineer: { x: 270, y: 549 },
  pretreatmentNote: { x: 447, y: 568, size: 8 },
  /** 選択肢の番号の x 範囲（中心を円で囲む） */
  circles: {
    sewerConnection: { y: 239, xs: [175, 254, 375, 464] },
    sewerWorkKind: { y: 298, xs: [175, 254, 343, 411, 467, 527] },
    waterSource: { y: 322, xs: [175, 254, 343, 411] },
    sewerBuildingUse: { y: 340, xs: [175, 254, 343, 411, 469], y2: 354, xs2: [175, 254, 333] },
    lending: { y: 568, xs: { 有り: 199, 無し: 262 } as Record<string, number> },
    pretreatment: { y: 568, xs: { 有り: 428, 無し: 543 } as Record<string, number> },
  },
  /** 2・3 面の図面欄（見出しの下） */
  drawingBox: { x: 36, top: 58, w: 494, h: 706 },
} as const;

let missingChars: Set<string> | undefined;
const text = (page: PDFPage, font: PDFFont, raw: string, p: Pos) => {
  if (!raw) return;
  const s = fontSafe(font, raw, missingChars);
  const size = p.size ?? SIZE;
  const w = font.widthOfTextAtSize(s, size);
  const x = p.right !== undefined ? p.right - w : (p.x ?? 0);
  page.drawText(s, { x, y: page.getHeight() - (p.y + 9), size, font, color: INK });
};
const circle = (page: PDFPage, cx: number, cy: number, r = 7) => page.drawCircle({ x: cx, y: page.getHeight() - cy, size: r, borderColor: INK, borderWidth: 0.8, opacity: 0 });

export function fillSewerPage1(page: PDFPage, font: PDFFont, v: ApplicationValues, c: Contractor): void {
  const d = reiwa(v.date ?? '');
  if (d) { text(page, font, String(d.year), { right: POS.dateX.y + 20, y: POS.dateY }); text(page, font, String(d.month), { right: POS.dateX.m + 10, y: POS.dateY }); text(page, font, String(d.day), { right: POS.dateX.d + 10, y: POS.dateY }); }
  text(page, font, v.applicantAddress ?? '', POS.applicantAddress);
  text(page, font, v.applicantKana ?? '', POS.applicantKana);
  text(page, font, v.applicantName ?? '', POS.applicantName);
  text(page, font, v.applicantTel ?? '', POS.applicantTel);
  text(page, font, (v.siteAddress ?? '').replace(/^沖縄市/, ''), POS.siteAddress);
  // 義務者は項目ごとに申請者で補う（氏名だけ・住所だけの入力でも使う）
  const obligorName = v.obligorName || v.applicantName || '';
  const obligorAddress = v.obligorAddress || v.applicantAddress || '';
  text(page, font, obligorAddress, POS.obligorAddress);
  text(page, font, obligorName, POS.obligorName);

  const pick = (opts: readonly string[], val: string | undefined) => opts.indexOf(val ?? '');
  const ci = pick(SEWER_CONNECTIONS, v.sewerConnection); if (ci >= 0) circle(page, POS.circles.sewerConnection.xs[ci], POS.circles.sewerConnection.y + 5);
  const wi = pick(SEWER_WORK_KINDS, v.sewerWorkKind); if (wi >= 0) circle(page, POS.circles.sewerWorkKind.xs[wi], POS.circles.sewerWorkKind.y + 5);
  const si = pick(WATER_SOURCES, v.waterSource); if (si >= 0) circle(page, POS.circles.waterSource.xs[si], POS.circles.waterSource.y + 5);
  if (si === 3) text(page, font, v.waterSourceOther ?? '', POS.waterSourceOther);
  const bi = pick(SEWER_BUILDING_USES, v.sewerBuildingUse);
  if (bi >= 0 && bi < 5) circle(page, POS.circles.sewerBuildingUse.xs[bi], POS.circles.sewerBuildingUse.y + 5);
  else if (bi >= 5) circle(page, POS.circles.sewerBuildingUse.xs2[bi - 5], POS.circles.sewerBuildingUse.y2 + 5);
  if (bi === 7) text(page, font, v.sewerBuildingUseOther ?? '', POS.sewerBuildingUseOther);
  if (bi >= 2) text(page, font, v.sewerBuildingUseNote ?? '', POS.sewerBuildingUseNote);

  if (bi === 1) { text(page, font, v.apartmentHouseholds || v.households || '', POS.apartmentHouseholds); text(page, font, v.apartmentPeople || v.people || '', POS.apartmentPeople); }
  else { text(page, font, v.households ?? '', POS.households); text(page, font, v.people ?? '', POS.people); }

  const f = reiwa(v.workFrom ?? ''), t = reiwa(v.workTo ?? '');
  if (f) { text(page, font, String(f.year), { right: POS.workFrom.y + 20, y: POS.workY }); text(page, font, String(f.month), { right: POS.workFrom.m + 8, y: POS.workY }); text(page, font, String(f.day), { right: POS.workFrom.d + 8, y: POS.workY }); }
  if (t) { text(page, font, String(t.year), { right: POS.workTo.y + 20, y: POS.workY }); text(page, font, String(t.month), { right: POS.workTo.m + 8, y: POS.workY }); text(page, font, String(t.day), { right: POS.workTo.d + 8, y: POS.workY }); }
  if (f && t) {
    const days = Math.round((Date.UTC(f.year + 2018, f.month - 1, f.day) - Date.UTC(t.year + 2018, t.month - 1, t.day)) / -86400000) + 1;
    if (days > 0) text(page, font, String(days), { right: POS.workDays + 14, y: POS.workY });
  }

  text(page, font, c.sewerLicenseNo || c.licenseNo, POS.sewerLicenseNo);
  text(page, font, [c.zip ? `〒${c.zip.replace(/^〒/, '')}` : '', c.address].filter(Boolean).join(' '), POS.contractorAddress);
  text(page, font, [c.name, c.tel].filter(Boolean).join('　'), POS.contractorNameTel);
  text(page, font, c.representative, POS.representative);
  text(page, font, c.drainageEngineerNo, POS.drainageEngineerNo);
  text(page, font, c.drainageEngineer, POS.drainageEngineer);
  const lx = POS.circles.lending.xs[v.lending ?? '']; if (lx) circle(page, lx, POS.circles.lending.y + 5, 9);
  const px = POS.circles.pretreatment.xs[v.pretreatment ?? '']; if (px) circle(page, px, POS.circles.pretreatment.y + 5, 9);
  if (v.pretreatment === '有り') text(page, font, v.pretreatmentNote ?? '', POS.pretreatmentNote);
}

/**
 * 様式 PDF に値と図面を載せる。profileSheet: 縦断図（2 面）、isoSheet: 立面図（3 面）。無ければ空欄のまま
 */
export async function buildSewerApplication(template: ArrayBuffer | Uint8Array, fontBytes: ArrayBuffer | Uint8Array, v: ApplicationValues, c: Contractor, sheets: { profile?: Sheet; iso?: Sheet }, opts: PdfOpts = {}): Promise<Uint8Array> {
  const pdf = await PDFDocument.load(template);
  pdf.registerFontkit(fontkit);
  const font = await pdf.embedFont(fontBytes, { subset: false });
  const pages = pdf.getPages();
  if (pages.length < 4) throw new Error('様式 PDF の面数が 4 ではありません');
  missingChars = opts.missing;
  try {
    fillSewerPage1(pages[0], font, v, c);
    if (sheets.profile) drawSheetOnPage(pages[1], font, sheets.profile, POS.drawingBox, opts);
    if (sheets.iso) drawSheetOnPage(pages[2], font, sheets.iso, POS.drawingBox, opts);
  } finally { missingChars = undefined; }
  return pdf.save();
}
