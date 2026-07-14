import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decodeScenario, encodeScenario } from './scenario-url';
import type { Scenario } from './estimator';

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
