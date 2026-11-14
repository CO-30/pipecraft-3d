import { beforeEach, describe, expect, it } from 'vitest';
import { parseProject } from '../storage/repository';
import { emptyDoc, useStore } from './store';

const s = () => useStore.getState();
beforeEach(() => s().newDoc(emptyDoc(), { id: 'p', name: '山田邸', createdAt: 1 }));

const u = (kind: 'aerial' | 'parcels', label: string) => ({
  floorId: s().activeFloorId, kind, label, src: 'data:image/png;base64,AAAA', widthPx: 10, heightPx: 10,
  center: { x: 0, y: 0 }, mmPerPx: 100, rotation: 0, opacity: 0.8, scaled: true,
});

describe('共通ストア: 住所から取り込む（航空写真＋地番図）', () => {
  it('下敷きを 2 枚（航空写真と地番図）1 回の操作で入れ、元に戻す 1 回で両方消える', () => {
    const r = s().importSite({ underlays: [u('aerial', '航空写真'), u('parcels', '地番図')] });
    expect(r).toEqual({ walls: 0, failed: 0 });
    const list = Object.values(s().doc.underlays ?? {});
    expect(list.map((x) => x.kind)).toEqual(['aerial', 'parcels']);
    s().undo();
    expect(Object.keys(s().doc.underlays ?? {})).toHaveLength(0);
  });
  it('保存して読み直しても地番図の下敷きが残る（保存形式で使える種類）', () => {
    s().importSite({ underlays: [u('parcels', '地番図')] });
    const p = s().toProjectData()!;
    expect(Object.values(parseProject(JSON.stringify(p)).underlays ?? {})[0].kind).toBe('parcels');
  });

  it('2 枚を足すと下敷きの上限を超えるときは、どちらも入れずに知らせる（1 枚ずつなら入る大きさでも）', async () => {
    const sized = (k: 'aerial' | 'parcels', n: number) => ({ ...u(k, k), src: 'data:image/png;base64,' + 'A'.repeat(n) });
    // すでに 7.8MB ある現場に 3MB を 2 枚（1 枚ずつなら 10.8MB で入るが、2 枚で 13.8MB > 12MB）
    s().importSite({ underlays: [sized('aerial', 3_900_000), sized('aerial', 3_900_000)] });
    const before = Object.keys(s().doc.underlays ?? {}).length;
    const big = (k: 'aerial' | 'parcels') => sized(k, 3_000_000);
    expect(s().importSite({ underlays: [big('aerial'), big('parcels')] })).toBeNull();
    expect(s().notice).toContain('下敷きが多すぎます');
    expect(Object.keys(s().doc.underlays ?? {})).toHaveLength(before);
  });
});
