import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildNcpSnapshot, type NcpOtherPrice, type NcpPriceList, type NcpSelectablePrice, type NcpServerPrice } from './ncp';

// 2026-10-17 한국 리전 실제 값(원화). 환율은 계산이 떨어지게 1,000원/USD로 둔다
const KRW = 1000;

const server = (code: string, fee: 'MTRAT' | 'FXSUM', price: number, over: Partial<NcpServerPrice> = {}): NcpServerPrice => ({
  infraResourceTypeCode: 'VSVR',
  platformDetailTypeCode: '-',
  serverProductCode: code,
  serverProductTypeCode: code.split('.')[code.includes('.AMD.') ? 3 : 2],
  osTypeCode: 'ROCKY',
  generationCode: 'G3',
  feeSystemTypeCode: fee,
  serverProductPrice: price,
  ...over,
});

const selectable = (infra: string, platform: string, code: string, vcpu: number, gb: number, price: number, gen = 'G3'): NcpSelectablePrice => ({
  infraResourceTypeCode: infra,
  platformDetailTypeCode: platform,
  serverProductCode: code,
  serverProductTypeCode: code.match(/\.(STAND|HICPU|HIMEM)\./)![1],
  generationCode: gen,
  vcpuCount: vcpu,
  memorySizeInGb: gb,
  serverProductPrice: String(price),
});

const other = (infra: string, rating: string, price: number, name = infra, from: number | null = null, to: number | null = null): NcpOtherPrice => ({
  infraResourceTypeCode: infra,
  productName: name,
  productRatingTypeCode: rating,
  productPrice: String(price),
  sectionStartValueInGb: from === null ? null : String(from),
  sectionEndValueInGb: to === null ? null : String(to),
});

const LIST: NcpPriceList = {
  serverSoftwareProductPriceList: [
    server('SVR.VSVR.STAND.C002.M008.G003', 'MTRAT', 115),
    server('SVR.VSVR.STAND.C002.M008.G003', 'FXSUM', 82240),
    server('SVR.VSVR.AMD.HICPU.C002.M004.G003', 'MTRAT', 92),
    server('SVR.VSVR.AMD.HICPU.C002.M004.G003', 'FXSUM', 66240),
    server('SVR.VSVR.STAND.C002.M008.NET.SSD.B050.G002', 'MTRAT', 123, { generationCode: 'G2' }), // ✘ 2세대(디스크 묶음)
    server('SVR.VSVR.MICRO.C001.M001.G003', 'MTRAT', 15), // ✘ Micro
    server('SVR.VSVR.STAND.C002.M008.G003', 'MTRAT', 200, { osTypeCode: 'WND' }), // ✘ Windows
    server('SVR.VSVR.SFC.C002.M008.G003', 'FXSUM', 113491, { platformDetailTypeCode: 'MSSQL' }), // ✘ 소프트웨어 포함
  ],
  serverAndSelectableSoftwareProductPriceList: [
    selectable('VDBAS', 'MYSQL', 'SVR.VDBAS.STAND.C002.M008.NET.SSD.B050.G003', 2, 8, 248),
    selectable('VDBAS', 'MYSQL', 'SVR.VDBAS.STAND.C002.M008.NET.SSD.B050.G002', 2, 8, 260, 'G2'), // 구세대 → 제외
    selectable('VPGSL', 'PGSQL', 'SVR.VPGSL.DBSVR.AMD.STAND.C002.M008.NET.SSD.B050.G003', 2, 8, 250),
    selectable('VDBAS', 'REDIS', 'SVR.VRDS.STAND.C004.M001.NET.SSD.B050.G003', 4, 1, 79),
    selectable('VDBAS', 'REDIS', 'SVR.VRDS.STAND.C004.M012.NET.SSD.B050.G003', 4, 12, 384),
    selectable('VNKS', 'MSTND', 'SVR.VNKS.STAND.C002.M008.G003', 2, 8, 100),
  ],
  additionalStorageProductPriceList: [
    { productName: 'Additional Block Storage [NET] (HDD)', productRatingTypeCode: 'BST', productPrice: '0.080000' },
    { productName: 'Additional Block Storage [NET] (SSD)', productRatingTypeCode: 'BST', productPrice: '0.160000' },
  ],
  otherProductPriceList: [
    other('NET', 'NETOT', 0, '네트웍', 0, 20),
    other('NET', 'NETOT', 100, '네트웍', 20, 5120),
    other('NET', 'NETOT', 100, '네트웍', 20, 5120), // 같은 구간이 여러 번 실려 있다
    other('NET', 'NETOT', 70, '네트웍', 30720, null),
    other('OBJST', 'OSSZ', 28, 'Object Storage', 0, 1048576),
    other('OBJST', 'OSSZ', 26, 'Object Storage', 1048576, null),
    other('VLB', 'PF_SM', 26, '네트워크 로드밸런서(VPC)'),
    other('VLB', 'PF_SM', 26, '어플리케이션 로드밸런서(VPC)'),
    other('VLB', 'DTIN', 9, '어플리케이션 로드밸런서(VPC)'),
    other('NATGW', 'NATMN', 56, 'NAT Gateway'),
    other('NATGW', 'NATNW', 60, 'NAT Gateway', 0, null),
    other('CLA', 'CLASZ', 0, 'Cloud Log Analytics', 0, 1),
    other('CLA', 'CLASZ', 800, 'Cloud Log Analytics', 1, null),
    other('CLA', 'CLASZ', 0, 'Cloud Log Analytics Premium', 0, null), // Premium 보관 무료 — Standard와 섞이면 안 된다
    other('CLA', 'CLA_LOG_COLLECT', 0, 'Cloud Log Analytics'),
    other('CLA', 'CLA_LOG_COLLECT', 500, 'Cloud Log Analytics Premium'),
  ],
  regionalIntegratedProductPriceList: [
    other('GCDN', 'CDNDN', 77, 'GCDN', 0, 200),
    other('GCDN', 'CDNDN', 65, 'GCDN', 200, 10240),
    other('GCDN', 'CDNDN', 30, 'GCDN', 512000, null),
    other('GCDN', 'CDNRQ', 10, 'GCDN'),
  ],
};

