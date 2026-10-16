/**
 * CDN 리소스 — AWS CloudFront / Azure Front Door Standard / GCP Cloud CDN.
 * 종량제 = 월 고정비 + 시청자 전송(GB 구간) + 요청(1만 건 구간) + 캐시 채움(GCP, 캐시 미스분).
 * CloudFront는 사용량을 감당하는 가장 싼 정액 요금제와 종량제 중 싼 쪽.
 * 시청자 지역 = 리전과 같은 지역 가정, 상시 무료 사용량 미반영 (요금제인 CloudFront Free는 반영).
 */

import type { CdnPrice } from '../schema';
import { parsePositiveInt, round2, tieredCost, type Resource, type ResourceDef } from './types';

/** 캐시 미스 비율 가정 — GCP 캐시 채움 계산용 (적중률 90%, methodology 고지) */
export const CDN_MISS_RATIO = 0.1;

/** 월 비용과 적용 요금제 (정액제면 이름, 종량제면 null) */
export function cdnMonthly(price: CdnPrice, gb: number, requests: number): { usd: number; plan: string | null } {
  const payg =
    price.monthlyBase +
    tieredCost(price.gbTiers, gb) +
    tieredCost(price.requestTiers, requests / 10_000) +
    gb * CDN_MISS_RATIO * price.fillPerGb;
  const plan = price.plans
    .filter((p) => gb <= p.maxGb && requests <= p.maxRequests)
    .sort((a, b) => a.monthlyUsd - b.monthlyUsd)[0];
  return plan && plan.monthlyUsd < payg ? { usd: plan.monthlyUsd, plan: plan.name } : { usd: payg, plan: null };
}

/** URL 본문: 1024:10 (월 전송 GB : 월 요청 백만 건) */
export const CDN: ResourceDef<Extract<Resource, { type: 'cdn' }>> = {
  token: 'cdn',
  singleton: true, // 구간 요금·Front Door 기본료가 전체 사용량 기준이라 카드를 나누면 중복 적용된다 (egress와 같은 이유)
  create: () => ({ type: 'cdn', gb: 1024, requestsM: 10 }),
  encode: (r) => `${r.gb}:${r.requestsM}`,
  decode: (body) => {
    const [gb, requestsM] = body.split(':').map(parsePositiveInt);
    return gb && requestsM && body.split(':').length === 2 ? { type: 'cdn', gb, requestsM } : null;
  },
  estimate: (r, { index, pricing: { cdn } }) => {
    const m = cdn ? cdnMonthly(cdn, r.gb, r.requestsM * 1_000_000) : null;
    return [{ resourceIndex: index, kind: 'cdn', gb: r.gb, requestsM: r.requestsM, plan: m?.plan ?? null, monthlyUsd: m ? round2(m.usd) : null }];
  },
};
