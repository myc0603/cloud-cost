/**
 * 공통 데이터 스키마 — collector(수집기)와 웹 앱이 공유한다.
 * 상세: docs/ARCHITECTURE.md §4
 */

export type Provider = 'aws' | 'azure' | 'gcp';

/** 정규화 리전 키. seoul = ap-northeast-2 / koreacentral / asia-northeast3 */
export type Region = 'seoul' | 'us-east';

/** VM — 가격은 USD, Linux 온디맨드, 시간당 */
export interface VmSku {
  provider: Provider;
  region: Region;
  sku: string; // "t3.medium" | "e2-medium" | "Standard_B2s"
  vcpu: number;
  ramGb: number;
  burstable: boolean; // 매칭 시 포함/제외 옵션
  generation: string; // 구세대 필터용 (패밀리 키)
  pricePerHour: number;
}

/** 스토리지 — GB·월 단가 */
export interface StorageSku {
  provider: Provider;
  region: Region;
  kind: 'block-ssd' | 'object-standard';
  pricePerGbMonth: number;
}

/**
 * egress = 클라우드 밖(인터넷)으로 나가는 데이터 전송. 구간 요금.
 * tiers는 0GB부터 시작하는 절대 사용량 구간(무료 구간은 pricePerGb 0으로 포함),
 * upToGb는 누적 상한(null = 무제한). freeGb는 표시용(선두 0원 구간의 상한).
 * 3사 모두 "인터넷 라우팅" 기준 (GCP Standard 티어 / Azure Routing Preference: Internet).
 */
export interface EgressTier {
  provider: Provider;
  region: Region;
  freeGb: number;
  tiers: { upToGb: number | null; pricePerGb: number }[];
}

/** 한 플랫폼의 리전별 요금 데이터 묶음 — pricing 로더가 반환하는 단위 */
export interface ProviderPricing {
  vm: VmSku[];
  storage: StorageSku[];
  egress: EgressTier | null;
}

/** data/meta.json */
export interface Meta {
  collectedAt: string; // ISO 8601
  usdKrw: { rate: number; at: string };
}
