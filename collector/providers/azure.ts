/**
 * Azure 수집기 — Retail Prices API(인증 불필요)에서 VM 시간 단가를 받아
 * 정적 사이즈 카탈로그와 조인해 VmSku[]를 만든다.
 *
 * 파이프라인: fetchVmPriceItems → buildAzureVmSkus
 */

import type { EgressTier, Region, StorageSku, VmSku } from '../../src/lib/schema';
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

async function fetchPriceItems(filter: string): Promise<AzurePriceItem[]> {
  let url: string | null = `https://prices.azure.com/api/retail/prices?$filter=${encodeURIComponent(filter)}`;
  const items: AzurePriceItem[] = [];

  while (url) {
    const res: Response = await fetch(url);
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
