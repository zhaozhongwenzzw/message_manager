// 标签 / 头像统一调色：按字符串 hash 稳定映射到一组品牌色块。
// avatar 用浅底深字（色块头像），chip 用浅底深字 + 边框（标签胶囊）。

const AVATAR_PALETTE = [
  'bg-brand-50 text-brand-700',
  'bg-info-50 text-info-600',
  'bg-warn-50 text-warn-600',
  'bg-agent-50 text-agent-600',
  'bg-rose-50 text-rose-600',
  'bg-sky-50 text-sky-600',
  'bg-teal-50 text-teal-600',
  'bg-indigo-50 text-indigo-600'
];

const CHIP_PALETTE = [
  'bg-brand-50 text-brand-700 border-brand-100',
  'bg-info-50 text-info-600 border-info-100',
  'bg-warn-50 text-warn-600 border-warn-100',
  'bg-agent-50 text-agent-600 border-agent-100',
  'bg-rose-50 text-rose-600 border-rose-100',
  'bg-sky-50 text-sky-600 border-sky-100',
  'bg-teal-50 text-teal-600 border-teal-100',
  'bg-indigo-50 text-indigo-600 border-indigo-100'
];

const DOT_PALETTE = [
  'bg-brand-500',
  'bg-info-500',
  'bg-warn-500',
  'bg-agent-500',
  'bg-rose-500',
  'bg-sky-500',
  'bg-teal-500',
  'bg-indigo-500'
];

function hashIndex(label: string, mod: number): number {
  let h = 0;
  for (let i = 0; i < label.length; i++) h = (h * 31 + label.charCodeAt(i)) >>> 0;
  return h % mod;
}

export function avatarTone(label: string): string {
  return AVATAR_PALETTE[hashIndex(label, AVATAR_PALETTE.length)];
}

export function tagChipTone(label: string): string {
  return CHIP_PALETTE[hashIndex(label, CHIP_PALETTE.length)];
}

export function tagDotTone(label: string): string {
  return DOT_PALETTE[hashIndex(label, DOT_PALETTE.length)];
}
