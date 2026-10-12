/**
 * GCP 수집기 — Cloud Billing Catalog API에서 Compute Engine SKU를 받아
 * 패밀리별 vCPU/RAM 시간 단가를 파싱하고, 머신 타입 카탈로그와 조합해
 * VmSku[]를 만든다.
 *
 * 파이프라인: fetchComputeSkus → parseUnitPrices → buildVmSkus
 */

import type { CacheGbTier, CachePrice, DbEngine, DbEnginePricing, DbPrice, EgressTier, K8sClusterPrice, LbPrice, NatPrice, Region, StorageSku, VmSku } from '../../src/lib/schema';
import { GCP_MACHINE_TYPES } from './gcp-machine-types';

const COMPUTE_SERVICE_ID = '6F81-5844-456A'; // Compute Engine
const GCS_SERVICE_ID = '95FF-2EF5-5EA1'; // Cloud Storage
const GKE_SERVICE_ID = 'CCD8-9BF1-090E'; // Kubernetes Engine
const NETWORKING_SERVICE_ID = 'E505-1604-58F8'; // Networking (Cloud Load Balancing·Cloud NAT)
const CLOUD_SQL_SERVICE_ID = '9662-B51E-5089'; // Cloud SQL
const MEMORYSTORE_REDIS_SERVICE_ID = '5AF5-2C11-D467'; // Cloud Memorystore for Redis

export const GCP_REGION: Record<Region, string> = {
  seoul: 'asia-northeast3',
  'us-east': 'us-east1',
};

/**
 * SKU description의 패밀리 라벨 → 우리 패밀리 키.
 * 예: "E2 Instance Core running in Seoul" → e2
 * 라벨 표기가 패밀리마다 제각각인 것(N1은 "Predefined", C2는 "Compute optimized")이
 * GCP 수집의 핵심 난점. 여기 없는 라벨은 unmatched로 집계해서 커버리지를 확인한다.
 */
const FAMILY_LABELS: Record<string, string> = {
  'E2 Instance': 'e2',
  'N2 Instance': 'n2',
  'N2D AMD Instance': 'n2d',
  'N1 Predefined Instance': 'n1',
  'Compute optimized': 'c2',
  'C2D AMD Instance': 'c2d',
  'C3 Instance': 'c3',
  'T2D AMD Instance': 't2d',
  'T2A Arm Instance': 't2a', // ARM (Ampere Altra) — us-east1 등 일부 리전
  'N4 Instance': 'n4',
  'N4D Instance': 'n4d',
  'C3D Instance': 'c3d',
  'C4 Instance': 'c4',
  'C4D Instance': 'c4d',
  'C4A Arm Instance': 'c4a', // ARM (Axion) — 서울 미제공
};

/** Billing Catalog API 응답에서 우리가 쓰는 필드만 */
export interface RawSku {
  skuId: string;
  description: string;
  category?: { usageType?: string; resourceGroup?: string };
  serviceRegions?: string[];
  pricingInfo?: {
    pricingExpression?: {
      usageUnit?: string;
      tieredRates?: {
        startUsageAmount?: number;
        unitPrice?: { currencyCode?: string; units?: string; nanos?: number };
      }[];
    };
  }[];
}

/** 패밀리 키 → vCPU/RAM 시간 단가 (USD) */
export type UnitPrices = Record<string, { corePerHour?: number; ramGbPerHour?: number }>;

export const fetchComputeSkus = (apiKey: string) => fetchServiceSkus(apiKey, COMPUTE_SERVICE_ID);
export const fetchGcsSkus = (apiKey: string) => fetchServiceSkus(apiKey, GCS_SERVICE_ID);
export const fetchGkeSkus = (apiKey: string) => fetchServiceSkus(apiKey, GKE_SERVICE_ID);
export const fetchNetworkingSkus = (apiKey: string) => fetchServiceSkus(apiKey, NETWORKING_SERVICE_ID);
export const fetchCloudSqlSkus = (apiKey: string) => fetchServiceSkus(apiKey, CLOUD_SQL_SERVICE_ID);
export const fetchMemorystoreSkus = (apiKey: string) => fetchServiceSkus(apiKey, MEMORYSTORE_REDIS_SERVICE_ID);

