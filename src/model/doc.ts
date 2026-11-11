/** 1つの現場の編集データ（建物・配管・設備機器）。Undo/Redo と保存の単位 */
import type { Building } from './building';
import type { Network } from './network';
import type { Fixture } from './fixtures';
import type { EstimateSettings } from './estimate';
import type { Underlay } from './underlay';
import type { Elevation } from './elevation';

/** 申請図面の現場設定。designGL: 設計地盤高(mm、1階 FL 基準。GL が床より下なら負)。未入力は図面に「仮」 */
export type SiteSettings = { designGL?: number; municipalityProfileId?: string; /** 申請書類の入力値（様式の項目 id → 文字列） */ application?: Record<string, string>;
  /** 配置図から読んだ敷地の高さの点（図面座標 mm、gl: 設計 GL からの mm） */ groundPoints?: { x: number; y: number; gl: number }[] };

/** estimate: 積算設定（単価・余長・税など）。古いテスト等で省略時は既定値として扱う */
export type Doc = { building: Building; network: Network; fixtures: Record<string, Fixture>; estimate?: EstimateSettings; underlays?: Record<string, Underlay>; elevations?: Record<string, Elevation>; site?: SiteSettings };
