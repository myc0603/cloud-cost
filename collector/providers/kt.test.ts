import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildKtSnapshot, ktTables, won, type KtDocs } from './kt';

// 실제 요금 문서(편집기 HTML) 형태, 2026-10-17 값. 환율은 1,000원/USD
const KRW = 1000;
const cell = (c: string) => `<td><p style="text-align:center;"><span class="text-small">${c}</span></p></td>`;
const table = (rows: string[][]) => `<figure class="table"><table class="ck-table-resized"><tbody>${rows.map((r) => `<tr>${r.map(cell).join('')}</tr>`).join('')}</tbody></table></figure>`;

const DB = (aux: string, auxPrice: string) =>
  table([
    ['VM 구분', 'vCore', 'vMemory (GB)', 'Memory Type', 'Root Disk (GB)', 'Root Disk Type', '월 요금 (원/월)', '시간 요금 (원/시간)'],
    [aux, '1', '1', '표준', '50', 'HDD', auxPrice, '₩ 39'],
    ['Standalone', '1', '2', 'SSD', '₩ 50,750', '₩ 69'],
    ['2', '4', '₩ 99,125', '₩ 137'],
    ['2', '8', 'High Memory', '₩ 126,000', '₩ 174'],
  ]) +
  table([
    ['영역', 'Disk Type', 'Disk Size (GB)', '월 요금 (원/월)', '시간 요금 (원/시간)'],
    ['Data Volume', 'HDD', '10', '₩700', '₩1'],
    ['SSD', '10', '₩ 1,400', '₩ 2'],
  ]);

const DOCS: KtDocs = {
  server:
    table([
      ['구분', 'vCore', 'Memory', '요금'],
      ['D1 (DX-M1)', 'G2 (KOR-Seoul M2)', 'G1 (기존 Zone)'],
      ['표준', '1', '1', '22,500원', '31원', '22,500원', '31원', '22,500원', '32원'],
      ['표준', '1', '2', '38,600원', '53원', 'X', 'X', '38,500원', '54원'],
      ['High Memory', '16', '62', 'X', 'X', '773,100원', '1,073원', '842,500원', '1,171원'], // D1 미제공 → 제외
    ]) +
    table([['약정 기간', '할인율'], ['1 년', '15%'], ['2 년', '20%'], ['3 년', '25%']]) +
    table([
      ['Cloud 서버 스펙별', 'Network 사용 구간별 단가 (GB당)'],
      ['0 ~ 512GB', '512 GB ~ 1 TB', '1 ~ 10TB', '10 ~ 20TB', '20TB 이상'],
      ['16GB Memory미만 Cloud 서버 당', '무료', '90원', '90원', '80원', '70원'],
      ['16GB Memory이상 Cloud 서버 당', '무료', '무료', '90원', '80원', '70원'],
    ]) +
    table([
      ['구분', '단위', '월 요금 (원/월)', '시간 요금 (원/시간)', 'IOPS 참고', '비고'],
      ['HDD(일반) DISK', '10GB', '700원', '1원', '', ''],
      ['SSD DISK', '10GB', '1,400원', '2원', '4,000 ~ 10,000', 'D플랫폼 : 모든 Zone 제공'],
    ]),
  object: table([['저장량 구간(월)', '월 요금 (원/1GB)'], ['Standard', 'Economy'], ['~ 10TB 이하', '30원/1GB', '20원/1GB'], ['10TB 초과 ~ 100TB 이하', '28원/1GB', '18원/1GB']]),
  lb: table([['구분', '요금'], ['로드밸런서 이용 요금', '42원 / 시간'], ['데이터 처리량', '20원 / GB']]),
  ks: table([['항목', '월 요금 (원/월)', '시간 요금(원/시간)'], ['클러스터', '70,000원', '98원']]),
  mysql: DB('MySQL Router (Cluster)', '₩ 28,125'),
  postgres: DB('Monitor (Master/Replica시 1대 생성)', '₩ 28,125'),
  cdn: table([
    ['구분', '사용량 구간', '적용 단가'],
    ['데이터를 인터넷으로 전송하는 요금(GB당)', '0 ~ 200GB', '75원'],
    ['0.2TB 초과 ~ 10TB 이하', '55원'],
    ['10TB 초과 ~ 50TB 이하', '49원'],
    ['50TB 초과 ~ 150TB 이하', '42원'],
    ['150TB 초과 ~ 500TB 이하', '35원'],
    ['500TB 초과', '29원'],
    ['모든 HTTP 메서드에 대한 요청 요금(10,000개 당)', '전 구간 동일', '10원'],
  ]),
};

