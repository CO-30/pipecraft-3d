import { z } from 'zod';
import { addFloor, emptyBuilding } from './building';
import { defaultEstimate } from './estimate';
import { MAX_UNDERLAY_SRC } from './underlay';

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
  fitting: z.object({ type: z.string().min(1), degree: z.number().int().nonnegative() }).optional(),
  avoid: z.enum(['beam', 'eave', 'balcony']).optional(),
  groundLevel: z.number().finite().optional(),
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
  slope: z.number().finite().min(0).max(1).optional(),
  slopeLocked: z.boolean().optional(),
  support: z.enum(['saddle', 'levelBand', 'tBracket', 'none']).optional(),
  face: z.string().min(1).optional(),
  substrate: z.enum(['concrete', 'wood']).optional(),
  penetrations: z.array(z.string().min(1)).optional(),
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
    lengthSet: z.boolean().optional(),
  })),
  openings: z.record(z.string(), z.object({
    id: z.string().min(1), wallId: z.string().min(1), type: z.enum(['door', 'window']),
    offset: z.number().finite(), width: z.number().positive(), height: z.number().positive(), sill: z.number().nonnegative(),
  })),
  rooms: z.record(z.string(), z.object({ id: z.string().min(1), floorId: z.string().min(1), name: z.string(), polygon: z.array(vec2) })),
  /** 梁・軒/庇・バルコニー・階段（v5 の途中で追加したため省略可） */
  members: z.record(z.string(), z.object({
    id: z.string().min(1), kind: z.enum(['beam', 'eave', 'balcony', 'stair']), floorId: z.string().min(1),
    a: vec2, b: vec2, width: z.number().finite().positive(), z0: z.number().finite(), z1: z.number().finite(), outward: vec2.optional(),
  })).optional(),
});

export const fixtureSchema = z.object({
  id: z.string().min(1),
  floorId: z.string().min(1),
  type: z.enum(['toilet', 'washbasin', 'kitchen', 'bathtub', 'shower', 'washer', 'waterHeater', 'waterMeter', 'pump', 'panel', 'outlet', 'light', 'aircon', 'faucet', 'mixFaucet', 'outdoorFaucet', 'roofTank',
    'manholeSewage', 'manholeRain', 'manholeTrap', 'manholeInvert', 'publicSewage', 'publicRain']),
  x: z.number().finite(),
  y: z.number().finite(),
  rotation: z.union([z.literal(0), z.literal(90), z.literal(180), z.literal(270)]),
  /** マスの口径・形状・管底高（v5 の途中で追加したため省略可） */
  params: z.object({ diameter: z.number().positive().optional(), shape: z.enum(['round', 'square']).optional(), invertZ: z.number().finite().optional() }).optional(),
});

const money = z.number().finite().nonnegative();
const saleUnitSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('perLength'), step: z.number().positive() }),
  z.object({ kind: z.literal('straight'), length: z.number().positive() }),
  z.object({ kind: z.literal('roll'), length: z.number().positive() }),
]);
export const estimateSchema = z.object({
  extraRate: z.number().finite().min(0).max(10),
  taxRate: z.number().finite().min(0).max(1),
  overhead: z.object({ mode: z.enum(['rate', 'amount']), value: money }),
  prices: z.record(z.string(), z.object({ material: money, labor: money, saleUnit: saleUnitSchema.optional() })),
  extras: z.array(z.object({ id: z.string().min(1), name: z.string(), quantity: z.number().finite(), unit: z.string(), unitPrice: z.number().finite() })),
  supports: z.object({
    enabled: z.boolean(),
    substrate: z.enum(['concrete', 'wood']),
    spacingSmall: z.number().finite().positive(),
    spacingLarge: z.number().finite().positive(),
    screwsPerSupport: z.number().int().min(0).max(10),
    holesPerBit: z.number().int().positive(),
  }).optional(),
  /** シールテープ・接着剤（v5 の途中で追加したため省略可） */
  consumables: z.object({
    enabled: z.boolean(),
    tapeRoll: z.number().finite().positive(),
    glueCan: z.number().finite().positive(),
  }).optional(),
  client: z.string().optional(),
  title: z.string().optional(),
  issuer: z.string().optional(),
  note: z.string().optional(),
});

