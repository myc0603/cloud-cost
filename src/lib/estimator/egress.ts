/**
 * 아웃바운드 트래픽(egress) 리소스 — 무료 구간을 반영한 구간 요금 누적 계산.
 */

import type { EgressTier } from '../schema';
import { parsePositiveInt, round2, type Resource, type ResourceDef } from './types';

/** 구간 요금 누적 계산 — tiers는 0GB부터의 절대 사용량 구간(무료 구간 포함) */
export function calcEgressUsd(egress: EgressTier, gb: number): number {
  let cost = 0;
  let prev = 0;
  for (const tier of egress.tiers) {
    const cap = tier.upToGb ?? Infinity;
    const qty = Math.min(gb, cap) - prev;
    if (qty > 0) cost += qty * tier.pricePerGb;
    if (gb <= cap) break;
    prev = cap;
  }
  return cost;
}

/** URL 본문: 월 GB 정수 */
export const EGRESS: ResourceDef<Extract<Resource, { type: 'egress' }>> = {
  token: 'eg',
  singleton: true,
  create: () => ({ type: 'egress', gb: 1024 }),
  encode: (r) => String(r.gb),
  decode: (body) => {
    const gb = parsePositiveInt(body);
    return gb ? { type: 'egress', gb } : null;
  },
  estimate: (r, { index, pricing: { egress } }) => [
    {
      resourceIndex: index,
      kind: 'egress',
      gb: r.gb,
      freeGb: egress?.freeGb ?? null,
      monthlyUsd: egress ? round2(calcEgressUsd(egress, r.gb)) : null,
    },
  ],
};
