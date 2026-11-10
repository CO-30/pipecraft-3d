/**
 * 平面図の文字から器具の候補を出す。絵（記号）は設計事務所ごとに違うので読まず、
 *  - 器具の名前の文字（「立水栓」「給湯器」…）→ その文字の位置
 *  - 部屋の名前（「WC」「UB」「洗面」「キッチン」…）→ その部屋に普通ある器具を、文字にいちばん近い壁ぎわへ
 * 置く。位置は目安なので、使う人が下に敷いた図面の絵に合わせて動かす前提（候補として確認してもらう）。純粋関数。
 */
import type { Vec2 } from '../building';
import { FIXTURE_CATALOG, type FixtureType, type Rotation } from '../fixtures';

export type FixtureCandidate = {
  type: FixtureType;
  x: number;
  y: number;
  rotation: Rotation;
  /** 何から候補にしたか（「WC」の部屋、「立水栓」の文字） */
  source: string;
  /** 文字のすぐそばに置いた（部屋の名前から置いたものは false = 位置は大まか） */
  near: boolean;
};
/** 文字（図面座標 mm） */
export type WText = { x: number; y: number; s: string };
/** 壁の芯線と厚さ（図面座標 mm） */
export type WallLine = { a: Vec2; b: Vec2; thickness: number };

const norm = (s: string) => s.normalize('NFKC').toUpperCase();

/** 器具の名前の文字 → 器具。先に書いたものを優先 */
const WORDS: [RegExp, FixtureType][] = [
  [/立水栓|散水栓|外水栓|外部水栓/, 'outdoorFaucet'],
  [/給湯器|給湯機|エコキュート|エコジョーズ|ボイラー/, 'waterHeater'],
  [/壁水栓|壁付水栓|横水栓/, 'faucet'],
  [/洗濯機|洗濯パン/, 'washer'],
  [/洗面化粧台|洗面台|洗面器|手洗器|手洗い器|スロップシンク/, 'washbasin'],
  [/便器|ウォシュレット/, 'toilet'],
];
/**
 * 部屋の名前（1 語全体が一致。「UB1616」のように寸法の数字が付いてもよい）→ その部屋の器具。
 * generic: 「LDK」「DK」のように台所を含むだけの名前（「キッチン」の文字が別にあればそちらを採る）
 */
const ROOMS: { re: RegExp; types: FixtureType[]; generic?: boolean }[] = [
  { re: /^(WC|W\.C\.?|トイレ|便所|TOILET)\d*$/, types: ['toilet'] },
  { re: /^(UB|浴室|バス|バスルーム|ユニットバス|BATH|BATHROOM)\d*$/, types: ['bathtub'] },
  { re: /^(洗面|洗面室|洗面所|洗面脱衣|洗面脱衣室|脱衣|脱衣室|脱衣所|サニタリー|ランドリー|ランドリールーム|LAUNDRY|洗濯室|家事室|パウダールーム)$/, types: ['washbasin', 'washer'] },
  { re: /^(キッチン|台所|厨房|KITCHEN)$/, types: ['kitchen'] },
  { re: /^(DK|LDK)$/, types: ['kitchen'], generic: true },
];

/** 同じ器具を指す文字とみなす距離（「便器」と「ウォシュレット」、部屋の名前とその部屋の器具の文字） */
const SAME_MM = 2000;
/** 同じ文字を 2 度読んだとみなす距離 */
const TWICE_MM = 300;
/** 部屋の文字からこれより遠い壁には寄せない */
const WALL_REACH = 4000;

type Near = { a: Vec2; n: Vec2; u: Vec2; d: number; t: number; s: number; L: number };
function nearestWall(p: Vec2, walls: WallLine[]): Near | null {
  let best: Near | null = null;
  for (const w of walls) {
    const L = Math.hypot(w.b.x - w.a.x, w.b.y - w.a.y);
    if (L < 1) continue;
    const u = { x: (w.b.x - w.a.x) / L, y: (w.b.y - w.a.y) / L };
    const s = Math.max(0, Math.min(L, (p.x - w.a.x) * u.x + (p.y - w.a.y) * u.y));
    const foot = { x: w.a.x + u.x * s, y: w.a.y + u.y * s };
    const d = Math.hypot(p.x - foot.x, p.y - foot.y);
    if (d < 1 || (best && d >= best.d)) continue;
    best = { a: w.a, n: { x: (p.x - foot.x) / d, y: (p.y - foot.y) / d }, u, d, t: w.thickness, s, L };
  }
  return best && best.d <= WALL_REACH ? best : null;
}

