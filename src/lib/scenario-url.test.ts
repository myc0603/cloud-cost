import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decodeScenario, encodeScenario } from './scenario-url';
import type { Scenario } from './estimator';

test('인코딩 → 디코딩 왕복 보존', () => {
  const scenario: Scenario = {
    region: 'us-east',
    vms: [{ vcpu: 2, ramGb: 4, count: 2 }, { vcpu: 8, ramGb: 32, count: 1 }],
  };
  assert.deepEqual(decodeScenario(encodeScenario(scenario)), scenario);
});

test('파라미터 없으면 null (기본 시나리오 위임)', () => {
  assert.equal(decodeScenario(''), null);
  assert.equal(decodeScenario('foo=bar'), null);
});

test('깨진 토큰은 버리고 정상 토큰만 살린다', () => {
  const s = decodeScenario('r=seoul&vm=2c4g:1,garbage,0c4g:1,4c8g:2');
  assert.deepEqual(s?.vms, [{ vcpu: 2, ramGb: 4, count: 1 }, { vcpu: 4, ramGb: 8, count: 2 }]);
});

test('모르는 리전은 seoul로 폴백', () => {
  assert.equal(decodeScenario('r=mars&vm=2c4g:1')?.region, 'seoul');
});
