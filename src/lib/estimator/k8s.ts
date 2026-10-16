/**
 * 관리형 Kubernetes 리소스 (EKS·AKS·GKE) — 컨트롤 플레인 + 워커 노드 두 줄.
 * 컨트롤 플레인: 표준(SLA 포함) 티어 클러스터 시간당 요금 × 클러스터 수.
 * 워커 노드: 일반 VM과 같은 매칭(최저가·드롭다운)이되 버스트는 항상 제외 — 파드를 몰아넣어 꾸준히 쓰는 노드엔 CPU 크레딧 방식이 안 맞음.
 * 노드 수 = 클러스터 수 × 클러스터당 노드.
 */

import { HOURS_PER_MONTH, parsePositiveInt, round2, type Resource, type ResourceDef } from './types';
import { vmLine } from './vm';

/** URL 본문: 1:4c16g:3 (클러스터 수 : 노드 vCPU c RAM g : 클러스터당 노드 수) */
export const K8S: ResourceDef<Extract<Resource, { type: 'k8s' }>> = {
  token: 'k8s',
  create: () => ({ type: 'k8s', clusters: 1, node: { vcpu: 4, ramGb: 16, count: 3 } }),
  encode: (r) => `${r.clusters}:${r.node.vcpu}c${r.node.ramGb}g:${r.node.count}`,
  decode: (body) => {
    const m = body.match(/^(\d+):(\d+)c(\d+)g:(\d+)$/);
    const [clusters, vcpu, ramGb, count] = [m?.[1], m?.[2], m?.[3], m?.[4]].map(parsePositiveInt);
    return clusters && vcpu && ramGb && count ? { type: 'k8s', clusters, node: { vcpu, ramGb, count } } : null;
  },
  estimate: (r, { index, pricing, opts, pick }) => {
    const perHour = pricing.k8s?.clusterPerHour ?? null;
    return [
      {
        resourceIndex: index,
        kind: 'k8s-control',
        clusters: r.clusters,
        clusterPerHour: perHour,
        monthlyUsd: perHour === null ? null : round2(perHour * HOURS_PER_MONTH * r.clusters),
      },
      vmLine(index, { ...r.node, count: r.node.count * r.clusters }, pricing.vm, { ...opts, includeBurstable: false }, pick, 'k8s-node'),
    ];
  },
};
