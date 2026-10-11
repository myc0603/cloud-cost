/**
 * L7 로드밸런서 리소스 — 시간당 고정 × 대수 + 처리 GB당 × 월 처리 트래픽.
 * 처리량 과금 단위(LCU·CU)는 수집 단계에서 GB당 단가로 환산돼 있다 (schema.ts LbPrice).
 */

import { HOURS_PER_MONTH, parsePositiveInt, round2, type Resource, type ResourceDef } from './types';

/** URL 본문: 1:500 (대수 : 월 처리 GB) */
export const LB: ResourceDef<Extract<Resource, { type: 'lb' }>> = {
  token: 'lb',
  create: () => ({ type: 'lb', count: 1, gb: 100 }),
  encode: (r) => `${r.count}:${r.gb}`,
  decode: (body) => {
    const [count, gb] = body.split(':').map(parsePositiveInt);
    return count && gb && body.split(':').length === 2 ? { type: 'lb', count, gb } : null;
  },
  estimate: (r, { index, pricing: { lb } }) => [
    {
      resourceIndex: index,
      kind: 'lb',
      count: r.count,
      gb: r.gb,
      monthlyUsd: lb ? round2(lb.perHour * HOURS_PER_MONTH * r.count + lb.perGb * r.gb) : null,
    },
  ],
};
