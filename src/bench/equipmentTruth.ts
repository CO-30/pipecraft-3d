/**
 * 設備図（申請図）に書かれた配管・ます・部品の数量を、精度の測定の正解（実際の設計の数量）にする。
 * 同じ配管を平面図と立面図（アイソメ）の両方に書くので、品目ごとに図面の間で多い方を採る（足すと 2 倍になる）。
 */
import type { SheetInput } from '../model/planRead/assemble';
import { equipmentQuantities, isEquipmentSheet, readEquipment } from '../model/planRead/equipment';
import type { Truth } from './truth';

type Qty = NonNullable<Truth['quantities']>[number];

export function quantitiesFromSheets(inputs: SheetInput[]): Qty[] {
  const out: Qty[] = [];
  for (const s of inputs.filter((i) => isEquipmentSheet(i.page.texts))) {
    for (const q of equipmentQuantities(readEquipment(s.page.texts))) {
      const cur = out.find((o) => o.name === q.name && o.spec === q.spec && o.unit === q.unit);
      if (cur) cur.qty = Math.max(cur.qty, q.qty); else out.push({ ...q });
    }
  }
  return out;
}
