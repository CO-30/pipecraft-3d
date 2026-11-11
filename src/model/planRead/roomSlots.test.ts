import { describe, expect, it } from 'vitest';
import type { WallLine } from './fixtureGuess';
import { matchSlot, roomBox, roomSlots } from './roomSlots';

/** 内法 2000×1600 の部屋（芯 0〜2120 × 0〜1720、厚さ 120）。下の壁の x=1500 に出入口 */
const room = (doors = true): WallLine[] => [
  { a: { x: 0, y: 0 }, b: { x: 2120, y: 0 }, thickness: 120, ...(doors ? { doors: [1500] } : {}) },
  { a: { x: 0, y: 1720 }, b: { x: 2120, y: 1720 }, thickness: 120 },
  { a: { x: 0, y: 0 }, b: { x: 0, y: 1720 }, thickness: 120 },
  { a: { x: 2120, y: 0 }, b: { x: 2120, y: 1720 }, thickness: 120 },
];
const tub = { w: 1600, d: 800 };
const label = { x: 1000, y: 800 };

describe('部屋の箱とスロット（roomSlots）', () => {
  it('部屋の名前の文字から上下左右の壁を探して内法の箱を作る', () => {
    expect(roomBox(label, room())).toEqual({ x0: 60, x1: 2060, y0: 60, y1: 1660 });
  });
  it('壁が 1 本欠けると箱は作らない', () => {
    expect(roomBox(label, room().slice(0, 3))).toBeNull();
  });
  it('辺ごとに奥を壁に付けたスロットを作る。器具が辺いっぱいなら 1 つ、余れば 端・真ん中・端', () => {
    const s = roomSlots(roomBox(label, room())!, tub, room(), label);
    const by = Object.fromEntries(s.map((x) => [x.key, x]));
    expect(Object.keys(by).sort()).toEqual(['B0', 'B1', 'B2', 'L0', 'R0', 'T0', 'T1', 'T2']);
    expect(by.L0).toMatchObject({ x: 460, y: 860, rotation: 90, f: { wall: 'short', door: 'beside', pos: 'full', label: false } });
    expect(by.R0).toMatchObject({ x: 1660, y: 860, rotation: 270, f: { wall: 'short', door: 'beside', pos: 'full' } });
    expect(by.B0).toMatchObject({ x: 860, y: 460, rotation: 180, f: { wall: 'long', door: 'on', pos: 'farDoor', label: true } });
    expect(by.B1.f.pos).toBe('center');
    expect(by.B2).toMatchObject({ x: 1260, f: { pos: 'nearDoor' } });
    expect(by.T2).toMatchObject({ x: 1260, y: 1260, rotation: 0, f: { door: 'opposite', pos: 'nearDoor' } });
  });
  it('出入口が分からないときは door: none・端は corner', () => {
    const s = roomSlots(roomBox(label, room(false))!, tub, room(false), label);
    expect(s.find((x) => x.key === 'B0')!.f).toMatchObject({ door: 'none', pos: 'corner' });
  });
  it('器具が入らない辺にはスロットを作らない', () => {
    const s = roomSlots(roomBox(label, room())!, { w: 1800, d: 800 }, room(), label);
    expect(s.map((x) => x.key).sort()).toEqual(['B0', 'T0']);
    expect(s[0].f.pos).toBe('full');
  });
  it('いまの位置・向きにいちばん近いスロットを探す（180° 回したものは flip）', () => {
    const s = roomSlots(roomBox(label, room())!, tub, room(), label);
    expect(matchSlot(s, 500, 900, 90)).toMatchObject({ slot: { key: 'L0' }, flip: false });
    expect(matchSlot(s, 500, 900, 270)).toMatchObject({ slot: { key: 'L0' }, flip: true });
    // 向きの軸が違うものは当てない
    expect(matchSlot(s, 500, 900, 0)).toBeNull();
    // 400mm より離れていれば当てない（許容を広げれば当てる）
    expect(matchSlot(s, 1000, 900, 90)).toBeNull();
    expect(matchSlot(s, 1000, 900, 90, 600)?.slot.key).toBe('L0');
  });
});