async function fetchServiceSkus(apiKey: string, serviceId: string): Promise<RawSku[]> {
  const all: RawSku[] = [];
  let pageToken = '';
  do {
    const url = new URL(`https://cloudbilling.googleapis.com/v1/services/${serviceId}/skus`);
    url.searchParams.set('key', apiKey);
    url.searchParams.set('pageSize', '5000');
    if (pageToken) url.searchParams.set('pageToken', pageToken);

    const res = await fetch(url);
    if (!res.ok) {
      throw new Error(`GCP Billing API 오류 ${res.status}: ${await res.text()}`);
    }
    const body = (await res.json()) as { skus?: RawSku[]; nextPageToken?: string };
    all.push(...(body.skus ?? []));
    pageToken = body.nextPageToken ?? '';
  } while (pageToken);
  return all;
}

function unitPriceOf(sku: RawSku): number | undefined {
  const rates = sku.pricingInfo?.[0]?.pricingExpression?.tieredRates;
  const last = rates?.[rates.length - 1];
  if (!last?.unitPrice) return undefined;
  return Number(last.unitPrice.units ?? 0) + (last.unitPrice.nanos ?? 0) / 1e9;
}

/**
 * 원본 SKU에서 해당 리전의 온디맨드 vCPU/RAM 단가를 패밀리별로 추출한다.
 * 반환하는 unmatched는 "Core/Ram running in" 패턴인데 라벨 맵에 없는 것들
 * — 커버리지 측정용 (Sole Tenancy, Custom, 미지원 패밀리 등이 여기 모인다).
 */
export function parseUnitPrices(
  skus: RawSku[],
  gcpRegion: string,
): { unitPrices: UnitPrices; unmatched: string[] } {
  const unitPrices: UnitPrices = {};
  const unmatched = new Set<string>();

  for (const sku of skus) {
    if (sku.category?.usageType !== 'OnDemand') continue;
    if (!sku.serviceRegions?.includes(gcpRegion)) continue;

    const m = sku.description.match(/^(.+?) (Core|Ram) running in /);
    if (!m) continue; // VM 단가 SKU가 아님 (디스크, 네트워크, GPU 등)

    const [, label, kind] = m;
    const family = FAMILY_LABELS[label];
    if (!family) {
      unmatched.add(`${label} (${kind})`);
      continue;
    }

    const price = unitPriceOf(sku);
    if (price === undefined) continue;

    const entry = (unitPrices[family] ??= {});
    const field = kind === 'Core' ? 'corePerHour' : 'ramGbPerHour';
    if (entry[field] !== undefined && entry[field] !== price) {
      console.warn(`⚠ ${family} ${field} 단가 중복 (${entry[field]} vs ${price}) — 먼저 온 값 유지`);
      continue;
    }
    entry[field] = price;
  }

  return { unitPrices, unmatched: [...unmatched].sort() };
}

const round6 = (x: number) => +x.toFixed(6);

const isOnDemandIn = (sku: RawSku, gcpRegion: string) =>
  sku.category?.usageType === 'OnDemand' && !!sku.serviceRegions?.includes(gcpRegion);

/**
 * 스토리지 단가 추출.
 * - block-ssd: Compute의 "Balanced PD Capacity ..." (gp3/Premium SSD v2와 동급인 범용 SSD)
 * - object-standard: GCS의 "Standard Storage ..." (RegionalStorage 그룹, Autoclass 변형 제외)
 */
export function parseGcpStorage(
  computeSkus: RawSku[],
  gcsSkus: RawSku[],
  gcpRegion: string,
  region: Region,
): StorageSku[] {
  const out: StorageSku[] = [];

  const pd = computeSkus.find(
    (s) => isOnDemandIn(s, gcpRegion) && s.category?.resourceGroup === 'SSD' && /^Balanced PD Capacity/.test(s.description),
  );
  const pdPrice = pd && unitPriceOf(pd);
  if (pdPrice) out.push({ provider: 'gcp', region, kind: 'block-ssd', pricePerGbMonth: round6(pdPrice) });

  const gcs = gcsSkus.find(
    (s) => isOnDemandIn(s, gcpRegion) && s.category?.resourceGroup === 'RegionalStorage' && /^Standard Storage /.test(s.description),
  );
  const gcsPrice = gcs && unitPriceOf(gcs);
  if (gcsPrice) out.push({ provider: 'gcp', region, kind: 'object-standard', pricePerGbMonth: round6(gcsPrice) });

  return out;
}

