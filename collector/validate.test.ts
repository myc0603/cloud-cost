import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateSnapshot, type Snapshot } from './validate';
import type { VmSku } from '../src/lib/schema';

const vm = (sku: string, pricePerHour: number): VmSku => ({
  provider: 'aws',
  region: 'seoul',
  sku,
  vcpu: 2,
  ramGb: 4,
  burstable: false,
  arch: 'x86',
  generation: 'x',
  pricePerHour,
});

const snap = (over: Partial<Snapshot>): Snapshot => ({
  vms: [],
  storage: [],
  egress: null,
  k8s: null,
  lb: null,
  nat: null,
  db: null,
  cache: null,
  container: null,
  cdn: null,
  ...over,
});

const EGRESS = { provider: 'aws' as const, region: 'seoul' as const, freeGb: 100, tiers: [{ upToGb: null, pricePerGb: 0.126 }] };

test('첫 수집(이전 없음)은 무조건 통과', () => {
  assert.deepEqual(validateSnapshot('t', null, snap({ vms: [vm('a', 1)] })), []);
});

test('정상 갱신(소폭 변화)은 통과', () => {
  const prev = snap({ vms: [vm('a', 0.1), vm('b', 0.2)] });
  const next = snap({ vms: [vm('a', 0.11), vm('b', 0.2), vm('c', 0.3)] });
  assert.deepEqual(validateSnapshot('t', prev, next), []);
});

test('VM 건수 30% 초과 급감 → 실패', () => {
  const prev = snap({ vms: Array.from({ length: 10 }, (_, i) => vm(`s${i}`, 0.1)) });
  const next = snap({ vms: prev.vms.slice(0, 6) });
  const errors = validateSnapshot('t', prev, next);
  assert.equal(errors.length, 1);
  assert.match(errors[0], /건수 급감/);
});

test('가격 ±30% 초과 변화가 다수면 실패, 소수면 경고만', () => {
  const many = Array.from({ length: 10 }, (_, i) => vm(`s${i}`, 0.1));
  // 10건 중 5건이 2배로 → 실패
  const broken = many.map((v, i) => (i < 5 ? { ...v, pricePerHour: 0.2 } : v));
  assert.match(validateSnapshot('t', snap({ vms: many }), snap({ vms: broken }))[0], /가격.*변화 5건/);
  // 10건 중 1건만 급변 → 통과 (경고)
  const one = many.map((v, i) => (i === 0 ? { ...v, pricePerHour: 0.2 } : v));
  assert.deepEqual(validateSnapshot('t', snap({ vms: many }), snap({ vms: one })), []);
});

test('스토리지 소실·단가 급변 → 실패', () => {
  const prev = snap({ storage: [{ provider: 'aws', region: 'seoul', kind: 'block-ssd', pricePerGbMonth: 0.09 }] });
  assert.match(validateSnapshot('t', prev, snap({}))[0], /소실/);
  const jumped = snap({ storage: [{ provider: 'aws', region: 'seoul', kind: 'block-ssd', pricePerGbMonth: 0.2 }] });
  assert.match(validateSnapshot('t', prev, jumped)[0], /단가 급변/);
});

test('egress 소실 → 실패', () => {
  const prev = snap({ egress: EGRESS });
  assert.match(validateSnapshot('t', prev, snap({}))[0], /egress.*소실/);
});

test('K8s 클러스터 요금 소실·급변은 실패, 소폭 변화는 통과', () => {
  const k8s = (clusterPerHour: number) => ({ provider: 'aws' as const, region: 'seoul' as const, clusterPerHour });
  assert.equal(validateSnapshot('t', snap({ k8s: k8s(0.1) }), snap({ k8s: null })).length, 1);
  assert.equal(validateSnapshot('t', snap({ k8s: k8s(0.1) }), snap({ k8s: k8s(0.6) })).length, 1);
  assert.deepEqual(validateSnapshot('t', snap({ k8s: k8s(0.1) }), snap({ k8s: k8s(0.11) })), []);
});

