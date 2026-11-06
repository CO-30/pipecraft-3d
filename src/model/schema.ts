import { z } from 'zod';

const vec3 = z.object({ x: z.number().finite(), y: z.number().finite(), z: z.number().finite() });

export const nodeSchema = z.object({
  id: z.string().min(1),
  kind: z.enum(['end', 'joint', 'elbow', 'tee', 'cross', 'valve', 'fixture']),
  pos: vec3,
  fixedKind: z.boolean().optional(),
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

export const SCHEMA_VERSION = 1;

export const projectSchema = z.object({
  schemaVersion: z.literal(SCHEMA_VERSION),
  id: z.string().min(1),
  name: z.string(),
  createdAt: z.number(),
  updatedAt: z.number(),
  network: networkSchema,
});

export type ProjectData = z.infer<typeof projectSchema>;