/**
 * 인터넷 egress 구간 요금 — Standard 네트워크 티어 기준.
 * (Premium 티어는 목적지별 SKU라 단일 가격이 없어 비교 지표로 쓰지 않는다)
 * tieredRates의 무료 선두 구간(예: 서울 0~200GB $0)이 그대로 tiers에 들어간다.
 */
export function parseGcpEgress(computeSkus: RawSku[], gcpRegion: string, region: Region): EgressTier | null {
  const sku = computeSkus.find(
    (s) =>
      isOnDemandIn(s, gcpRegion) &&
      s.category?.resourceGroup === 'StandardInternetEgress' &&
      s.description.startsWith('Network Standard Data Transfer Out to Internet from'),
  );
  const rates = sku?.pricingInfo?.[0]?.pricingExpression?.tieredRates;
  if (!rates || rates.length === 0) return null;

  const sorted = [...rates].sort((a, b) => (a.startUsageAmount ?? 0) - (b.startUsageAmount ?? 0));
  const tiers = sorted.map((r, i) => ({
    upToGb: sorted[i + 1]?.startUsageAmount ?? null,
    pricePerGb: round6(Number(r.unitPrice?.units ?? 0) + (r.unitPrice?.nanos ?? 0) / 1e9),
  }));

  let freeGb = 0;
  for (const t of tiers) {
    if (t.pricePerGb !== 0 || t.upToGb === null) break;
    freeGb = t.upToGb;
  }
  return { provider: 'gcp', region, freeGb, tiers };
}

/**
 * GKE 클러스터 관리 요금 — "Regional Kubernetes Clusters"(컨트롤 플레인 이중화, EKS·AKS Standard와 동급).
 * 전 리전 공통 global SKU. 결제 계정당 월 크레딧(Zonal·Autopilot 1개분)은 무료 혜택이라 미반영.
 */
export function parseGkeCluster(gkeSkus: RawSku[], region: Region): K8sClusterPrice | null {
  const sku = gkeSkus.find(
    (s) =>
      s.category?.usageType === 'OnDemand' &&
      !!s.serviceRegions?.includes('global') &&
      s.description === 'Regional Kubernetes Clusters',
  );
  const price = sku && unitPriceOf(sku);
  return price ? { provider: 'gcp', region, clusterPerHour: round6(price) } : null;
}

/**
 * 리전 외부 애플리케이션 LB — 포워딩 규칙 최소 요금(시간당, 규칙 5개까지 포함) + 처리 GB당.
 * GCP는 인바운드·아웃바운드 처리량을 각각 과금하므로 "총 처리 GB × 단가"가 된다 (두 단가 중 큰 값 사용).
 */
export function parseGcpLb(netSkus: RawSku[], gcpRegion: string, region: Region): LbPrice | null {
  const price = (pattern: RegExp) => {
    const sku = netSkus.find((s) => isOnDemandIn(s, gcpRegion) && pattern.test(s.description));
    return sku && unitPriceOf(sku);
  };
  const perHour = price(/^Regional External Application Load Balancer Forwarding Rule Minimum /);
  const inbound = price(/^Regional External Application Load Balancer Inbound Data Processing /);
  const outbound = price(/^Regional External Application Load Balancer Outbound Data Processing /);
  if (!perHour || !inbound || !outbound) return null;
  return { provider: 'gcp', region, perHour: round6(perHour), perGb: round6(Math.max(inbound, outbound)) };
}

/** Cloud NAT 시간당 요금 상한 VM 수 — 가격 API에 없어 공식 문서(cloud.google.com/vpc/network-pricing)값 */
const CLOUD_NAT_MAX_BILLED_VMS = 32;

/** Cloud NAT — 게이트웨이 가동(VM 1대당 시간당, 32대 상한) + 처리 GB당. 전 리전 공통 global SKU */
export function parseGcpNat(netSkus: RawSku[], region: Region): NatPrice | null {
  const price = (description: string) => {
    const sku = netSkus.find((s) => isOnDemandIn(s, 'global') && s.description === description);
    return sku && unitPriceOf(sku);
  };
  const perVmHour = price('Networking Cloud Nat Gateway Uptime');
  const perGb = price('Networking Cloud Nat Data Processing');
  if (!perVmHour || !perGb) return null;
  return {
    provider: 'gcp',
    region,
    hourly: { per: 'vm', usd: round6(perVmHour), maxVms: CLOUD_NAT_MAX_BILLED_VMS },
    perGb: round6(perGb),
  };
}

