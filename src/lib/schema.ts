/**
 * 공통 데이터 스키마 — collector(수집기)와 웹 앱이 공유한다.
 * 상세: docs/ARCHITECTURE.md §4
 */

export type Provider = 'aws' | 'azure' | 'gcp';

/** CPU 아키텍처. arm = Graviton(AWS)·Ampere(Azure/GCP) 계열 */
export type Arch = 'x86' | 'arm';

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
  arch: Arch; // x86 | arm — 매칭 필터 + 표시 배지
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

/**
 * 관리형 Kubernetes 컨트롤 플레인 — 표준(SLA 포함) 티어 클러스터 시간당 요금.
 * EKS 기본 / AKS Standard / GKE Regional. 무료 옵션(AKS Free·GKE 크레딧)·연장 지원은 비교 대상 아님.
 */
export interface K8sClusterPrice {
  provider: Provider;
  region: Region;
  clusterPerHour: number;
}

/**
 * L7(HTTP) 로드밸런서 — 시간당 고정 + 처리 GB당.
 * AWS ALB / Azure Application Gateway Standard v2 / GCP 리전 외부 애플리케이션 LB.
 * LCU·CU는 공식 정의상 "시간당 1GB 처리" 단위라 GB당 단가로 환산한다 (연결 수·규칙 평가 차원은 미반영).
 */
export interface LbPrice {
  provider: Provider;
  region: Region;
  perHour: number;
  perGb: number;
}

/**
 * NAT 게이트웨이 — 시간당 + 처리 GB당.
 * GCP Cloud NAT만 시간당 요금이 "NAT를 쓰는 VM 1대당"이고 maxVms대에서 상한.
 */
export interface NatPrice {
  provider: Provider;
  region: Region;
  hourly: { per: 'gateway'; usd: number } | { per: 'vm'; usd: number; maxVms: number };
  perGb: number;
}

/** 한 플랫폼의 리전별 요금 데이터 묶음 — pricing 로더가 반환하는 단위 */
export interface ProviderPricing {
  vm: VmSku[];
  storage: StorageSku[];
  egress: EgressTier | null;
  k8s: K8sClusterPrice | null;
  lb: LbPrice | null;
  nat: NatPrice | null;
}

/** data/meta.json */
export interface Meta {
  collectedAt: string; // ISO 8601
  usdKrw: { rate: number; at: string } | null; // 환율 조회 실패 시 null 가능
}
