import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  decodeMatchOptions,
  decodeOverrides,
  decodeScenario,
  encodeMatchOptions,
  encodeOverrides,
  encodeScenario,
} from './scenario-url';
import type { Overrides, Scenario } from './estimator';

test('인코딩 → 디코딩 왕복 보존', () => {
  const scenario: Scenario = {
    region: 'us-east',
    vms: [{ vcpu: 2, ramGb: 4, count: 2 }, { vcpu: 8, ramGb: 32, count: 1 }],
    blockGb: 100,
    objectGb: 500,
    egressGb: 1024,
  };
  assert.deepEqual(decodeScenario(encodeScenario(scenario)), scenario);
});

test('0인 리소스는 인코딩에서 생략되고 디코딩 시 0으로 복원', () => {
  const scenario: Scenario = { region: 'seoul', vms: [{ vcpu: 2, ramGb: 4, count: 1 }], blockGb: 0, objectGb: 0, egressGb: 0 };
  const encoded = encodeScenario(scenario);
  assert.ok(!encoded.includes('blk=') && !encoded.includes('obj=') && !encoded.includes('eg='));
  assert.deepEqual(decodeScenario(encoded), scenario);
});

test('파라미터 없으면 null (기본 시나리오 위임)', () => {
  assert.equal(decodeScenario(''), null);
  assert.equal(decodeScenario('foo=bar'), null);
});

test('깨진 토큰은 버리고 정상 토큰만 살린다', () => {
  const s = decodeScenario('r=seoul&vm=2c4g:1,garbage,0c4g:1,4c8g:2&blk=abc&eg=-5');
  assert.deepEqual(s?.vms, [{ vcpu: 2, ramGb: 4, count: 1 }, { vcpu: 4, ramGb: 8, count: 2 }]);
  assert.equal(s?.blockGb, 0); // 숫자 아님 → 0
  assert.equal(s?.egressGb, 0); // 음수 → 0
});

test('모르는 리전은 seoul로 폴백', () => {
  assert.equal(decodeScenario('r=mars&vm=2c4g:1')?.region, 'seoul');
});

test('overrides: 인코딩 → 디코딩 왕복 보존 (SKU의 . _ - 포함)', () => {
  const overrides: Overrides = { aws: { 0: 't3.large' }, gcp: { 0: 'n2-standard-2', 1: 'e2-medium' } };
  const q = new URLSearchParams({ pick: encodeOverrides(overrides) });
  assert.deepEqual(decodeOverrides(q), overrides);
});

test('overrides: 비어있으면 pick 없음 → 빈 객체', () => {
  assert.equal(encodeOverrides({}), '');
  assert.deepEqual(decodeOverrides(''), {});
});

test('overrides: 깨진 토큰·모르는 플랫폼은 버린다', () => {
  const out = decodeOverrides('pick=aws:0:t3.large,mars:0:x,gcp:abc:y,azure:1:');
  assert.deepEqual(out, { aws: { 0: 't3.large' } });
});

test('matchOptions: 기본값(both·버스트 포함)은 URL에 안 남는다', () => {
  assert.equal(encodeMatchOptions({ arch: 'both', includeBurstable: true }), '');
  assert.deepEqual(decodeMatchOptions(''), { arch: 'both', includeBurstable: true });
});

test('matchOptions: arch·burst 왕복', () => {
  const opts = { arch: 'arm' as const, includeBurstable: false };
  assert.deepEqual(decodeMatchOptions(encodeMatchOptions(opts)), opts);
  assert.equal(decodeMatchOptions('arch=x86').arch, 'x86');
  assert.equal(decodeMatchOptions('arch=mips').arch, 'both'); // 모르는 값 → both
});
