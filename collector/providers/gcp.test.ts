/**
 * GCP 파싱 로직 단위 테스트 — 실제 API 응답 형태의 픽스처로 검증한다.
 * 실행: npm run test:collector
 */

import assert from 'node:assert/strict';
import { parseUnitPrices, buildVmSkus, type RawSku } from './gcp';

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

console.log(`gcp.test: 모든 검증 통과 ✔ (VmSku ${vms.length}건 생성)`);
