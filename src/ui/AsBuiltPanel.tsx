/**
 * 申請画面の「竣工図にする」と竣工日、図に出ている区間の実測長の一覧（まとめて入れる）。
 * 実測長は区間の measuredLength（現場実測長）。入れた値はそのまま図の延長になる。
 */
import { useStore } from '../state/store';
import type { AsBuiltSettings } from '../model/asBuilt';
import { OptNumField } from './Panels';

type Props = { settings: AsBuiltSettings; onChange: (patch: Partial<AsBuiltSettings>) => void; segIds: string[]; unmeasured: number; modelLength: (segId: string) => number };

const SYS: Record<string, string> = { water: '給水', hotWater: '給湯', drain: '雑排水', sewage: '汚水', vent: '通気' };

export function AsBuiltPanel({ settings, onChange, segIds, unmeasured, modelLength }: Props) {
  const doc = useStore((s) => s.doc);
  const setMeasured = useStore((s) => s.setSegmentMeasured);
  return (
    <>
      <label className="field inline"><input type="checkbox" data-testid="asbuilt-on" checked={settings.on} onChange={(e) => onChange({ on: e.target.checked })} /> 竣工図にする</label>
      {settings.on && (
        <>
          <label className="field inline">竣工日 <input type="date" data-testid="asbuilt-date" value={settings.date ?? ''} onChange={(e) => onChange({ date: e.target.value || undefined })} /></label>
          {segIds.length > 0 && (
            <details className="asbuilt-list" data-testid="asbuilt-list" open={unmeasured > 0}>
              <summary>実測長の入力（{segIds.length} 区間・未入力 <span data-testid="asbuilt-unmeasured">{unmeasured}</span>）</summary>
              <ol>
                {segIds.map((id) => {
                  const s = doc.network.segments[id];
                  if (!s) return null;
                  return (
                    <li key={id}>
                      <span className="small">{SYS[s.system] ?? s.system} {s.material ?? ''}φ{s.diameter}<span className="muted"> 図面 {(modelLength(id) / 1000).toFixed(2)}m</span></span>
                      <OptNumField label="実測" positive value={s.measuredLength} testId={`asbuilt-len-${id}`} placeholder="未入力" onCommit={(v) => setMeasured(id, v)} />
                      {s.measuredApprox && <span className="badge warn" title="区間を分けたとき長さの比で分けた値">概算</span>}
                    </li>
                  );
                })}
              </ol>
            </details>
          )}
        </>
      )}
    </>
  );
}