export const underlaySchema = z.object({
  id: z.string().min(1),
  floorId: z.string().min(1),
  kind: z.enum(['image', 'pdf', 'aerial']),
  label: z.string(),
  // 画像のみ（SVG 等は受け付けない）
  src: z.string().max(MAX_UNDERLAY_SRC).regex(/^data:image\/(jpeg|png|webp);base64,/),
  widthPx: z.number().int().positive(),
  heightPx: z.number().int().positive(),
  center: vec2,
  mmPerPx: z.number().finite().positive(),
  rotation: z.number().finite(),
  opacity: z.number().min(0).max(1),
  scaled: z.boolean(),
  attribution: z.string().optional(),
});

export const elevationSchema = z.object({
  id: z.string().min(1),
  label: z.string(),
  wallId: z.string().min(1).optional(),
  floorId: z.string().min(1),
  origin: vec2,
  dir: vec2,
  normal: vec2,
  faceOffset: z.number().finite().nonnegative(),
  baseZ: z.number().finite(),
  width: z.number().finite().positive(),
  height: z.number().finite().positive(),
  mount: z.object({ type: z.enum(['tBracket', 'saddle']), standoff: z.number().finite().min(0).max(1000) }),
  photo: z.object({
    src: z.string().max(MAX_UNDERLAY_SRC).regex(/^data:image\/(jpeg|png|webp);base64,/),
    w: z.number().int().positive(),
    h: z.number().int().positive(),
  }).optional(),
  opacity: z.number().min(0).max(1),
});

/** 申請図面の現場設定（v5 の途中で追加したため省略可） */
export const siteSchema = z.object({
  /** 設計地盤高(mm)。1階床面（FL±0）との高低差。GL が床より下なら負 */
  designGL: z.number().finite().optional(),
  /** 使用中の自治体プロファイル ID（既定 standard） */
  municipalityProfileId: z.string().min(1).optional(),
});

export const SCHEMA_VERSION = 5;

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
  estimate: estimateSchema,
  underlays: z.record(z.string(), underlaySchema),
  /** 立面（外壁の写真と取付）。v5 の途中で追加したため省略可 */
  elevations: z.record(z.string(), elevationSchema).optional(),
  site: siteSchema.optional(),
  /** 書き出し時にだけ付く、使用中の自治体プロファイル本体（読み込み時に取り出して保存する。DB には残さない） */
  bundledProfile: z.unknown().optional(),
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

const projectV3Schema = projectV2Schema.extend({ schemaVersion: z.literal(3), fixtures: z.record(z.string(), fixtureSchema) });
const projectV4Schema = projectV3Schema.extend({ schemaVersion: z.literal(4), estimate: estimateSchema });

/** 旧形式を現行形式へ変換（未知の形式はそのまま返し、後段の検証で拒否される） */
export function migrate(raw: unknown): unknown {
  const v1 = projectV1Schema.safeParse(raw);
  if (v1.success) {
    return { ...v1.data, schemaVersion: SCHEMA_VERSION, building: addFloor(emptyBuilding()).b, fixtures: {}, estimate: defaultEstimate(), underlays: {} };
  }
  const v2 = projectV2Schema.safeParse(raw);
  if (v2.success) return { ...v2.data, schemaVersion: SCHEMA_VERSION, fixtures: {}, estimate: defaultEstimate(), underlays: {} };
  const v3 = projectV3Schema.safeParse(raw);
  if (v3.success) return { ...v3.data, schemaVersion: SCHEMA_VERSION, estimate: defaultEstimate(), underlays: {} };
  const v4 = projectV4Schema.safeParse(raw);
  if (v4.success) return { ...v4.data, schemaVersion: SCHEMA_VERSION, underlays: {} };
  return raw;
}
