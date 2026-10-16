import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildAzureCache,
  buildAzureCdn,
  buildAzureContainer,
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

test('buildAzureCache: Managed Redis SKU 미터 × 카탈로그 용량, 이중화 2배 — 기존 Azure Cache for Redis 제외', () => {
  const amr = (tier: string, sku: string, retailPrice: number) =>
    item({ productName: `Azure Managed Redis - ${tier}`, skuName: sku, meterName: `${sku} Cache Instance`, retailPrice });
  const items = [
    item({ productName: 'Azure Redis Cache Standard', skuName: 'C1', meterName: 'C1 Cache Instance', retailPrice: 0.089 }),
    amr('Balanced', 'B1', 0.039),
    amr('Memory Optimized', 'M10', 0.261),
  ];
  const c = buildAzureCache(items, 'seoul')!;
  assert.equal(c.engine, 'Redis');
  assert.deepEqual(c.nodes, [
    { sku: 'B1', memoryGb: 1, burstable: false, perHour: 0.039, haPerHour: 0.078 },
    { sku: 'M10', memoryGb: 12, burstable: false, perHour: 0.261, haPerHour: 0.522 },
  ]);
  assert.equal(buildAzureCache([], 'seoul'), null);
});

test('buildAzureVmSkus: 예약 아이템(기간 총액) → 시간당 약정가, Windows 예약·정가 이상 제외', () => {
  const rsv = (term: string, retailPrice: number, over: Partial<AzurePriceItem> = {}) =>
    item({ type: 'Reservation', reservationTerm: term, retailPrice, armSkuName: 'Standard_D2s_v5', meterName: 'D2s v5', productName: 'Virtual Machines Dsv5 Series', ...over });
  const items = [
    item({ armSkuName: 'Standard_D2s_v5', meterName: 'D2s v5', productName: 'Virtual Machines Dsv5 Series', retailPrice: 0.115 }),
    rsv('1 Year', 604.44), // 604.44 / 8760 = 0.069
    rsv('3 Years', 1314), //  1314 / 26280 = 0.05
    rsv('1 Year', 1, { productName: 'Virtual Machines Dsv5 Series Windows' }), // ✘ Windows
    item({}), // B2s 정가만
    rsv('1 Year', 9000, { armSkuName: 'Standard_B2s', meterName: 'B2s', productName: 'Virtual Machines BS Series' }), // ✘ 정가보다 비쌈
  ];
  const skus = buildAzureVmSkus(items, 'seoul');
  assert.deepEqual(skus.find((s) => s.sku === 'Standard_D2s_v5')?.commit, { '1y': 0.069, '3y': 0.05 });
  assert.equal(skus.find((s) => s.sku === 'Standard_B2s')?.commit, undefined);
});

test('buildAzureDbEngine: vCore 예약 — PG 시리즈별·MySQL 등급 공통 상품, 이중화 2배, 버스트 없음', () => {
  const it = (service: string, product: string, retailPrice: number, over: Partial<AzurePriceItem> = {}) =>
    item({ productName: `Azure Database for ${service} ${product}`, skuName: 'vCore', meterName: 'vCore', retailPrice, ...over });
  const rsv = (service: string, product: string, term: string, retailPrice: number) =>
    it(service, product, retailPrice, { type: 'Reservation', reservationTerm: term });
  const base = (service: string) => [
    it(service, 'Flexible Server Burstable BS Series Compute', 0.208, { skuName: 'B2ms', meterName: 'B2ms vCore' }),
    it(service, 'Flexible Server General Purpose Dadsv5 Series Compute', 0.123),
    it(service, 'Flex Server Storage', 0.131, { skuName: 'Storage', meterName: 'Storage Data Stored', unitOfMeasure: '1 GB/Month' }),
  ];
  const pg = buildAzureDbEngine([
    ...base('PostgreSQL'),
    rsv('PostgreSQL', 'Flexible Server General Purpose Dadsv5 Series Compute', '1 Year', 646.08), // /8760 = 0.073753
    rsv('PostgreSQL', 'Flexible Server General Purpose Ddsv4 Series Compute', '1 Year', 1), // 다른 시리즈
  ])!;
  assert.deepEqual(pg.instances.find((i) => i.sku === 'Standard_D2ads_v5')?.commit, {
    '1y': { perHour: +(2 * 646.08 / 8760).toFixed(6), haPerHour: +(+(2 * 646.08 / 8760).toFixed(6) * 2).toFixed(6) },
  });
  assert.equal(pg.instances.find((i) => i.sku === 'Standard_B2ms')?.commit, undefined);

  const mysql = buildAzureDbEngine([...base('MySQL'), rsv('MySQL', 'Flexible Server General Purpose Series Compute', '3 Years', 1240)])!;
  assert.equal(mysql.instances.find((i) => i.sku === 'Standard_D2ads_v5')?.commit?.['3y']?.perHour, +(2 * 1240 / 26280).toFixed(6));
});

