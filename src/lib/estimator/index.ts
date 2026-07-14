/**
 * 견적 엔진 — 순수 함수. 시나리오 × 요금표 → 플랫폼별 월 견적.
 * I/O·UI 의존 없음: 입력이 같으면 출력이 항상 같다 (테스트로 정확성 보장).
 * 상세: docs/ARCHITECTURE.md §5
 */

import type { Provider, Region, VmSku } from '../schema';

export interface VmSpec {
  vcpu: number;
  ramGb: number;
  count: number;
}

export interface Scenario {
  region: Region;
  vms: VmSpec[];
}

export interface MatchOptions {
  /** 버스트 인스턴스(t계열/B계열/E2 공유 코어)를 매칭 후보에 포함할지 */
  includeBurstable: boolean;
}

export interface VmLineItem {
  spec: VmSpec;
  /** 스펙을 만족하는 최저가 인스턴스. null = 조건 만족하는 인스턴스 없음 */
  matched: VmSku | null;
  monthlyUsd: number | null;
}

export interface ProviderEstimate {
  provider: Provider;
  /** 요금 데이터 존재 여부 — false면 "데이터 준비 중" */
  available: boolean;
  lines: VmLineItem[];
  /** 모든 항목이 매칭됐을 때만 총액. 불완전 견적에 총액을 보여주면 오해를 부른다 */
  totalMonthlyUsd: number | null;
}

/** 월 환산 시간 — 3사 계산기 관례(365d × 24h ÷ 12) */
export const HOURS_PER_MONTH = 730;

const round2 = (x: number) => +x.toFixed(2);

/**
 * 요구 스펙을 만족하는(vCPU·RAM 최소 충족) 후보 중 최저가 선택.
 * 동가면 vCPU가 작은 것 → 과잉 프로비저닝 최소화.
 */
export function matchVm(skus: VmSku[], spec: VmSpec, opts: MatchOptions): VmSku | null {
  const candidates = skus.filter(
    (s) => s.vcpu >= spec.vcpu && s.ramGb >= spec.ramGb && (opts.includeBurstable || !s.burstable),
  );
  if (candidates.length === 0) return null;
  return candidates.reduce((best, s) =>
    s.pricePerHour < best.pricePerHour ||
    (s.pricePerHour === best.pricePerHour && s.vcpu < best.vcpu)
      ? s
      : best,
  );
}

export function estimate(
  scenario: Scenario,
  skusByProvider: Record<Provider, VmSku[]>,
  opts: MatchOptions,
): ProviderEstimate[] {
  return (Object.keys(skusByProvider) as Provider[]).map((provider) => {
    const skus = skusByProvider[provider];
    if (skus.length === 0) {
      return { provider, available: false, lines: [], totalMonthlyUsd: null };
    }

    const lines: VmLineItem[] = scenario.vms.map((spec) => {
      const matched = matchVm(skus, spec, opts);
      return {
        spec,
        matched,
        monthlyUsd: matched ? round2(matched.pricePerHour * HOURS_PER_MONTH * spec.count) : null,
      };
    });

    const complete = lines.length > 0 && lines.every((l) => l.monthlyUsd !== null);
    return {
      provider,
      available: true,
      lines,
      totalMonthlyUsd: complete ? round2(lines.reduce((sum, l) => sum + l.monthlyUsd!, 0)) : null,
    };
  });
}
