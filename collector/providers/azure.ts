/**
 * Azure 수집기 — Retail Prices API(인증 불필요)에서 VM 시간 단가를 받아
 * 정적 사이즈 카탈로그와 조인해 VmSku[]를 만든다.
 *
 * 파이프라인: fetchVmPriceItems → buildAzureVmSkus
 */

import type {
  CachePrice,
  DbEngine,
  DbEnginePricing,
  DbInstance,
  DbPrice,
  EgressTier,
  K8sClusterPrice,
  LbPrice,
  NatPrice,
  Region,
  StorageSku,
  VmSku,
} from '../../src/lib/schema';
import { AZURE_CACHE_SIZES } from './azure-cache-sizes';
import { AZURE_DB_SIZES } from './azure-db-sizes';
import { AZURE_VM_SIZES } from './azure-vm-sizes';

export const AZURE_REGION: Record<Region, string> = {
  seoul: 'koreacentral',
  'us-east': 'eastus',
};

/** Retail Prices API 응답에서 우리가 쓰는 필드만 */
export interface AzurePriceItem {
  currencyCode: string;
  retailPrice: number;
  armRegionName: string;
  meterName: string;
  productName: string;
  skuName: string;
  armSkuName: string;
  unitOfMeasure: string;
  tierMinimumUnits: number;
  type: string;
}

/** 429(요청 과다)는 잠깐 기다렸다 재시도 — 리전당 병렬 요청이 여럿이라 간헐적으로 걸린다 */
async function fetchWithRetry(url: string, attempts = 4): Promise<Response> {
  for (let i = 1; ; i++) {
    const res = await fetch(url);
    if (res.status !== 429 || i >= attempts) return res;
    const retryAfter = Number(res.headers.get('retry-after'));
    const waitMs = (retryAfter > 0 ? retryAfter : 5 * i) * 1000;
    console.warn(`⚠ azure 429 — ${waitMs / 1000}초 후 재시도 (${i}/${attempts - 1})`);
    await new Promise((r) => setTimeout(r, waitMs));
  }
}

async function fetchPriceItems(filter: string): Promise<AzurePriceItem[]> {
  let url: string | null = `https://prices.azure.com/api/retail/prices?$filter=${encodeURIComponent(filter)}`;
  const items: AzurePriceItem[] = [];

  while (url) {
    const res: Response = await fetchWithRetry(url);
    if (!res.ok) throw new Error(`Azure Retail Prices API 오류 ${res.status}: ${await res.text()}`);
    const body = (await res.json()) as { Items?: AzurePriceItem[]; NextPageLink?: string | null };
    items.push(...(body.Items ?? []));
    url = body.NextPageLink ?? null;
  }
  return items;
}

export const fetchVmPriceItems = (armRegion: string) =>
  fetchPriceItems(`serviceName eq 'Virtual Machines' and armRegionName eq '${armRegion}' and priceType eq 'Consumption'`);

/**
 * 가격 아이템 → 카탈로그 조인 → VmSku[].
 * 제외: Windows 제품, Spot/Low Priority 미터, 시간 단가가 아닌 것.
 */
export function buildAzureVmSkus(items: AzurePriceItem[], region: Region): VmSku[] {
  const priceBySku = new Map<string, number>();

  for (const item of items) {
    if (item.currencyCode !== 'USD') continue;
    if (item.unitOfMeasure !== '1 Hour') continue;
    if (item.type !== 'Consumption') continue;
    // "Eadsv5 Series CloudServices" 같은 구형 Cloud Services 요금 변형 제외
    if (!item.productName.startsWith('Virtual Machines')) continue;
    if (/windows/i.test(item.productName)) continue;
    if (/spot|low priority/i.test(item.meterName)) continue;
    if (!(item.retailPrice > 0)) continue;

    const prev = priceBySku.get(item.armSkuName);
    if (prev !== undefined && prev !== item.retailPrice) {
      console.warn(`⚠ azure ${item.armSkuName} 가격 중복 (${prev} vs ${item.retailPrice}) — 먼저 온 값 유지`);
      continue;
    }
    priceBySku.set(item.armSkuName, item.retailPrice);
  }

  return AZURE_VM_SIZES.flatMap((size) => {
    const price = priceBySku.get(size.armSkuName);
    if (price === undefined) return [];
    return [{
      provider: 'azure' as const,
      region,
      sku: size.armSkuName,
      vcpu: size.vcpu,
      ramGb: size.ramGb,
      burstable: size.burstable,
      arch: size.arch,
      generation: size.generation,
      pricePerHour: +price.toFixed(6),
    }];
  });
}

