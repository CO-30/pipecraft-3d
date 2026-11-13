/** 図面一式の読み取り結果（buildFromSheets）を、正解と比べる平らな形（Reading）にする。純粋関数 */
import { wallsOnFloor } from '../model/building';
import type { PlanSetResult, SheetInput } from '../model/planRead/assemble';
import { classifySheet, readGrid, sheetScale } from '../model/planRead/sheet';
import type { Reading } from './evaluate';

export function readingOf(res: PlanSetResult, inputs: SheetInput[]): Reading {
  const b = res.building;
  const floorNo = new Map(b.floors.map((f, i) => [f.id, i + 1]));
  const sheets = inputs.map((s) => {
    const kind = classifySheet(s.page.texts, s.name).kind;
    const placed = res.plans.find((p) => p.index === inputs.indexOf(s));
    const scale = placed?.scale ?? sheetScale(s.page.texts, readGrid(s.page.texts))?.scale;
    return { name: s.name, kind, ...(scale ? { scale } : {}) };
  });
  const walls = b.floors.flatMap((f) => wallsOnFloor(b, f.id).map((w) => ({
    floor: floorNo.get(f.id)!, a: { x: b.corners[w.a].x, y: b.corners[w.a].y }, b: { x: b.corners[w.b].x, y: b.corners[w.b].y }, thickness: w.thickness,
  })));
  const openings = b.floors.map((f) => ({ floor: floorNo.get(f.id)!, count: Object.values(b.openings).filter((o) => b.walls[o.wallId]?.floorId === f.id).length }));
  return {
    sheets,
    floors: b.floors.map((f, i) => ({ n: i + 1, height: f.height })),
    ...(res.designGL !== undefined ? { glToFl: -res.designGL } : {}),
    walls,
    openings,
    fixtures: res.fixtures.map((c) => ({ floor: floorNo.get(c.floorId) ?? 1, type: c.type, x: Math.round(c.x), y: Math.round(c.y) })),
    site: (res.site?.items ?? []).map((s) => ({ type: s.type, x: Math.round(s.x), y: Math.round(s.y) })),
    checks: res.report.check,
  };
}
