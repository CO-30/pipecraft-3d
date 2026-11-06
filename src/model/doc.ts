/** 1つの現場の編集データ（建物・配管・設備機器）。Undo/Redo と保存の単位 */
import type { Building } from './building';
import type { Network } from './network';
import type { Fixture } from './fixtures';
import type { EstimateSettings } from './estimate';

/** estimate: 積算設定（単価・余長・税など）。古いテスト等で省略時は既定値として扱う */
export type Doc = { building: Building; network: Network; fixtures: Record<string, Fixture>; estimate?: EstimateSettings };
