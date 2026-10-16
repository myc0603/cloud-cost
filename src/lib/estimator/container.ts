/**
 * 서버리스 컨테이너 리소스 — AWS ECS Fargate / Azure Container Apps(Consumption) / GCP Cloud Run(인스턴스 기반 과금).
 * 상시 실행 기준: 컨테이너 수 × (vCPU 단가 × vCPU + GB 단가 × 메모리) × 730시간.
 * 플랫폼마다 허용되는 vCPU·메모리 조합이 달라 요구 스펙 이상인 가장 싼 허용 조합으로 올린다 (규칙은 아래 상수, 공식 문서값).
 * 아키텍처 토글을 따른다 (ARM은 Fargate만). 버스트 옵션은 해당 없음.
 */

import type { Arch, ContainerPrice, Provider } from '../schema';
import {
  HOURS_PER_MONTH,
  parsePositiveInt,
  priceAt,
  round2,
  type ContainerMatch,
  type MatchOptions,
  type NoMatchReason,
  type Resource,
  type ResourceDef,
} from './types';

/** 입력 vCPU 선택지 */
export const CONTAINER_VCPUS = [0.25, 0.5, 1, 2, 4, 8, 16];

type Shape = { vcpu: number; ramGb: number };
const range = (from: number, to: number, step: number) => Array.from({ length: Math.round((to - from) / step) + 1 }, (_, i) => from + i * step);

/** Fargate Linux 태스크 CPU·메모리 조합 — docs.aws.amazon.com/AmazonECS/latest/developerguide/fargate-tasks-services.html (2026-10-17 확인) */
const FARGATE_SHAPES: Shape[] = (
  [
    [0.25, [0.5, 1, 2]],
    [0.5, range(1, 4, 1)],
    [1, range(2, 8, 1)],
    [2, range(4, 16, 1)],
    [4, range(8, 30, 1)],
    [8, range(16, 60, 4)],
    [16, range(32, 120, 8)],
  ] as [number, number[]][]
).flatMap(([vcpu, rams]) => rams.map((ramGb) => ({ vcpu, ramGb })));

/** Container Apps Consumption 조합 — 0.25 vCPU 단위, 메모리 = vCPU × 2, 최대 4 vCPU (learn.microsoft.com/azure/container-apps/containers, 2026-10-17 확인) */
const CONTAINER_APPS_SHAPES: Shape[] = range(1, 16, 1).map((k) => ({ vcpu: k * 0.25, ramGb: k * 0.5 }));

/**
 * Cloud Run 인스턴스 기반 과금 — vCPU는 정수 1·2·4·6·8(분수 vCPU는 요청 기반 과금 전용), vCPU별 메모리 범위
 * (cloud.google.com/run/docs/configuring/services/cpu · memory-limits, 2026-10-17 확인). 메모리는 요구치 그대로(최소치 미만이면 최소치)
 */
const CLOUD_RUN_MEMORY: [vcpu: number, minGb: number, maxGb: number][] = [
  [1, 0.5, 4],
  [2, 0.5, 8],
  [4, 2, 16],
  [6, 4, 24],
  [8, 4, 32],
];

function shapes(provider: Provider, ramGb: number): Shape[] {
  if (provider === 'aws') return FARGATE_SHAPES;
  if (provider === 'azure') return CONTAINER_APPS_SHAPES;
  return CLOUD_RUN_MEMORY.flatMap(([vcpu, min, max]) => {
    const ram = Math.max(ramGb, min);
    return ram <= max ? [{ vcpu, ramGb: ram }] : [];
  });
}

/** 플랫폼별 최대 사이즈 — 사이즈 초과 안내용 */
const MAX: Record<Provider, Shape> = { aws: { vcpu: 16, ramGb: 120 }, azure: { vcpu: 4, ramGb: 8 }, gcp: { vcpu: 8, ramGb: 32 } };

/** 요구 스펙 이상인 허용 조합 × 아키텍처 중 최저가. 동가면 작은 조합 */
export function fitContainer(price: ContainerPrice, spec: Shape, opts: MatchOptions): ContainerMatch | NoMatchReason {
  const arches = (Object.keys(price.rates) as Arch[]).filter((a) => !opts.arch || opts.arch === 'both' || opts.arch === a);
  if (arches.length === 0) return { reason: 'arch', arch: opts.arch === 'x86' ? 'x86' : 'arm', scope: 'platform' };
  let best: ContainerMatch | null = null;
  for (const arch of arches) {
    const r = price.rates[arch]!;
    const { price: rate, committed } = priceAt(r, r.commit, opts.term);
    for (const s of shapes(price.provider, spec.ramGb)) {
      if (s.vcpu < spec.vcpu || s.ramGb < spec.ramGb) continue;
      const perHour = +(s.vcpu * rate.vcpuPerHour + s.ramGb * rate.gbPerHour).toFixed(6);
      if (!best || perHour < best.perHour || (perHour === best.perHour && s.vcpu < best.vcpu)) best = { ...s, arch, perHour, committed };
    }
  }
  if (best) return best;
  const max = MAX[price.provider];
  return { reason: 'size', maxVcpu: max.vcpu, maxRamGb: max.ramGb };
}

/** URL 본문: 0.5c1g:2 (vCPU c 메모리 GB g : 컨테이너 수). vCPU는 CONTAINER_VCPUS 중 하나 */
export const CONTAINER: ResourceDef<Extract<Resource, { type: 'container' }>> = {
  token: 'ctr',
  create: () => ({ type: 'container', vcpu: 1, ramGb: 2, count: 2 }),
  encode: (r) => `${r.vcpu}c${r.ramGb}g:${r.count}`,
  decode: (body) => {
    const m = body.match(/^([\d.]+)c(\d+)g:(\d+)$/);
    const vcpu = Number(m?.[1]);
    const [ramGb, count] = [m?.[2], m?.[3]].map(parsePositiveInt);
    return m && CONTAINER_VCPUS.includes(vcpu) && ramGb && count ? { type: 'container', vcpu, ramGb, count } : null;
  },
  estimate: (r, { index, pricing: { container }, opts }) => {
    const fit = container ? fitContainer(container, r, opts) : null;
    const matched = fit && 'perHour' in fit ? fit : null;
    return [
      {
        resourceIndex: index,
        kind: 'container',
        spec: { vcpu: r.vcpu, ramGb: r.ramGb, count: r.count },
        matched,
        noMatch: fit && !matched ? (fit as NoMatchReason) : null,
        monthlyUsd: matched ? round2(matched.perHour * HOURS_PER_MONTH * r.count) : null,
      },
    ];
  },
};
