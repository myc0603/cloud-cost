/**
 * 스토리지 리소스 — 블록(범용 SSD)·오브젝트(표준 티어). 용량 × GB·월 단가.
 */

import type { ProviderPricing, StorageSku } from '../schema';
import { parsePositiveInt, round2, type EstimateLine, type Resource, type ResourceDef } from './types';

function storageLine(index: number, storageKind: StorageSku['kind'], sizeGb: number, pricing: ProviderPricing): EstimateLine {
  const sku = pricing.storage.find((s) => s.kind === storageKind);
  return {
    resourceIndex: index,
    kind: 'storage',
    storageKind,
    sizeGb,
    pricePerGbMonth: sku?.pricePerGbMonth ?? null,
    monthlyUsd: sku ? round2(sizeGb * sku.pricePerGbMonth) : null,
  };
}

/** URL 본문: GB 정수 */
export const BLOCK: ResourceDef<Extract<Resource, { type: 'block' }>> = {
  token: 'blk',
  create: () => ({ type: 'block', gb: 100 }),
  encode: (r) => String(r.gb),
  decode: (body) => {
    const gb = parsePositiveInt(body);
    return gb ? { type: 'block', gb } : null;
  },
  estimate: (r, { index, pricing }) => [storageLine(index, 'block-ssd', r.gb, pricing)],
};

/** URL 본문: GB 정수 */
export const OBJECT: ResourceDef<Extract<Resource, { type: 'object' }>> = {
  token: 'obj',
  create: () => ({ type: 'object', gb: 100 }),
  encode: (r) => String(r.gb),
  decode: (body) => {
    const gb = parsePositiveInt(body);
    return gb ? { type: 'object', gb } : null;
  },
  estimate: (r, { index, pricing }) => [storageLine(index, 'object-standard', r.gb, pricing)],
};
