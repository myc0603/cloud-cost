import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildScpSnapshot, parseArrayLiteral, scpRows, type ScpFiles } from './scp';

// 실제 파일 형식(2026-10-17 값). 환율은 계산이 떨어지게 1,000원/USD
const KRW = 1000;

/** 리전 하나·표 여러 개짜리 요금 파일 — USD 표와 다른 리전을 섞어 엉뚱한 곳을 읽지 않는지도 본다 */
const file = (tables: Record<string, string>) => `import { REGION, TABLE_NAME, CURRENCY } from '../../common/constants.js';

export default {
  [REGION.KR_WEST]: {
${Object.entries(tables)
  .map(([t, rows]) => `    [TABLE_NAME.${t}]: {\n      [CURRENCY.KRW]: [\n${rows}\n      ],\n      [CURRENCY.USD]: [\n        ['usd-row', 999999],\n      ],\n    },`)
  .join('\n')}
  },
  [REGION.KR_SOUTH]: {
${Object.keys(tables)
  .map((t) => `    [TABLE_NAME.${t}]: {\n      [CURRENCY.KRW]: [\n        ['south-row', 1, 1, 777777, 1, 1, 1, 1, 1, 1],\n      ],\n    },`)
  .join('\n')}
  },
};`;

const FILES: ScpFiles = {
  virtualServerPlannedCompute: file({
    'VIRTUAL_SERVER_PLANNED_COMPUTE.GENERAL_3': `        ['s3v2m8','2','8',120,153,153,56900,78200,89400,52600,72600,83800],`,
    'VIRTUAL_SERVER_PLANNED_COMPUTE.LARGE_3': `        ['h3v24m48','24','48',1016,1180,1197,482100,603000,699000,407900,516800,655400],`,
  }),
  MysqlPlannedCompute: file({
    'MYSQL_PLANNED_COMPUTE.STANDARD_3': `        ['db3v2m8',2,8,228,116600,108200],`,
    'MYSQL_PLANNED_COMPUTE.HIGH_CAPACITY_3': `        ['dbH3v24m48',24,48,1771,904000,774800],`,
  }),
  PostgreSQLPlannedCompute: file({
    'POSTGRE_SQL_PLANNED_COMPUTE.STANDARD_3': `        ['db3v2m8',2,8,228,116600,108200],`,
    'POSTGRE_SQL_PLANNED_COMPUTE.HIGH_CAPACITY_3': `        ['dbH3v24m48',24,48,1771,904000,774800],`,
  }),
  cacheStorePlannedCompute: file({
    'CACHE_STORE_PLANNED_COMPUTE.STANDARD_3': `        ['redis3v1m2/ccs3v1m2',1,2,91,46300,42900],
        ['redis3v2m4/ccs3v2m4',2,4,181,92600,86000],
        ['redis3v4m4/ccs3v4m4',4,4,300,1,1],`,
  }),
  blockStorage: file({
    'BLOCK_STORAGE.DEFAULT': `        ['HDD','<td data-i18n="pricing.table.perGbStorage" />',55],
        ['SSD','<td data-i18n="pricing.table.perGbStorage" />',120],`,
  }),
  objStorage: file({ 'OBJ_STORAGE.DEFAULT': `        ['<td data-i18n="pricing.table.perGbStorage" />',28],` }),
  vpc: file({
    'VPC.OUTBOUND_TRAFFIC': `        ['<td data-i18n="pricing.vpc.section1" />','-'],
        ['<td data-i18n="pricing.vpc.section2" />',100],
        ['<td data-i18n="pricing.vpc.section3" />',90],
        ['<td data-i18n="pricing.vpc.section4" />',80],
        ['<td data-i18n="pricing.vpc.section5" />',70],`,
    'VPC.NAT_GATEWAY': `        ['<td data-i18n="pricing.table.usageRatesHour" />',56],`,
  }),
  k8sEngine: file({ 'K8S_ENGINE.DEFAULT': `        ['<td data-i18n="pricing.table.perKubernetesCluster"/>',100,'<td data-i18n="pricing.k8sEngine.note1"/>'],` }),
  loadBalancer: file({
    'LOAD_BALANCER.DEFAULT': `        ['<td data-i18n="pricing.table.perLb" />',26],`,
    'LOAD_BALANCER.TRAFFIC': `        ['<td data-i18n="pricing.loadBalancer.type1" />',7],`,
  }),
  gcdn: file({
    'GCDN.DEFAULT': `        ['<td rowspan="6" data-i18n="pricing.gcdn.type1" class="borderB" />','<td rowspan="6" class="borderB">GB</td>','<td data-i18n="pricing.gcdn.usage1" />',77],
        ['<td data-i18n="pricing.gcdn.usage2" />',65],
        ['<td data-i18n="pricing.gcdn.usage3" />',57],
        ['<td data-i18n="pricing.gcdn.usage4" />',52],
        ['<td data-i18n="pricing.gcdn.usage5" />',40],
        ['<td data-i18n="pricing.gcdn.usage6" />',30],`,
  }),
  serviceWatch: file({
    'SERVICE_WATCH.DEFAULT': `        ['<td colspan="2" data-i18n="pricing.serviceWatch.type1" />','<td data-i18n="pricing.serviceWatch.unit1" />',35,'<td data-i18n="pricing.serviceWatch.note1" />'],
        ['<td colspan="2" data-i18n="pricing.serviceWatch.type5" />','<td data-i18n="pricing.serviceWatch.unit5" />',331,'<td data-i18n="pricing.serviceWatch.note5" />'],
        [null,'downloadMetricDataImage','<td data-i18n="pricing.serviceWatch.unit3" />',22,'-'],`,
  }),
};

