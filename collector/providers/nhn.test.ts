import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildNhnSnapshot, krw, nhnSections, type NhnPages } from './nhn';

// 실제 요금표 HTML 형태(2026-10-17 서울 값, rowspan으로 칸이 밀린 행 포함). 환율은 1,000원/USD
const KRW = 1000;

const table = (title: string, rows: string[][]) =>
  `<div><strong class="block text-title-2">  ${title}  </strong><div data-editor-area data-pricing-table><em>(VAT 별도)</em>` +
  `<div class="tbl_wrap"><table class="tbl"><thead><tr><th>과금 구분</th><th>요금</th></tr></thead><tbody>` +
  rows.map((r) => `<tr>${r.map((c) => `<td rowspan="2">${c}</td>`).join('')}</tr>`).join('') +
  `</tbody></table></div></div></div>`;

const NETWORK = table('Network', [
  ['공인 IP', '인터넷 트래픽', '1GB 이하', '무료 제공', '0원'],
  ['1GB 초과', '1GB당', '100원'],
  ['같은 리전 내 트래픽', '-', '1GB당', '9원'],
]);

const DB_PAGE =
  table('Instance', [
    ['Standard', 'm2', 'm2.c2m4', '2개', '4GB', '사용 시간 누적', '149원/시간'],
    ['r2.c2m8', '2개', '8GB', '231원/시간'],
  ]) +
  NETWORK +
  table('Data Storage', [['HDD', '10GB당 사용 시간 누적', '1.4원/시간'], ['SSD', '1.6원/시간']]);

const PAGES: NhnPages = {
  instance:
    table('Instance', [
      ['인스턴스 타입', 'vCPU', '메모리'],
      ['Standard', 't2', 't2.c1m1', '1개', '1GB', '사용 시간 누적', '24원/시간'],
      ['m2', 'm2.c2m4', '2개', '4GB', '93원/시간'],
      ['x1.c16m64', '16개', '64GB', '1,029원/시간'],
      ['Basic', 'u2', 'u2.c2m4', '2개', '4GB', '30원/시간'], // ✘ 로컬 스토리지 묶음
    ]) + NETWORK,
  block: table('Block Storage', [['HDD', '10GB당 사용 시간 누적', '1.4원/시간'], ['SSD', '1.6원/시간']]),
  object: table('Object Storage', [['Standard', '스토리지 용량', '10GB당 사용 시간 누적', '0.4원/시간'], ['Economy', '스토리지 용량', '10GB당 사용 시간 누적', '0.2원/시간']]),
  nks: table('NHN Kubernetes Service(NKS)', [['클러스터', '시간당', '100원/시간']]),
  lb: table('Load Balancer', [['일반 Load Balancer', '1개당 사용 시간 누적', '20원/시간'], ['전용 Load Balancer', '1개당 사용 일수 누적', '14,000원/일']]),
  nat: table('NAT Gateway', [['NAT 게이트웨이 수', '1개당', '50원/시간']]),
  mysql: DB_PAGE,
  postgres: '', // 요금표가 비어 있는 리전(도쿄)과 같은 상태
  cache: table('Instance', [
    ['2GB', 'm2', 'm2.c1m2', 'Standard', '1개', '사용 시간 누적', '54원/시간'],
    ['8GB', 'r2', 'r2.c2m8', 'Memory Optimized', '2개', '182원/시간'],
    ['m2', 'm2.c4m8', 'Standard', '4개', '219원/시간'], // 같은 8GB의 비싼 행 → 버림
  ]),
  ncs: table('Workload', [['CPU', 'vCPU', '1vCPU당 사용 시간 누적', '0.016원/초'], ['메모리', '1GB당 사용 시간 누적', '0.0018원/초']]),
  cdn: table('CDN', [
    ['Network 전송량', '10TB 이하', '1GB당', '84원'],
    ['10TB 초과 ~ 30TB 이하', '1GB당', '78원'],
    ['30TB 초과 ~ 50TB 이하', '1GB당', '74원'],
    ['50TB 초과 ~ 100TB 이하', '1GB당', '71원'],
    ['100TB 초과 ~ 300TB 이하', '1GB당', '55원'],
    ['300TB 초과 ~ 500TB 이하', '1GB당', '43원'],
    ['500TB 초과', '1GB당', '35원'],
  ]),
  logs: table('Log Search', [
    ['API 호출', '1,000,000호출 이하', '무료 제공', '0원'],
    ['스토리지 용량', 'Basic', '1GB 이하', '무료 제공', '0원'],
    ['1GB 초과', '월 평균 저장량 1GB당', '800원'],
    ['Premium', '1GB 이하', '무료 제공', '0원'],
    ['1GB 초과', '월 평균 저장량 1GB당', '1,600원'],
  ]),
};

