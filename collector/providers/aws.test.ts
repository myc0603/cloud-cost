import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseAwsVmCsv, parseCsvLine } from './aws';

test('parseCsvLine: 따옴표·이스케이프·빈 필드', () => {
  assert.deepEqual(parseCsvLine('"a","b,c","d""e",,"f"'), ['a', 'b,c', 'd"e', '', 'f']);
});

const HEADER =
  '"SKU","TermType","Unit","PricePerUnit","Currency","Product Family","Instance Type","Current Generation","vCPU","Physical Processor","Memory","Processor Architecture","Tenancy","Operating System","License Model","Pre Installed S/W","CapacityStatus","GPU"';

const row = (over: Record<string, string> = {}) => {
  const base: Record<string, string> = {
    SKU: 'X',
    TermType: 'OnDemand',
    Unit: 'Hrs',
    PricePerUnit: '0.0520000000',
    Currency: 'USD',
    'Product Family': 'Compute Instance',
    'Instance Type': 't3.medium',
    'Current Generation': 'Yes',
    vCPU: '2',
    'Physical Processor': 'Intel Skylake E5 2686 v5',
    Memory: '4 GiB',
    'Processor Architecture': '64-bit',
    Tenancy: 'Shared',
    'Operating System': 'Linux',
    'License Model': 'No License required',
    'Pre Installed S/W': 'NA',
    CapacityStatus: 'Used',
    GPU: '',
    ...over,
  };
  return parseCsvLine(HEADER)
    .map((name) => `"${base[name] ?? ''}"`)
    .join(',');
};

test('parseAwsVmCsv: 정상 행 파싱 + 제외 필터', async () => {
  const lines = [
    '"FormatVersion","v1.0"', // 메타데이터 줄은 건너뛴다
    HEADER,
    row(), // ✔ t3.medium
    row({ 'Instance Type': 'm5.large', vCPU: '2', Memory: '8 GiB', PricePerUnit: '0.118', 'Physical Processor': 'Intel Xeon' }), // ✔
    row({ 'Operating System': 'SUSE' }), // ✘ Linux 아님
    row({ CapacityStatus: 'UnusedCapacityReservation' }), // ✘ 미사용 예약
    row({ 'Instance Type': 'm7g.large', 'Physical Processor': 'AWS Graviton3 Processor' }), // ✘ ARM
    row({ 'Instance Type': 'g5.xlarge', GPU: '1' }), // ✘ GPU
    row({ 'Instance Type': 'm5.metal', vCPU: '96', Memory: '384 GiB' }), // ✘ 베어메탈
    row({ 'Instance Type': 'm4.large', 'Current Generation': 'No' }), // ✘ 구세대
    row({ TermType: 'Reserved' }), // ✘ 예약 텀
  ];
  const skus = await parseAwsVmCsv(lines, 'seoul');

  assert.deepEqual(skus.map((s) => s.sku), ['m5.large', 't3.medium']);
  const t3 = skus.find((s) => s.sku === 't3.medium')!;
  assert.equal(t3.pricePerHour, 0.052);
  assert.equal(t3.vcpu, 2);
  assert.equal(t3.ramGb, 4);
  assert.equal(t3.burstable, true);
  assert.equal(t3.generation, 't3');
  assert.equal(skus.find((s) => s.sku === 'm5.large')!.burstable, false);
});

test('parseAwsVmCsv: 쉼표 포함 메모리("3,904 GiB") 파싱', async () => {
  const lines = [HEADER, row({ 'Instance Type': 'u7i-12tb.112xlarge', vCPU: '448', Memory: '3,904 GiB', PricePerUnit: '113.36' })];
  const skus = await parseAwsVmCsv(lines, 'seoul');
  assert.equal(skus[0].ramGb, 3904);
});

test('parseAwsVmCsv: 헤더가 없으면 형식 변경 의심 에러', async () => {
  await assert.rejects(() => parseAwsVmCsv(['"FormatVersion","v1.0"'], 'seoul'), /형식 변경/);
});
