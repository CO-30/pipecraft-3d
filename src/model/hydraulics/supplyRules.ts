/**
 * 給水の水理計算に使う値（データ）。値ごとに状態と出典を持つ。
 *   ok = 規程・基準の原文で確認 / general = 指針・他市の計算例などの一般値 / unknown = その自治体の値は未確認（一般値で計算）
 * 自治体の排水の決まり（municipality.ts）とは別に持つ。
 */
import type { FixtureType } from '../fixtures';
import { cityOf } from '../municipality';

export type RuleStatus = 'ok' | 'general' | 'unknown';
export type RuleVal = { v: number; status: RuleStatus; source: string };
export type EquivItem = 'faucet' | 'meter' | 'stopValve' | 'tap' | 'checkValve' | 'valve';
export type SupplyRules = {
  /** 市町村名（分からなければ null = 標準） */
  city: string | null;
  /** 設計水圧（配水管の最小動水圧）MPa */
  designPressure: RuleVal;
  /** 余裕水頭 m */
  margin: RuleVal;
  /** 管の延長にかける係数（ソケット等の損失） */
  lengthFactor: RuleVal;
  /** 管内流速の上限 m/s */
  maxVelocity: RuleVal;
  /** 配水管がメーターより下にある高さ m */
  mainDrop: RuleVal;
  /** 引込（配水管〜メーター）を描いていないときの延長 m */
  serviceLength: RuleVal;
  /** 屋外の給水管の埋設深さ（GL から管まで）mm */
  burial: RuleVal;
  /** 引込の器具（配水管の側から順に） */
  serviceItems: EquivItem[];
  notes: { text: string; status: RuleStatus; source: string }[];
};

export const SOURCES = {
  shishin: '給水装置工事技術指針（給水工事技術振興財団）',
  kawasaki: '川崎市 給水装置工事 計算例 https://www.city.kawasaki.jp/800/cmsfiles/contents/0000083/83335/7_keisanrei.pdf',
  chiba: '千葉県企業局 水理計算例 https://www.pref.chiba.lg.jp/suidou/kyuusui/tetsuzuki/documents/6-1suiri.pdf',
  odawara: '小田原市 計算例 https://www.city.odawara.kanagawa.jp/global-image/units/431059/1-20200420145535.pdf',
  niigata: '新潟市 給水装置工事施行指針 計算例 https://www.city.niigata.lg.jp/kurashi/jyogesuido/suido/jigyousha/kakusyuyoshiki/kyusui_sekoshishin.files/018_2022.pdf',
  kitakyushu: '北九州市 給水装置工事の設計（最小動水圧 0.15MPa）https://www.city.kitakyushu.lg.jp/files/000866158.pdf',
  ginowan: '宜野湾市 給水装置の構造及び材質の基準に関する規程（令和元年12月20日改正）https://www.city.ginowan.lg.jp/material/files/group/43/kyuusuikouzouzaisitu20191220.pdf',
} as const;

export const EQUIV_LABEL: Record<EquivItem, string> = {
  faucet: '給水栓', meter: '水道メーター', stopValve: '止水栓', tap: '分水栓', checkValve: '逆止弁', valve: 'バルブ',
};

/** 器具類の直管換算長（m）。口径 13・20・25 */
const EQUIV: Record<EquivItem, [number, number, number]> = {
  faucet: [3.0, 8.0, 8.0],
  meter: [4.0, 11.0, 15.0],
  stopValve: [1.5, 2.0, 3.0],
  tap: [1.5, 2.0, 3.0],
  checkValve: [1.2, 1.6, 2.0],
  valve: [0.12, 0.15, 0.18],
};

/** 直管換算長（m）。13 未満は 13、13〜25 は近い方の上の口径、30 以上は 25 の値 × 口径/25 */
export function equivLength(item: EquivItem, dia: number): number {
  const [a, b, c] = EQUIV[item];
  if (dia <= 13) return a;
  if (dia <= 20) return b;
  if (dia <= 25) return c;
  return (c * dia) / 25;
}

/** 同時使用率を考慮した給水用具数（1→1、2〜4→2、5〜10→3、11〜15→4、16〜20→5、21〜30→6、以後 10 栓ごとに +1） */
export function simultaneousCount(total: number): number {
  if (total <= 0) return 0;
  const table: [number, number][] = [[1, 1], [4, 2], [10, 3], [15, 4], [20, 5], [30, 6]];
  for (const [max, n] of table) if (total <= max) return n;
  return 6 + Math.ceil((total - 30) / 10);
}

/** 使用水量の既定（L/min）。指針の「種類別吐水量」の代表値 */
export function defaultFlow(type: FixtureType, portDia: number): number {
  if (type === 'waterHeater') return 20;
  if (portDia >= 20) return 20;
  if (type === 'washbasin') return 8;
  return 12;
}

const OKINAWA = ['那覇市', '沖縄市', '宜野湾市', '浦添市', '豊見城市', '糸満市', '南城市', 'うるま市', '名護市', '宮古島市', '石垣市', '南風原町', '与那原町', '八重瀬町', '西原町', '北谷町', '嘉手納町', '読谷村', '中城村', '北中城村'];

const base = (): SupplyRules => ({
  city: null,
  designPressure: { v: 0.15, status: 'general', source: SOURCES.kitakyushu },
  margin: { v: 3, status: 'general', source: SOURCES.kawasaki },
  lengthFactor: { v: 1.1, status: 'general', source: SOURCES.kawasaki },
  maxVelocity: { v: 2, status: 'general', source: SOURCES.kawasaki },
  mainDrop: { v: 0.9, status: 'general', source: SOURCES.chiba },
  serviceLength: { v: 3, status: 'general', source: SOURCES.shishin },
  burial: { v: 300, status: 'general', source: '器具の真下に配管を落とす（屋外は GL から 300）と同じ値' },
  serviceItems: ['tap', 'stopValve', 'meter', 'checkValve'],
  notes: [],
});

/** 現場の自治体の値。プロファイル名に市町村があればそれ、無ければ住所から */
export function resolveSupplyRules(input: { profileName?: string; address?: string }): SupplyRules {
  const city = (input.profileName && cityOf(input.profileName)) || (input.address && cityOf(input.address)) || null;
  const r = base();
  if (!city) return r;
  r.city = city;
  const where = OKINAWA.includes(city) ? `${city}の水道局` : `${city}の水道事業者`;
  r.designPressure = { v: 0.15, status: 'unknown', source: `${city}: 設計水圧は未確認（${where}に確認）。一般値 0.15MPa で計算` };
  if (city === '宜野湾市') {
    r.designPressure.source = '宜野湾市: 規程に設計水圧の数値なし（上下水道局に確認）。一般値 0.15MPa で計算';
    r.burial = { v: 600, status: 'ok', source: SOURCES.ginowan };
    r.notes.push(
      { text: 'メーターの上流に鍵付き伸縮止水栓、下流に逆流防止の器具（第10条）', status: 'ok', source: SOURCES.ginowan },
      { text: '給水管の埋設深度 0.6m 以上（第7条）', status: 'ok', source: SOURCES.ginowan },
      { text: 'メーターは道路境界からおおむね 1.5m 以内（第10条）', status: 'ok', source: SOURCES.ginowan },
    );
  }
  return r;
}
