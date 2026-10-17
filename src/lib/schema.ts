/**
 * 공통 데이터 스키마 — collector(수집기)와 웹 앱이 공유한다.
 * 상세: docs/ARCHITECTURE.md §4
 */

/** 플랫폼 목록·라벨·미제공 구성 요소는 providers.ts */
export type Provider = 'aws' | 'azure' | 'gcp' | 'oci' | 'ncp' | 'scp' | 'nhn';

/** CPU 아키텍처. arm = Graviton(AWS)·Ampere(Azure/GCP) 계열 */
export type Arch = 'x86' | 'arm';

/** 정규화 리전 키. 플랫폼별 실제 리전 코드는 regions.ts */
export type Region = 'seoul' | 'tokyo' | 'singapore' | 'us-east' | 'us-west' | 'frankfurt' | 'london';

/**
 * 약정 기간. 약정가는 3사 모두 "인스턴스 고정형 + 선결제 없음" 기준의 시간당 실효가
 * (AWS Standard RI·EC2 Instance SP / Azure 예약 / GCP 리소스 CUD, 지출 기반 CUD 상품은 공식 할인율).
 * 선결제 없음이 없는 상품(RDS 3년 일부)은 부분 선결제액 ÷ 기간 시간을 시간당에 더한다.
 */
export type Term = '1y' | '3y';

/** 기간별 약정가. 키가 없으면 그 기간 약정 상품이 없다 */
export type CommitPrices<T> = Partial<Record<Term, T>>;

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
  /** 약정 시간당 */
  commit?: CommitPrices<number>;
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

/** 관리형 DB 엔진 */
export type DbEngine = 'mysql' | 'postgres';

/** 정해진 사이즈의 관리형 DB 인스턴스 — AWS RDS 클래스 / Azure Flexible Server SKU */
export interface DbInstance {
  sku: string;
  vcpu: number;
  ramGb: number;
  burstable: boolean;
  perHour: number;
  /** 이중화(대기 서버 포함) 시간당. null = 이중화 미지원 (Azure 버스트 등급) */
  haPerHour: number | null;
  commit?: CommitPrices<{ perHour: number; haPerHour: number | null }>;
}

/** 커스텀 사이즈 단가 한 벌 */
export interface DbRateSet {
  vcpuPerHour: number;
  ramGbPerHour: number;
  haVcpuPerHour: number;
  haRamGbPerHour: number;
}

/** 커스텀 사이즈 관리형 DB 단가 — GCP Cloud SQL Enterprise. 사이즈 규칙은 estimator/db.ts */
export interface DbCustomRates extends DbRateSet {
  commit?: CommitPrices<DbRateSet>;
}

/** 엔진 하나의 요금 — instances(정해진 사이즈) 또는 custom(커스텀 사이즈) 중 하나를 쓴다 */
export interface DbEnginePricing {
  instances: DbInstance[];
  custom: DbCustomRates | null;
  storageGbMonth: number;
  haStorageGbMonth: number;
}

/**
 * 관리형 DB — AWS RDS / Azure Database Flexible Server / GCP Cloud SQL Enterprise.
 * 엔진별 가격이 플랫폼마다 달라(AWS·Azure) 엔진 단위로 저장한다.
 */
export interface DbPrice {
  provider: Provider;
  region: Region;
  engines: Record<DbEngine, DbEnginePricing | null>;
}

/** 정해진 사이즈의 관리형 캐시 — AWS ElastiCache 노드 / Azure Managed Redis SKU */
export interface CacheNode {
  sku: string;
  memoryGb: number;
  burstable: boolean;
  perHour: number;
  /** 이중화(주 + 복제 노드) 시간당 */
  haPerHour: number;
  commit?: CommitPrices<{ perHour: number; haPerHour: number }>;
}

/** 용량 구간 단가 — GCP Memorystore. 인스턴스 용량이 속한 구간의 단가가 용량 전체에 적용된다 (누적 아님) */
export interface CacheGbTier {
  /** 구간 상한 GB (null = 무제한) */
  upToGb: number | null;
  perGbHour: number;
  haPerGbHour: number;
  /** 약정 대상이 아닌 구간(Memorystore M1, 5GB 미만)은 없음 */
  commit?: CommitPrices<{ perGbHour: number; haPerGbHour: number }>;
}

/**
 * Redis 호환 관리형 캐시 — AWS ElastiCache(Valkey) / Azure Managed Redis / GCP Memorystore for Redis.
 * nodes(정해진 사이즈) 또는 gbTiers(GB 단가) 중 하나를 쓴다.
 */
export interface CachePrice {
  provider: Provider;
  region: Region;
  /** 표시용 엔진명 — 'Valkey' | 'Redis' */
  engine: string;
  nodes: CacheNode[];
  gbTiers: CacheGbTier[] | null;
}

/** 컨테이너 vCPU·메모리 시간 단가 한 벌 */
export interface ContainerRate {
  vcpuPerHour: number;
  gbPerHour: number;
}