export async function collectAzureVm(region: Region): Promise<VmSku[]> {
  const items = await fetchVmPriceItems(AZURE_REGION[region]);
  return buildAzureVmSkus(items, region);
}

const HOURS_PER_MONTH = 730;

/**
 * 스토리지 단가.
 * - block-ssd: Premium SSD v2 프로비저닝 용량 (GiB·시간 → 월 환산).
 *   Azure 관리 디스크는 고정 크기(P10/P20…) 과금이라 per-GB 모델과 맞지 않아,
 *   유일하게 per-GB 과금인 Premium SSD v2를 쓴다 (IOPS 3000·처리량 125MBps 기본 무료분 내 기준).
 * - object-standard: Blob Storage Hot LRS 첫 구간(0~50TB) 단가.
 */
export function buildAzureStorage(
  ssdItems: AzurePriceItem[],
  blobItems: AzurePriceItem[],
  region: Region,
): StorageSku[] {
  const out: StorageSku[] = [];

  const cap = ssdItems.find(
    (i) =>
      i.skuName === 'Premium LRS' &&
      i.meterName === 'Premium LRS Provisioned Capacity' &&
      i.unitOfMeasure === '1 GiB/Hour' &&
      i.type === 'Consumption' &&
      i.retailPrice > 0,
  );
  if (cap) {
    out.push({ provider: 'azure', region, kind: 'block-ssd', pricePerGbMonth: +(cap.retailPrice * HOURS_PER_MONTH).toFixed(6) });
  }

  const stored = blobItems.find(
    (i) =>
      i.productName === 'Blob Storage' &&
      i.meterName === 'Hot LRS Data Stored' &&
      i.unitOfMeasure === '1 GB/Month' &&
      i.type === 'Consumption' &&
      i.tierMinimumUnits === 0 &&
      i.retailPrice > 0,
  );
  if (stored) {
    out.push({ provider: 'azure', region, kind: 'object-standard', pricePerGbMonth: +stored.retailPrice.toFixed(6) });
  }

  return out;
}

/**
 * 인터넷 egress — "Routing Preference: Internet" 기준 (GCP Standard 티어와 동일한
 * 인터넷 라우팅 조건으로 통일). tierMinimumUnits가 구간 시작점이다 (0 = 무료 100GB 구간).
 */
export function buildAzureEgress(bandwidthItems: AzurePriceItem[], region: Region): EgressTier | null {
  const outs = bandwidthItems
    .filter(
      (i) =>
        i.meterName === 'Standard Data Transfer Out' &&
        i.unitOfMeasure === '1 GB' &&
        i.type === 'Consumption',
    )
    .sort((a, b) => a.tierMinimumUnits - b.tierMinimumUnits);
  if (outs.length === 0) return null;

  const tiers = outs.map((item, i) => ({
    upToGb: outs[i + 1]?.tierMinimumUnits ?? null,
    pricePerGb: +item.retailPrice.toFixed(6),
  }));

  let freeGb = 0;
  for (const t of tiers) {
    if (t.pricePerGb !== 0 || t.upToGb === null) break;
    freeGb = t.upToGb;
  }
  return { provider: 'azure', region, freeGb, tiers };
}

export async function collectAzureStorage(region: Region): Promise<StorageSku[]> {
  const armRegion = AZURE_REGION[region];
  const base = `armRegionName eq '${armRegion}' and priceType eq 'Consumption'`;
  const [ssd, blob] = await Promise.all([
    fetchPriceItems(`${base} and productName eq 'Azure Premium SSD v2'`),
    fetchPriceItems(`${base} and productName eq 'Blob Storage' and skuName eq 'Hot LRS'`),
  ]);
  return buildAzureStorage(ssd, blob, region);
}

