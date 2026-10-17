import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadPricing } from '../pricing';
import { calcEgressUsd, cheapestTotal, cdnMonthly, logsMonthly, cheapestPerSize, estimate, findVmSku, fitContainer, gcpSustainedUseMax, matchVm, qualifyingVms, HOURS_PER_MONTH, type ArchFilter, type Scenario } from './index';
import { fitCloudSqlShape } from './db';
import type { CdnPrice, LogPrice, ContainerPrice, DbInstance, EgressTier, Provider, ProviderPricing, VmSku } from '../schema';
import type { MatchOptions, Resource } from './types';

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
  aws: { vm: [], storage: [], egress: null, k8s: null, lb: null, nat: null, db: null, cache: null, container: null, cdn: null, logs: null },
  azure: { vm: [], storage: [], egress: null, k8s: null, lb: null, nat: null, db: null, cache: null, container: null, cdn: null, logs: null },
  oci: { vm: [], storage: [], egress: null, k8s: null, lb: null, nat: null, db: null, cache: null, container: null, cdn: null, logs: null },
  ncp: { vm: [], storage: [], egress: null, k8s: null, lb: null, nat: null, db: null, cache: null, container: null, cdn: null, logs: null },
  scp: { vm: [], storage: [], egress: null, k8s: null, lb: null, nat: null, db: null, cache: null, container: null, cdn: null, logs: null },
  nhn: { vm: [], storage: [], egress: null, k8s: null, lb: null, nat: null, db: null, cache: null, container: null, cdn: null, logs: null },
  kt: { vm: [], storage: [], egress: null, k8s: null, lb: null, nat: null, db: null, cache: null, container: null, cdn: null, logs: null },
  gcp: {
    vm: FIXTURE,
    storage: [
      { provider: 'gcp', region: 'seoul', kind: 'block-ssd', pricePerGbMonth: 0.13 },
      { provider: 'gcp', region: 'seoul', kind: 'object-standard', pricePerGbMonth: 0.023 },
    ],
    egress: EGRESS,
    k8s: { provider: 'gcp', region: 'seoul', clusterPerHour: 0.1 },
    lb: { provider: 'gcp', region: 'seoul', perHour: 0.038, perGb: 0.012 },
    nat: { provider: 'gcp', region: 'seoul', hourly: { per: 'vm', usd: 0.0014, maxVms: 32 }, perGb: 0.045 },
    db: {
      provider: 'gcp',
      region: 'seoul',
      engines: {
        mysql: null,
        postgres: {
          instances: [],
          custom: { vcpuPerHour: 0.05, ramGbPerHour: 0.01, haVcpuPerHour: 0.1, haRamGbPerHour: 0.02 },
          storageGbMonth: 0.2,
          haStorageGbMonth: 0.4,
        },
      },
    },
    cache: {
      provider: 'gcp',
      region: 'seoul',
      engine: 'Redis',
      nodes: [],
      gbTiers: [
        { upToGb: 4, perGbHour: 0.065, haPerGbHour: 0.114 },
        { upToGb: 10, perGbHour: 0.04, haPerGbHour: 0.075 },
        { upToGb: null, perGbHour: 0.02, haPerGbHour: 0.04 },
      ],
    },
    container: null,
    cdn: null,
    logs: null,
  },
};

const scenario = (resources: Resource[]): Scenario => ({ region: 'seoul', resources });
const vmRes = (vcpu: number, ramGb: number, count = 1): Resource => ({ type: 'vm', vcpu, ramGb, count });

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
  const s = scenario([vmRes(2, 4)]);
  const gcp = estimate(s, PRICING, { includeBurstable: true }, { gcp: { 0: 'fit' } }).find((e) => e.provider === 'gcp')!;
  const vm = gcp.lines[0];
  assert.ok(vm.kind === 'vm' && vm.matched?.sku === 'fit');
  assert.equal(vm.monthlyUsd, +(0.08 * HOURS_PER_MONTH).toFixed(2));
});

test('estimate: 존재하지 않는 override는 최저가로 self-heal', () => {
  const s = scenario([vmRes(2, 4)]);
  const gcp = estimate(s, PRICING, { includeBurstable: true }, { gcp: { 0: 'no-such-sku' } }).find((e) => e.provider === 'gcp')!;
  assert.ok(gcp.lines[0].kind === 'vm' && gcp.lines[0].matched?.sku === 'cheap-burst');
});

test('estimate: 같은 사이즈에 더 싼 게 있는 override도 그대로 쓰고 후보에 끼워 넣는다', () => {
  const pricing = { ...PRICING, gcp: { ...PRICING.gcp, vm: [...FIXTURE, sku({ sku: 'fit-pricey', vcpu: 2, ramGb: 8, pricePerHour: 0.09 })] } };
  const vm = estimate(scenario([vmRes(2, 4)]), pricing, { includeBurstable: true }, { gcp: { 0: 'fit-pricey' } }).find((e) => e.provider === 'gcp')!.lines[0];
  assert.ok(vm.kind === 'vm' && vm.matched?.sku === 'fit-pricey');
  assert.deepEqual(vm.candidates.map((c) => c.sku), ['cheap-burst', 'fit', 'same-price-bigger', 'fit-pricey', 'big']);
});

test('estimate: 버스트 제외여도 버스트 override는 그대로 — 자동 선택(후보 맨 앞)은 조건 안 최저가 유지', () => {
  const vm = estimate(scenario([vmRes(2, 4)]), PRICING, { includeBurstable: false }, { gcp: { 0: 'cheap-burst' } }).find((e) => e.provider === 'gcp')!.lines[0];
  assert.ok(vm.kind === 'vm' && vm.matched?.sku === 'cheap-burst');
  assert.deepEqual(vm.candidates.map((c) => c.sku), ['fit', 'cheap-burst', 'same-price-bigger', 'big']);
});

test('findVmSku: 대소문자 무시, Azure는 Standard_ 생략 허용, 없으면 null', () => {
  const pricing = { ...PRICING, azure: { ...PRICING.azure, vm: [sku({ provider: 'azure', sku: 'Standard_B2s' })] } };
  assert.equal(findVmSku(pricing, ' FIT ')?.sku, 'fit');
  assert.equal(findVmSku(pricing, 'b2s')?.provider, 'azure');
  assert.equal(findVmSku(pricing, 'Standard_B2s')?.sku, 'Standard_B2s');
  assert.equal(findVmSku(pricing, 'm5.large'), null);
  assert.equal(findVmSku(pricing, ''), null);
});

