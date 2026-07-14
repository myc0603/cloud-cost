import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { estimate, matchVm, HOURS_PER_MONTH } from './index';
import type { VmSku } from '../schema';

const sku = (over: Partial<VmSku>): VmSku => ({
  provider: 'gcp',
  region: 'seoul',
  sku: 'test',
  vcpu: 2,
  ramGb: 4,
  burstable: false,
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

test('estimate: 월 환산·합산, 데이터 없는 플랫폼은 available=false', () => {
  const scenario = { region: 'seoul' as const, vms: [{ vcpu: 2, ramGb: 4, count: 2 }] };
  const [aws, gcp] = estimate(
    scenario,
    { aws: [], azure: [], gcp: FIXTURE },
    { includeBurstable: true },
  ).filter((e) => e.provider === 'aws' || e.provider === 'gcp');

  assert.equal(aws.available, false);
  assert.equal(aws.totalMonthlyUsd, null);

  assert.equal(gcp.available, true);
  assert.equal(gcp.lines[0].matched?.sku, 'cheap-burst');
  assert.equal(gcp.lines[0].monthlyUsd, +(0.03 * HOURS_PER_MONTH * 2).toFixed(2));
  assert.equal(gcp.totalMonthlyUsd, gcp.lines[0].monthlyUsd);
});

test('estimate: 한 항목이라도 매칭 실패면 총액은 null', () => {
  const scenario = {
    region: 'seoul' as const,
    vms: [{ vcpu: 2, ramGb: 4, count: 1 }, { vcpu: 64, ramGb: 4, count: 1 }],
  };
  const gcp = estimate(scenario, { aws: [], azure: [], gcp: FIXTURE }, { includeBurstable: true })
    .find((e) => e.provider === 'gcp')!;
  assert.equal(gcp.lines[1].matched, null);
  assert.equal(gcp.totalMonthlyUsd, null);
});

test('실데이터 스모크: GCP 서울 스냅샷에서 2vCPU/4GB 매칭 불변식', () => {
  const skus: VmSku[] = JSON.parse(readFileSync('data/gcp/seoul/vm.json', 'utf8'));
  const spec = { vcpu: 2, ramGb: 4, count: 1 };
  const m = matchVm(skus, spec, { includeBurstable: false });

  assert.ok(m, '매칭 결과가 있어야 함');
  assert.ok(m.vcpu >= spec.vcpu && m.ramGb >= spec.ramGb, '스펙을 만족해야 함');
  assert.equal(m.burstable, false);

  const fitting = skus.filter((s) => !s.burstable && s.vcpu >= spec.vcpu && s.ramGb >= spec.ramGb);
  assert.ok(fitting.every((s) => m.pricePerHour <= s.pricePerHour), '후보 중 최저가여야 함');
});
