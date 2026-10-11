/**
 * NAT 게이트웨이 리소스 — 시간당 + 처리 GB당.
 * GCP Cloud NAT는 시간당 요금이 "NAT를 쓰는 VM 1대당"이라, 시나리오의 VM 카드 대수 + K8s 노드 수를
 * 과금 VM으로 보고 게이트웨이당 상한(maxVms)을 적용한다 (VM이 게이트웨이들에 고르게 나뉜다고 가정).
 */

import { HOURS_PER_MONTH, parsePositiveInt, round2, type Resource, type ResourceDef, type Scenario } from './types';

/** 시나리오에서 NAT를 쓸 수 있는 VM 수 — VM 카드 대수 + K8s 노드 수 */
export function scenarioVmCount(scenario: Scenario): number {
  return scenario.resources.reduce(
    (n, r) => n + (r.type === 'vm' ? r.count : r.type === 'k8s' ? r.clusters * r.node.count : 0),
    0,
  );
}

/** URL 본문: 1:1000 (게이트웨이 수 : 월 처리 GB) */
export const NAT: ResourceDef<Extract<Resource, { type: 'nat' }>> = {
  token: 'nat',
  create: () => ({ type: 'nat', count: 1, gb: 100 }),
  encode: (r) => `${r.count}:${r.gb}`,
  decode: (body) => {
    const [count, gb] = body.split(':').map(parsePositiveInt);
    return count && gb && body.split(':').length === 2 ? { type: 'nat', count, gb } : null;
  },
  estimate: (r, { index, pricing: { nat }, scenario }) => {
    const billedVms = nat?.hourly.per === 'vm' ? Math.min(scenarioVmCount(scenario), nat.hourly.maxVms * r.count) : null;
    const hourlyUsd = !nat ? null : nat.hourly.per === 'vm' ? nat.hourly.usd * billedVms! : nat.hourly.usd * r.count;
    return [
      {
        resourceIndex: index,
        kind: 'nat',
        count: r.count,
        gb: r.gb,
        billedVms,
        monthlyUsd: nat && hourlyUsd !== null ? round2(hourlyUsd * HOURS_PER_MONTH + nat.perGb * r.gb) : null,
      },
    ];
  },
};
