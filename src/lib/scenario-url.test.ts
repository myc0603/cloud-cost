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

test('인코딩 → 디코딩 왕복 보존 (카드 순서 포함)', () => {
  const scenario: Scenario = {
    region: 'us-east',
    resources: [
      { type: 'vm', vcpu: 2, ramGb: 4, count: 2 },
      { type: 'block', gb: 100 },
      { type: 'vm', vcpu: 8, ramGb: 32, count: 1 },
      { type: 'object', gb: 500 },
      { type: 'egress', gb: 1024 },
    ],
  };
  const encoded = encodeScenario(scenario);
  assert.equal(new URLSearchParams(encoded).get('res'), 'vm:2c4g:2,blk:100,vm:8c32g:1,obj:500,eg:1024');
  assert.deepEqual(decodeScenario(encoded), scenario);
});

test('파라미터 없으면 null (기본 시나리오 위임) — v0.3 이전 형식도 null', () => {
  assert.equal(decodeScenario(''), null);
  assert.equal(decodeScenario('foo=bar'), null);
  assert.equal(decodeScenario('vm=2c4g:1&blk=100'), null);
});

test('깨진 토큰·모르는 리소스는 버리고 정상 토큰만 살린다', () => {
  const s = decodeScenario('r=seoul&res=vm:2c4g:1,garbage,vm:0c4g:1,lb:1,blk:abc,eg:-5,vm:4c8g:2');
  assert.deepEqual(s?.resources, [
    { type: 'vm', vcpu: 2, ramGb: 4, count: 1 },
    { type: 'vm', vcpu: 4, ramGb: 8, count: 2 },
  ]);
});

test('K8s 토큰 왕복 + 깨진 본문은 버린다', () => {
  const scenario: Scenario = { region: 'seoul', resources: [{ type: 'k8s', clusters: 2, node: { vcpu: 4, ramGb: 16, count: 3 } }] };
  const encoded = encodeScenario(scenario);
  assert.equal(new URLSearchParams(encoded).get('res'), 'k8s:2:4c16g:3');
  assert.deepEqual(decodeScenario(encoded), scenario);
  assert.deepEqual(decodeScenario('res=k8s:0:4c16g:3,k8s:1:4c16g')?.resources, []);
});

test('singleton(트래픽)은 첫 카드만 살린다', () => {
  const s = decodeScenario('res=eg:100,eg:200');
  assert.deepEqual(s?.resources, [{ type: 'egress', gb: 100 }]);
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