test('estimate: vm 라인에 resourceIndex와 후보 목록이 실린다 (드롭다운용)', () => {
  const s = scenario([vmRes(2, 4)]);
  const vm = estimate(s, PRICING, { includeBurstable: true }).find((e) => e.provider === 'gcp')!.lines[0];
  assert.ok(vm.kind === 'vm' && vm.resourceIndex === 0 && vm.candidates.length === 4);
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
  const s = scenario([vmRes(2, 4, 2), { type: 'block', gb: 100 }, { type: 'object', gb: 500 }, { type: 'egress', gb: 1024 }]);
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

test('estimate: 카드 순서대로 줄이 나오고 resourceIndex가 카드 인덱스', () => {
  const s = scenario([{ type: 'egress', gb: 100 }, vmRes(2, 4), { type: 'block', gb: 10 }]);
  const gcp = estimate(s, PRICING, { includeBurstable: true }).find((e) => e.provider === 'gcp')!;
  assert.deepEqual(gcp.lines.map((l) => [l.kind, l.resourceIndex]), [['egress', 0], ['vm', 1], ['storage', 2]]);
});

test('estimate: override는 VM 순번이 아니라 카드 인덱스로 적용', () => {
  const s = scenario([{ type: 'block', gb: 10 }, vmRes(2, 4)]);
  const gcp = estimate(s, PRICING, { includeBurstable: true }, { gcp: { 1: 'fit' } }).find((e) => e.provider === 'gcp')!;
  const line = gcp.lines[1];
  assert.ok(line.kind === 'vm' && line.matched?.sku === 'fit');
});

test('estimate: 한 항목이라도 계산 실패면 총액은 null', () => {
  const s = scenario([vmRes(64, 4)]);
  const gcp = estimate(s, PRICING, { includeBurstable: true }).find((e) => e.provider === 'gcp')!;
  assert.equal(gcp.totalMonthlyUsd, null);
});

test('estimate: 매칭 실패 이유 — 사이즈 초과면 조건 내 최대 vCPU·RAM', () => {
  const s = scenario([vmRes(64, 4)]);
  const vm = estimate(s, PRICING, { includeBurstable: true }).find((e) => e.provider === 'gcp')!.lines[0];
  assert.ok(vm.kind === 'vm');
  assert.deepEqual(vm.noMatch, { reason: 'size', maxVcpu: 8, maxRamGb: 32 });
});

test('estimate: 매칭 실패 이유 — 조건(아키텍처)에 맞는 SKU가 아예 없으면 arch', () => {
  const s = scenario([vmRes(2, 4)]);
  const vm = estimate(s, PRICING, { includeBurstable: true, arch: 'arm' }).find((e) => e.provider === 'gcp')!.lines[0];
  assert.ok(vm.kind === 'vm');
  assert.deepEqual(vm.noMatch, { reason: 'arch', arch: 'arm', scope: 'region' });
});

test('estimate: 매칭 성공이면 noMatch는 null', () => {
  const s = scenario([vmRes(2, 4)]);
  const vm = estimate(s, PRICING, { includeBurstable: true }).find((e) => e.provider === 'gcp')!.lines[0];
  assert.ok(vm.kind === 'vm' && vm.noMatch === null);
});

test('estimate: K8s 카드 = 컨트롤 플레인 + 노드 두 줄, 노드 수는 클러스터 × 클러스터당 노드', () => {
  const s = scenario([{ type: 'k8s', clusters: 2, node: { vcpu: 2, ramGb: 8, count: 3 } }]);
  const gcp = estimate(s, PRICING, { includeBurstable: true }).find((e) => e.provider === 'gcp')!;
  const [control, node] = gcp.lines;
  assert.ok(control.kind === 'k8s-control' && control.resourceIndex === 0);
  assert.equal(control.monthlyUsd, +(0.1 * HOURS_PER_MONTH * 2).toFixed(2));
  assert.ok(node.kind === 'vm' && node.role === 'k8s-node' && node.resourceIndex === 0);
  assert.equal(node.spec.count, 6);
  assert.equal(node.matched?.sku, 'fit');
  assert.equal(node.monthlyUsd, +(0.08 * HOURS_PER_MONTH * 6).toFixed(2));
});

test('estimate: K8s 노드는 버스트 포함 옵션이어도 버스트 제외 (일반 VM은 포함)', () => {
  const s = scenario([vmRes(2, 4), { type: 'k8s', clusters: 1, node: { vcpu: 2, ramGb: 4, count: 1 } }]);
  const gcp = estimate(s, PRICING, { includeBurstable: true }).find((e) => e.provider === 'gcp')!;
  const [vm, , node] = gcp.lines;
  assert.ok(vm.kind === 'vm' && vm.matched?.sku === 'cheap-burst');
  assert.ok(node.kind === 'vm' && node.role === 'k8s-node' && node.matched?.sku === 'fit');
  assert.ok(node.candidates.every((c) => !c.burstable));
});

test('estimate: K8s 노드도 카드 인덱스 override로 인스턴스 변경', () => {
  const s = scenario([vmRes(2, 4), { type: 'k8s', clusters: 1, node: { vcpu: 2, ramGb: 8, count: 1 } }]);
  const gcp = estimate(s, PRICING, { includeBurstable: true }, { gcp: { 1: 'big' } }).find((e) => e.provider === 'gcp')!;
  const node = gcp.lines.find((l) => l.kind === 'vm' && l.role === 'k8s-node')!;
  assert.ok(node.kind === 'vm' && node.matched?.sku === 'big');
});

test('estimate: K8s 요금 데이터가 없으면 컨트롤 플레인 줄이 null → 총액 null', () => {
  const s = scenario([{ type: 'k8s', clusters: 1, node: { vcpu: 2, ramGb: 4, count: 1 } }]);
  const pricing = { ...PRICING, gcp: { ...PRICING.gcp, k8s: null } };
  const gcp = estimate(s, pricing, { includeBurstable: true }).find((e) => e.provider === 'gcp')!;
  assert.equal(gcp.lines[0].monthlyUsd, null);
  assert.equal(gcp.totalMonthlyUsd, null);
});

test('estimate: LB = 시간당 × 대수 + GB당 × 처리량', () => {
  const s = scenario([{ type: 'lb', count: 2, gb: 1000 }]);
  const line = estimate(s, PRICING, { includeBurstable: true }).find((e) => e.provider === 'gcp')!.lines[0];
  assert.ok(line.kind === 'lb');
  assert.equal(line.monthlyUsd, +(0.038 * HOURS_PER_MONTH * 2 + 0.012 * 1000).toFixed(2));
});

test('estimate: NAT(VM당 과금) = 시나리오 VM 대수 + K8s 노드 수, 게이트웨이당 32대 상한', () => {
  const nat = (resources: Resource[]) => {
    const line = estimate(scenario(resources), PRICING, { includeBurstable: true }).find((e) => e.provider === 'gcp')!.lines.find((l) => l.kind === 'nat')!;
    assert.ok(line.kind === 'nat');
    return line;
  };
  // VM 2대 + 노드 2×3=6대 = 8대
  const small = nat([vmRes(2, 4, 2), { type: 'k8s', clusters: 2, node: { vcpu: 2, ramGb: 4, count: 3 } }, { type: 'nat', count: 1, gb: 100 }]);
  assert.equal(small.billedVms, 8);
  assert.equal(small.monthlyUsd, +(0.0014 * 8 * HOURS_PER_MONTH + 0.045 * 100).toFixed(2));
  // 100대지만 게이트웨이 1개 → 32대 상한, 2개 → 64대
  assert.equal(nat([vmRes(2, 4, 100), { type: 'nat', count: 1, gb: 1 }]).billedVms, 32);
  assert.equal(nat([vmRes(2, 4, 100), { type: 'nat', count: 2, gb: 1 }]).billedVms, 64);
});

test('estimate: NAT(게이트웨이당 과금)는 VM 수와 무관, billedVms null', () => {
  const pricing = { ...PRICING, gcp: { ...PRICING.gcp, nat: { provider: 'gcp' as const, region: 'seoul' as const, hourly: { per: 'gateway' as const, usd: 0.045 }, perGb: 0.045 } } };
  const line = estimate(scenario([vmRes(2, 4, 50), { type: 'nat', count: 2, gb: 100 }]), pricing, { includeBurstable: true })
    .find((e) => e.provider === 'gcp')!.lines.find((l) => l.kind === 'nat')!;
  assert.ok(line.kind === 'nat' && line.billedVms === null);
  assert.equal(line.monthlyUsd, +(0.045 * 2 * HOURS_PER_MONTH + 0.045 * 100).toFixed(2));
});

const RATES = { vcpuPerHour: 0.05, ramGbPerHour: 0.01, haVcpuPerHour: 0.1, haRamGbPerHour: 0.02 };

test('fitCloudSqlShape: 문서 규칙 — vCPU 1 또는 짝수, RAM 0.9~6.5GB/vCPU·256MB 단위·최소 3.75GB', () => {
  const fit = (vcpu: number, ramGb: number) => fitCloudSqlShape({ vcpu, ramGb, count: 1 }, RATES, false);
  assert.deepEqual(fit(2, 8), { sku: 'db-custom-2-8192', vcpu: 2, ramGb: 8, perHour: 0.18, committed: false });
  assert.equal(fit(1, 1)?.ramGb, 3.75); // 최소 3.75GB
  assert.equal(fit(3, 4)?.vcpu, 4); // 3은 불가 → 짝수 4
  assert.equal(fit(4, 4)?.ramGb, 4); // vCPU당 최소 0.9GB → 3.6, 단 최소 3.75 → 3.75 < 4 OK
  assert.equal(fit(8, 1)?.ramGb, 7.25); // 0.9×8=7.2 → 256MB 단위 올림 7.25
  assert.equal(fit(1, 16)?.vcpu, 4); // 16GB는 vCPU당 6.5GB 상한 → 최소 2.46 → 짝수 4
  assert.equal(fit(2, 8.1)?.ramGb, 8.25); // 256MB 단위 올림
  assert.equal(fit(96, 625), null); // 96×6.5 = 624 초과
  assert.equal(fitCloudSqlShape({ vcpu: 2, ramGb: 8, count: 1 }, RATES, true)?.perHour, 0.36); // HA 단가
});

test('estimate: DB(GCP 커스텀) = 컴퓨트 + 스토리지 두 줄, 인스턴스 수·이중화 반영', () => {
  const s = scenario([{ type: 'db', engine: 'postgres', vcpu: 2, ramGb: 8, storageGb: 100, ha: true, count: 2 }]);
  const [compute, storage] = estimate(s, PRICING, { includeBurstable: true }).find((e) => e.provider === 'gcp')!.lines;
  assert.ok(compute.kind === 'db' && compute.matched?.sku === 'db-custom-2-8192');
  assert.equal(compute.monthlyUsd, +(0.36 * HOURS_PER_MONTH * 2).toFixed(2));
  assert.ok(storage.kind === 'db-storage');
  assert.equal(storage.monthlyUsd, +(0.4 * 100 * 2).toFixed(2));
});

test('estimate: DB 요금은 있는데 엔진 요금만 없으면 그 엔진 미제공 (수집 누락은 validate가 막는다)', () => {
  const s = scenario([{ type: 'db', engine: 'mysql', vcpu: 2, ramGb: 8, storageGb: 100, ha: false, count: 1 }]);
  const gcp = estimate(s, PRICING, { includeBurstable: true }).find((e) => e.provider === 'gcp')!;
  assert.deepEqual(gcp.lines, [{ resourceIndex: 0, kind: 'not-offered', resourceType: 'db', limit: { kind: 'engine', engine: 'mysql' }, monthlyUsd: null }]);
  assert.equal(gcp.partial, true);
  assert.equal(gcp.totalMonthlyUsd, null); // 미제공 줄뿐이면 합산할 항목이 없다
});

test('estimate: DB(정해진 사이즈) — 버스트 옵션·이중화 미지원 제외·카드 인덱스 선택·사이즈 초과 이유', () => {
  const inst = (sku: string, vcpu: number, ramGb: number, perHour: number, haPerHour: number | null, burstable = false): DbInstance =>
    ({ sku, vcpu, ramGb, perHour, haPerHour, burstable });
  const instances = [
    inst('burst-2c8', 2, 8, 0.05, null, true), // 이중화 미지원 (Azure 버스트)
    inst('gp-2c8', 2, 8, 0.1, 0.2),
    inst('gp-4c16', 4, 16, 0.2, 0.4),
  ];
  const pricing = {
    ...PRICING,
    gcp: { ...PRICING.gcp, db: { provider: 'gcp' as const, region: 'seoul' as const, engines: { mysql: { instances, custom: null, storageGbMonth: 0.1, haStorageGbMonth: 0.2 }, postgres: null } } },
  };
  const db = (ha: boolean, includeBurstable: boolean, vcpu = 2, pick?: string) => {
    const s = scenario([{ type: 'db', engine: 'mysql', vcpu, ramGb: 8, storageGb: 10, ha, count: 1 }]);
    const line = estimate(s, pricing, { includeBurstable }, pick ? { gcp: { 0: pick } } : {}).find((e) => e.provider === 'gcp')!.lines[0];
    assert.ok(line.kind === 'db');
    return line;
  };
  assert.equal(db(false, true).matched?.sku, 'burst-2c8');
  assert.equal(db(false, false).matched?.sku, 'gp-2c8'); // 버스트 제외
  assert.equal(db(true, true).matched?.sku, 'gp-2c8'); // 이중화 미지원 버스트 제외
  assert.equal(db(true, true).matched?.perHour, 0.2); // 이중화 단가
  assert.equal(db(false, true, 2, 'gp-4c16').matched?.sku, 'gp-4c16'); // 드롭다운 선택
  assert.deepEqual(db(false, true, 8).noMatch, { reason: 'size', maxVcpu: 4, maxRamGb: 16 });
});

test('estimate: 캐시(GB 구간) — GB 올림·최소 1GB, 용량이 속한 구간 단가 × 용량 전체, 이중화·개수·300GB 상한', () => {
  const cache = (memoryGb: number, ha = false, count = 1) => {
    const line = estimate(scenario([{ type: 'cache', memoryGb, ha, count }]), PRICING, { includeBurstable: true }).find((e) => e.provider === 'gcp')!.lines[0];
    assert.ok(line.kind === 'cache');
    return line;
  };
  assert.deepEqual(cache(3).matched, { sku: 'Basic M1 3GB', memoryGb: 3, perHour: 0.195, committed: false });
  assert.equal(cache(5).matched?.perHour, 0.2); // M2 구간 단가가 5GB 전체에 (누적 아님)
  assert.equal(cache(5, true).matched?.sku, 'Standard M2 5GB');
  assert.equal(cache(5, true, 2).monthlyUsd, +(5 * 0.075 * HOURS_PER_MONTH * 2).toFixed(2));
  assert.equal(cache(3).engine, 'Redis');
  assert.deepEqual(cache(301).noMatch, { reason: 'memory', maxGb: 300 });
});

test('estimate: 캐시(노드) — 메모리 ≥ 요구치 최저가, 버스트 옵션, 이중화 단가, 카드 인덱스 선택, 한도 초과', () => {
  const node = (sku: string, memoryGb: number, perHour: number, burstable = false) => ({ sku, memoryGb, burstable, perHour, haPerHour: perHour * 2 });
  const pricing = {
    ...PRICING,
    gcp: {
      ...PRICING.gcp,
      cache: { provider: 'gcp' as const, region: 'seoul' as const, engine: 'Valkey', gbTiers: null, nodes: [node('t-1', 1.37, 0.03, true), node('m-6', 6.38, 0.15), node('r-13', 13.07, 0.2)] },
    },
  };
  const cache = (memoryGb: number, opts: { includeBurstable: boolean }, ha = false, pick?: string) => {
    const line = estimate(scenario([{ type: 'cache', memoryGb, ha, count: 1 }]), pricing, opts, pick ? { gcp: { 0: pick } } : {}).find((e) => e.provider === 'gcp')!.lines[0];
    assert.ok(line.kind === 'cache');
    return line;
  };
  assert.equal(cache(1, { includeBurstable: true }).matched?.sku, 't-1');
  assert.equal(cache(1, { includeBurstable: false }).matched?.sku, 'm-6');
  assert.equal(cache(1, { includeBurstable: true }, true).matched?.perHour, 0.06);
  assert.equal(cache(1, { includeBurstable: true }, false, 'r-13').matched?.sku, 'r-13');
  assert.deepEqual(cache(20, { includeBurstable: true }).noMatch, { reason: 'memory', maxGb: 13.07 });
});

test('약정: VM은 약정가 기준으로 최저가를 다시 찾고, 약정가 없는 후보는 정가(committed false)로 남는다', () => {
  const skus = [
    sku({ sku: 'od-cheap', pricePerHour: 0.08 }), // 약정가 없음
    sku({ sku: 'commit-cheap', pricePerHour: 0.1, commit: { '1y': 0.07, '3y': 0.05 } }),
  ];
  const spec = { vcpu: 2, ramGb: 4, count: 1 };
  assert.equal(matchVm(skus, spec, { includeBurstable: true })?.sku, 'od-cheap'); // 정가 기준
  const y1 = qualifyingVms(skus, spec, { includeBurstable: true, term: '1y' });
  assert.deepEqual(y1.map((c) => [c.sku, c.perHour, c.committed]), [['commit-cheap', 0.07, true], ['od-cheap', 0.08, false]]);
  assert.equal(y1[0].pricePerHour, 0.1); // 정가는 그대로 보존
  assert.equal(matchVm(skus, spec, { includeBurstable: true, term: '3y' })?.perHour, 0.05);
});

test('약정: K8s 노드·DB(정해진 사이즈·이중화 약정가 없으면 정가)·GCP 커스텀·캐시 노드·GB 구간(M1 제외)', () => {
  const inst: DbInstance = { sku: 'gp', vcpu: 2, ramGb: 8, burstable: false, perHour: 0.2, haPerHour: 0.4, commit: { '1y': { perHour: 0.12, haPerHour: 0.24 }, '3y': { perHour: 0.08, haPerHour: null } } };
  const pricing = {
    ...PRICING,
    gcp: {
      ...PRICING.gcp,
      vm: [sku({ sku: 'node', vcpu: 2, ramGb: 8, pricePerHour: 0.1, commit: { '1y': 0.06 } })],
      db: {
        provider: 'gcp' as const,
        region: 'seoul' as const,
        engines: {
          mysql: { instances: [inst], custom: null, storageGbMonth: 0.1, haStorageGbMonth: 0.2 },
          postgres: { ...PRICING.gcp.db!.engines.postgres!, custom: { ...RATES, commit: { '1y': { vcpuPerHour: 0.04, ramGbPerHour: 0.008, haVcpuPerHour: 0.08, haRamGbPerHour: 0.016 } } } },
        },
      },
      cache: {
        ...PRICING.gcp.cache!,
        gbTiers: PRICING.gcp.cache!.gbTiers!.map((t, i) => (i === 0 ? t : { ...t, commit: { '1y': { perGbHour: t.perGbHour / 2, haPerGbHour: t.haPerGbHour / 2 } } })),
      },
    },
  };
  const lines = (resources: Resource[], term: '1y' | '3y') =>
    estimate(scenario(resources), pricing, { includeBurstable: true, term }).find((e) => e.provider === 'gcp')!.lines;
  const node = lines([{ type: 'k8s', clusters: 1, node: { vcpu: 2, ramGb: 8, count: 1 } }], '1y')[1];
  assert.ok(node.kind === 'vm' && node.matched?.perHour === 0.06 && node.matched.committed);
  // DB 정해진 사이즈: 1년 이중화 약정가 / 3년은 이중화 약정가 없음 → 정가
  const mysql = (ha: boolean, term: '1y' | '3y') => lines([{ type: 'db', engine: 'mysql', vcpu: 2, ramGb: 8, storageGb: 10, ha, count: 1 }], term)[0];
  const [a, b, c] = [mysql(true, '1y'), mysql(false, '3y'), mysql(true, '3y')];
  assert.ok(a.kind === 'db' && a.matched?.perHour === 0.24 && a.matched.committed);
  assert.ok(b.kind === 'db' && b.matched?.perHour === 0.08 && b.matched.committed);
  assert.ok(c.kind === 'db' && c.matched?.perHour === 0.4 && !c.matched.committed);
  // GCP 커스텀: 약정 단가로 계산 (2×0.04 + 8×0.008), 3년 단가 없으면 정가
  const pg = (term: '1y' | '3y') => lines([{ type: 'db', engine: 'postgres', vcpu: 2, ramGb: 8, storageGb: 10, ha: false, count: 1 }], term)[0];
  const [p1, p3] = [pg('1y'), pg('3y')];
  assert.ok(p1.kind === 'db' && p1.matched?.perHour === 0.144 && p1.matched.committed);
  assert.ok(p3.kind === 'db' && p3.matched?.perHour === 0.18 && !p3.matched.committed);
  // 캐시 GB 구간: M1(3GB)은 약정 없음, M2(5GB)는 약정 단가
  const [m1] = lines([{ type: 'cache', memoryGb: 3, ha: false, count: 1 }], '1y');
  const [m2] = lines([{ type: 'cache', memoryGb: 5, ha: false, count: 1 }], '1y');
  assert.ok(m1.kind === 'cache' && m1.matched?.committed === false);
  assert.ok(m2.kind === 'cache' && m2.matched?.perHour === 0.1 && m2.matched.committed);
});

test('gcpSustainedUseMax: GCP N1 30%·N2·N2D·C2 20%, E2·다른 플랫폼은 null', () => {
  assert.equal(gcpSustainedUseMax(sku({ generation: 'n1' })), 0.3);
  assert.equal(gcpSustainedUseMax(sku({ generation: 'n2d' })), 0.2);
  assert.equal(gcpSustainedUseMax(sku({ generation: 'e2' })), null);
  assert.equal(gcpSustainedUseMax(sku({ provider: 'aws', generation: 'n2' })), null);
});

test('컨테이너: 플랫폼별 허용 조합으로 올림 — Fargate 표·Container Apps 1:2·Cloud Run 정수 vCPU', () => {
  const rate = { vcpuPerHour: 0.04, gbPerHour: 0.005 };
  const price = (provider: Provider, arm = false): ContainerPrice => ({ provider, region: 'seoul', rates: { x86: rate, ...(arm ? { arm: { vcpuPerHour: 0.03, gbPerHour: 0.004 } } : {}) } });
  const fit = (provider: Provider, vcpu: number, ramGb: number, opts: MatchOptions = { includeBurstable: true }) => fitContainer(price(provider), { vcpu, ramGb }, opts);
  // Fargate: 0.25 vCPU는 최대 2GB → 3GB는 0.5 vCPU로
  assert.deepEqual(fit('aws', 0.25, 3), { vcpu: 0.5, ramGb: 3, arch: 'x86', perHour: 0.035, committed: false });
  // 1 vCPU 최소 메모리 2GB
  assert.ok('vcpu' in fit('aws', 1, 1) && (fit('aws', 1, 1) as { ramGb: number }).ramGb === 2);
  // 8 vCPU는 4GB 단위 → 17GB 요구면 20GB
  assert.equal((fit('aws', 8, 17) as { ramGb: number }).ramGb, 20);
  // Container Apps: 메모리 = vCPU × 2 → 1 vCPU/3GB면 1.5 vCPU/3GB, 4 vCPU 초과는 불가
  assert.deepEqual(fit('azure', 1, 3), { vcpu: 1.5, ramGb: 3, arch: 'x86', perHour: 0.075, committed: false });
  assert.deepEqual(fit('azure', 8, 16), { reason: 'size', maxVcpu: 4, maxRamGb: 8 });
  // Cloud Run: 분수 vCPU 불가 → 1, 1 vCPU 최대 4GB → 6GB면 2 vCPU, 4 vCPU 최소 2GB
  assert.equal((fit('gcp', 0.25, 1) as { vcpu: number }).vcpu, 1);
  assert.equal((fit('gcp', 1, 6) as { vcpu: number }).vcpu, 2);
  assert.equal((fit('gcp', 4, 1) as { ramGb: number }).ramGb, 2);
  // 아키텍처: Fargate는 ARM이 싸면 ARM, ARM만이면 x86 전용 플랫폼은 arch 실패
  const arm = fitContainer(price('aws', true), { vcpu: 1, ramGb: 2 }, { includeBurstable: true });
  assert.ok('arch' in arm && arm.arch === 'arm');
  assert.deepEqual(fit('gcp', 1, 2, { includeBurstable: true, arch: 'arm' }), { reason: 'arch', arch: 'arm', scope: 'platform' });
});

test('컨테이너: 견적 줄 = 컨테이너 수 × 시간당 × 730, 약정 단가 반영', () => {
  const container: ContainerPrice = {
    provider: 'gcp',
    region: 'seoul',
    rates: { x86: { vcpuPerHour: 0.08, gbPerHour: 0.01, commit: { '1y': { vcpuPerHour: 0.04, gbPerHour: 0.005 } } } },
  };
  const line = (term?: '1y' | '3y') =>
    estimate(scenario([{ type: 'container', vcpu: 1, ramGb: 2, count: 3 }]), { ...PRICING, gcp: { ...PRICING.gcp, container } }, { includeBurstable: true, term })
      .find((e) => e.provider === 'gcp')!.lines[0];
  const od = line();
  assert.ok(od.kind === 'container' && od.matched?.perHour === 0.1);
  assert.equal(od.monthlyUsd, +(0.1 * HOURS_PER_MONTH * 3).toFixed(2));
  const y1 = line('1y');
  assert.ok(y1.kind === 'container' && y1.matched?.perHour === 0.05 && y1.matched.committed);
  const y3 = line('3y'); // 3년 약정가 없음 → 정가
  assert.ok(y3.kind === 'container' && y3.matched?.perHour === 0.1 && !y3.matched.committed);
  const none = estimate(scenario([{ type: 'container', vcpu: 1, ramGb: 2, count: 1 }]), PRICING, { includeBurstable: true }).find((e) => e.provider === 'gcp')!.lines[0];
  assert.ok(none.kind === 'container' && none.matched === null && none.noMatch === null); // 데이터 없음
});

test('CDN: 종량제 = 기본료 + 전송 구간 + 요청 구간(1만 건) + 캐시 채움(미스 10%)', () => {
  const cdn: CdnPrice = {
    provider: 'gcp',
    region: 'seoul',
    gbTiers: [{ upTo: 1000, price: 0.1 }, { upTo: null, price: 0.05 }],
    requestTiers: [{ upTo: 100, price: 0.01 }, { upTo: null, price: 0.005 }],
    monthlyBase: 35,
    fillPerGb: 0.02,
    plans: [],
  };
  const line = estimate(scenario([{ type: 'cdn', gb: 2000, requestsM: 2 }]), { ...PRICING, gcp: { ...PRICING.gcp, cdn } }, { includeBurstable: true })
    .find((e) => e.provider === 'gcp')!.lines[0];
  // 35 + (1000×0.1 + 1000×0.05) + (100×0.01 + 100×0.005) + 2000×0.1×0.02
  assert.deepEqual(line, { resourceIndex: 0, kind: 'cdn', gb: 2000, requestsM: 2, plan: null, monthlyUsd: +(35 + 150 + 1.5 + 4).toFixed(2) });
});

test('CDN: 정액 요금제는 한도 안에서 가장 싼 것, 종량제보다 비싸면 종량제', () => {
  const cdn: CdnPrice = {
    provider: 'aws',
    region: 'seoul',
    gbTiers: [{ upTo: null, price: 0.12 }],
    requestTiers: [{ upTo: null, price: 0.012 }],
    monthlyBase: 0,
    fillPerGb: 0,
    plans: [
      { name: 'Free', monthlyUsd: 0, maxGb: 100, maxRequests: 1_000_000 },
      { name: 'Pro', monthlyUsd: 15, maxGb: 51200, maxRequests: 10_000_000 },
      { name: 'Business', monthlyUsd: 200, maxGb: 51200, maxRequests: 125_000_000 },
    ],
  };
  assert.deepEqual(cdnMonthly(cdn, 100, 1_000_000), { usd: 0, plan: 'Free' });
  assert.deepEqual(cdnMonthly(cdn, 1024, 10_000_000), { usd: 15, plan: 'Pro' });
  // 1TB·5천만 건: Business $200 > 종량제 1024×0.12 + 5000×0.012 = $182.88
  assert.equal(cdnMonthly(cdn, 1024, 50_000_000).plan, null);
  assert.equal(cdnMonthly(cdn, 60000, 1_000_000).plan, null); // 전송 한도 초과 → 종량제
});

test('로그: 수집 + 포함 기간 넘는 보관(쌓인 양 × 배율), Commitment Tier는 초과분 실효 단가로 비교', () => {
  const D = HOURS_PER_MONTH / 24; // 월 일수
  const aws: LogPrice = { provider: 'aws', region: 'seoul', ingestPerGb: 0.76, storagePerGbMonth: 0.03, includedDays: 0, storedRatio: 0.15, commitmentTiers: [] };
  // 100GB × 0.76 + 100GB × (90일/월일수) × 0.15 × 0.03
  assert.equal(logsMonthly(aws, 100, 90).usd.toFixed(6), (76 + 100 * (90 / D) * 0.15 * 0.03).toFixed(6));
  const azure: LogPrice = { provider: 'azure', region: 'seoul', ingestPerGb: 3, storagePerGbMonth: 0.1, includedDays: 31, storedRatio: 1, commitmentTiers: [{ gbPerDay: 100, perDay: 250 }] };
  assert.deepEqual(logsMonthly(azure, 100, 30), { usd: 300, commitmentGbPerDay: null }); // 포함 기간 안, 약정은 비쌈
  // 하루 200GB: 종량제 3 × 200D vs 약정 250D + 초과 100D × 2.5 → 약정
  const big = logsMonthly(azure, 200 * D, 31);
  assert.equal(big.commitmentGbPerDay, 100);
  assert.equal(big.usd.toFixed(6), (250 * D + 100 * D * 2.5).toFixed(6));
  const line = estimate(scenario([{ type: 'logs', gb: 100, retentionDays: 30 }]), { ...PRICING, gcp: { ...PRICING.gcp, logs: azure } }, { includeBurstable: true })
    .find((e) => e.provider === 'gcp')!.lines[0];
  assert.deepEqual(line, { resourceIndex: 0, kind: 'logs', gb: 100, retentionDays: 30, commitmentGbPerDay: null, plan: null, monthlyUsd: 300 });
});

test('실데이터 스모크: 전 플랫폼 스냅샷에서 통합 시나리오 견적', () => {
  const s = scenario([vmRes(2, 4, 2), { type: 'block', gb: 100 }, { type: 'object', gb: 500 }, { type: 'egress', gb: 1024 }]);
  const results = estimate(s, loadPricing('seoul'), { includeBurstable: true });

  for (const r of results) {
    assert.equal(r.available, true, `${r.provider} 데이터가 있어야 함`);
    assert.equal(r.lines.length, 4);
    assert.ok(r.totalMonthlyUsd !== null && r.totalMonthlyUsd > 0, `${r.provider} 총액이 계산되어야 함`);
  }
});

test('미제공: NOT_OFFERED 구성 요소는 미제공 줄 — 총액은 나머지 합계(partial), 최저가 비교에서 제외', () => {
  const cdn: CdnPrice = { provider: 'gcp', region: 'seoul', gbTiers: [{ upTo: null, price: 0.08 }], requestTiers: [{ upTo: null, price: 0.0075 }], monthlyBase: 0, fillPerGb: 0, plans: [] };
  // OCI는 CDN 미제공(providers.ts). OCI에 GCP와 같은 VM 데이터를 주면 VM 줄은 같고 CDN만 빠진다
  const pricing = { ...PRICING, gcp: { ...PRICING.gcp, cdn }, oci: { ...PRICING.gcp, cdn: null } };
  const results = estimate(scenario([vmRes(2, 4), { type: 'cdn', gb: 100, requestsM: 1 }]), pricing, { includeBurstable: true });
  const gcp = results.find((e) => e.provider === 'gcp')!;
  const oci = results.find((e) => e.provider === 'oci')!;
  assert.deepEqual(oci.lines[1], { resourceIndex: 1, kind: 'not-offered', resourceType: 'cdn', limit: null, monthlyUsd: null });
  assert.equal(oci.partial, true);
  assert.equal(oci.totalMonthlyUsd, oci.lines[0].monthlyUsd); // VM만의 합계
  assert.equal(gcp.partial, false);
  // OCI 총액(VM만)이 더 싸도 최저가는 전부 제공하는 GCP
  assert.ok(oci.totalMonthlyUsd! < gcp.totalMonthlyUsd!);
  assert.equal(cheapestTotal(results), gcp.totalMonthlyUsd);
  // 미제공 카드가 없으면 OCI도 일반 견적
  const vmOnly = estimate(scenario([vmRes(2, 4)]), pricing, { includeBurstable: true }).find((e) => e.provider === 'oci')!;
  assert.equal(vmOnly.partial, false);
});

test('로그: 최대 보관 기간(OCI 180일)을 넘으면 미제공 줄', () => {
  const oci: LogPrice = { provider: 'oci', region: 'seoul', ingestPerGb: 0, storagePerGbMonth: 0.05, includedDays: 0, storedRatio: 1, commitmentTiers: [], maxRetentionDays: 180 };
  const line = (days: number) =>
    estimate(scenario([{ type: 'logs', gb: 100, retentionDays: days }]), { ...PRICING, gcp: { ...PRICING.gcp, logs: oci } }, { includeBurstable: true })
      .find((e) => e.provider === 'gcp')!.lines[0];
  assert.ok(line(180).kind === 'logs' && line(180).monthlyUsd !== null);
  assert.deepEqual(line(365), { resourceIndex: 0, kind: 'not-offered', resourceType: 'logs', limit: { kind: 'retention', maxDays: 180 }, monthlyUsd: null });
});

test('컨테이너: OCI는 OCPU 단위 — x86은 vCPU 2개씩(E4), ARM은 1개씩(A1), 메모리 1GB 단위·최소 OCPU 수', () => {
  const price: ContainerPrice = { provider: 'oci', region: 'seoul', rates: { x86: { vcpuPerHour: 0.0125, gbPerHour: 0.0015 }, arm: { vcpuPerHour: 0.01, gbPerHour: 0.0015 } } };
  const x86 = fitContainer(price, { vcpu: 0.25, ramGb: 0.5 }, { includeBurstable: true, arch: 'x86' });
  assert.deepEqual(x86, { vcpu: 2, ramGb: 1, arch: 'x86', perHour: 0.0265, committed: false });
  const arm = fitContainer(price, { vcpu: 1, ramGb: 2 }, { includeBurstable: true, arch: 'arm' });
  assert.deepEqual(arm, { vcpu: 1, ramGb: 2, arch: 'arm', perHour: 0.013, committed: false });
  // 3 vCPU x86 → 2 OCPU = 4 vCPU, 메모리는 OCPU 수 이상
  assert.deepEqual(fitContainer(price, { vcpu: 3, ramGb: 1 }, { includeBurstable: true, arch: 'x86' }), { vcpu: 4, ramGb: 2, arch: 'x86', perHour: 0.053, committed: false });
});

test('로그: 요금제가 여러 개면 한도(하루 수집량·보관량) 안에서 가장 싼 쪽, 모두 넘으면 용량 미제공', () => {
  const premium: LogPrice = { provider: 'ncp', region: 'seoul', ingestPerGb: 0.4, storagePerGbMonth: 0, includedDays: 0, storedRatio: 1, commitmentTiers: [], plan: 'Premium', maxGbPerDay: 100, maxStoredGb: 1024 };
  const standard: LogPrice = { ...premium, ingestPerGb: 0, storagePerGbMonth: 0.6, plan: 'Standard', maxGbPerDay: 20, maxStoredGb: 100, alternatives: [premium] };
  const line = (gb: number, days: number) =>
    estimate(scenario([{ type: 'logs', gb, retentionDays: days }]), { ...PRICING, gcp: { ...PRICING.gcp, logs: standard } }, { includeBurstable: true })
      .find((e) => e.provider === 'gcp')!.lines[0];
  // 월 30GB·30일 보관(보관량 ≈ 29.6GB, Standard 한도 안): Standard ≈ 29.6 × 0.6 = 17.75 > Premium 30 × 0.4 = 12 → Premium
  const small = line(30, 30);
  assert.ok(small.kind === 'logs' && small.plan === 'Premium' && small.monthlyUsd === 12);
  // 하루 20GB 초과(월 900GB) → Standard 불가, Premium 가능
  const mid = line(900, 30);
  assert.ok(mid.kind === 'logs' && mid.plan === 'Premium');
  // 보관량 1TB 초과(월 900GB × 365일) → 둘 다 불가
  assert.deepEqual(line(900, 365), { resourceIndex: 0, kind: 'not-offered', resourceType: 'logs', limit: { kind: 'volume' }, monthlyUsd: null });
});

test('미제공: 리전별 미제공(NHN 도쿄 NAT)과 DB 엔진 미제공(엔진 요금만 없음)은 미제공 줄, DB 요금 자체가 없으면 데이터 없음', () => {
  const nat = { provider: 'nhn' as const, region: 'tokyo' as const, hourly: { per: 'gateway' as const, usd: 0.05 }, perGb: 0 };
  const db = { provider: 'nhn' as const, region: 'tokyo' as const, engines: { mysql: PRICING.gcp.db!.engines.postgres, postgres: null } };
  const pricing = { ...PRICING, nhn: { ...PRICING.gcp, nat, db } };
  const run = (region: 'seoul' | 'tokyo', resources: Resource[]) =>
    estimate({ region, resources }, pricing, { includeBurstable: true }).find((e) => e.provider === 'nhn')!;
  // 도쿄 NAT는 providers.ts NOT_OFFERED_IN — 요금 데이터가 있어도 미제공
  assert.equal(run('tokyo', [vmRes(2, 4), { type: 'nat', count: 1, gb: 10 }]).lines[1].kind, 'not-offered');
  assert.equal(run('seoul', [vmRes(2, 4), { type: 'nat', count: 1, gb: 10 }]).lines[1].kind, 'nat');
  const pg = run('tokyo', [vmRes(2, 4), { type: 'db', engine: 'postgres', vcpu: 2, ramGb: 8, storageGb: 10, ha: false, count: 1 }]);
  assert.deepEqual(pg.lines[1], { resourceIndex: 1, kind: 'not-offered', resourceType: 'db', limit: { kind: 'engine', engine: 'postgres' }, monthlyUsd: null });
  assert.equal(pg.partial, true);
  // DB 요금이 아예 없으면(수집 누락) 미제공이 아니라 데이터 없음 → 총액 null
  const missing = estimate(scenario([{ type: 'db', engine: 'postgres', vcpu: 2, ramGb: 8, storageGb: 10, ha: false, count: 1 }]), { ...PRICING, nhn: { ...PRICING.gcp, db: null } }, { includeBurstable: true }).find((e) => e.provider === 'nhn')!;
  assert.equal(missing.lines[0].kind, 'db');
  assert.equal(missing.totalMonthlyUsd, null);
});

test('로그: 모든 요금제가 보관 기간 한도를 넘으면 가장 긴 한도로 안내 (NHN Basic 30일·Premium 120일)', () => {
  const premium: LogPrice = { provider: 'nhn', region: 'seoul', ingestPerGb: 0, storagePerGbMonth: 1.6, includedDays: 0, storedRatio: 1, commitmentTiers: [], plan: 'Premium', maxRetentionDays: 120 };
  const basic: LogPrice = { ...premium, storagePerGbMonth: 0.8, plan: 'Basic', maxRetentionDays: 30, alternatives: [premium] };
  const line = (days: number) =>
    estimate(scenario([{ type: 'logs', gb: 100, retentionDays: days }]), { ...PRICING, gcp: { ...PRICING.gcp, logs: basic } }, { includeBurstable: true })
      .find((e) => e.provider === 'gcp')!.lines[0];
  assert.ok(line(30).kind === 'logs' && (line(30) as { plan: string }).plan === 'Basic');
  assert.ok(line(90).kind === 'logs' && (line(90) as { plan: string }).plan === 'Premium');
  assert.deepEqual(line(180), { resourceIndex: 0, kind: 'not-offered', resourceType: 'logs', limit: { kind: 'retention', maxDays: 120 }, monthlyUsd: null });
});

test('컨테이너: NHN NCS는 요구 스펙 그대로(올림 없음), 16 vCPU·225GB 초과는 사이즈 초과', () => {
  const price: ContainerPrice = { provider: 'nhn', region: 'seoul', rates: { x86: { vcpuPerHour: 0.0576, gbPerHour: 0.00648 } } };
  assert.deepEqual(fitContainer(price, { vcpu: 0.25, ramGb: 1 }, { includeBurstable: true }), { vcpu: 0.25, ramGb: 1, arch: 'x86', perHour: 0.02088, committed: false });
  assert.deepEqual(fitContainer(price, { vcpu: 32, ramGb: 64 }, { includeBurstable: true }), { reason: 'size', maxVcpu: 16, maxRamGb: 225 });
});

test('트래픽: 서버당 무료량(KT) — VM 대수·K8s 노드별 무료량(16GB 이상 1TB, 미만 512GB)을 합쳐 앞 구간 무료', () => {
  const egress: EgressTier = {
    provider: 'kt',
    region: 'seoul',
    freeGb: 0,
    tiers: [{ upToGb: 10240, pricePerGb: 0.09 }, { upToGb: 20480, pricePerGb: 0.08 }, { upToGb: null, pricePerGb: 0.07 }],
    perServerFree: { gb: 512, largeGb: 1024, largeFromRamGb: 16 },
  };
  const line = (resources: Resource[]) =>
    estimate(scenario(resources), { ...PRICING, gcp: { ...PRICING.gcp, egress } }, { includeBurstable: true }).find((e) => e.provider === 'gcp')!.lines.find((l) => l.kind === 'egress')!;
  // VM 2대(4GB) 512 × 2 + K8s 노드 1 × 3대(16GB) 1024 × 3 = 4096GB 무료 → 5000GB면 904GB × 0.09
  const l = line([vmRes(2, 4, 2), { type: 'k8s', clusters: 1, node: { vcpu: 4, ramGb: 16, count: 3 } }, { type: 'egress', gb: 5000 }]);
  assert.ok(l.kind === 'egress' && l.freeGb === 4096);
  assert.equal(l.monthlyUsd, +(904 * 0.09).toFixed(2));
  // 무료량이 첫 유료 구간 경계를 넘어도 구간이 뒤집히지 않는다 (VM 12대 × 1TB = 12288GB 무료)
  const big = line([vmRes(4, 16, 12), { type: 'egress', gb: 15000 }]);
  assert.equal(big.monthlyUsd, +((15000 - 12288) * 0.08).toFixed(2));
});
