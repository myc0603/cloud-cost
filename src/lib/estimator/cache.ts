/**
 * Redis 호환 관리형 캐시 리소스 — AWS ElastiCache(Valkey) / Azure Managed Redis / GCP Memorystore for Redis.
 * - AWS·Azure: 메모리 ≥ 요구치인 노드·SKU 중 최저가 (드롭다운 선택 가능). AWS t계열은 버스트 옵션을 따른다
 * - GCP: 요구치를 GB 단위로 올림(최소 1GB)해 용량이 속한 구간 단가 × 용량 (최대 300GB, 문서값)
 * 이중화 단가는 수집 단계에서 정해진다(AWS 복제 노드 2개, Azure 2노드, GCP Standard 등급). 아키텍처 토글은 미적용.
 */

import { HOURS_PER_MONTH, parsePositiveInt, round2, type CacheMatch, type NoMatchReason, type Resource, type ResourceDef } from './types';

/** Memorystore for Redis 인스턴스 용량 범위 — cloud.google.com/memorystore/docs/redis (2026-10-12 확인) */
const MEMORYSTORE = { minGb: 1, maxGb: 300 };

/** URL 본문: 4:1:2 (메모리 GB : 이중화 0/1 : 캐시 개수) */
export const CACHE: ResourceDef<Extract<Resource, { type: 'cache' }>> = {
  token: 'cache',
  create: () => ({ type: 'cache', memoryGb: 1, ha: false, count: 1 }),
  encode: (r) => `${r.memoryGb}:${r.ha ? 1 : 0}:${r.count}`,
  decode: (body) => {
    const m = body.match(/^(\d+):([01]):(\d+)$/);
    if (!m) return null;
    const [memoryGb, count] = [m[1], m[3]].map(parsePositiveInt);
    return memoryGb && count ? { type: 'cache', memoryGb, ha: m[2] === '1', count } : null;
  },
  estimate: (r, { index, pricing: { cache }, opts, pick }) => {
    let candidates: CacheMatch[] = [];
    let noMatch: NoMatchReason | null = null;

    if (cache?.gbTiers) {
      const gb = Math.max(MEMORYSTORE.minGb, Math.ceil(r.memoryGb));
      const i = cache.gbTiers.findIndex((t) => t.upToGb === null || gb <= t.upToGb);
      if (gb > MEMORYSTORE.maxGb || i < 0) {
        noMatch = { reason: 'memory', maxGb: MEMORYSTORE.maxGb };
      } else {
        const tier = cache.gbTiers[i];
        const perHour = +(gb * (r.ha ? tier.haPerGbHour : tier.perGbHour)).toFixed(6);
        candidates = [{ sku: `${r.ha ? 'Standard' : 'Basic'} M${i + 1} ${gb}GB`, memoryGb: gb, perHour }];
      }
    } else if (cache) {
      const pool = cache.nodes.filter((n) => opts.includeBurstable || !n.burstable);
      const seen = new Set<number>(); // 같은 메모리 크기는 최저가 1개만 (드롭다운 노이즈 제거, VM의 cheapestPerSize와 같은 취지)
      candidates = pool
        .filter((n) => n.memoryGb >= r.memoryGb)
        .map((n) => ({ sku: n.sku, memoryGb: n.memoryGb, perHour: r.ha ? n.haPerHour : n.perHour }))
        .sort((a, b) => a.perHour - b.perHour || a.memoryGb - b.memoryGb)
        .filter((c) => !seen.has(c.memoryGb) && !!seen.add(c.memoryGb));
      if (candidates.length === 0 && pool.length > 0) noMatch = { reason: 'memory', maxGb: Math.max(...pool.map((n) => n.memoryGb)) };
    }

    const matched = candidates.find((c) => c.sku === pick) ?? candidates[0] ?? null;
    return [
      {
        resourceIndex: index,
        kind: 'cache',
        engine: cache?.engine ?? null,
        memoryGb: r.memoryGb,
        ha: r.ha,
        count: r.count,
        matched,
        candidates,
        noMatch,
        monthlyUsd: matched ? round2(matched.perHour * HOURS_PER_MONTH * r.count) : null,
      },
    ];
  },
};
