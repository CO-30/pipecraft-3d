import { z } from 'zod';
import { addFloor, emptyBuilding } from './building';

const vec3 = z.object({ x: z.number().finite(), y: z.number().finite(), z: z.number().finite() });
const vec2 = z.object({ x: z.number().finite(), y: z.number().finite() });

export const nodeSchema = z.object({
  id: z.string().min(1),
  kind: z.enum(['end', 'joint', 'elbow', 'tee', 'cross', 'valve', 'fixture']),
  pos: vec3,
  fixedKind: z.boolean().optional(),
  fixtureId: z.string().min(1).optional(),
  portId: z.string().min(1).optional(),
  floorId: z.string().min(1).optional(),
});

export const segmentSchema = z.object({
  id: z.string().min(1),
  a: z.string().min(1),
  b: z.string().min(1),
  system: z.enum(['water', 'hotWater', 'drain', 'sewage', 'vent', 'gas', 'refrigerant', 'condensate', 'electric', 'telecom', 'other']),
  diameter: z.number().positive(),
  material: z.string().optional(),
  measuredLength: z.number().nonnegative().optional(),
  measuredApprox: z.boolean().optional(),
  extraRate: z.number().nonnegative().optional(),
  note: z.string().optional(),
});

export const networkSchema = z.object({
  nodes: z.record(z.string(), nodeSchema),
  segments: z.record(z.string(), segmentSchema),
});

export const buildingSchema = z.object({
  floors: z.array(z.object({
    id: z.string().min(1), name: z.string(), elevation: z.number().finite(), height: z.number().positive(), slabThickness: z.number().nonnegative(),
  })),
  corners: z.record(z.string(), z.object({ id: z.string().min(1), floorId: z.string().min(1), x: z.number().finite(), y: z.number().finite() })),
  walls: z.record(z.string(), z.object({
    id: z.string().min(1), floorId: z.string().min(1), a: z.string().min(1), b: z.string().min(1),
    thickness: z.number().positive(), kind: z.enum(['exterior', 'interior']),
  })),
  openings: z.record(z.string(), z.object({
    id: z.string().min(1), wallId: z.string().min(1), type: z.enum(['door', 'window']),
    offset: z.number().finite(), width: z.number().positive(), height: z.number().positive(), sill: z.number().nonnegative(),
  })),
  rooms: z.record(z.string(), z.object({ id: z.string().min(1), floorId: z.string().min(1), name: z.string(), polygon: z.array(vec2) })),
});

export const fixtureSchema = z.object({
  id: z.string().min(1),
  floorId: z.string().min(1),
  type: z.enum(['toilet', 'washbasin', 'kitchen', 'bathtub', 'shower', 'washer', 'waterHeater', 'waterMeter', 'pump', 'panel', 'outlet', 'light', 'aircon']),
  x: z.number().finite(),
  y: z.number().finite(),
  rotation: z.union([z.literal(0), z.literal(90), z.literal(180), z.literal(270)]),
});

export const SCHEMA_VERSION = 3;

export const projectSchema = z.object({
  schemaVersion: z.literal(SCHEMA_VERSION),
  id: z.string().min(1),
  name: z.string(),
  address: z.string().optional(),
  createdAt: z.number(),
  updatedAt: z.number(),
  building: buildingSchema,
  network: networkSchema,
  fixtures: z.record(z.string(), fixtureSchema),
});

export type ProjectData = z.infer<typeof projectSchema>;

const projectV1Schema = z.object({
  schemaVersion: z.literal(1),
  id: z.string().min(1),
  name: z.string(),
  createdAt: z.number(),
  updatedAt: z.number(),
  network: networkSchema,
});

const projectV2Schema = z.object({
  schemaVersion: z.literal(2),
  id: z.string().min(1),
  name: z.string(),
  address: z.string().optional(),
  createdAt: z.number(),
  updatedAt: z.number(),
  building: buildingSchema,
  network: networkSchema,
});

/** 旧形式を現行形式へ変換（未知の形式はそのまま返し、後段の検証で拒否される） */
export function migrate(raw: unknown): unknown {
  const v1 = projectV1Schema.safeParse(raw);
  if (v1.success) {
    return { ...v1.data, schemaVersion: SCHEMA_VERSION, building: addFloor(emptyBuilding()).b, fixtures: {} };
  }
  const v2 = projectV2Schema.safeParse(raw);
  if (v2.success) return { ...v2.data, schemaVersion: SCHEMA_VERSION, fixtures: {} };
  return raw;
}
