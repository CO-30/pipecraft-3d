// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';

const save = vi.fn();
vi.mock('../storage/instance', () => ({ repo: { save: (...a: unknown[]) => save(...a) } }));

import { flushNow, hasUnsaved, installAutosave } from './autosave';
import { emptyDoc, useStore } from '../state/store';

describe('自動保存', () => {
  it('保存に失敗したら未保存のまま残り、次の保存で成功する（変更を失わない）', async () => {
    installAutosave();
    const st = useStore.getState();
    st.newDoc(emptyDoc(), { id: 'p1', name: 'a', createdAt: 1 });
    st.drawPolyline([{ x: 0, y: 0, z: 0 }, { x: 1000, y: 0, z: 0 }]);

    save.mockRejectedValueOnce(new Error('QuotaExceeded'));
    expect(await flushNow()).toBe(false);
    expect(hasUnsaved()).toBe(true);

    save.mockResolvedValueOnce(undefined);
    expect(await flushNow()).toBe(true);
    expect(hasUnsaved()).toBe(false);
    const saved = save.mock.calls.at(-1)![0];
    expect(Object.keys(saved.network.segments)).toHaveLength(1);
  });

  it('変更がなければ保存しない', async () => {
    save.mockClear();
    expect(await flushNow()).toBe(true);
    expect(save).not.toHaveBeenCalled();
  });
});
