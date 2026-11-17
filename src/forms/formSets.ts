/** 自治体プロファイル ID → 申請書の様式。下水道申請書に載せる図面の組み立てもここ */
import type { Doc } from '../model/doc';
import { stripHead, type MunicipalityProfile } from '../model/municipality';
import { buildIsometric, isoManholeLabels } from '../model/isometric';
import { buildProfile, extractRoute, trimToManholes } from '../model/profileDrawing';
import { outletCandidates } from '../model/outlets';
import { renderProfileSheet } from '../export/profileSheet';
import { renderIsoSheet } from '../export/isoSheet';
import { renderDrainPlanSheet } from '../export/drainPlanSheet';
import { buildRiser, defaultRiserRoot } from '../model/riser';
import { renderRiserSheet } from '../export/riserSheet';
import type { Sheet } from '../export/sheet';
import { OKINAWA_FORMS } from './okinawaCity';
import { NANBU_FORMS } from './nanbu';
import { HAEBARU_FORMS } from './haebaruSewer';
import type { FormSet } from './types';

/** プロファイル ID → 様式 */
export const FORM_SETS: Record<string, FormSet> = {
  [OKINAWA_FORMS.profileId]: OKINAWA_FORMS,
  // 南風原町・八重瀬町の給水は南部水道企業団の同じ様式
  // 南風原町は下水道（町の排水設備計画確認申請書）の項目も
  haebaru: HAEBARU_FORMS,
  yaese: { ...NANBU_FORMS, profileId: 'yaese' },
};
/** 南部水道企業団の様式か（申請書タブの出力ボタンが変わる） */
export const isNanbu = (set: FormSet | undefined) => set?.water === 'nanbu';
export const CONTRACTOR_KEY = 'contractor';

/**
 * 下水道申請書に載せる図面: profile＝本線の縦断図（プロファイルの様式どおり。沖縄市・南風原町はアイソメ図つき）、iso＝排水の立面図。
 * extra（南風原町の申請書）のときだけ profileOnly＝アイソメ図を載せない縦断図（2 面の下半分）と plan＝排水平面図も作る。
 * 公共マスまでの経路が無くても、排水の配管があれば平面図は作る（桝は種類名で書く）
 */
export function drainageSheetsFor(doc: Doc, profile: MunicipalityProfile, siteName: string, date: Date, titleValues?: Record<string, string>, opts: { extra?: boolean } = {}): { profile?: Sheet; iso?: Sheet; profileOnly?: Sheet; plan?: Sheet } {
  const outlet = outletCandidates(doc)[0]?.id;
  const r = outlet ? extractRoute(doc.network, outlet) : undefined;
  const model = r && !('error' in r) ? buildProfile(doc, trimToManholes(doc, r.route), profile, '排水設備 縦断図') : undefined;
  const plan = opts.extra ? renderDrainPlanSheet(doc, profile, { siteName, date, titleValues, ...(model ? { manholeLabels: isoManholeLabels([model]) } : {}) }) : undefined;
  if (!model) return plan ? { plan } : {};
  const iso = buildIsometric(doc, 'drain', profile, profile.profileTable.manholeText === 'naikeiFuka' ? { manholeLabels: isoManholeLabels([model]) } : {});
  const withIso = profile.profileTable.drainageIsometric && iso.lines.length > 0;
  return {
    profile: renderProfileSheet(model, { siteName, date, titleValues }, withIso ? iso : undefined),
    ...(opts.extra && withIso ? { profileOnly: renderProfileSheet(model, { siteName, date, titleValues }) } : {}),
    ...(plan ? { plan } : {}),
    ...(iso.lines.length > 0 ? { iso: renderIsoSheet(iso, profile, { siteName, date, title: '配管立図', titleValues }) } : {}),
  };
}

/** 給水の立面図（建物側面図の欄に貼る）。プロファイルの様式どおり（アイソメ or 系統図）。配管が無ければ undefined */
export function waterSheetFor(doc: Doc, profile: MunicipalityProfile, siteName: string, date: Date): Sheet | undefined {
  if (profile.riser.lineStyle === 'isometric') {
    const iso = buildIsometric(doc, 'water', profile);
    return iso.lines.length ? renderIsoSheet(iso, profile, { siteName, date, title: '建物側面図（給水）' }) : undefined;
  }
  const root = defaultRiserRoot(doc);
  return root ? renderRiserSheet(buildRiser(doc, root, profile, '給水装置 立面図'), { siteName, date }) : undefined;
}

/**
 * 申請図面の表題欄の値（南風原町の実例: 申請地＝県・郡を省いた設置場所、申請者＝「○○ 邸」、指定工事店＝工事店の名前）。
 * 地番が「100-1,2,3」のように続くときは最初の 1 つだけ（欄に入る長さ）
 */
export function drawingTitleValues(app: Record<string, string> | undefined, contractorName: string, fallbackAddress = ''): Record<string, string> {
  const addr = stripHead(app?.siteAddress || fallbackAddress || '').replace(/(\d+(?:-\d+)*)[,、・].*$/, '$1');
  const name = (app?.applicantName || app?.ownerName || '').trim();
  return { '申請地': addr, '申請者': name ? `${name} 邸` : '', '指定工事店': contractorName };
}
