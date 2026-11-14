/**
 * 設備図（申請図）に書かれた配管・ます・部品の数量を、精度の測定の正解（実際の設計の数量）にする。
 * 同じ配管を平面図と立面図（アイソメ）の両方に書くので、平面図どうし（階ごと・給水と排水）は足し、
 * 平面図の合計と立面図などの合計の多い方を採る（全部足すと 2 倍になる）。
 */
import type { SheetInput } from '../model/planRead/assemble';
import { equipmentQuantities, isEquipmentSheet, readEquipment } from '../model/planRead/equipment';
import { classifySheet } from '../model/planRead/sheet';
import type { Truth } from './truth';

type Qty = NonNullable<Truth['quantities']>[number];

export function quantitiesFromSheets(inputs: SheetInput[]): Qty[] {
  const sum = (list: SheetInput[]) => {
    const out: Qty[] = [];
    for (const s of list) for (const q of equipmentQuantities(readEquipment(s.page.texts))) {
      const cur = out.find((o) => o.name === q.name && o.spec === q.spec && o.unit === q.unit);
      if (cur) cur.qty = Math.round((cur.qty + q.qty) * 100) / 100; else out.push({ ...q });
    }
    return out;
  };
  const eq = inputs.filter((i) => isEquipmentSheet(i.page.texts));
  const isPlan = (i: SheetInput) => classifySheet(i.page.texts, i.name).kind === 'plan';
  const out = sum(eq.filter(isPlan));
  for (const q of sum(eq.filter((i) => !isPlan(i)))) {
    const cur = out.find((o) => o.name === q.name && o.spec === q.spec && o.unit === q.unit);
    if (cur) cur.qty = Math.max(cur.qty, q.qty); else out.push(q);
  }
  return out;
}
