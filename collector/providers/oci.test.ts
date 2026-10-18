import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildOciSnapshot, type OciItem } from './oci';

/** 가격 목록 품목 — [partNumber, 구간들]. 구간 하나면 단일가 */
const item = (partNumber: string, ...prices: { value: number; rangeMin?: number; rangeMax?: number }[]): OciItem => ({
  partNumber,
  displayName: partNumber,
  currencyCodeLocalizations: [{ currencyCode: 'USD', prices: prices.map((p) => ({ model: 'PAY_AS_YOU_GO', ...p })) }],
});

// 2026-10-17 실제 가격 목록 값
const ITEMS: OciItem[] = [
  item('B93113', { value: 0.025 }), // E4 OCPU
  item('B93114', { value: 0.0015 }), // E4 메모리
  item('B97384', { value: 0.03 }), // E5 OCPU
  item('B97385', { value: 0.002 }),
  item('B94176', { value: 0.04 }), // X9(Standard3) OCPU
  item('B94177', { value: 0.0015 }),
  item('B93297', { value: 0, rangeMin: 0, rangeMax: 3000 }, { value: 0.01, rangeMin: 3000, rangeMax: 999999999999999 }), // A1 OCPU — 무료 구간
  item('B93298', { value: 0, rangeMin: 0, rangeMax: 18000 }, { value: 0.0015, rangeMin: 18000, rangeMax: 999999999999999 }),
  item('B91961', { value: 0.0255 }), // 블록 용량
  item('B91962', { value: 0.0017 }), // 블록 성능 단위(VPU)
  item('B91628', { value: 0, rangeMin: 0, rangeMax: 10 }, { value: 0.0255, rangeMin: 10, rangeMax: 999999999 }), // 오브젝트
  item('B88327', { value: 0, rangeMin: 0, rangeMax: 10240 }, { value: 0.0085, rangeMin: 10240, rangeMax: 999999999999999 }), // 트래픽 북미·유럽
  item('B93455', { value: 0, rangeMin: 0, rangeMax: 10240 }, { value: 0.025, rangeMin: 10240, rangeMax: 999999999999999 }), // 트래픽 아시아
  item('B93030', { value: 0, rangeMin: 0, rangeMax: 744 }, { value: 0.0113, rangeMin: 744, rangeMax: 999999999 }), // LB 기본
  item('B93031', { value: 0, rangeMin: 0, rangeMax: 7440 }, { value: 0.0001, rangeMin: 7440, rangeMax: 999999999 }), // LB 대역폭
  item('B96545', { value: 0.1 }), // OKE Enhanced
  item('B108030', { value: 0.0366 }), // MySQL ECPU
  item('B92426', { value: 0.04 }), // MySQL 스토리지
  item('B99060', { value: 0.098 }), // PostgreSQL OCPU 요금
  item('B99062', { value: 0.072 }), // PostgreSQL 스토리지
  item('B98217', { value: 0.0194 }), // 캐시 저메모리
  item('B99591', { value: 0.0136 }), // 캐시 고메모리
  item('B92593', { value: 0, rangeMin: 0, rangeMax: 10 }, { value: 0.05, rangeMin: 10, rangeMax: 999999999 }), // 로그 저장
];

test('OCI VM: Flex 격자 — OCPU·GB 단가, x86 1 OCPU = 2 vCPU, A1은 1 vCPU, 무료 구간 미반영, OCPU당 64GB 상한', () => {
  const vms = buildOciSnapshot(ITEMS, 'seoul').vms;
  const e4 = vms.find((v) => v.sku === 'VM.Standard.E4.Flex.1OCPU.8GB')!;
  assert.deepEqual([e4.vcpu, e4.ramGb, e4.arch, e4.generation, e4.pricePerHour], [2, 8, 'x86', 'e4', 0.037]); // 0.025 + 8 × 0.0015
  const a1 = vms.find((v) => v.sku === 'VM.Standard.A1.Flex.1OCPU.2GB')!;
  assert.deepEqual([a1.vcpu, a1.arch, a1.pricePerHour], [1, 'arm', 0.013]); // 무료 구간이 아니라 유료 단가
  assert.ok(!vms.some((v) => v.arch === 'x86' && v.vcpu === 1)); // x86은 짝수 vCPU만
  assert.ok(!vms.some((v) => v.generation === 'x9' && v.vcpu > 64)); // Standard3 최대 32 OCPU
  assert.ok(vms.every((v) => v.ramGb <= (v.arch === 'arm' ? v.vcpu : v.vcpu / 2) * 64 && !v.burstable && !v.commit));
});

