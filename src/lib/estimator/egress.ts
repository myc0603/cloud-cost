/**
 * 아웃바운드 트래픽(egress) 리소스 — 무료 구간을 반영한 구간 요금 누적 계산.
 */

import type { EgressTier } from '../schema';
import { parsePositiveInt, round2, tieredCost, type Resource, type ResourceDef, type Scenario } from './types';

/** 구간 요금 누적 계산 — tiers는 0GB부터의 절대 사용량 구간(무료 구간 포함) */
export function calcEgressUsd(egress: EgressTier, gb: number): number {
  return tieredCost(egress.tiers.map((t) => ({ upTo: t.upToGb, price: t.pricePerGb })), gb);
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
  estimate: (r, { index, pricing: { egress }, scenario }) => {
    const e = egress?.perServerFree ? withServerFree(egress, scenario) : egress;
    return [
      {
        resourceIndex: index,
        kind: 'egress',
        gb: r.gb,
        freeGb: e?.freeGb ?? null,
        monthlyUsd: e ? round2(calcEgressUsd(e, r.gb)) : null,
      },
    ];
  },
};

/**
 * 서버당 무료 전송량(KT) — 시나리오의 서버(VM 카드 대수 + K8s 노드 수)별 무료량 합계를 앞 구간 무료로 붙인 요금표.
 * 서버 메모리는 요구 스펙 기준 (매칭된 인스턴스는 그 이상일 수 있어 무료량을 적게 잡는 쪽)
 */
export function withServerFree(egress: EgressTier, scenario: Scenario): EgressTier {
  const f = egress.perServerFree!;
  const perServer = (ramGb: number) => (ramGb >= f.largeFromRamGb ? f.largeGb : f.gb);
  const pool = scenario.resources.reduce(
    (sum, r) => sum + (r.type === 'vm' ? r.count * perServer(r.ramGb) : r.type === 'k8s' ? r.clusters * r.node.count * perServer(r.node.ramGb) : 0),
    0,
  );
  return {
    ...egress,
    freeGb: pool,
    tiers: [{ upToGb: pool, pricePerGb: 0 }, ...egress.tiers.map((t) => ({ upToGb: t.upToGb === null ? null : Math.max(t.upToGb, pool), pricePerGb: t.pricePerGb }))],
  };
}