test('NCP VM: G3 Rocky Linux 일반 서버만, 월 요금 ÷ 730을 단가로, 원화 → USD', () => {
  const vms = buildNcpSnapshot(LIST, 'seoul', KRW).vms;
  assert.deepEqual(vms.map((v) => v.sku).sort(), ['AMD.HICPU.C002.M004.G003', 'STAND.C002.M008.G003']);
  const s2 = vms.find((v) => v.sku === 'STAND.C002.M008.G003')!;
  assert.deepEqual([s2.vcpu, s2.ramGb, s2.arch, s2.burstable, s2.generation], [2, 8, 'x86', false, 'stand']);
  assert.equal(s2.pricePerHour, +(82240 / 730 / KRW).toFixed(6)); // 시간 115원 × 730 = 83,950원보다 싼 월 요금 기준
  assert.equal(vms.find((v) => v.sku.startsWith('AMD'))!.generation, 'hicpu-amd');
});

test('NCP 스토리지·트래픽·LB·NAT·K8s·CDN: 단위 환산(원/GB·시간 × 730 등)과 구간 중복 제거', () => {
  const snap = buildNcpSnapshot(LIST, 'seoul', KRW);
  assert.deepEqual(snap.storage.map((s) => [s.kind, s.pricePerGbMonth]), [['block-ssd', 0.1168], ['object-standard', 0.028]]); // 0.16원 × 730, 28원
  assert.deepEqual(snap.egress, {
    provider: 'ncp',
    region: 'seoul',
    freeGb: 20,
    tiers: [{ upToGb: 20, pricePerGb: 0 }, { upToGb: 5120, pricePerGb: 0.1 }, { upToGb: null, pricePerGb: 0.07 }],
  });
  assert.deepEqual([snap.lb!.perHour, snap.lb!.perGb], [0.026, 0.009]);
  assert.deepEqual([snap.nat!.hourly.usd, snap.nat!.perGb], [0.056, 0.06]);
  assert.equal(snap.k8s!.clusterPerHour, 0.1);
  assert.deepEqual(snap.cdn!.gbTiers[0], { upTo: 200, price: 0.077 });
  assert.deepEqual(snap.cdn!.requestTiers, [{ upTo: null, price: 0.01 }]);
  assert.equal(snap.container, null);
});

test('NCP DB·캐시: 최신 세대만, 이중화 2배, DB 스토리지 = 블록 SSD 단가, Redis 메모리는 요금 페이지 크기(1.5GB 등)', () => {
  const snap = buildNcpSnapshot(LIST, 'seoul', KRW);
  const mysql = snap.db!.engines.mysql!;
  assert.deepEqual(mysql.instances, [{ sku: 'VDBAS.STAND.C002.M008.NET.SSD.B050.G003', vcpu: 2, ramGb: 8, burstable: false, perHour: 0.248, haPerHour: 0.496 }]);
  assert.deepEqual([mysql.storageGbMonth, mysql.haStorageGbMonth], [0.1168, 0.2336]);
  assert.equal(snap.db!.engines.postgres!.instances[0].perHour, 0.25);
  assert.deepEqual(snap.cache!.nodes.map((n) => [n.memoryGb, n.perHour, n.haPerHour]), [[1.5, 0.079, 0.158], [12.8, 0.384, 0.768]]);
});

test('NCP 로그: Standard(수집 무료·보관 800원) + Premium(수집 500원·보관 무료), 한도는 문서값', () => {
  const logs = buildNcpSnapshot(LIST, 'seoul', KRW).logs!;
  assert.deepEqual([logs.plan, logs.ingestPerGb, logs.storagePerGbMonth, logs.maxGbPerDay, logs.maxStoredGb], ['Standard', 0, 0.8, 20, 100]);
  const p = logs.alternatives![0];
  assert.deepEqual([p.plan, p.ingestPerGb, p.storagePerGbMonth, p.maxGbPerDay, p.maxStoredGb], ['Premium', 0.5, 0, 100, 1024]);
});

test('NCP: 필요한 품목이 없으면 수집 실패(조용히 0원으로 만들지 않는다)', () => {
  const noNat = { ...LIST, otherProductPriceList: LIST.otherProductPriceList.filter((x) => x.infraResourceTypeCode !== 'NATGW') };
  assert.throws(() => buildNcpSnapshot(noNat, 'seoul', KRW), /NATGW/);
});
