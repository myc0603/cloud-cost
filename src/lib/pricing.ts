/**
 * data/ 스냅샷 로더 — 파일 경로 규칙과 타입을 아는 유일한 곳.
 * 서버(빌드 시점) 전용: node:fs를 쓰므로 클라이언트 컴포넌트에서 import 금지.
 */

import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import type { Provider, Region, VmSku } from './schema';

export const PROVIDERS: Provider[] = ['aws', 'azure', 'gcp'];

/** 리전의 플랫폼별 VM 요금표. 스냅샷이 아직 없는 플랫폼은 빈 배열 */
export function loadVmSkus(region: Region): Record<Provider, VmSku[]> {
  const entries = PROVIDERS.map((provider) => {
    const file = path.join(process.cwd(), 'data', provider, region, 'vm.json');
    const skus: VmSku[] = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : [];
    return [provider, skus] as const;
  });
  return Object.fromEntries(entries) as Record<Provider, VmSku[]>;
}
