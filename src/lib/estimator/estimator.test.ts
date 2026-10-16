import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { calcEgressUsd, cheapestPerSize, estimate, matchVm, qualifyingVms, HOURS_PER_MONTH, type ArchFilter, type Scenario } from './index';
import { fitCloudSqlShape } from './db';
import type { DbInstance, EgressTier, Provider, ProviderPricing, VmSku } from '../schema';
import type { Resource } from './types';

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
  aws: { vm: [], storage: [], egress: null, k8s: null, lb: null, nat: null, db: null, cache: null },
  azure: { vm: [], storage: [], egress: null, k8s: null, lb: null, nat: null, db: null, cache: null },
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
  assert.deepEqual(vm.noMatch, { reason: 'arch' });
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
  assert.deepEqual(fit(2, 8), { sku: 'db-custom-2-8192', vcpu: 2, ramGb: 8, perHour: 0.18 });
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

test('estimate: DB 엔진 요금이 없으면 데이터 없음(matched·noMatch null) → 총액 null', () => {
  const s = scenario([{ type: 'db', engine: 'mysql', vcpu: 2, ramGb: 8, storageGb: 100, ha: false, count: 1 }]);
  const gcp = estimate(s, PRICING, { includeBurstable: true }).find((e) => e.provider === 'gcp')!;
  const [compute] = gcp.lines;
  assert.ok(compute.kind === 'db' && compute.matched === null && compute.noMatch === null);
  assert.equal(gcp.totalMonthlyUsd, null);
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
  assert.deepEqual(cache(3).matched, { sku: 'Basic M1 3GB', memoryGb: 3, perHour: 0.195 });
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

test('실데이터 스모크: 3사 스냅샷에서 통합 시나리오 견적', () => {
  const load = (p: string, f: string) => JSON.parse(readFileSync(`data/${p}/seoul/${f}`, 'utf8'));
  const pricing: Record<Provider, ProviderPricing> = {
    aws: { vm: load('aws', 'vm.json'), storage: load('aws', 'storage.json'), egress: load('aws', 'egress.json'), k8s: load('aws', 'k8s.json'), lb: load('aws', 'lb.json'), nat: load('aws', 'nat.json'), db: load('aws', 'db.json'), cache: load('aws', 'cache.json') },
    azure: { vm: load('azure', 'vm.json'), storage: load('azure', 'storage.json'), egress: load('azure', 'egress.json'), k8s: load('azure', 'k8s.json'), lb: load('azure', 'lb.json'), nat: load('azure', 'nat.json'), db: load('azure', 'db.json'), cache: load('azure', 'cache.json') },
    gcp: { vm: load('gcp', 'vm.json'), storage: load('gcp', 'storage.json'), egress: load('gcp', 'egress.json'), k8s: load('gcp', 'k8s.json'), lb: load('gcp', 'lb.json'), nat: load('gcp', 'nat.json'), db: load('gcp', 'db.json'), cache: load('gcp', 'cache.json') },
  };
  const s = scenario([vmRes(2, 4, 2), { type: 'block', gb: 100 }, { type: 'object', gb: 500 }, { type: 'egress', gb: 1024 }]);
  const results = estimate(s, pricing, { includeBurstable: true });

  for (const r of results) {
    assert.equal(r.available, true, `${r.provider} 데이터가 있어야 함`);
    assert.equal(r.lines.length, 4);
    assert.ok(r.totalMonthlyUsd !== null && r.totalMonthlyUsd > 0, `${r.provider} 총액이 계산되어야 함`);
  }
});
