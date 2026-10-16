/**
 * 견적 엔진 — 순수 함수. 시나리오 × 요금표 → 플랫폼별 월 견적.
 * I/O·UI 의존 없음: 입력이 같으면 출력이 항상 같다 (테스트로 정확성 보장).
 * 상세: docs/ARCHITECTURE.md §5
 *
 * 리소스 타입별 계산·URL 토큰은 각 모듈(vm·storage·egress·k8s·lb·nat·db·cache·container·cdn)에 있고, 여기는 레지스트리와 합산만 한다.
 */

import type { Provider, ProviderPricing } from '../schema';
import { CACHE } from './cache';
import { CDN } from './cdn';
import { CONTAINER } from './container';
import { DB } from './db';
import { EGRESS } from './egress';
import { K8S } from './k8s';
import { LB } from './lb';
import { NAT } from './nat';
import { BLOCK, OBJECT } from './storage';
import {
  round2,
  type EstimateLine,
  type MatchOptions,
  type Overrides,
  type ProviderEstimate,
  type Resource,
  type ResourceDef,
  type ResourceType,
  type Scenario,
} from './types';
import { VM } from './vm';

export * from './types';
export { calcEgressUsd } from './egress';
export { CONTAINER_VCPUS, fitContainer } from './container';
export { cdnMonthly } from './cdn';
export { cheapestPerSize, gcpSustainedUseMax, matchVm, noMatchReason, qualifyingVms } from './vm';

/** 리소스 타입 레지스트리 — 키 순서가 "+ 추가" 버튼 순서 */
export const RESOURCES: { [K in ResourceType]: ResourceDef<Extract<Resource, { type: K }>> } = {
  vm: VM,
  block: BLOCK,
  object: OBJECT,
  egress: EGRESS,
  k8s: K8S,
  lb: LB,
  nat: NAT,
  db: DB,
  cache: CACHE,
  container: CONTAINER,
  cdn: CDN,
};

/** 타입별 정의 조회 — 유니온을 좁히지 못하는 호출부용 */
export const resourceDef = (r: Resource) => RESOURCES[r.type] as ResourceDef<Resource>;

export function estimate(
  scenario: Scenario,
  pricing: Record<Provider, ProviderPricing>,
  opts: MatchOptions,
  overrides: Overrides = {},
): ProviderEstimate[] {
  return (Object.keys(pricing) as Provider[]).map((provider) => {
    const p = pricing[provider];
    if (p.vm.length === 0) {
      return { provider, available: false, lines: [], totalMonthlyUsd: null };
    }

    const lines: EstimateLine[] = scenario.resources.flatMap((r, index) =>
      resourceDef(r).estimate(r, { index, pricing: p, opts, pick: overrides[provider]?.[index], scenario }),
    );

    const complete = lines.length > 0 && lines.every((l) => l.monthlyUsd !== null);
    return {
      provider,
      available: true,
      lines,
      totalMonthlyUsd: complete ? round2(lines.reduce((sum, l) => sum + l.monthlyUsd!, 0)) : null,
    };
  });
}
