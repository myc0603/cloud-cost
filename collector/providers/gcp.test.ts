/**
 * GCP 파싱 로직 단위 테스트 — 실제 API 응답 형태의 픽스처로 검증한다.
 * 실행: npm run test:collector
 */

import assert from 'node:assert/strict';
import { parseCloudCdn, parseCloudRun, parseCloudSql, parseCommitUnitPrices, parseMemorystore, parseGcpLb, parseGcpNat, parseGkeCluster, parseUnitPrices, buildVmSkus, type RawSku } from './gcp';

function fx(
  description: string,
  usageType: string,
  nanos: number,
  regions: string[] = ['asia-northeast3'],
): RawSku {
  return {
    skuId: 'test-sku',
    description,
    category: { usageType },
    serviceRegions: regions,
    pricingInfo: [{
      pricingExpression: {
        usageUnit: 'h',
        tieredRates: [{ startUsageAmount: 0, unitPrice: { currencyCode: 'USD', units: '0', nanos } }],
      },
    }],
  };
}

const skus: RawSku[] = [
  // 정상 케이스: E2 서울 온디맨드 단가 (가상의 값)
  fx('E2 Instance Core running in Seoul', 'OnDemand', 31_211_000), // $0.031211/vCPU·h
  fx('E2 Instance Ram running in Seoul', 'OnDemand', 4_184_000), //   $0.004184/GB·h
  // 제외되어야 하는 것들
  fx('E2 Instance Core running in Seoul', 'Preemptible', 9_000_000), // 온디맨드 아님
  fx('E2 Instance Core running in Virginia', 'OnDemand', 21_811_000, ['us-east4']), // 다른 리전
  fx('Storage PD Capacity in Seoul', 'OnDemand', 52_000_000), // VM 단가 패턴 아님
  // 라벨 맵에 없는 것 → unmatched로 집계되어야
  fx('Sole Tenancy Instance Core running in Seoul', 'OnDemand', 90_000_000),
];

const { unitPrices, unmatched } = parseUnitPrices(skus, 'asia-northeast3');

// 단가 추출
assert.equal(unitPrices.e2?.corePerHour, 0.031211);
assert.equal(unitPrices.e2?.ramGbPerHour, 0.004184);
// Preemptible 가격이 온디맨드를 덮어쓰지 않았는지
assert.notEqual(unitPrices.e2?.corePerHour, 0.009);
// 커버리지 집계
assert.deepEqual(unmatched, ['Sole Tenancy Instance (Core)']);

const vms = buildVmSkus(unitPrices, 'seoul');

// e2-standard-2: 2 vCPU × core + 8GB × ram
const e2s2 = vms.find((v) => v.sku === 'e2-standard-2');
assert.ok(e2s2, 'e2-standard-2가 생성되어야 함');
assert.equal(e2s2.vcpu, 2);
assert.equal(e2s2.ramGb, 8);
assert.equal(e2s2.pricePerHour, +(2 * 0.031211 + 8 * 0.004184).toFixed(6));
assert.equal(e2s2.burstable, false);

// e2-micro: 공유 코어 — vCPU 2개가 보이지만 과금은 0.25코어
const micro = vms.find((v) => v.sku === 'e2-micro');
assert.ok(micro, 'e2-micro가 생성되어야 함');
assert.equal(micro.vcpu, 2);
assert.equal(micro.pricePerHour, +(0.25 * 0.031211 + 1 * 0.004184).toFixed(6));
assert.equal(micro.burstable, true);

// 단가가 없는 패밀리(n2 등)는 머신이 생성되지 않아야
assert.ok(!vms.some((v) => v.sku.startsWith('n2-')), '단가 없는 패밀리는 제외');

// GKE: Regional 클러스터(global SKU)만 — Zonal·연장 지원은 비교 대상 아님
const gke = [
  fx('Zonal Kubernetes Clusters', 'OnDemand', 90_000_000, ['global']),
  fx('Extended Period Kubernetes Clusters', 'OnDemand', 500_000_000, ['global']),
  fx('Regional Kubernetes Clusters', 'Commit1Yr', 50_000_000, ['global']),
  fx('Regional Kubernetes Clusters', 'OnDemand', 100_000_000, ['global']),
];
assert.deepEqual(parseGkeCluster(gke, 'seoul'), { provider: 'gcp', region: 'seoul', clusterPerHour: 0.1 });
assert.equal(parseGkeCluster([], 'seoul'), null);

// LB: 리전 외부 ALB — 포워딩 규칙 최소 + 처리(인/아웃 중 큰 값). 다른 리전·다른 LB 종류 제외
const lbSkus = [
  fx('Regional External Application Load Balancer Forwarding Rule Minimum for South Carolina (us-east1)', 'OnDemand', 25_000_000, ['us-east1']),
  fx('Regional Internal Application Load Balancer Inbound Data Processing for Seoul (asia-northeast3)', 'OnDemand', 8_000_000),
  fx('Regional External Application Load Balancer Forwarding Rule Minimum for Seoul (asia-northeast3)', 'OnDemand', 38_000_000),
  fx('Regional External Application Load Balancer Inbound Data Processing for Seoul (asia-northeast3)', 'OnDemand', 12_000_000),
  fx('Regional External Application Load Balancer Outbound Data Processing for Seoul (asia-northeast3)', 'OnDemand', 12_000_000),
];
assert.deepEqual(parseGcpLb(lbSkus, 'asia-northeast3', 'seoul'), { provider: 'gcp', region: 'seoul', perHour: 0.038, perGb: 0.012 });
assert.equal(parseGcpLb(lbSkus.slice(0, 3), 'asia-northeast3', 'seoul'), null); // 처리 단가 없으면 null

