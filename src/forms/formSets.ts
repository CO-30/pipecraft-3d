/** 自治体プロファイル ID → 申請書の様式。下水道申請書に載せる図面の組み立てもここ */
import type { Doc } from '../model/doc';
import type { MunicipalityProfile } from '../model/municipality';
import { buildIsometric } from '../model/isometric';
import { buildProfile, extractRoute, trimToManholes } from '../model/profileDrawing';
import { outletCandidates } from '../model/outlets';
import { renderProfileSheet } from '../export/profileSheet';
import { renderIsoSheet } from '../export/isoSheet';
import type { Sheet } from '../export/sheet';
import { OKINAWA_FORMS } from './okinawaCity';
import type { FormSet } from './types';

/** プロファイル ID → 様式 */
export const FORM_SETS: Record<string, FormSet> = { [OKINAWA_FORMS.profileId]: OKINAWA_FORMS };
export const CONTRACTOR_KEY = 'contractor';

/** 下水道申請書の 2・3 面に載せる図面（本線の縦断図＋排水の立面図）。無ければ undefined */
export function drainageSheetsFor(doc: Doc, profile: MunicipalityProfile, siteName: string, date: Date): { profile?: Sheet; iso?: Sheet } {
  const outlet = outletCandidates(doc)[0]?.id;
  if (!outlet) return {};
  const r = extractRoute(doc.network, outlet);
  if ('error' in r) return {};
  const iso = buildIsometric(doc, 'drain', profile);
  const model = buildProfile(doc, trimToManholes(doc, r.route), profile, '排水設備 縦断図');
  const withIso = profile.profileTable.drainageIsometric && iso.lines.length > 0;
  return {
    profile: renderProfileSheet(model, { siteName, date }, withIso ? iso : undefined),
    ...(iso.lines.length > 0 ? { iso: renderIsoSheet(iso, profile, { siteName, date, title: '配管立図' }) } : {}),
  };
}

