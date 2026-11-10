/**
 * 沖縄市「給水装置申込及び工事申請書」（Excel 様式）に値を差し込む。
 * テンプレート: public/forms/okinawa-city/water-application.xlsx（記入例の値と画像を除いたもの）
 * セル位置は様式の実物から（2026-11-10）。様式が更新されたら CELLS を直す。
 */
import ExcelJS from 'exceljs';
import { PURPOSES, SUPPLY_TYPES, USE_TYPES, WATER_WORK_KINDS } from './okinawaCity';
import { markChoice, markWord, reiwa, type ApplicationValues, type Contractor } from './types';

export const SHEET_NAME = '申請書（表）';

/** 値を書くセル */
export const CELLS = {
  date: 'P7',
  workKind: { 新設: 'D6', 改造: 'F6', 臨仮: 'H6' } as Record<string, string>,
  siteAddress: 'D14',
  applicantAddress: 'D15', applicantKana: 'D16', applicantName: 'D18', applicantTel: 'D22',
  userAddress: 'D24', userKana: 'D25', userName: 'D27',
  licenseNo: 'O15', zip: 'M16', address: 'O16', name: 'M20', representative: 'M24', tel: 'M25', chiefEngineer: 'M27',
  useType1: 'D29', useType2: 'D30',
  households: 'D31', supplyType: 'I31', sewerConnected: 'S31',
  purpose: 'D32',
  structure: 'N34', floors: 'O35',
  drawingNo: 'D36', billTo: 'N37',
  diameter: 'D39', feeDesign: 'F39', feeAdmission: 'B41', feeInspection: 'F41', feeTotal: 'J41',
  meterDiameter: 'D46',
} as const;

const num = (s: string | undefined): number | undefined => {
  const t = (s ?? '').replace(/[,，]/g, '').trim();
  const n = Number(t);
  return t && Number.isFinite(n) ? n : undefined;
};

export function fillWaterApplication(ws: ExcelJS.Worksheet, v: ApplicationValues, c: Contractor): void {
  const set = (addr: string, val: string | number | undefined) => { if (val !== undefined && val !== '') ws.getCell(addr).value = val; };
  const str = (addr: string) => String(ws.getCell(addr).value ?? '');

  const d = reiwa(v.date ?? '');
  if (d) set(CELLS.date, `　令和　${d.year}　年　${d.month}　月　${d.day}　日`);
  const wk = CELLS.workKind[v.waterWorkKind ?? ''];
  if (wk && WATER_WORK_KINDS.includes(v.waterWorkKind)) set(wk, `○${str(wk)}`);

  set(CELLS.siteAddress, v.siteAddress);
  set(CELLS.applicantAddress, v.applicantAddress); set(CELLS.applicantKana, v.applicantKana); set(CELLS.applicantName, v.applicantName); set(CELLS.applicantTel, v.applicantTel);
  const same = (v.userSame ?? '同じ') === '同じ';
  set(CELLS.userAddress, same ? v.applicantAddress : v.userAddress); set(CELLS.userKana, same ? v.applicantKana : v.userKana); set(CELLS.userName, same ? v.applicantName : v.userName);

  set(CELLS.licenseNo, num(c.licenseNo) ?? c.licenseNo); set(CELLS.zip, c.zip ? `〒${c.zip.replace(/^〒/, '')}` : undefined); set(CELLS.address, c.address);
  set(CELLS.name, c.name); set(CELLS.representative, c.representative); set(CELLS.tel, c.tel); set(CELLS.chiefEngineer, c.chiefEngineer);

  // 使用形態: 1 一般家庭用（一般住宅・アパート）2 官公署 3 学校 4 病院 5 事務所 / 6 営業用 7 工場 8 その他
  const ui = USE_TYPES.indexOf(v.useType ?? '');
  if (ui >= 0) {
    const n = ui <= 1 ? 1 : ui; // USE_TYPES[2]='官公署' → 2 …
    if (n <= 5) {
      let t = markChoice(str(CELLS.useType1), n);
      if (ui === 0) t = markWord(t, '一般住宅'); else if (ui === 1) t = markWord(t, 'アパート');
      set(CELLS.useType1, t);
    } else {
      let t = markChoice(str(CELLS.useType2), n);
      if (n === 8 && v.useTypeOther) t = t.replace(/その他（\s*/, `その他（${v.useTypeOther}`);
      set(CELLS.useType2, t);
    }
  }
  set(CELLS.households, num(v.households));
  const si = SUPPLY_TYPES.indexOf(v.supplyType ?? '');
  if (si >= 0) set(CELLS.supplyType, markChoice(str(CELLS.supplyType), si + 1));
  if (v.sewerConnected === '有' || v.sewerConnected === '無') set(CELLS.sewerConnected, markWord(str(CELLS.sewerConnected), v.sewerConnected));
  const pi = PURPOSES.indexOf(v.purpose ?? '');
  if (pi >= 0) set(CELLS.purpose, markChoice(str(CELLS.purpose), pi + 1));
  // 構造・階数はテンプレートの記入例が残らないよう、空なら空で上書き
  ws.getCell(CELLS.structure).value = v.structure || null; ws.getCell(CELLS.floors).value = num(v.floors) ?? null;
  set(CELLS.drawingNo, v.drawingNo); set(CELLS.billTo, v.billTo);

  const dia = num(v.diameter);
  set(CELLS.diameter, dia); set(CELLS.meterDiameter, dia);
  const fa = num(v.feeAdmission), fd = num(v.feeDesign), fi = num(v.feeInspection);
  set(CELLS.feeAdmission, fa); set(CELLS.feeDesign, fd); set(CELLS.feeInspection, fi);
  if (fa !== undefined || fd !== undefined || fi !== undefined) set(CELLS.feeTotal, (fa ?? 0) + (fd ?? 0) + (fi ?? 0));
}