test('NHN 파서: <strong> 제목별 표, 셀 텍스트, 원화 금액(쉼표·소수·단위)', () => {
  assert.deepEqual(nhnSections(PAGES.lb)[0].title, 'Load Balancer');
  assert.deepEqual(nhnSections(PAGES.lb)[0].rows[1], ['일반 Load Balancer', '1개당 사용 시간 누적', '20원/시간']);
  assert.deepEqual([krw('1,029원/시간'), krw('0.016원/초'), krw('무료 제공')], [1029, 0.016, null]);
});

test('NHN VM·스토리지·트래픽·K8s·LB·NAT: 타입 이름으로 사양, 10GB당 원/시간 → GB·월, u2 제외', () => {
  const snap = buildNhnSnapshot(PAGES, 'seoul', KRW);
  assert.deepEqual(snap.vms.map((v) => [v.sku, v.vcpu, v.ramGb, v.generation, v.pricePerHour]), [
    ['t2.c1m1', 1, 1, 't2', 0.024],
    ['m2.c2m4', 2, 4, 'm2', 0.093],
    ['x1.c16m64', 16, 64, 'x1', 1.029],
  ]);
  assert.deepEqual(snap.storage.map((s) => [s.kind, s.pricePerGbMonth]), [['block-ssd', 0.1168], ['object-standard', 0.0292]]);
  assert.deepEqual(snap.egress!.tiers, [{ upToGb: 1, pricePerGb: 0 }, { upToGb: null, pricePerGb: 0.1 }]);
  assert.equal(snap.k8s!.clusterPerHour, 0.1);
  assert.deepEqual([snap.lb!.perHour, snap.lb!.perGb, snap.nat!.hourly.usd, snap.nat!.perGb], [0.02, 0, 0.05, 0]);
});

test('NHN DB·캐시·컨테이너·CDN·로그: HA 2배, 비어 있는 요금표는 null, 원/초 → 시간, 로그 Basic 30일·Premium 120일', () => {
  const snap = buildNhnSnapshot(PAGES, 'seoul', KRW);
  const mysql = snap.db!.engines.mysql!;
  assert.deepEqual(mysql.instances.map((i) => [i.sku, i.perHour, i.haPerHour]), [['m2.c2m4', 0.149, 0.298], ['r2.c2m8', 0.231, 0.462]]);
  assert.deepEqual([mysql.storageGbMonth, mysql.haStorageGbMonth], [0.1168, 0.2336]);
  assert.equal(snap.db!.engines.postgres, null);
  assert.deepEqual(snap.cache!.nodes.map((n) => [n.memoryGb, n.perHour, n.haPerHour]), [[2, 0.054, 0.108], [8, 0.182, 0.364]]);
  assert.deepEqual(snap.container!.rates, { x86: { vcpuPerHour: 0.0576, gbPerHour: 0.00648 } });
  assert.deepEqual(snap.cdn!.gbTiers.at(-1), { upTo: null, price: 0.035 });
  assert.deepEqual([snap.logs!.plan, snap.logs!.storagePerGbMonth, snap.logs!.maxRetentionDays], ['Basic', 0.8, 30]);
  const p = snap.logs!.alternatives![0];
  assert.deepEqual([p.plan, p.storagePerGbMonth, p.maxRetentionDays], ['Premium', 1.6, 120]);
});

test('NHN 도쿄처럼 요금표가 비어 있으면 그 구성 요소만 null, 필수 요금표가 없으면 수집 실패', () => {
  const tokyo = buildNhnSnapshot({ ...PAGES, nks: '', nat: '', cache: '', ncs: '' }, 'tokyo', KRW);
  assert.deepEqual([tokyo.k8s, tokyo.nat, tokyo.cache, tokyo.container], [null, null, null, null]);
  assert.throws(() => buildNhnSnapshot({ ...PAGES, lb: '' }, 'seoul', KRW), /Load Balancer/);
});
