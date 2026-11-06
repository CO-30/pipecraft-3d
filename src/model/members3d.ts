/** 梁・軒/庇・バルコニー・階段 → 3D表示用の箱 */
import type { Building } from './building';
import type { Box } from './building3d';
import { membersOf, stairSteps, type Member } from './members';

const RAIL_T = 50;

export function memberBoxes(b: Building): Box[] {
  const out: Box[] = [];
  for (const m of membersOf(b)) {
    const f = b.floors.find((x) => x.id === m.floorId);
    if (!f) continue;
    out.push(...boxesOf(m, f.elevation));
  }
  return out;
}

function boxesOf(m: Member, base: number): Box[] {
  const L = Math.hypot(m.b.x - m.a.x, m.b.y - m.a.y);
  if (L < 1) return [];
  const u = { x: (m.b.x - m.a.x) / L, y: (m.b.y - m.a.y) / L };
  const n = { x: -u.y, y: u.x };
  const rot = Math.atan2(u.y, u.x);
  const out: Box[] = [];
  /** 中心線に沿って s0〜s1、横に t0〜t1、高さ z0〜z1 の箱 */
  const box = (tag: string, s0: number, s1: number, t0: number, t1: number, z0: number, z1: number) => {
    const sm = (s0 + s1) / 2, tm = (t0 + t1) / 2;
    out.push({
      key: `${m.id}:${tag}`, elementId: m.id, floorId: m.floorId, category: 'member',
      center: { x: m.a.x + u.x * sm + n.x * tm, y: m.a.y + u.y * sm + n.y * tm, z: base + (z0 + z1) / 2 },
      size: { x: s1 - s0, y: t1 - t0, z: z1 - z0 }, rotationZ: rot,
    });
  };
  const h = m.width / 2;
  if (m.kind === 'beam') {
    // 外面は壁の外面と重なるので、ちらつかないよう 2mm 内側へ
    const side = m.outward && m.outward.x * n.x + m.outward.y * n.y < 0 ? -1 : 1;
    box('body', 0, L, side > 0 ? -h : -h + 2, side > 0 ? h - 2 : h, m.z0, m.z1);
  } else if (m.kind === 'eave') box('body', 0, L, -h, h, m.z0, m.z1);
  else if (m.kind === 'balcony') {
    box('slab', 0, L, -h, h, m.z0, 0);
    const side = m.outward && m.outward.x * n.x + m.outward.y * n.y < 0 ? -1 : 1;
    const t0 = side > 0 ? h - RAIL_T : -h, t1 = side > 0 ? h : -h + RAIL_T;
    box('rail', 0, L, t0, t1, 0, m.z1);
    box('railA', 0, RAIL_T, -h, h, 0, m.z1);
    box('railB', L - RAIL_T, L, -h, h, 0, m.z1);
  } else {
    const k = stairSteps(m), run = L / k, rise = (m.z1 - m.z0) / k;
    for (let i = 0; i < k; i++) box(`s${i}`, i * run, (i + 1) * run, -h, h, m.z0 + i * rise, m.z0 + (i + 1) * rise);
  }
  return out;
}
