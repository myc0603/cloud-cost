/**
 * 플랫폼 카탈로그 — 지원 플랫폼 목록·표시 이름·구성 요소 미제공 여부의 유일한 출처.
 * 플랫폼 추가 = Provider 유니온(schema.ts) + 여기 + regions.ts 리전 코드 + 수집기 + 상품명 맵(EstimateResult).
 */

import type { ResourceType } from './estimator/types';
import type { Provider, Region } from './schema';

/** 화면 표시 순서. 대표 3사(PRIMARY)가 위, 나머지는 아래에 구분해서 */
export const PROVIDERS: Provider[] = ['aws', 'azure', 'gcp', 'oci', 'ncp', 'scp', 'nhn'];

/** 대표 플랫폼 — 결과 화면 위쪽 묶음 */
export const PRIMARY_PROVIDERS: Provider[] = ['aws', 'azure', 'gcp'];

export const PROVIDER_LABEL: Record<Provider, string> = { aws: 'AWS', azure: 'Azure', gcp: 'GCP', oci: 'OCI', ncp: 'NCP', scp: 'Samsung SCP', nhn: 'NHN Cloud' };

/**
 * 플랫폼이 아예 제공하지 않는 구성 요소 — 견적 줄은 "미제공", 총액은 나머지 합계,
 * 최저가 비교에서는 빠진다 (구성 요소를 전부 제공하는 플랫폼끼리만 최저가를 가린다).
 * OCI CDN: 자체 CDN 상품 없음 (2026-10-17 가격 목록 확인)
 * NCP·SCP 서버리스 컨테이너: 상품 없음 — Cloud Functions는 함수형(FaaS)이라 다른 종류 (2026-10-17 요금 페이지 확인)
 */
export const NOT_OFFERED: Record<Provider, ResourceType[]> = { aws: [], azure: [], gcp: [], oci: ['cdn'], ncp: ['container'], scp: ['container'], nhn: [] };

/**
 * 리전에 따라 제공하지 않는 구성 요소 — 그 리전에서만 미제공 (처리는 NOT_OFFERED와 같다).
 * NHN 도쿄(JP1): NKS·NAT Gateway·EasyCache·NCS 요금표가 비어 있음 (2026-10-17 요금 페이지 확인)
 */
export const NOT_OFFERED_IN: Partial<Record<Provider, Partial<Record<Region, ResourceType[]>>>> = {
  nhn: { tokyo: ['k8s', 'nat', 'cache', 'container'] },
};

/** 이 플랫폼·리전에서 구성 요소를 제공하지 않는지 */
export const notOffered = (provider: Provider, region: Region, type: ResourceType): boolean =>
  NOT_OFFERED[provider].includes(type) || (NOT_OFFERED_IN[provider]?.[region]?.includes(type) ?? false);
