import type { SystemType } from '../model/network';

export const SYSTEMS: { id: SystemType; label: string; color: string }[] = [
  { id: 'water', label: '給水', color: '#2563eb' },
  { id: 'hotWater', label: '給湯', color: '#dc2626' },
  { id: 'drain', label: '排水', color: '#92400e' },
  { id: 'sewage', label: '汚水', color: '#6b7280' },
  { id: 'vent', label: '通気', color: '#0891b2' },
  { id: 'gas', label: 'ガス', color: '#ca8a04' },
  { id: 'refrigerant', label: '冷媒', color: '#ea580c' },
  { id: 'condensate', label: 'ドレン', color: '#65a30d' },
  { id: 'electric', label: '電気', color: '#16a34a' },
  { id: 'telecom', label: '通信', color: '#9333ea' },
  { id: 'other', label: 'その他', color: '#475569' },
];

export const systemColor = (s: SystemType) => SYSTEMS.find((x) => x.id === s)?.color ?? '#475569';
export const systemLabel = (s: SystemType) => SYSTEMS.find((x) => x.id === s)?.label ?? s;
export const SELECT_COLOR = '#f59e0b';