export async function collectAzureEgress(region: Region): Promise<EgressTier | null> {
  const armRegion = AZURE_REGION[region];
  const items = await fetchPriceItems(
    `armRegionName eq '${armRegion}' and priceType eq 'Consumption' and serviceName eq 'Bandwidth' and productName eq 'Bandwidth - Routing Preference: Internet'`,
  );
  return buildAzureEgress(items, region);
}

/**
 * AKS Standard 티어(SLA 포함) 클러스터 시간당 요금 — "Standard Uptime SLA" 미터.
 * Free 티어(SLA 없음)·LTS·Automatic 모드는 비교 대상 아님.
 */
export function buildAzureK8s(items: AzurePriceItem[], region: Region): K8sClusterPrice | null {
  const sla = items.find(
    (i) =>
      i.productName === 'Azure Kubernetes Service' &&
      i.meterName === 'Standard Uptime SLA' &&
      i.unitOfMeasure === '1 Hour' &&
      i.type === 'Consumption' &&
      i.retailPrice > 0,
  );
  return sla ? { provider: 'azure', region, clusterPerHour: +sla.retailPrice.toFixed(6) } : null;
}

export async function collectAzureK8s(region: Region): Promise<K8sClusterPrice | null> {
  const items = await fetchPriceItems(
    `armRegionName eq '${AZURE_REGION[region]}' and priceType eq 'Consumption' and serviceName eq 'Azure Kubernetes Service'`,
  );
  return buildAzureK8s(items, region);
}

const hourlyMeter = (items: AzurePriceItem[], productName: string, meterName: string, unit: string) =>
  items.find(
    (i) => i.productName === productName && i.meterName === meterName && i.unitOfMeasure === unit && i.type === 'Consumption' && i.retailPrice > 0,
  )?.retailPrice;

/**
 * Application Gateway Standard v2 — 고정 시간당 + 용량 단위(CU) 시간당.
 * CU는 공식 정의상 "시간당 1GB(2.22Mbps) 처리"라 GB당 단가로 쓴다. WAF·Basic·컨테이너용은 제외.
 */
export function buildAzureLb(items: AzurePriceItem[], region: Region): LbPrice | null {
  const perHour = hourlyMeter(items, 'Application Gateway Standard v2', 'Standard Fixed Cost', '1/Hour');
  const perGb = hourlyMeter(items, 'Application Gateway Standard v2', 'Standard Capacity Units', '1/Hour');
  return perHour && perGb ? { provider: 'azure', region, perHour: +perHour.toFixed(6), perGb: +perGb.toFixed(6) } : null;
}

/** NAT Gateway Standard — 게이트웨이 시간당 + 처리 GB당 (전 세계 단일 가격, armRegionName 'Global') */
export function buildAzureNat(items: AzurePriceItem[], region: Region): NatPrice | null {
  const perHour = hourlyMeter(items, 'NAT Gateway', 'Standard Gateway', '1 Hour');
  const perGb = hourlyMeter(items, 'NAT Gateway', 'Standard Data Processed', '1 GB');
  return perHour && perGb
    ? { provider: 'azure', region, hourly: { per: 'gateway', usd: +perHour.toFixed(6) }, perGb: +perGb.toFixed(6) }
    : null;
}

export async function collectAzureLb(region: Region): Promise<LbPrice | null> {
  const items = await fetchPriceItems(
    `armRegionName eq '${AZURE_REGION[region]}' and priceType eq 'Consumption' and productName eq 'Application Gateway Standard v2'`,
  );
  return buildAzureLb(items, region);
}

export async function collectAzureNat(region: Region): Promise<NatPrice | null> {
  const items = await fetchPriceItems(`armRegionName eq 'Global' and priceType eq 'Consumption' and productName eq 'NAT Gateway'`);
  return buildAzureNat(items, region);
}

const AZURE_DB_SERVICE: Record<DbEngine, string> = {
  mysql: 'Azure Database for MySQL',
  postgres: 'Azure Database for PostgreSQL',
};

