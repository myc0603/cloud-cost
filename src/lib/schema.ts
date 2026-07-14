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

/** egress = 클라우드 밖(인터넷)으로 나가는 데이터 전송. 구간 요금 */
export interface EgressTier {
  provider: Provider;
  region: Region;
  freeGb: number; // 월 무료 구간
  tiers: { upToGb: number | null; pricePerGb: number }[]; // null = 무제한
}

/** data/meta.json */
export interface Meta {
  collectedAt: string; // ISO 8601
  usdKrw: { rate: number; at: string };
}
