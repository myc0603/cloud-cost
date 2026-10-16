'use client';

/**
 * 리전 요금을 필요할 때 받아오는 훅 — /pricing/{region}.json (빌드 시 정적 생성).
 * 페이지가 미리 넣어준 리전(initial)은 바로 쓰고, 나머지는 처음 고를 때 한 번만 받는다 (모듈 캐시 공유).
 */

import { useEffect, useState } from 'react';
import type { Provider, ProviderPricing, Region } from './schema';

type RegionPricing = Record<Provider, ProviderPricing>;

const cache = new Map<Region, Promise<RegionPricing>>();

function fetchRegion(region: Region): Promise<RegionPricing> {
  let p = cache.get(region);
  if (!p) {
    p = fetch(`/pricing/${region}.json`).then((res) => {
      if (!res.ok) throw new Error(`요금 데이터 응답 ${res.status}`);
      return res.json() as Promise<RegionPricing>;
    });
    p.catch(() => cache.delete(region)); // 실패는 캐시하지 않는다 — 다시 고르면 재시도
    cache.set(region, p);
  }
  return p;
}

/** pricing null + error false = 불러오는 중. region null = 받지 않음(호출부가 이미 데이터를 가진 경우) */
export function useRegionPricing(
  region: Region | null,
  initial: Partial<Record<Region, RegionPricing>>,
): { pricing: RegionPricing | null; error: boolean } {
  const [loaded, setLoaded] = useState(initial);
  const [failed, setFailed] = useState<Region | null>(null);

  useEffect(() => {
    if (!region || loaded[region]) return;
    let alive = true;
    fetchRegion(region).then(
      (p) => alive && setLoaded((l) => ({ ...l, [region]: p })),
      () => alive && setFailed(region),
    );
    return () => {
      alive = false;
    };
  }, [region, loaded]);

  if (!region) return { pricing: null, error: false };
  return { pricing: loaded[region] ?? null, error: failed === region && !loaded[region] };
}