test('SCP 파서: 리전·표의 원화 배열만 — 다른 리전·USD 표를 읽지 않고, 큰따옴표 든 문자열·null·끝 쉼표를 다룬다', () => {
  assert.deepEqual(parseArrayLiteral(`[ ['a',1,null,'<td x="y" />',], [2.5,'-'], ]`, 0), [['a', 1, null, '<td x="y" />'], [2.5, '-']]);
  assert.deepEqual(scpRows(FILES.loadBalancer, 'KR_WEST', 'LOAD_BALANCER.DEFAULT'), [['<td data-i18n="pricing.table.perLb" />', 26]]);
  assert.throws(() => scpRows(FILES.loadBalancer, 'US_WEST', 'LOAD_BALANCER.DEFAULT'), /리전 US_WEST/);
  assert.throws(() => parseArrayLiteral(`[ foo() ]`, 0), /파싱 실패/);
});

test('SCP VM: 3세대 일반·대용량, 오픈소스 OS 무약정 시간 요금 + Planned Compute 월 요금 ÷ 730', () => {
  const vms = buildScpSnapshot(FILES, 'seoul', KRW).vms;
  assert.deepEqual(vms.map((v) => [v.sku, v.vcpu, v.ramGb, v.generation]), [['s3v2m8', 2, 8, 'general-g3'], ['h3v24m48', 24, 48, 'large-g3']]);
  assert.equal(vms[0].pricePerHour, 0.12);
  assert.deepEqual(vms[0].commit, { '1y': +(56900 / 730 / KRW).toFixed(6), '3y': +(52600 / 730 / KRW).toFixed(6) });
});

test('SCP 스토리지·트래픽·K8s·LB·NAT·CDN·로그: 단위와 구간', () => {
  const snap = buildScpSnapshot(FILES, 'seoul', KRW);
  assert.deepEqual(snap.storage.map((s) => [s.kind, s.pricePerGbMonth]), [['block-ssd', 0.12], ['object-standard', 0.028]]);
  assert.deepEqual(snap.egress!.tiers, [
    { upToGb: 20, pricePerGb: 0 },
    { upToGb: 5120, pricePerGb: 0.1 },
    { upToGb: 10240, pricePerGb: 0.09 },
    { upToGb: 30720, pricePerGb: 0.08 },
    { upToGb: null, pricePerGb: 0.07 },
  ]);
  assert.equal(snap.k8s!.clusterPerHour, 0.1);
  assert.deepEqual([snap.lb!.perHour, snap.lb!.perGb], [0.026, 0.007]);
  assert.deepEqual([snap.nat!.hourly.usd, snap.nat!.perGb], [0.056, 0]);
  assert.deepEqual(snap.cdn!.gbTiers.map((t) => [t.upTo, t.price]), [[200, 0.077], [10240, 0.065], [51200, 0.057], [153600, 0.052], [512000, 0.04], [null, 0.03]]);
  assert.equal(snap.logs!.ingestPerGb, 0.035);
  assert.equal(snap.container, null);
});

test('SCP DB·캐시: 이중화 2배(컴퓨트·스토리지), 스토리지 = 블록 SSD, 약정 월 요금 ÷ 730, 캐시는 메모리별 최저가', () => {
  const snap = buildScpSnapshot(FILES, 'seoul', KRW);
  const mysql = snap.db!.engines.mysql!;
  const db = mysql.instances[0];
  assert.deepEqual([db.sku, db.perHour, db.haPerHour], ['db3v2m8', 0.228, 0.456]);
  const c1 = +(116600 / 730 / KRW).toFixed(6);
  assert.deepEqual(db.commit!['1y'], { perHour: c1, haPerHour: +(c1 * 2).toFixed(6) });
  assert.deepEqual([mysql.storageGbMonth, mysql.haStorageGbMonth], [0.12, 0.24]);
  assert.deepEqual(snap.cache!.nodes.map((n) => [n.sku, n.memoryGb, n.perHour]), [['redis3v1m2', 2, 0.091], ['redis3v2m4', 4, 0.181]]); // 4GB는 싼 2vCore 행
});
