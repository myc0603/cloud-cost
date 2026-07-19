import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { calcEgressUsd, cheapestPerSize, estimate, matchVm, qualifyingVms, HOURS_PER_MONTH, type ArchFilter, type Scenario } from './index';
import type { EgressTier, Provider, ProviderPricing, VmSku } from '../schema';

const sku = (over: Partial<VmSku>): VmSku => ({
  provider: 'gcp',
  region: 'seoul',
  sku: 'test',
  vcpu: 2,
  ramGb: 4,
  burstable: false,
  arch: 'x86',
  generation: 'e2',
  pricePerHour: 0.1,
  ...over,
});

const FIXTURE: VmSku[] = [
  sku({ sku: 'cheap-burst', vcpu: 2, ramGb: 4, burstable: true, pricePerHour: 0.03 }),
  sku({ sku: 'fit', vcpu: 2, ramGb: 8, pricePerHour: 0.08 }),
  sku({ sku: 'same-price-bigger', vcpu: 4, ramGb: 8, pricePerHour: 0.08 }),
  sku({ sku: 'big', vcpu: 8, ramGb: 32, pricePerHour: 0.5 }),
];

const EGRESS: EgressTier = {
  provider: 'gcp',
  region: 'seoul',
  freeGb: 200,
  tiers: [
    { upToGb: 200, pricePerGb: 0 },
    { upToGb: 10240, pricePerGb: 0.119 },
    { upToGb: null, pricePerGb: 0.109 },
  ],
};

const PRICING: Record<Provider, ProviderPricing> = {
  aws: { vm: [], storage: [], egress: null },
  azure: { vm: [], storage: [], egress: null },
  gcp: {
    vm: FIXTURE,
    storage: [
      { provider: 'gcp', region: 'seoul', kind: 'block-ssd', pricePerGbMonth: 0.13 },
      { provider: 'gcp', region: 'seoul', kind: 'object-standard', pricePerGbMonth: 0.023 },
    ],
    egress: EGRESS,
  },
};

const scenario = (over: Partial<Scenario>): Scenario => ({
  region: 'seoul',
  vms: [],
  blockGb: 0,
  objectGb: 0,
  egressGb: 0,
  ...over,
});

test('matchVm: 스펙 만족 최저가 선택 (버스트 포함)', () => {
  const m = matchVm(FIXTURE, { vcpu: 2, ramGb: 4, count: 1 }, { includeBurstable: true });
  assert.equal(m?.sku, 'cheap-burst');
});

test('matchVm: 버스트 제외 옵션', () => {
  const m = matchVm(FIXTURE, { vcpu: 2, ramGb: 4, count: 1 }, { includeBurstable: false });
  assert.equal(m?.sku, 'fit');
});

test('matchVm: 동가면 vCPU 작은 것 (과잉 프로비저닝 최소화)', () => {
  const m = matchVm(FIXTURE, { vcpu: 2, ramGb: 8, count: 1 }, { includeBurstable: false });
  assert.equal(m?.sku, 'fit');
});

test('matchVm: 만족 불가 시 null', () => {
  const m = matchVm(FIXTURE, { vcpu: 64, ramGb: 4, count: 1 }, { includeBurstable: true });
  assert.equal(m, null);
});

test('qualifyingVms: 스펙 만족 후보를 가격 오름차순으로 (동가면 vCPU 작은 순)', () => {
  const q = qualifyingVms(FIXTURE, { vcpu: 2, ramGb: 4, count: 1 }, { includeBurstable: true });
  assert.deepEqual(q.map((s) => s.sku), ['cheap-burst', 'fit', 'same-price-bigger', 'big']);
});

test('qualifyingVms: arch 필터 — both는 통틀어 최저가, x86/arm은 해당만', () => {
  const skus = [
    sku({ sku: 'x86-cheap', vcpu: 2, ramGb: 4, arch: 'x86', pricePerHour: 0.05 }),
    sku({ sku: 'arm-cheaper', vcpu: 2, ramGb: 4, arch: 'arm', pricePerHour: 0.03 }),
  ];
  const pick = (arch: ArchFilter) =>
    qualifyingVms(skus, { vcpu: 2, ramGb: 4, count: 1 }, { includeBurstable: true, arch });
  assert.equal(pick('both')[0].sku, 'arm-cheaper'); // 통틀어 최저가 = ARM
  assert.deepEqual(pick('x86').map((s) => s.sku), ['x86-cheap']);
  assert.deepEqual(pick('arm').map((s) => s.sku), ['arm-cheaper']);
});

test('cheapestPerSize: 같은 (vCPU,RAM)는 최저가 1개만 (열등 SKU 제거)', () => {
  const skus = [
    sku({ sku: 'big-4c8-pricey', vcpu: 4, ramGb: 8, pricePerHour: 0.2 }),
    sku({ sku: 'big-4c8-cheap', vcpu: 4, ramGb: 8, pricePerHour: 0.1 }),
    sku({ sku: 'small-2c4', vcpu: 2, ramGb: 4, pricePerHour: 0.05 }),
  ];
  const sorted = qualifyingVms(skus, { vcpu: 2, ramGb: 4, count: 1 }, { includeBurstable: true });
  assert.deepEqual(cheapestPerSize(sorted).map((s) => s.sku), ['small-2c4', 'big-4c8-cheap']);
});

