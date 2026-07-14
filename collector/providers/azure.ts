/**
 * Azure 수집기 — Retail Prices API(인증 불필요)에서 VM 시간 단가를 받아
 * 정적 사이즈 카탈로그와 조인해 VmSku[]를 만든다.
 *
 * 파이프라인: fetchVmPriceItems → buildAzureVmSkus
 */

import type { Region, VmSku } from '../../src/lib/schema';
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
  armSkuName: string;
  unitOfMeasure: string;
  type: string;
}

export async function fetchVmPriceItems(armRegion: string): Promise<AzurePriceItem[]> {
  const filter = `serviceName eq 'Virtual Machines' and armRegionName eq '${armRegion}' and priceType eq 'Consumption'`;
  let url: string | null = `https://prices.azure.com/api/retail/prices?$filter=${encodeURIComponent(filter)}`;
  const items: AzurePriceItem[] = [];

  while (url) {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Azure Retail Prices API 오류 ${res.status}: ${await res.text()}`);
    const body = (await res.json()) as { Items?: AzurePriceItem[]; NextPageLink?: string | null };
    items.push(...(body.Items ?? []));
    url = body.NextPageLink ?? null;
  }
  return items;
}

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