/**
 * 서버리스 컨테이너 — AWS ECS Fargate / Azure Container Apps(Consumption, 활성 요금) / GCP Cloud Run(인스턴스 기반 과금).
 * 상시 실행 기준 vCPU·GB 시간 단가. 허용 사이즈 조합은 플랫폼마다 달라 estimator/container.ts의 문서값 규칙을 쓴다.
 * 약정은 3사 모두 유연형·지출 기반뿐이라 그걸 쓴다 (Fargate Compute SP / Azure Savings Plan / Cloud Run 유연 CUD).
 */
export interface ContainerPrice {
  provider: Provider;
  region: Region;
  /** 아키텍처별 단가 — ARM은 Fargate만 */
  rates: Partial<Record<Arch, ContainerRate & { commit?: CommitPrices<ContainerRate> }>>;
}

/** 구간 단가 — upTo는 0부터의 누적 상한(null = 무제한), 단위는 쓰는 곳이 정한다 */
export interface PriceTier {
  upTo: number | null;
  price: number;
}

/** CloudFront 정액 요금제 — 배포당 월정액, 한도 안이면 초과 요금 없음 (한도 초과 시 성능 조정 가능 → 한도 안 요금제만 고른다) */
export interface CdnPlan {
  name: string;
  monthlyUsd: number;
  maxGb: number;
  maxRequests: number;
}

/**
 * CDN — AWS CloudFront / Azure Front Door Standard / GCP Cloud CDN.
 * 시청자는 리전과 같은 지역으로 가정한다 (서울 → 한국·아시아태평양 요금, 미국 동부 → 북미 요금).
 * 오리진 → CDN 전송: AWS·Azure 오리진은 무료, GCP는 캐시 채움(fillPerGb, 캐시 미스분).
 */
export interface CdnPrice {
  provider: Provider;
  region: Region;
  /** 시청자 방향 전송 — GB 구간 */
  gbTiers: PriceTier[];
  /** 요청 — 1만 건 단위 구간 (upTo도 1만 건 단위) */
  requestTiers: PriceTier[];
  /** 월 고정비 (Front Door 프로필 기본료). 없으면 0 */
  monthlyBase: number;
  /** 캐시 채움 GB당 (GCP 같은 대륙 요금). 무료면 0 */
  fillPerGb: number;
  /** 정액 요금제 (CloudFront). 없으면 빈 배열 */
  plans: CdnPlan[];
}

/** Azure Log Analytics Commitment Tier — 하루 약정 GB와 일 요금 (31일 단위, 초과분은 등급 실효 단가) */
export interface LogCommitmentTier {
  gbPerDay: number;
  perDay: number;
}

/**
 * 로그 수집 — AWS CloudWatch Logs(Standard) / Azure Log Analytics(Analytics Logs) / GCP Cloud Logging.
 * 수집 GB당 + 보관 GB·월(기본 포함 기간 이후). 쿼리 요금·저가 등급(IA·Basic·Auxiliary)·무료분은 비교 대상 아님.
 */
export interface LogPrice {
  provider: Provider;
  region: Region;
  ingestPerGb: number;
  storagePerGbMonth: number;
  /** 보관 요금 없이 포함되는 일수 (AWS 0, Azure 31, GCP 30) */
  includedDays: number;
  /** 보관 과금 크기 배율 — AWS는 압축 크기(원본 × 0.15, 문서값), 그 외 1 */
  storedRatio: number;
  /** 볼륨 약정 등급 (Azure). 없으면 빈 배열 */
  commitmentTiers: LogCommitmentTier[];
  /** 설정 가능한 최대 보관 일수 (OCI 180일). 없으면 제한 없음 — 넘는 보관 기간은 "미제공" */
  maxRetentionDays?: number;
  /** 요금제 이름 — 요금제가 여러 개인 플랫폼(NCP Standard·Premium)의 표시용 */
  plan?: string;
  /** 하루 최대 수집 GB (NCP). 없으면 제한 없음 */
  maxGbPerDay?: number;
  /** 최대 보관량 GB — 정상 상태 누적량 기준 (NCP). 없으면 제한 없음 */
  maxStoredGb?: number;
  /** 다른 요금제 — 한도 안에 드는 요금제 중 가장 싼 쪽으로 계산 (NCP Premium) */
  alternatives?: LogPrice[];
}

/** 한 플랫폼의 리전별 요금 데이터 묶음 — pricing 로더가 반환하는 단위 */
export interface ProviderPricing {
  vm: VmSku[];
  storage: StorageSku[];
  egress: EgressTier | null;
  k8s: K8sClusterPrice | null;
  lb: LbPrice | null;
  nat: NatPrice | null;
  db: DbPrice | null;
  cache: CachePrice | null;
  container: ContainerPrice | null;
  cdn: CdnPrice | null;
  logs: LogPrice | null;
}

/** data/meta.json */
export interface Meta {
  collectedAt: string; // ISO 8601
  usdKrw: { rate: number; at: string } | null; // 환율 조회 실패 시 null 가능
}