/**
 * Flexible Server 한 엔진의 가격 아이템 → 카탈로그 조인.
 * 이중화(HA)는 대기 서버가 주 서버와 같은 요금(공식 문서) → 컴퓨트·스토리지 2배. 버스트는 HA 미지원.
 * 스토리지는 기본 "Storage Data Stored"(GB·월).
 */
export function buildAzureDbEngine(items: AzurePriceItem[]): DbEnginePricing | null {
  // PG 스토리지 상품명은 "Flex Server Storage"로 줄여 쓴다
  const flex = items.filter((i) => /Flex(ible)? Server/.test(i.productName) && i.type === 'Consumption' && i.retailPrice > 0);
  const hourly = flex.filter((i) => i.unitOfMeasure === '1 Hour');

  const perVcore = (series: string) =>
    hourly.find((i) => i.productName.endsWith(`${series} Series Compute`) && (i.skuName === 'vCore' || i.skuName === '1 vCore'))?.retailPrice;
  const tierRate = { general: perVcore('Dadsv5'), memory: perVcore('Eadsv5') };
  const burstPrice = new Map(
    hourly
      .filter((i) => i.productName.endsWith('Burstable BS Series Compute'))
      .map((i) => [i.meterName.toLowerCase().replace(/ vcore$/, ''), i.retailPrice]),
  );

  const instances: DbInstance[] = AZURE_DB_SIZES.flatMap((size) => {
    const price = size.tier === 'burstable' ? burstPrice.get(size.meter!) : tierRate[size.tier] && tierRate[size.tier]! * size.vcpu;
    if (!price) return [];
    return [{
      sku: size.sku,
      vcpu: size.vcpu,
      ramGb: size.ramGb,
      burstable: size.tier === 'burstable',
      perHour: +price.toFixed(6),
      haPerHour: size.tier === 'burstable' ? null : +(price * 2).toFixed(6),
    }];
  });

  const storage = flex.find(
    (i) => i.productName.includes('Storage') && i.meterName === 'Storage Data Stored' && i.unitOfMeasure === '1 GB/Month',
  )?.retailPrice;
  if (instances.length === 0 || !storage) return null;
  return { instances, custom: null, storageGbMonth: +storage.toFixed(6), haStorageGbMonth: +(storage * 2).toFixed(6) };
}

export async function collectAzureDb(region: Region): Promise<DbPrice | null> {
  const engines = {} as Record<DbEngine, DbEnginePricing | null>;
  for (const engine of ['mysql', 'postgres'] as const) {
    const items = await fetchPriceItems(
      `armRegionName eq '${AZURE_REGION[region]}' and priceType eq 'Consumption' and serviceName eq '${AZURE_DB_SERVICE[engine]}'`,
    );
    engines[engine] = buildAzureDbEngine(items);
  }
  return engines.mysql || engines.postgres ? { provider: 'azure', region, engines } : null;
}

/** Azure Managed Redis — 카탈로그 × "{SKU} Cache Instance" 미터(노드 1개). 이중화 = 2노드 → 2배 (추론, 카탈로그 주석 참조) */
export function buildAzureCache(items: AzurePriceItem[], region: Region): CachePrice | null {
  const nodes = AZURE_CACHE_SIZES.flatMap((size) => {
    const price = items.find(
      (i) =>
        i.productName === `Azure Managed Redis - ${size.tier}` &&
        i.meterName === `${size.sku} Cache Instance` &&
        i.unitOfMeasure === '1 Hour' &&
        i.type === 'Consumption' &&
        i.retailPrice > 0,
    )?.retailPrice;
    if (!price) return [];
    return [{ sku: size.sku, memoryGb: size.memoryGb, burstable: false, perHour: +price.toFixed(6), haPerHour: +(price * 2).toFixed(6) }];
  });
  return nodes.length > 0 ? { provider: 'azure', region, engine: 'Redis', nodes, gbTiers: null } : null;
}

export async function collectAzureCache(region: Region): Promise<CachePrice | null> {
  const items = await fetchPriceItems(
    `armRegionName eq '${AZURE_REGION[region]}' and priceType eq 'Consumption' and serviceName eq 'Redis Cache'`,
  );
  return buildAzureCache(items, region);
}