test('estimate: override로 조건 만족하는 더 큰 인스턴스 선택', () => {
  const s = scenario({ vms: [{ vcpu: 2, ramGb: 4, count: 1 }] });
  const gcp = estimate(s, PRICING, { includeBurstable: true }, { gcp: { 0: 'fit' } }).find((e) => e.provider === 'gcp')!;
  const vm = gcp.lines[0];
  assert.ok(vm.kind === 'vm' && vm.matched?.sku === 'fit');
  assert.equal(vm.monthlyUsd, +(0.08 * HOURS_PER_MONTH).toFixed(2));
});

test('estimate: 존재하지 않는 override는 최저가로 self-heal', () => {
  const s = scenario({ vms: [{ vcpu: 2, ramGb: 4, count: 1 }] });
  const gcp = estimate(s, PRICING, { includeBurstable: true }, { gcp: { 0: 'no-such-sku' } }).find((e) => e.provider === 'gcp')!;
  assert.ok(gcp.lines[0].kind === 'vm' && gcp.lines[0].matched?.sku === 'cheap-burst');
});

test('estimate: vm 라인에 vmIndex와 후보 목록이 실린다 (드롭다운용)', () => {
  const s = scenario({ vms: [{ vcpu: 2, ramGb: 4, count: 1 }] });
  const vm = estimate(s, PRICING, { includeBurstable: true }).find((e) => e.provider === 'gcp')!.lines[0];
  assert.ok(vm.kind === 'vm' && vm.vmIndex === 0 && vm.candidates.length === 4);
});

test('calcEgressUsd: 무료 구간 내 = 0', () => {
  assert.equal(calcEgressUsd(EGRESS, 150), 0);
});

test('calcEgressUsd: 구간 누적 계산', () => {
  // 1TB: 무료 200GB + (1024-200) × 0.119
  assert.equal(+calcEgressUsd(EGRESS, 1024).toFixed(3), +((1024 - 200) * 0.119).toFixed(3));
  // 20TB: (10240-200)×0.119 + (20480-10240)×0.109
  const expected = (10240 - 200) * 0.119 + (20480 - 10240) * 0.109;
  assert.equal(+calcEgressUsd(EGRESS, 20480).toFixed(3), +expected.toFixed(3));
});

test('estimate: VM+스토리지+egress 통합, 데이터 없는 플랫폼은 available=false', () => {
  const s = scenario({ vms: [{ vcpu: 2, ramGb: 4, count: 2 }], blockGb: 100, objectGb: 500, egressGb: 1024 });
  const results = estimate(s, PRICING, { includeBurstable: true });

  const aws = results.find((e) => e.provider === 'aws')!;
  assert.equal(aws.available, false);
  assert.equal(aws.totalMonthlyUsd, null);

  const gcp = results.find((e) => e.provider === 'gcp')!;
  assert.equal(gcp.lines.length, 4); // vm + block + object + egress
  const vmLine = gcp.lines[0];
  assert.ok(vmLine.kind === 'vm' && vmLine.matched?.sku === 'cheap-burst');
  assert.equal(vmLine.monthlyUsd, +(0.03 * HOURS_PER_MONTH * 2).toFixed(2));

  const block = gcp.lines.find((l) => l.kind === 'storage' && l.storageKind === 'block-ssd')!;
  assert.equal(block.monthlyUsd, +(100 * 0.13).toFixed(2));
  const object = gcp.lines.find((l) => l.kind === 'storage' && l.storageKind === 'object-standard')!;
  assert.equal(object.monthlyUsd, +(500 * 0.023).toFixed(2));
  const egress = gcp.lines.find((l) => l.kind === 'egress')!;
  assert.equal(egress.monthlyUsd, +((1024 - 200) * 0.119).toFixed(2));

  assert.equal(
    gcp.totalMonthlyUsd,
    +gcp.lines.reduce((sum, l) => sum + l.monthlyUsd!, 0).toFixed(2),
  );
});

test('estimate: 사용량 0인 리소스는 항목 자체가 없다', () => {
  const s = scenario({ vms: [{ vcpu: 2, ramGb: 4, count: 1 }] });
  const gcp = estimate(s, PRICING, { includeBurstable: true }).find((e) => e.provider === 'gcp')!;
  assert.equal(gcp.lines.length, 1);
});

test('estimate: 한 항목이라도 계산 실패면 총액은 null', () => {
  const s = scenario({ vms: [{ vcpu: 64, ramGb: 4, count: 1 }] });
  const gcp = estimate(s, PRICING, { includeBurstable: true }).find((e) => e.provider === 'gcp')!;
  assert.equal(gcp.totalMonthlyUsd, null);
});

test('실데이터 스모크: 3사 스냅샷에서 통합 시나리오 견적', () => {
  const load = (p: string, f: string) => JSON.parse(readFileSync(`data/${p}/seoul/${f}`, 'utf8'));
  const pricing: Record<Provider, ProviderPricing> = {
    aws: { vm: load('aws', 'vm.json'), storage: load('aws', 'storage.json'), egress: load('aws', 'egress.json') },
    azure: { vm: load('azure', 'vm.json'), storage: load('azure', 'storage.json'), egress: load('azure', 'egress.json') },
    gcp: { vm: load('gcp', 'vm.json'), storage: load('gcp', 'storage.json'), egress: load('gcp', 'egress.json') },
  };
  const s = scenario({ vms: [{ vcpu: 2, ramGb: 4, count: 2 }], blockGb: 100, objectGb: 500, egressGb: 1024 });
  const results = estimate(s, pricing, { includeBurstable: true });

  for (const r of results) {
    assert.equal(r.available, true, `${r.provider} 데이터가 있어야 함`);
    assert.equal(r.lines.length, 4);
    assert.ok(r.totalMonthlyUsd !== null && r.totalMonthlyUsd > 0, `${r.provider} 총액이 계산되어야 함`);
  }
});