test('LB·NAT 단가 소실·급변은 실패', () => {
  const lb = (perHour: number, perGb: number) => ({ provider: 'aws' as const, region: 'seoul' as const, perHour, perGb });
  const nat = (usd: number) => ({ provider: 'aws' as const, region: 'seoul' as const, hourly: { per: 'gateway' as const, usd }, perGb: 0.059 });
  assert.equal(validateSnapshot('t', snap({ lb: lb(0.0225, 0.008) }), snap({ lb: null })).length, 2); // 시간당·GB당 둘 다 소실
  assert.equal(validateSnapshot('t', snap({ lb: lb(0.0225, 0.008) }), snap({ lb: lb(0.0225, 0.02) })).length, 1);
  assert.equal(validateSnapshot('t', snap({ nat: nat(0.059) }), snap({ nat: nat(0.1) })).length, 1);
  assert.deepEqual(validateSnapshot('t', snap({ nat: nat(0.059) }), snap({ nat: nat(0.06) })), []);
});

test('DB: 엔진 요금 소실·스토리지 급변·인스턴스 건수 급감은 실패', () => {
  const inst = { sku: 'x', vcpu: 2, ramGb: 8, burstable: false, perHour: 0.1, haPerHour: 0.2 };
  const db = (n: number, storageGbMonth: number) => ({
    provider: 'aws' as const,
    region: 'seoul' as const,
    engines: { mysql: { instances: Array(n).fill(inst), custom: null, storageGbMonth, haStorageGbMonth: storageGbMonth * 2 }, postgres: null },
  });
  assert.deepEqual(validateSnapshot('t', snap({ db: db(10, 0.131) }), snap({ db: db(10, 0.131) })), []);
  assert.equal(validateSnapshot('t', snap({ db: db(10, 0.131) }), snap({ db: db(5, 0.131) })).length, 1); // 건수 급감
  assert.equal(validateSnapshot('t', snap({ db: db(10, 0.131) }), snap({ db: db(10, 0.3) })).length, 1); // 스토리지 급변
  assert.equal(validateSnapshot('t', snap({ db: db(10, 0.131) }), snap({ db: null })).length, 2); // 스토리지 소실 + 건수 0
});

test('캐시: 소실·노드 건수 급감·GB 단가 급변은 실패', () => {
  const node = { sku: 'x', memoryGb: 1, burstable: false, perHour: 0.1, haPerHour: 0.2 };
  const nodes = (n: number) => ({ provider: 'aws' as const, region: 'seoul' as const, engine: 'Valkey', nodes: Array(n).fill(node), gbTiers: null });
  const tiers = (perGbHour: number) => ({ provider: 'gcp' as const, region: 'seoul' as const, engine: 'Redis', nodes: [], gbTiers: [{ upToGb: null, perGbHour, haPerGbHour: perGbHour * 2 }] });
  assert.equal(validateSnapshot('t', snap({ cache: nodes(10) }), snap({ cache: null })).length, 2); // 소실 + 건수 0
  assert.equal(validateSnapshot('t', snap({ cache: nodes(10) }), snap({ cache: nodes(5) })).length, 1);
  assert.equal(validateSnapshot('t', snap({ cache: tiers(0.065) }), snap({ cache: tiers(0.1) })).length, 1);
  assert.deepEqual(validateSnapshot('t', snap({ cache: tiers(0.065) }), snap({ cache: tiers(0.066) })), []);
});

test('약정가 있는 VM 건수 급감·3년 > 1년 역전은 실패', () => {
  const c = (sku: string, y1: number, y3: number): VmSku => ({ ...vm(sku, 0.2), commit: { '1y': y1, '3y': y3 } });
  const prev = snap({ vms: [c('a', 0.12, 0.08), c('b', 0.12, 0.08), c('c', 0.12, 0.08)] });
  const lost = validateSnapshot('t', prev, snap({ vms: [c('a', 0.12, 0.08), vm('b', 0.2), vm('c', 0.2)] }));
  assert.ok(lost.some((e) => e.includes('약정가 있는 VM 건수 급감')));
  const inverted = validateSnapshot('t', prev, snap({ vms: [c('a', 0.12, 0.08), c('b', 0.12, 0.08), c('c', 0.08, 0.12)] }));
  assert.deepEqual(inverted, ['t: 3년 약정가 > 1년 약정가 1건 — c']);
});