export const BACK_SHEET_NAME = '申請書（裏）';

/** 様式の図の欄に貼る画像（PNG）。sideView: 表の「建物側面図」、plan: 裏の「平面図」、iso: 裏の「平面図・アイソメ図」 */
export type WaterImages = { sideView?: Uint8Array; plan?: Uint8Array; iso?: Uint8Array };
/** 画像の欄（0 始まりの列・行。tl〜br の 2 セルアンカー） */
export const IMAGE_BOXES = {
  sideView: { tl: { col: 13, row: 47 }, br: { col: 20, row: 60 } },
  plan: { tl: { col: 0, row: 1 }, br: { col: 10, row: 31 } },
  iso: { tl: { col: 0, row: 32 }, br: { col: 10, row: 65 } },
} as const;

/** テンプレートのバイト列から、値（と図の画像）を入れた xlsx を作る */
export async function buildWaterApplication(template: ArrayBuffer | Uint8Array, v: ApplicationValues, c: Contractor, images: WaterImages = {}): Promise<Uint8Array> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(template as ArrayBuffer);
  const ws = wb.getWorksheet(SHEET_NAME);
  if (!ws) throw new Error(`様式のシート「${SHEET_NAME}」が見つかりません`);
  // 文書のプロパティに個人名などを残さない
  wb.creator = 'PipeCraft 3D'; wb.lastModifiedBy = 'PipeCraft 3D'; wb.company = ''; wb.modified = new Date();
  fillWaterApplication(ws, v, c);
  const back = wb.getWorksheet(BACK_SHEET_NAME);
  const put = (sheet: ExcelJS.Worksheet | undefined, png: Uint8Array | undefined, box: { tl: { col: number; row: number }; br: { col: number; row: number } }) => {
    if (!sheet || !png) return;
    const id = wb.addImage({ buffer: png as unknown as ExcelJS.Buffer, extension: 'png' });
    sheet.addImage(id, { tl: { col: box.tl.col, row: box.tl.row }, br: { col: box.br.col, row: box.br.row }, editAs: 'oneCell' } as unknown as ExcelJS.ImageRange);
  };
  put(ws, images.sideView, IMAGE_BOXES.sideView);
  put(back, images.plan, IMAGE_BOXES.plan);
  put(back, images.iso, IMAGE_BOXES.iso);
  return new Uint8Array(await wb.xlsx.writeBuffer());
}