const CLOUD_SQL_ENGINE_LABEL: Record<DbEngine, string> = { mysql: 'MySQL', postgres: 'PostgreSQL' };

/**
 * Cloud SQL Enterprise 커스텀 사이즈 단가 — vCPU·RAM·SSD 스토리지, Zonal(단일)·Regional(이중화).
 * 설명 예: "Cloud SQL for MySQL: Zonal - vCPU in Seoul". N4 시리즈·Enterprise Plus·공유 코어·HDD는 설명이 달라 제외.
 */
export function parseCloudSql(sqlSkus: RawSku[], gcpRegion: string, region: Region): DbPrice | null {
  const engine = (e: DbEngine): DbEnginePricing | null => {
    const price = (avail: 'Zonal' | 'Regional', item: 'vCPU' | 'RAM' | 'Standard storage') => {
      const description = `Cloud SQL for ${CLOUD_SQL_ENGINE_LABEL[e]}: ${avail} - ${item} in `;
      const sku = sqlSkus.find((s) => isOnDemandIn(s, gcpRegion) && s.description.startsWith(description));
      return sku && unitPriceOf(sku);
    };
    const [vcpu, ram, storage] = (['vCPU', 'RAM', 'Standard storage'] as const).map((x) => price('Zonal', x));
    const [haVcpu, haRam, haStorage] = (['vCPU', 'RAM', 'Standard storage'] as const).map((x) => price('Regional', x));
    if (!vcpu || !ram || !storage || !haVcpu || !haRam || !haStorage) return null;
    return {
      instances: [],
      custom: { vcpuPerHour: round6(vcpu), ramGbPerHour: round6(ram), haVcpuPerHour: round6(haVcpu), haRamGbPerHour: round6(haRam) },
      storageGbMonth: round6(storage),
      haStorageGbMonth: round6(haStorage),
    };
  };
  const engines = { mysql: engine('mysql'), postgres: engine('postgres') };
  return engines.mysql || engines.postgres ? { provider: 'gcp', region, engines } : null;
}

/**
 * Memorystore for Redis 용량 구간 상한(GiB) — 가격 API에 없어 공식 문서값
 * (cloud.google.com/memorystore/docs/redis/pricing: M1 1~4, M2 5~10, M3 11~35, M4 36~100, M5 100 초과)
 */
const MEMORYSTORE_TIERS: [string, number | null][] = [['M1', 4], ['M2', 10], ['M3', 35], ['M4', 100], ['M5', null]];

/** Memorystore for Redis — Basic(단일)·Standard(이중화) 용량 GB당 시간 단가. "Redis Standard Node Capacity"(읽기 복제본) 제외 */
export function parseMemorystore(redisSkus: RawSku[], gcpRegion: string, region: Region): CachePrice | null {
  const price = (tier: 'Basic' | 'Standard', m: string) => {
    const sku = redisSkus.find((s) => isOnDemandIn(s, gcpRegion) && s.description.startsWith(`Redis Capacity ${tier} ${m} `));
    return sku && unitPriceOf(sku);
  };
  const gbTiers: CacheGbTier[] = [];
  for (const [m, upToGb] of MEMORYSTORE_TIERS) {
    const basic = price('Basic', m);
    const standard = price('Standard', m);
    if (!basic || !standard) return null; // 구간 하나라도 빠지면 계산이 틀어지므로 전체 무효
    gbTiers.push({ upToGb, perGbHour: round6(basic), haPerGbHour: round6(standard) });
  }
  return { provider: 'gcp', region, engine: 'Redis', nodes: [], gbTiers };
}

/** 패밀리 단가 × 머신 타입 카탈로그 → VmSku[]. 단가가 불완전한 패밀리는 건너뛴다. */
export function buildVmSkus(unitPrices: UnitPrices, region: Region): VmSku[] {
  return GCP_MACHINE_TYPES.flatMap((mt) => {
    const p = unitPrices[mt.family];
    if (p?.corePerHour === undefined || p?.ramGbPerHour === undefined) return [];
    return [{
      provider: 'gcp' as const,
      region,
      sku: mt.name,
      vcpu: mt.vcpu,
      ramGb: mt.ramGb,
      burstable: mt.burstable,
      arch: mt.arch,
      generation: mt.family,
      pricePerHour: round6(mt.billedCores * p.corePerHour + mt.ramGb * p.ramGbPerHour),
    }];
  });
}