test('buildAzureCache: 같은 미터의 예약 아이템 → 약정가, 이중화 2배', () => {
  const amr = (over: Partial<AzurePriceItem>) =>
    item({ productName: 'Azure Managed Redis - Balanced', skuName: 'B5', meterName: 'B5 Cache Instance', retailPrice: 0.189, ...over });
  const c = buildAzureCache([amr({}), amr({ type: 'Reservation', reservationTerm: '1 Year', retailPrice: 1076 })], 'seoul')!;
  const perHour = +(1076 / 8760).toFixed(6);
  assert.deepEqual(c.nodes[0].commit, { '1y': { perHour, haPerHour: +(perHour * 2).toFixed(6) } });
});

test('buildAzureContainer: Container Apps 활성 vCPU·메모리 초 단가 → 시간 단가 + Savings Plan, 유휴·Dedicated 제외', () => {
  const ca = (meterName: string, retailPrice: number, unitOfMeasure: string, skuName = 'Standard', savingsPlan?: AzurePriceItem['savingsPlan']) =>
    item({ productName: 'Azure Container Apps', skuName, meterName, retailPrice, unitOfMeasure, savingsPlan });
  const c = buildAzureContainer(
    [
      ca('Standard vCPU Idle Usage', 3e-6, '1 Second'), // ✘ 유휴
      ca('Dedicated vCPU Usage', 0.057, '1 Hour', 'Dedicated'), // ✘ Dedicated
      ca('Standard vCPU Active Usage', 2.4e-5, '1 Second', 'Standard', [{ term: '1 Year', retailPrice: 2.04e-5 }, { term: '3 Years', retailPrice: 1.992e-5 }]),
      ca('Standard Memory Active Usage', 3e-6, '1 GiB Second', 'Standard', [{ term: '1 Year', retailPrice: 2.55e-6 }]),
    ],
    'seoul',
  )!;
  // 3년은 메모리 SP 단가가 없어 미적용
  assert.deepEqual(c.rates, { x86: { vcpuPerHour: 0.0864, gbPerHour: 0.0108, commit: { '1y': { vcpuPerHour: 0.07344, gbPerHour: 0.00918 } } } });
  assert.equal(buildAzureContainer([], 'seoul'), null);
});

test('buildAzureCdn: Front Door Standard 존(서울 → Zone 8) 기본료 + 전송·요청 구간, Premium·다른 존 제외', () => {
  const fd = (meterName: string, retailPrice: number, unitOfMeasure: string, tierMinimumUnits = 0, over: Partial<AzurePriceItem> = {}) =>
    item({ productName: 'Azure Front Door', skuName: 'Standard', armRegionName: 'Zone 8', meterName, retailPrice, unitOfMeasure, tierMinimumUnits, ...over });
  const cdn = buildAzureCdn(
    [
      fd('Standard Base Fees', 35, '1/Month'),
      fd('Standard Data Transfer Out', 0.132006, '1 GB', 10000),
      fd('Standard Data Transfer Out', 0.14, '1 GB'),
      fd('Standard Requests', 0.0181, '10K'),
      fd('Standard Requests', 0.6, '1M/Month'), // ✘ 다른 단위 미터
      fd('Standard Data Transfer Out', 0.0825, '1 GB', 0, { armRegionName: 'Zone 1' }), // ✘ 다른 존
      fd('Premium Data Transfer Out', 0.2, '1 GB', 0, { skuName: 'Premium' }), // ✘ Premium
    ],
    'seoul',
  )!;
  assert.deepEqual(cdn.gbTiers, [{ upTo: 10000, price: 0.14 }, { upTo: null, price: 0.132006 }]);
  assert.deepEqual(cdn.requestTiers, [{ upTo: null, price: 0.0181 }]);
  assert.equal(cdn.monthlyBase, 35);
  assert.equal(buildAzureCdn([], 'seoul'), null);
});
