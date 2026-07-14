/**
 * data/ 스냅샷 로더 — 파일 경로 규칙과 타입을 아는 유일한 곳.
 * 서버(빌드 시점) 전용: node:fs를 쓰므로 클라이언트 컴포넌트에서 import 금지.
 */

import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import type { EgressTier, Provider, ProviderPricing, Region, StorageSku, VmSku } from './schema';

export const PROVIDERS: Provider[] = ['aws', 'azure', 'gcp'];

function readJson<T>(provider: Provider, region: Region, file: string, fallback: T): T {
  const p = path.join(process.cwd(), 'data', provider, region, file);
  return existsSync(p) ? (JSON.parse(readFileSync(p, 'utf8')) as T) : fallback;
}

/** 리전의 플랫폼별 요금 데이터. 스냅샷이 아직 없는 항목은 빈 값 */
export function loadPricing(region: Region): Record<Provider, ProviderPricing> {
  const entries = PROVIDERS.map((provider) => {
    const pricing: ProviderPricing = {
      vm: readJson<VmSku[]>(provider, region, 'vm.json', []),
      storage: readJson<StorageSku[]>(provider, region, 'storage.json', []),
      egress: readJson<EgressTier | null>(provider, region, 'egress.json', null),
    };
    return [provider, pricing] as const;
  });
  return Object.fromEntries(entries) as Record<Provider, ProviderPricing>;
}