// NAT: Cloud NAT 가동(VM당) + 처리 — Private NAT 제외, 상한 32대
const natSkus = [
  fx('Networking Private Nat Gateway Uptime', 'OnDemand', 45_000_000, ['global']),
  fx('Networking Cloud Nat Gateway Uptime', 'OnDemand', 1_400_000, ['global']),
  fx('Networking Cloud Nat Data Processing', 'OnDemand', 45_000_000, ['global']),
];
assert.deepEqual(parseGcpNat(natSkus, 'seoul'), {
  provider: 'gcp',
  region: 'seoul',
  hourly: { per: 'vm', usd: 0.0014, maxVms: 32 },
  perGb: 0.045,
});

// Cloud SQL: Zonal(단일)·Regional(이중화) vCPU·RAM·SSD — N4·Enterprise Plus 제외, 6개 다 있어야 엔진 생성
const sqlSkus = [
  fx('Cloud SQL for MySQL: Zonal - Enterprise N4 vCPU in Seoul', 'OnDemand', 99_000_000),
  fx('Cloud SQL for MySQL: Zonal - Enterprise Plus N vCPU in Seoul', 'OnDemand', 99_000_000),
  fx('Cloud SQL for MySQL: Zonal - vCPU in Seoul', 'OnDemand', 53_700_000),
  fx('Cloud SQL for MySQL: Zonal - RAM in Seoul', 'OnDemand', 9_100_000),
  fx('Cloud SQL for MySQL: Zonal - Standard storage in Seoul', 'OnDemand', 221_000_000),
  fx('Cloud SQL for MySQL: Regional - vCPU in Seoul', 'OnDemand', 107_400_000),
  fx('Cloud SQL for MySQL: Regional - RAM in Seoul', 'OnDemand', 18_200_000),
  fx('Cloud SQL for MySQL: Regional - Standard storage in Seoul', 'OnDemand', 442_000_000),
  fx('Cloud SQL for PostgreSQL: Zonal - vCPU in Seoul', 'OnDemand', 53_700_000), // PG는 일부만 → null
];
const sql = parseCloudSql(sqlSkus, 'asia-northeast3', 'seoul')!;
assert.deepEqual(sql.engines.mysql, {
  instances: [],
  custom: {
    vcpuPerHour: 0.0537,
    ramGbPerHour: 0.0091,
    haVcpuPerHour: 0.1074,
    haRamGbPerHour: 0.0182,
    // CUD 할인율(문서값) 1년 25%·3년 52%
    commit: {
      '1y': { vcpuPerHour: 0.040275, ramGbPerHour: 0.006825, haVcpuPerHour: 0.08055, haRamGbPerHour: 0.01365 },
      '3y': { vcpuPerHour: 0.025776, ramGbPerHour: 0.004368, haVcpuPerHour: 0.051552, haRamGbPerHour: 0.008736 },
    },
  },
  storageGbMonth: 0.221,
  haStorageGbMonth: 0.442,
});
assert.equal(sql.engines.postgres, null);

// Memorystore for Redis: Basic·Standard × M1~M5 — "Standard Node Capacity"(읽기 복제본) 제외, 구간 하나라도 빠지면 null
const ms = ['M1', 'M2', 'M3', 'M4', 'M5'].flatMap((m, i) => [
  fx(`Redis Capacity Basic ${m} Seoul`, 'OnDemand', (65 - i * 10) * 1_000_000),
  fx(`Redis Capacity Standard ${m} Seoul`, 'OnDemand', (114 - i * 15) * 1_000_000),
]);
const cache = parseMemorystore([fx('Redis Standard Node Capacity M1 Seoul', 'OnDemand', 1_000_000), ...ms], 'asia-northeast3', 'seoul')!;
assert.equal(cache.engine, 'Redis');
assert.deepEqual(cache.gbTiers?.map((t) => t.upToGb), [4, 10, 35, 100, null]);
assert.deepEqual(cache.gbTiers?.[0], { upToGb: 4, perGbHour: 0.065, haPerGbHour: 0.114 }); // M1(5GB 미만)은 CUD 대상 아님
assert.deepEqual(cache.gbTiers?.[1].commit, {
  '1y': { perGbHour: 0.044, haPerGbHour: 0.0792 }, // 20%
  '3y': { perGbHour: 0.033, haPerGbHour: 0.0594 }, // 40%
});
assert.equal(parseMemorystore(ms.slice(0, 8), 'asia-northeast3', 'seoul'), null); // M5 없음