test('OCI 스토리지·트래픽·LB·NAT·K8s: Balanced 10 VPU, 리전별 트래픽 구간(10TB 무료), LB 최소 10Mbps + GB 환산', () => {
  const seoul = buildOciSnapshot(ITEMS, 'seoul');
  assert.deepEqual(seoul.storage.map((s) => [s.kind, s.pricePerGbMonth]), [['block-ssd', 0.0425], ['object-standard', 0.0255]]);
  assert.deepEqual(seoul.egress, { provider: 'oci', region: 'seoul', freeGb: 10240, tiers: [{ upToGb: 10240, pricePerGb: 0 }, { upToGb: null, pricePerGb: 0.025 }] });
  assert.equal(buildOciSnapshot(ITEMS, 'london').egress!.tiers[1].pricePerGb, 0.0085);
  assert.deepEqual([seoul.lb!.perHour, seoul.lb!.perGb], [0.0123, 0.000222]);
  assert.deepEqual([seoul.nat!.hourly.usd, seoul.nat!.perGb], [0, 0]);
  assert.equal(seoul.k8s!.clusterPerHour, 0.1);
  assert.equal(seoul.cdn, null);
});

test('OCI DB: MySQL ECPU 셰이프(이중화 3배), PostgreSQL = E5 컴퓨트 + OCPU 요금(이중화 2배), 스토리지 = Optimized Storage + 30 VPU(노드 공유)', () => {
  const db = buildOciSnapshot(ITEMS, 'seoul').db!;
  const mysql2 = db.engines.mysql!.instances.find((i) => i.sku === 'MySQL.2')!;
  assert.deepEqual([mysql2.vcpu, mysql2.ramGb, mysql2.perHour, mysql2.haPerHour], [2, 16, 0.0732, 0.2196]);
  assert.deepEqual([db.engines.mysql!.storageGbMonth, db.engines.mysql!.haStorageGbMonth], [0.04, 0.12]);
  const pg = db.engines.postgres!.instances.find((i) => i.sku === 'PostgreSQL.VM.Standard.E5.Flex.1OCPU.16GB')!;
  assert.deepEqual([pg.vcpu, pg.ramGb, pg.perHour, pg.haPerHour], [2, 16, 0.16, 0.32]); // 1 × (0.03 + 0.098) + 16 × 0.002
  assert.equal(db.engines.postgres!.instances.filter((i) => i.ramGb < 16).length, 0); // 최소 16GB
  assert.equal(db.engines.postgres!.storageGbMonth, 0.123); // Optimized Storage 0.072 + 최저 성능 등급 30 VPU × 0.0017
  assert.equal(db.engines.postgres!.haStorageGbMonth, db.engines.postgres!.storageGbMonth);
});

test('OCI 캐시·컨테이너·로그: 노드 10GB 이하/초과 단가, Container Instances = E4·A1 단가, 로그 수집 무료·보관 180일 상한', () => {
  const snap = buildOciSnapshot(ITEMS, 'seoul');
  const node = (gb: number) => snap.cache!.nodes.find((n) => n.memoryGb === gb)!;
  assert.deepEqual([node(10).perHour, node(12).perHour, node(12).haPerHour], [0.194, 0.1632, 0.3264]);
  assert.deepEqual(snap.container!.rates, { x86: { vcpuPerHour: 0.0125, gbPerHour: 0.0015 }, arm: { vcpuPerHour: 0.01, gbPerHour: 0.0015 } });
  assert.deepEqual([snap.logs!.ingestPerGb, snap.logs!.storagePerGbMonth, snap.logs!.maxRetentionDays], [0, 0.05, 180]);
});

test('OCI: 품목이 없으면 수집 실패(조용히 0원으로 만들지 않는다)', () => {
  assert.throws(() => buildOciSnapshot(ITEMS.filter((i) => i.partNumber !== 'B96545'), 'seoul'), /B96545/);
});