test('KT 파서: 편집기 HTML 표 → 셀 텍스트, 원화 표기 두 가지(22,500원 · ₩ 99,125)', () => {
  assert.deepEqual(ktTables(DOCS.lb)[0][1], ['로드밸런서 이용 요금', '42원 / 시간']);
  assert.deepEqual([won('22,500원'), won('₩ 99,125'), won('42원 / 시간'), won('X'), won('무료')], [22500, 99125, 42, null, null]);
});

test('KT VM: D1 열 월 요금 ÷ 730, D1 미제공(X) 제외, 온라인 VM 약정 1년 15%·3년 25%', () => {
  const vms = buildKtSnapshot(DOCS, 'seoul', KRW).vms;
  assert.deepEqual(vms.map((v) => [v.sku, v.vcpu, v.ramGb]), [['d1.std.1c1g', 1, 1], ['d1.std.1c2g', 1, 2]]);
  const per = 22500 / 730;
  assert.equal(vms[0].pricePerHour, +(per / KRW).toFixed(6));
  assert.deepEqual(vms[0].commit, { '1y': +((per * 0.85) / KRW).toFixed(6), '3y': +((per * 0.75) / KRW).toFixed(6) });
});

test('KT 스토리지·트래픽·K8s·LB·CDN: 10GB당 월 요금, 서버당 무료량(512GB/1TB) 표시, 클러스터 월 요금 ÷ 730', () => {
  const s = buildKtSnapshot(DOCS, 'seoul', KRW);
  assert.deepEqual(s.storage.map((x) => [x.kind, x.pricePerGbMonth]), [['block-ssd', 0.14], ['object-standard', 0.03]]);
  assert.deepEqual(s.egress!.perServerFree, { gb: 512, largeGb: 1024, largeFromRamGb: 16 });
  assert.deepEqual(s.egress!.tiers.map((t) => [t.upToGb, t.pricePerGb]), [[10240, 0.09], [20480, 0.08], [null, 0.07]]);
  assert.equal(s.k8s!.clusterPerHour, +(70000 / 730 / KRW).toFixed(6));
  assert.deepEqual([s.lb!.perHour, s.lb!.perGb], [0.042, 0.02]);
  assert.deepEqual(s.cdn!.gbTiers[0], { upTo: 200, price: 0.075 });
  assert.deepEqual(s.cdn!.requestTiers, [{ upTo: null, price: 0.01 }]);
  assert.deepEqual([s.nat, s.cache, s.logs, s.container], [null, null, null, null]);
});

test('KT DB: 이중화 MySQL = 3노드 + Router 2대, PostgreSQL = 2노드 + Monitor 1대, 스토리지 = 데이터 + 백업 2배', () => {
  const db = buildKtSnapshot(DOCS, 'seoul', KRW).db!;
  const [vm, aux] = [99125 / 730, 28125 / 730];
  const my = db.engines.mysql!.instances.find((i) => i.sku === '2c4g')!;
  assert.deepEqual([my.perHour, my.haPerHour], [+(vm / KRW).toFixed(6), +((vm * 3 + aux * 2) / KRW).toFixed(6)]);
  const pg = db.engines.postgres!.instances.find((i) => i.sku === '2c4g')!;
  assert.equal(pg.haPerHour, +((vm * 2 + aux) / KRW).toFixed(6));
  assert.deepEqual([db.engines.mysql!.storageGbMonth, db.engines.mysql!.haStorageGbMonth, db.engines.postgres!.haStorageGbMonth], [0.42, 0.7, 0.56]);
  assert.equal(db.engines.mysql!.instances.length, 3); // Router 행은 DB 사양이 아님
});

test('KT: 표 형식이 바뀌면 수집 실패(조용히 0원으로 만들지 않는다)', () => {
  assert.throws(() => buildKtSnapshot({ ...DOCS, lb: table([['구분', '요금'], ['LB', '42원']]) }, 'seoul', KRW), /로드밸런서 이용 요금/);
});
