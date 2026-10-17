/**
 * 리전 카탈로그 — 지원 리전 목록과 플랫폼별 실제 리전 코드의 유일한 출처.
 * 리전 추가 = 여기 한 줄 + Region 유니온(schema.ts) + 리전 이름 문구(messages) + 플랫폼별 지역 요금 매핑(컴파일러가 빠진 곳을 알려준다).
 * null = 그 플랫폼은 이 리전을 제공하지 않음 → 수집 대상에서 빠지고 화면은 "이 리전 미제공".
 */

import type { Provider, Region } from './schema';

export const REGION_CODES: Record<Region, Record<Provider, string | null>> = {
  seoul: { aws: 'ap-northeast-2', azure: 'koreacentral', gcp: 'asia-northeast3', oci: 'ap-seoul-1', ncp: 'KR' },
  tokyo: { aws: 'ap-northeast-1', azure: 'japaneast', gcp: 'asia-northeast1', oci: 'ap-tokyo-1', ncp: 'JPN' },
  singapore: { aws: 'ap-southeast-1', azure: 'southeastasia', gcp: 'asia-southeast1', oci: 'ap-singapore-1', ncp: 'SGN' },
  'us-east': { aws: 'us-east-1', azure: 'eastus', gcp: 'us-east1', oci: 'us-ashburn-1', ncp: null },
  'us-west': { aws: 'us-west-2', azure: 'westus2', gcp: 'us-west1', oci: 'us-sanjose-1', ncp: null },
  frankfurt: { aws: 'eu-central-1', azure: 'germanywestcentral', gcp: 'europe-west3', oci: 'eu-frankfurt-1', ncp: null },
  london: { aws: 'eu-west-2', azure: 'uksouth', gcp: 'europe-west2', oci: 'uk-london-1', ncp: null },
};

export const REGIONS = Object.keys(REGION_CODES) as Region[];

/** 플랫폼이 이 리전을 제공하는지 */
export const offeredIn = (region: Region, provider: Provider) => REGION_CODES[region][provider] !== null;

/** 수집기용 — 플랫폼의 리전 코드 맵. 미제공 리전은 수집 대상에서 빠지므로(collector/main.ts) 빈 문자열은 쓰이지 않는다 */
export const regionCodes = (provider: Provider) =>
  Object.fromEntries(REGIONS.map((r) => [r, REGION_CODES[r][provider] ?? ''])) as Record<Region, string>;