/** 器具の奥（+dy）が壁の方（-n）を向く回転 */
function facing(n: Vec2): Rotation {
  if (Math.abs(n.y) >= Math.abs(n.x)) return n.y < 0 ? 0 : 180;
  return n.x > 0 ? 90 : 270;
}

/**
 * texts: 平面図の文字（図面座標）。walls: その階の壁。area: 建物の範囲（凡例・表の文字を除くため。省略時は壁の範囲 + 3m）
 */
export function guessFixtures(texts: WText[], walls: WallLine[], area?: { x0: number; y0: number; x1: number; y1: number }): FixtureCandidate[] {
  const pts = walls.flatMap((w) => [w.a, w.b]);
  const box = area ?? (pts.length
    ? { x0: Math.min(...pts.map((p) => p.x)) - 3000, y0: Math.min(...pts.map((p) => p.y)) - 3000, x1: Math.max(...pts.map((p) => p.x)) + 3000, y1: Math.max(...pts.map((p) => p.y)) + 3000 }
    : null);
  const inArea = (t: WText) => !box || (t.x >= box.x0 && t.x <= box.x1 && t.y >= box.y0 && t.y <= box.y1);
  const named: FixtureCandidate[] = [];
  /** 部屋の名前から出した候補。label は部屋の文字の位置（重なりの判定は壁へ寄せる前の位置で行う） */
  const roomed: (FixtureCandidate & { label: Vec2; generic: boolean })[] = [];
  const far = (p: Vec2, q: Vec2, mm: number) => Math.hypot(p.x - q.x, p.y - q.y) >= mm;
  for (const t of texts) {
    if (!inArea(t)) continue;
    const whole = norm(t.s).replace(/\s+/g, '');
    // 「展開図参照」「洗面化粧台合わせ」は他の図面・寸法の注記
    if (/参照|別紙|合わせ/.test(whole)) continue;
    const word = WORDS.find(([re]) => re.test(whole));
    if (word) {
      // 「給湯器用コンセント」「洗濯機用水栓」は器具そのものではない（「給湯器設置予定」は器具）
      if (new RegExp(`(${word[0].source})用`).test(whole)) continue;
      // 同じ器具を指す文字（「便器」と「ウォシュレット」）は 1 つにする
      if (named.every((o) => o.type !== word[1] || far(o, t, SAME_MM))) named.push({ type: word[1], x: Math.round(t.x), y: Math.round(t.y), rotation: 0, source: `「${t.s.trim()}」の文字`, near: true });
      continue;
    }
    // 部屋の名前は 1 語ずつ見る（「Laundry 床目地」「UB WC」のように続けて書かれていることがある）
    for (const token of t.s.trim().split(/\s+/)) {
      const room = ROOMS.find((r) => r.re.test(norm(token)));
      if (!room) continue;
      // 同じ文字を 2 度読んだもの（重ね書き）は 1 つ。離れた同じ名前は別の部屋
      if (roomed.some((o) => o.type === room.types[0] && !far(o.label, t, TWICE_MM))) continue;
      const wall = nearestWall(t, walls);
      room.types.forEach((type, i) => {
        const size = FIXTURE_CATALOG[type].size;
        let p: Vec2 = { x: t.x + i * 1000, y: t.y };
        if (wall) {
          // 壁の面から器具の奥行の半分だけ離す。壁の端からはみ出さないよう壁の内側へ寄せ、2 つ目以降は壁に沿って空いている側へ並べる
          const half = Math.min(size.w / 2, wall.L / 2);
          const clamp = (v: number) => Math.max(half, Math.min(wall.L - half, v));
          const along = clamp(i === 0 ? wall.s : wall.s + i * 1000 <= wall.L - half ? wall.s + i * 1000 : wall.s - i * 1000);
          const off = wall.t / 2 + size.d / 2;
          p = { x: wall.a.x + wall.u.x * along + wall.n.x * off, y: wall.a.y + wall.u.y * along + wall.n.y * off };
        }
        roomed.push({ type, x: Math.round(p.x), y: Math.round(p.y), rotation: wall ? facing(wall.n) : 0, source: `「${token}」の部屋`, near: false, label: { x: t.x, y: t.y }, generic: !!room.generic });
      });
    }
  }
  const out: FixtureCandidate[] = [...named];
  // 「キッチン」と書かれていれば、「LDK」からは置かない
  const specific = new Set(roomed.filter((c) => !c.generic).map((c) => c.type));
  for (const { label, generic, ...c } of roomed) {
    if (generic && specific.has(c.type)) continue;
    // 器具の名前の文字がその部屋にあれば、文字の方を採る
    if (named.some((o) => o.type === c.type && !far(o, label, SAME_MM))) continue;
    out.push(c);
  }
  return out;
}
