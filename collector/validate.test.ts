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
