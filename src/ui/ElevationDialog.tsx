/**
 * 立面（外壁）を作る: 実測の横幅・高さ、配管の取付（T字金具で浮かせる／サドル直付け）、外壁の写真（任意）。
 * 壁を選んで開いた場合はその壁の外側、壁がない場合は寸法だけで外壁を作る。
 */
import { useState } from 'react';
import { useStore } from '../state/store';
import { wallLength } from '../model/building';
import { DEFAULT_MOUNT, elevationFromWall, elevationStandalone, facadeHeight, type MountType, type WallMount } from '../model/elevation';
import { PhotoRectify, type Face } from './PhotoRectify';

export function MountFields({ mount, onChange }: { mount: WallMount; onChange: (m: WallMount) => void }) {
  const [sd, setSd] = useState(String(mount.standoff));
  const commitSd = () => {
    const v = Number(sd);
    if (Number.isFinite(v) && v >= 0 && v <= 1000) onChange({ ...mount, standoff: Math.round(v) });
    else setSd(String(mount.standoff));
  };
  return (
    <div className="row mount-fields">
      <span className="small">取付</span>
      <div className="seg-btns small">
        {(['tBracket', 'saddle'] as MountType[]).map((t) => (
          <button key={t} data-testid={`mount-${t}`} className={mount.type === t ? 'on' : ''} onClick={() => onChange({ ...mount, type: t })}>
            {t === 'tBracket' ? 'T字金具で浮かせる' : 'サドル直付け'}
          </button>
        ))}
      </div>
      {mount.type === 'tBracket' && (
        <label className="field inline">壁からのすき間
          <input data-testid="mount-standoff" type="number" inputMode="numeric" min={0} max={1000} value={sd}
            onChange={(e) => setSd(e.target.value)} onBlur={commitSd} onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }} />mm
        </label>
      )}
    </div>
  );
}

export function ElevationDialog({ wallId, onClose }: { wallId: string | null; onClose: () => void }) {
  const b = useStore((s) => s.doc.building);
  const floorId = useStore((s) => s.activeFloorId);
  const wall = wallId ? b.walls[wallId] : undefined;
  const [width, setWidth] = useState(String(Math.round(wall ? wallLength(b, wall.id) : 8000)));
  const [height, setHeight] = useState(String(Math.round(facadeHeight(b, wall?.floorId ?? floorId))));
  const [mount, setMount] = useState<WallMount>({ ...DEFAULT_MOUNT });
  const [face, setFace] = useState<Face | null>(null);
  const [msg, setMsg] = useState('');
  const W = Number(width), H = Number(height);
  const ok = Number.isFinite(W) && Number.isFinite(H) && W >= 500 && H >= 500 && W <= 200000 && H <= 200000;

  const create = () => {
    if (!ok) return;
    const base = wall
      ? elevationFromWall(b, wall.id, { width: W, height: H })
      : elevationStandalone(floorId, W, H, b.floors.find((f) => f.id === floorId)?.elevation ?? 0);
    const el = { ...base, mount, ...(face ? { photo: { src: face.url, w: face.w, h: face.h } } : {}) };
    // 壁がない場合は、この寸法で外壁を1枚作る（平面図・3D にも出る。外から見た面は南）
    const err = useStore.getState().addElevation(el, { createWall: !wall });
    if (err) { setMsg(err); return; }
    onClose();
  };

  return (
    <div className="modal-back" onClick={onClose}>
      <div className="modal wide-modal" data-testid="elev-dialog" onClick={(e) => e.stopPropagation()}>
        <h2>立面図で配管を描く{wall ? '' : '（壁を寸法で作成）'}</h2>
        <p className="small muted">外壁の横幅と高さ（地面〜屋上など、写真に写す範囲）を測って入力します。</p>
        <div className="row">
          <label className="field inline">横幅<input data-testid="el-width" type="number" inputMode="numeric" value={width} onChange={(e) => { setWidth(e.target.value); setFace(null); }} />mm</label>
          <label className="field inline">高さ<input data-testid="el-height" type="number" inputMode="numeric" value={height} onChange={(e) => { setHeight(e.target.value); setFace(null); }} />mm</label>
        </div>
        {!ok && <p className="warn small">横幅・高さは 500mm 以上で入力してください</p>}
        <MountFields mount={mount} onChange={setMount} />
        <p className="small muted">取付はあとで立面図の上から変えられます（描いた配管もいっしょに動きます）。</p>
        <h3>外壁の写真（なくても描けます）</h3>
        {face ? (
          <div>
            <img src={face.url} alt="補正した外壁" className="el-face-preview" data-testid="el-face" />
            <div className="row"><button onClick={() => setFace(null)}>写真をやり直す</button></div>
          </div>
        ) : ok ? (
          <PhotoRectify key={`${W}x${H}`} aspectW={W} aspectH={H} maxPx={1600} quality={0.8} allowPartial
            intro="外壁を撮った写真を選び、四隅を壁の角（入力した横幅・高さの範囲）に合わせます。壁の端が写っていなければ、大きさの分かる四角（窓など）でも合わせられます。"
            onDone={setFace} />
        ) : null}
        {msg && <p className="err" role="alert">{msg}</p>}
        <div className="modal-btns">
          <button onClick={onClose}>閉じる</button>
          <button className="primary" data-testid="el-create" disabled={!ok} onClick={create}>立面図を開く</button>
        </div>
      </div>
    </div>
  );
}
