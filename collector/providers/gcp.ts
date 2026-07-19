/**
 * GCP 수집기 — Cloud Billing Catalog API에서 Compute Engine SKU를 받아
 * 패밀리별 vCPU/RAM 시간 단가를 파싱하고, 머신 타입 카탈로그와 조합해
 * VmSku[]를 만든다.
 *
 * 파이프라인: fetchComputeSkus → parseUnitPrices → buildVmSkus
 */

import type { EgressTier, Region, StorageSku, VmSku } from '../../src/lib/schema';
import { GCP_MACHINE_TYPES } from './gcp-machine-types';

const COMPUTE_SERVICE_ID = '6F81-5844-456A'; // Compute Engine
const GCS_SERVICE_ID = '95FF-2EF5-5EA1'; // Cloud Storage

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
