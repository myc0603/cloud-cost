import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildAzureEgress, buildAzureStorage, buildAzureVmSkus, type AzurePriceItem } from './azure';

const item = (over: Partial<AzurePriceItem>): AzurePriceItem => ({
  currencyCode: 'USD',
  retailPrice: 0.052,
  armRegionName: 'koreacentral',
  meterName: 'B2s',
  productName: 'Virtual Machines BS Series',
  skuName: 'B2s',
  armSkuName: 'Standard_B2s',
  unitOfMeasure: '1 Hour',
  tierMinimumUnits: 0,
  type: 'Consumption',
  ...over,
});

test('buildAzureVmSkus: Linux 가격 조인 + 제외 필터', () => {
  const items: AzurePriceItem[] = [
    item({}), // ✔ B2s Linux
    item({ productName: 'Virtual Machines BS Series Windows', retailPrice: 0.06 }), // ✘ Windows
    item({ meterName: 'B2s Spot', retailPrice: 0.01 }), // ✘ Spot
    item({ meterName: 'B2s Low Priority', retailPrice: 0.02 }), // ✘ Low Priority
    item({ armSkuName: 'Standard_D2s_v5', meterName: 'D2s v5', productName: 'Virtual Machines Dsv5 Series', retailPrice: 0.115 }), // ✔
    item({ armSkuName: 'Standard_ND96asr_v4', meterName: 'ND96asr v4', retailPrice: 27.2 }), // 카탈로그 밖 → 무시
    item({ productName: 'BS Series CloudServices', retailPrice: 0.07 }), // ✘ 구형 Cloud Services 변형
  ];
  const skus = buildAzureVmSkus(items, 'seoul');

  assert.deepEqual(skus.map((s) => s.sku).sort(), ['Standard_B2s', 'Standard_D2s_v5']);
  const b2s = skus.find((s) => s.sku === 'Standard_B2s')!;
  assert.equal(b2s.pricePerHour, 0.052); // Windows 가격(0.06)이 아니어야 함
  assert.equal(b2s.vcpu, 2);
  assert.equal(b2s.ramGb, 4);
  assert.equal(b2s.burstable, true);
  const d2s = skus.find((s) => s.sku === 'Standard_D2s_v5')!;
  assert.equal(d2s.burstable, false);
  assert.equal(d2s.ramGb, 8);
});

test('buildAzureVmSkus: 가격 없는 사이즈는 생성 안 됨', () => {
  const skus = buildAzureVmSkus([item({})], 'seoul');
  assert.ok(!skus.some((s) => s.sku === 'Standard_D2s_v5'));
});

test('buildAzureStorage: SSD v2 월 환산 + Blob 첫 구간', () => {
  const ssd = [
    item({ productName: 'Azure Premium SSD v2', skuName: 'Premium LRS', meterName: 'Premium LRS Provisioned Capacity', unitOfMeasure: '1 GiB/Hour', retailPrice: 0.000125 }),
    item({ productName: 'Azure Premium SSD v2', skuName: 'Premium LRS', meterName: 'Premium LRS Provisioned IOPS', unitOfMeasure: '1/Hour', retailPrice: 0.000008, tierMinimumUnits: 3000 }), // ✘ IOPS 미터
  ];
  const blob = [
    item({ productName: 'Blob Storage', skuName: 'Hot LRS', meterName: 'Hot LRS Data Stored', unitOfMeasure: '1 GB/Month', retailPrice: 0.02 }),
    item({ productName: 'Blob Storage', skuName: 'Hot LRS', meterName: 'Hot LRS Data Stored', unitOfMeasure: '1 GB/Month', retailPrice: 0.0192, tierMinimumUnits: 51200 }), // ✘ 두번째 구간
  ];
  const storage = buildAzureStorage(ssd, blob, 'seoul');
  assert.deepEqual(storage, [
    { provider: 'azure', region: 'seoul', kind: 'block-ssd', pricePerGbMonth: +(0.000125 * 730).toFixed(6) },
    { provider: 'azure', region: 'seoul', kind: 'object-standard', pricePerGbMonth: 0.02 },
  ]);
});

test('buildAzureEgress: tierMinimumUnits → 구간 변환 + 무료 100GB', () => {
  const bw = (tierMin: number, price: number) =>
    item({ productName: 'Bandwidth - Routing Preference: Internet', skuName: 'Standard', meterName: 'Standard Data Transfer Out', unitOfMeasure: '1 GB', tierMinimumUnits: tierMin, retailPrice: price });
  const egress = buildAzureEgress(
    [bw(10100, 0.075), bw(0, 0), bw(100, 0.11)], // 순서 섞여 들어와도 정렬되어야
    'seoul',
  );
  assert.ok(egress);
  assert.equal(egress.freeGb, 100);
  assert.deepEqual(egress.tiers, [
    { upToGb: 100, pricePerGb: 0 },
    { upToGb: 10100, pricePerGb: 0.11 },
    { upToGb: null, pricePerGb: 0.075 },
  ]);
});
