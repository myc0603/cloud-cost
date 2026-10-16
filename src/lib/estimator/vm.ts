/**
 * VM 리소스 — 스펙(vCPU·RAM) 최소 충족 최저가 매칭 + 사용자 선택(드롭다운) 반영.
 * 매칭 함수는 K8s 노드처럼 VM을 쓰는 다른 리소스에서도 재사용한다.
 */

import type { VmSku } from '../schema';
import {
  HOURS_PER_MONTH,
  parsePositiveInt,
  priceAt,
  round2,
  type EstimateLine,
  type MatchOptions,
  type NoMatchReason,
  type Resource,
  type ResourceDef,
  type VmMatch,
  type VmSpec,
} from './types';

/**
 * 요구 스펙을 만족하는(vCPU·RAM 최소 충족) 후보를 선택한 요금 기준(정가·약정) 가격 오름차순으로.
 * 동가면 vCPU가 작은 것 우선 → 과잉 프로비저닝 최소화. 첫 항목이 곧 최저가.
 */
export function qualifyingVms(skus: VmSku[], spec: VmSpec, opts: MatchOptions): VmMatch[] {
  return eligibleVms(skus, opts)
    .filter((s) => s.vcpu >= spec.vcpu && s.ramGb >= spec.ramGb)
    .map((s) => {
      const { price, committed } = priceAt(s.pricePerHour, s.commit, opts.term);
      return { ...s, perHour: price, committed };
    })
    .sort((a, b) => a.perHour - b.perHour || a.vcpu - b.vcpu);
}

/** 스펙과 무관한 매칭 조건(버스트·아키텍처)만 적용한 후보 */
function eligibleVms(skus: VmSku[], opts: MatchOptions): VmSku[] {
  const arch = opts.arch ?? 'both';
  return skus.filter((s) => (opts.includeBurstable || !s.burstable) && (arch === 'both' || s.arch === arch));
}

/** 후보가 없을 때 이유 — 조건 내 SKU가 0개면 arch, 아니면 최대 사이즈 안내 */
export function noMatchReason(skus: VmSku[], opts: MatchOptions): NoMatchReason {
  const pool = eligibleVms(skus, opts);
  if (pool.length === 0) return { reason: 'arch' };
  return {
    reason: 'size',
    maxVcpu: Math.max(...pool.map((s) => s.vcpu)),
    maxRamGb: Math.max(...pool.map((s) => s.ramGb)),
  };
}

/** 스펙 만족 후보 중 최저가 (자동 선택 기본값) */
export function matchVm(skus: VmSku[], spec: VmSpec, opts: MatchOptions): VmMatch | null {
  return qualifyingVms(skus, spec, opts)[0] ?? null;
}

/**
 * GCP 지속 사용 할인(SUD) 최대율 — 한 달 내내 쓰면 자동 적용, 견적(정가)에는 미반영이라 화면 안내용.
 * 대상 시리즈·최대율은 공식 문서값 (cloud.google.com/compute/docs/sustained-use-discounts, 2026-10-17 확인).
 * E2·N4·C3·C4·T2D 등은 대상 아님. 약정(CUD)이 덮는 사용량엔 적용되지 않는다.
 */
const GCP_SUD_MAX: Record<string, number> = { n1: 0.3, n2: 0.2, n2d: 0.2, c2: 0.2 };

/** SUD 대상 GCP VM이면 최대 할인율, 아니면 null */
export function gcpSustainedUseMax(vm: VmSku): number | null {
  return vm.provider === 'gcp' ? (GCP_SUD_MAX[vm.generation] ?? null) : null;
}

/**
 * 사이즈(vCPU·RAM)별 최저가 1개만 남긴다 — 드롭다운 후보용.
 * 같은 스펙에 더 비싼 SKU는 열등(strictly dominated)하므로 노이즈.
 * 입력이 가격 오름차순이면 각 사이즈의 첫 항목이 곧 최저가.
 */
export function cheapestPerSize<T extends { vcpu: number; ramGb: number }>(sorted: T[]): T[] {
  const seen = new Set<string>();
  return sorted.filter((s) => {
    const key = `${s.vcpu}/${s.ramGb}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** VM 스펙 하나의 견적 줄 — 고른 SKU가 조건 충족 후보에 있으면 그걸, 아니면 최저가로 self-heal */
export function vmLine(
  index: number,
  spec: VmSpec,
  skus: VmSku[],
  opts: MatchOptions,
  pick?: string,
  role: 'vm' | 'k8s-node' = 'vm',
): EstimateLine {
  const candidates = cheapestPerSize(qualifyingVms(skus, spec, opts));
  const matched = candidates.find((c) => c.sku === pick) ?? candidates[0] ?? null;
  return {
    resourceIndex: index,
    kind: 'vm',
    role,
    spec,
    matched,
    candidates,
    noMatch: matched ? null : noMatchReason(skus, opts),
    monthlyUsd: matched ? round2(matched.perHour * HOURS_PER_MONTH * spec.count) : null,
  };
}

type VmResource = Extract<Resource, { type: 'vm' }>;

/** URL 본문: 2c4g:2 (vCPU c RAM g : 대수) */
export const VM: ResourceDef<VmResource> = {
  token: 'vm',
  create: () => ({ type: 'vm', vcpu: 2, ramGb: 4, count: 1 }),
  encode: (r) => `${r.vcpu}c${r.ramGb}g:${r.count}`,
  decode: (body) => {
    const m = body.match(/^(\d+)c(\d+)g:(\d+)$/);
    const [vcpu, ramGb, count] = [m?.[1], m?.[2], m?.[3]].map(parsePositiveInt);
    return vcpu && ramGb && count ? { type: 'vm', vcpu, ramGb, count } : null;
  },
  estimate: ({ vcpu, ramGb, count }, { index, pricing, opts, pick }) => [
    vmLine(index, { vcpu, ramGb, count }, pricing.vm, opts, pick),
  ],
};
