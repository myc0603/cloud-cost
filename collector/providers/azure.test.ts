import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildAzureDbEngine,
  buildAzureEgress,
  buildAzureK8s,
  buildAzureLb,
  buildAzureNat,
  buildAzureStorage,
  buildAzureVmSkus,
  type AzurePriceItem,
} from './azure';

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

test('buildAzureK8s: Standard 티어(SLA) 미터만 — Free 인프라·LTS·Automatic 제외', () => {
  const k = (productName: string, meterName: string, retailPrice: number) => item({ productName, meterName, retailPrice, skuName: 'Standard' });
  const items = [
    k('Azure Kubernetes Service', 'FreeTierInfrastructureCost Uptime SLA', 0.05),
    k('Azure Kubernetes Service', 'Standard Long Term Support', 0.6),
    k('Azure Kubernetes Service - Automatic', 'Automatic Hosted Control Plane', 0.16),
    k('Azure Kubernetes Service', 'Standard Uptime SLA', 0.1),
  ];
  assert.deepEqual(buildAzureK8s(items, 'seoul'), { provider: 'azure', region: 'seoul', clusterPerHour: 0.1 });
  assert.equal(buildAzureK8s([], 'seoul'), null);
});

test('buildAzureLb: Application Gateway Standard v2 고정비 + CU(=GB당) — WAF·Basic 제외', () => {
  const g = (productName: string, meterName: string, retailPrice: number) => item({ productName, meterName, retailPrice, unitOfMeasure: '1/Hour' });
  const items = [
    g('Application Gateway WAF v2', 'Standard Fixed Cost', 0.486),
    g('Application Gateway Basic v2', 'Basic Fixed Cost', 0.0225),
    g('Application Gateway Standard v2', 'Standard Fixed Cost', 0.27),
    g('Application Gateway Standard v2', 'Standard Capacity Units', 0.008),
  ];
  assert.deepEqual(buildAzureLb(items, 'seoul'), { provider: 'azure', region: 'seoul', perHour: 0.27, perGb: 0.008 });
  assert.equal(buildAzureLb(items.slice(0, 3), 'seoul'), null); // CU 없으면 불완전 → null
});

test('buildAzureNat: Standard 게이트웨이 시간당 + 처리 GB당 — StandardV2 로그 제외', () => {
  const items = [
    item({ productName: 'NAT Gateway', meterName: 'StandardV2 Log Enabled', unitOfMeasure: '1/Month', retailPrice: 4 }),
    item({ productName: 'NAT Gateway', meterName: 'Standard Gateway', unitOfMeasure: '1 Hour', retailPrice: 0.045 }),
    item({ productName: 'NAT Gateway', meterName: 'Standard Data Processed', unitOfMeasure: '1 GB', retailPrice: 0.045 }),
  ];
  assert.deepEqual(buildAzureNat(items, 'seoul'), {
    provider: 'azure',
    region: 'seoul',
    hourly: { per: 'gateway', usd: 0.045 },
    perGb: 0.045,
  });
});

test('buildAzureDbEngine: 버스트(사이즈별 미터·HA 없음) + 범용·메모리(vCore 단가 × vCore, HA 2배) + 스토리지', () => {
  const pg = (product: string, skuName: string, meterName: string, retailPrice: number, unitOfMeasure = '1 Hour') =>
    item({ productName: `Azure Database for PostgreSQL ${product}`, skuName, meterName, retailPrice, unitOfMeasure });
  const items = [
    pg('Flexible Server Burstable BS Series Compute', 'B2ms', 'B2ms vCore', 0.208),
    pg('Flexible Server General Purpose Dadsv5 Series Compute', 'vCore', 'vCore', 0.123),
    pg('Flexible Server General Purpose Dadsv5 Series Compute', '2 vCore', 'vCore', 0.246), // vCore당 미터만 사용
    pg('Flexible Server Memory Optimized Eadsv5 Series Compute', '1 vCore', 'vCore', 0.15),
    pg('Flex Server Storage', 'Storage', 'Storage Data Stored', 0.131, '1 GB/Month'), // PG는 "Flex Server"
    pg('Single Server General Purpose - Compute Gen5', 'vCore', 'vCore', 9), // Single Server 제외
  ];
  const p = buildAzureDbEngine(items)!;
  const find = (sku: string) => p.instances.find((i) => i.sku === sku);
  assert.deepEqual(find('Standard_B2ms'), { sku: 'Standard_B2ms', vcpu: 2, ramGb: 8, burstable: true, perHour: 0.208, haPerHour: null });
  assert.deepEqual(find('Standard_D4ads_v5'), { sku: 'Standard_D4ads_v5', vcpu: 4, ramGb: 16, burstable: false, perHour: 0.492, haPerHour: 0.984 });
  assert.equal(find('Standard_E2ads_v5')?.perHour, 0.3);
  assert.equal(find('Standard_B1ms'), undefined); // 가격 미터 없으면 제외
  assert.equal(p.storageGbMonth, 0.131);
  assert.equal(p.haStorageGbMonth, 0.262);
});
