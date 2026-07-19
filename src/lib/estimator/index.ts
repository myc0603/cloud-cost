/**
 * 견적 엔진 — 순수 함수. 시나리오 × 요금표 → 플랫폼별 월 견적.
 * I/O·UI 의존 없음: 입력이 같으면 출력이 항상 같다 (테스트로 정확성 보장).
 * 상세: docs/ARCHITECTURE.md §5
 */

import type { EgressTier, Provider, ProviderPricing, StorageSku, VmSku } from '../schema';
import type { Region } from '../schema';

export interface VmSpec {
  vcpu: number;
  ramGb: number;
  count: number;
}

export interface Scenario {
  region: Region;
  vms: VmSpec[];
  blockGb: number; // 0 = 미사용
  objectGb: number;
  egressGb: number; // 월 아웃바운드 전송량
}

/** 매칭할 CPU 아키텍처. both = x86·arm 통틀어 최저가 */
export type ArchFilter = 'x86' | 'arm' | 'both';

export interface MatchOptions {
  /** 버스트 인스턴스(t계열/B계열/E2 공유 코어)를 매칭 후보에 포함할지 */
  includeBurstable: boolean;
  /** 매칭할 아키텍처. 생략 시 both */
  arch?: ArchFilter;
}

/** 플랫폼 × VM 인덱스 → 사용자가 고른 SKU명. 조건 미충족·미존재 SKU는 무시하고 최저가로 self-heal */
export type Overrides = Partial<Record<Provider, Record<number, string>>>;

export type EstimateLine =
  | { kind: 'vm'; vmIndex: number; spec: VmSpec; matched: VmSku | null; candidates: VmSku[]; monthlyUsd: number | null }
  | { kind: 'storage'; storageKind: StorageSku['kind']; sizeGb: number; pricePerGbMonth: number | null; monthlyUsd: number | null }
  | { kind: 'egress'; gb: number; freeGb: number | null; monthlyUsd: number | null };

export interface ProviderEstimate {
  provider: Provider;
  /** VM 요금 데이터 존재 여부 — false면 "데이터 준비 중" */
  available: boolean;
  lines: EstimateLine[];
  /** 모든 항목이 계산됐을 때만 총액. 불완전 견적에 총액을 보여주면 오해를 부른다 */
  totalMonthlyUsd: number | null;
}

/** 월 환산 시간 — 3사 계산기 관례(365d × 24h ÷ 12) */
export const HOURS_PER_MONTH = 730;

const round2 = (x: number) => +x.toFixed(2);

/**
 * 요구 스펙을 만족하는(vCPU·RAM 최소 충족) 후보를 가격 오름차순으로.
 * 동가면 vCPU가 작은 것 우선 → 과잉 프로비저닝 최소화. 첫 항목이 곧 최저가.
 */
export function qualifyingVms(skus: VmSku[], spec: VmSpec, opts: MatchOptions): VmSku[] {
  const arch = opts.arch ?? 'both';
  return skus
    .filter(
      (s) =>
        s.vcpu >= spec.vcpu &&
        s.ramGb >= spec.ramGb &&
        (opts.includeBurstable || !s.burstable) &&
        (arch === 'both' || s.arch === arch),
    )
    .sort((a, b) => a.pricePerHour - b.pricePerHour || a.vcpu - b.vcpu);
}

/** 스펙 만족 후보 중 최저가 (자동 선택 기본값) */
export function matchVm(skus: VmSku[], spec: VmSpec, opts: MatchOptions): VmSku | null {
  return qualifyingVms(skus, spec, opts)[0] ?? null;
}

/**
 * 사이즈(vCPU·RAM)별 최저가 1개만 남긴다 — 드롭다운 후보용.
 * 같은 스펙에 더 비싼 SKU는 열등(strictly dominated)하므로 노이즈.
 * 입력이 가격 오름차순이면 각 사이즈의 첫 항목이 곧 최저가.
 */
export function cheapestPerSize(sorted: VmSku[]): VmSku[] {
  const seen = new Set<string>();
  return sorted.filter((s) => {
    const key = `${s.vcpu}/${s.ramGb}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

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

export function estimate(
  scenario: Scenario,
  pricing: Record<Provider, ProviderPricing>,
  opts: MatchOptions,
  overrides: Overrides = {},
): ProviderEstimate[] {
  return (Object.keys(pricing) as Provider[]).map((provider) => {
    const { vm: vmSkus, storage, egress } = pricing[provider];
    if (vmSkus.length === 0) {
      return { provider, available: false, lines: [], totalMonthlyUsd: null };
    }

    const lines: EstimateLine[] = scenario.vms.map((spec, i) => {
      const candidates = cheapestPerSize(qualifyingVms(vmSkus, spec, opts));
      const picked = overrides[provider]?.[i];
      // 고른 SKU가 조건 충족 후보에 있으면 그걸, 아니면 최저가로 self-heal
      const matched = candidates.find((c) => c.sku === picked) ?? candidates[0] ?? null;
      return {
        kind: 'vm' as const,
        vmIndex: i,
        spec,
        matched,
        candidates,
        monthlyUsd: matched ? round2(matched.pricePerHour * HOURS_PER_MONTH * spec.count) : null,
      };
    });

    const storageLine = (storageKind: StorageSku['kind'], sizeGb: number): EstimateLine => {
      const sku = storage.find((s) => s.kind === storageKind);
      return {
        kind: 'storage',
        storageKind,
        sizeGb,
        pricePerGbMonth: sku?.pricePerGbMonth ?? null,
        monthlyUsd: sku ? round2(sizeGb * sku.pricePerGbMonth) : null,
      };
    };
    if (scenario.blockGb > 0) lines.push(storageLine('block-ssd', scenario.blockGb));
    if (scenario.objectGb > 0) lines.push(storageLine('object-standard', scenario.objectGb));

    if (scenario.egressGb > 0) {
      lines.push({
        kind: 'egress',
        gb: scenario.egressGb,
        freeGb: egress?.freeGb ?? null,
        monthlyUsd: egress ? round2(calcEgressUsd(egress, scenario.egressGb)) : null,
      });
    }

    const complete = lines.length > 0 && lines.every((l) => l.monthlyUsd !== null);
    return {
      provider,
      available: true,
      lines,
      totalMonthlyUsd: complete ? round2(lines.reduce((sum, l) => sum + l.monthlyUsd!, 0)) : null,
    };
  });
}