// 리소스 기반 CUD: 라벨 표기 3종(E2 / N1 무라벨 / C2 "Compute optimized … running"), 다른 리전·미수록 라벨 제외
const commitSkus = [
  fx('Commitment v1: E2 Cpu in Seoul for 1 Year', 'Commit1Yr', 19_663_000),
  fx('Commitment v1: E2 Ram in Seoul for 1 Year', 'Commit1Yr', 2_636_000),
  fx('Commitment v1: E2 Cpu in Seoul for 3 Year', 'Commit3Yr', 14_046_000),
  fx('Commitment v1: E2 Ram in Seoul for 3 Years', 'Commit3Yr', 1_883_000),
  fx('Commitment v1: Cpu in Seoul for 1 Year', 'Commit1Yr', 25_589_000),
  fx('Commitment: Compute optimized Core running in Seoul for 1 Year', 'Commit1Yr', 27_509_000),
  fx('Commitment v1: E2 Cpu in Virginia for 1 Year', 'Commit1Yr', 1_000_000, ['us-east4']),
  fx('Commitment v1: Memory-optimized Cpu in Seoul for 1 Year', 'Commit1Yr', 25_160_000),
];
const { commitPrices, unmatched: commitUnmatched } = parseCommitUnitPrices(commitSkus, 'asia-northeast3');
assert.deepEqual(commitPrices['1y']?.e2, { corePerHour: 0.019663, ramGbPerHour: 0.002636 });
assert.deepEqual(commitPrices['3y']?.e2, { corePerHour: 0.014046, ramGbPerHour: 0.001883 });
assert.deepEqual(commitPrices['1y']?.n1, { corePerHour: 0.025589 });
assert.deepEqual(commitPrices['1y']?.c2, { corePerHour: 0.027509 });
assert.deepEqual(commitUnmatched, ['Memory-optimized (Cpu)']);

// 약정가 = 과금 코어 × CUD vCPU 단가 + RAM × CUD RAM 단가, vCPU·RAM 둘 다 있는 패밀리만
const committed = buildVmSkus(unitPrices, 'seoul', commitPrices).find((v) => v.sku === 'e2-standard-2')!;
assert.deepEqual(committed.commit, {
  '1y': +(2 * 0.019663 + 8 * 0.002636).toFixed(6),
  '3y': +(2 * 0.014046 + 8 * 0.001883).toFixed(6),
});
assert.equal(e2s2.commit, undefined); // CUD 단가를 안 넘기면 약정가 없음

// Cloud Run: 인스턴스 기반 과금 vCPU·메모리 초 단가 → 시간 단가, 유연 CUD 28%·46% — 요청 기반 과금·다른 리전 제외
const run = parseCloudRun(
  [
    fx('Services CPU (Request-based billing) in asia-northeast3', 'OnDemand', 33_600),
    fx('Services CPU (Instance-based billing) in asia-northeast3', 'OnDemand', 21_600),
    fx('Services Memory (Instance-based billing) in asia-northeast3', 'OnDemand', 2_400),
    fx('Services CPU (Instance-based billing) in us-east1', 'OnDemand', 18_000, ['us-east1']),
  ],
  'asia-northeast3',
  'seoul',
)!;
assert.deepEqual(run.rates.x86, {
  vcpuPerHour: 0.07776,
  gbPerHour: 0.00864,
  commit: { '1y': { vcpuPerHour: 0.055987, gbPerHour: 0.006221 }, '3y': { vcpuPerHour: 0.04199, gbPerHour: 0.004666 } },
});
assert.equal(parseCloudRun([], 'asia-northeast3', 'seoul'), null);

// Cloud CDN: 시청자 지역(서울 → Asia) 캐시 전송 구간 + 조회(1만 건) + 캐시 채움(문서값, 아시아 $0.02)
const tiered = (description: string, tiers: [number, number][]): RawSku => ({
  ...fx(description, 'OnDemand', 0, ['global']),
  pricingInfo: [{ pricingExpression: { usageUnit: 'GiBy', tieredRates: tiers.map(([start, nanos]) => ({ startUsageAmount: start, unitPrice: { currencyCode: 'USD', units: '0', nanos } })) } }],
});
const cdn = parseCloudCdn(
  [
    tiered('Networking Cloud CDN Traffic Cache Data Transfer to Asia', [[10240, 60_000_000], [0, 90_000_000]]),
    tiered('Networking Cloud CDN Traffic Cache Data Transfer to Europe', [[0, 80_000_000]]),
    fx('Networking Cloud Cdn Cache Lookups', 'OnDemand', 750, ['global']),
  ],
  'seoul',
)!;
assert.deepEqual(cdn.gbTiers, [{ upTo: 10240, price: 0.09 }, { upTo: null, price: 0.06 }]);
assert.deepEqual(cdn.requestTiers, [{ upTo: null, price: 0.0075 }]);
assert.equal(cdn.fillPerGb, 0.02);
assert.equal(parseCloudCdn([], 'seoul'), null);

console.log(`gcp.test: 모든 검증 통과 ✔ (VmSku ${vms.length}건 생성)`);
