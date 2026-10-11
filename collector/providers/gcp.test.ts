/**
 * GCP 파싱 로직 단위 테스트 — 실제 API 응답 형태의 픽스처로 검증한다.
 * 실행: npm run test:collector
 */

import assert from 'node:assert/strict';
import { parseCloudSql, parseGcpLb, parseGcpNat, parseGkeCluster, parseUnitPrices, buildVmSkus, type RawSku } from './gcp';

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
  custom: { vcpuPerHour: 0.0537, ramGbPerHour: 0.0091, haVcpuPerHour: 0.1074, haRamGbPerHour: 0.0182 },
  storageGbMonth: 0.221,
  haStorageGbMonth: 0.442,
});
assert.equal(sql.engines.postgres, null);

console.log(`gcp.test: 모든 검증 통과 ✔ (VmSku ${vms.length}건 생성)`);
