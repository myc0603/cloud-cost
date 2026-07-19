import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseCsvLine, parseDataTransferCsv, parseEc2OfferCsv, parseS3OfferCsv } from './aws';

test('parseCsvLine: 따옴표·이스케이프·빈 필드', () => {
  assert.deepEqual(parseCsvLine('"a","b,c","d""e",,"f"'), ['a', 'b,c', 'd"e', '', 'f']);
});

const HEADER =
  '"SKU","TermType","StartingRange","EndingRange","Unit","PricePerUnit","Currency","Product Family","Instance Type","Current Generation","vCPU","Physical Processor","Memory","Processor Architecture","Storage Media","Volume Type","Volume API Name","Tenancy","Operating System","License Model","Pre Installed S/W","Transfer Type","From Location","To Location","usageType","CapacityStatus","GPU"';

const HEADER_NAMES = parseCsvLine(HEADER);

const row = (over: Record<string, string> = {}) => {
  const base: Record<string, string> = {
    SKU: 'X',
    TermType: 'OnDemand',
    StartingRange: '0',
    EndingRange: 'Inf',
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
  return HEADER_NAMES.map((name) => `"${base[name] ?? ''}"`).join(',');
};

test('parseEc2OfferCsv: VM 파싱 + 제외 필터', async () => {
  const lines = [
    '"FormatVersion","v1.0"', // 메타데이터 줄은 건너뛴다
    HEADER,
    row(), // ✔ t3.medium
    row({ 'Instance Type': 'm5.large', vCPU: '2', Memory: '8 GiB', PricePerUnit: '0.118', 'Physical Processor': 'Intel Xeon' }), // ✔
    row({ 'Operating System': 'SUSE' }), // ✘ Linux 아님
    row({ CapacityStatus: 'UnusedCapacityReservation' }), // ✘ 미사용 예약
    row({ 'Instance Type': 'm7g.large', 'Physical Processor': 'AWS Graviton3 Processor' }), // ✔ ARM(Graviton) — 이제 포함, arch 태깅
    row({ 'Instance Type': 'g5.xlarge', GPU: '1' }), // ✘ GPU
    row({ 'Instance Type': 'm5.metal', vCPU: '96', Memory: '384 GiB' }), // ✘ 베어메탈
    row({ 'Instance Type': 'm4.large', 'Current Generation': 'No' }), // ✘ 구세대
    row({ TermType: 'Reserved' }), // ✘ 예약 텀
  ];
  const { vms } = await parseEc2OfferCsv(lines, 'seoul');

  assert.deepEqual(vms.map((s) => s.sku), ['m5.large', 'm7g.large', 't3.medium']);
  const t3 = vms.find((s) => s.sku === 't3.medium')!;
  assert.equal(t3.pricePerHour, 0.052);
  assert.equal(t3.vcpu, 2);
  assert.equal(t3.ramGb, 4);
  assert.equal(t3.burstable, true);
  assert.equal(t3.generation, 't3');
  assert.equal(t3.arch, 'x86');
  assert.equal(vms.find((s) => s.sku === 'm5.large')!.burstable, false);
  assert.equal(vms.find((s) => s.sku === 'm7g.large')!.arch, 'arm'); // Graviton → arm
});

test('parseEc2OfferCsv: 쉼표 포함 메모리("3,904 GiB") 파싱', async () => {
  const lines = [HEADER, row({ 'Instance Type': 'u7i-12tb.112xlarge', vCPU: '448', Memory: '3,904 GiB', PricePerUnit: '113.36' })];
  const { vms } = await parseEc2OfferCsv(lines, 'seoul');
  assert.equal(vms[0].ramGb, 3904);
});

test('parseEc2OfferCsv: gp3 블록 스토리지 추출', async () => {
  const storageRow = (over: Record<string, string>) =>
    row({ 'Product Family': 'Storage', Unit: 'GB-Mo', 'Instance Type': '', ...over });
  const lines = [
    HEADER,
    storageRow({ 'Volume API Name': 'gp3', PricePerUnit: '0.0912' }), // ✔ gp3
    storageRow({ 'Volume API Name': 'gp2', PricePerUnit: '0.114' }), // ✘ gp2
  ];
  const { storage } = await parseEc2OfferCsv(lines, 'seoul');
  assert.deepEqual(storage, [{ provider: 'aws', region: 'seoul', kind: 'block-ssd', pricePerGbMonth: 0.0912 }]);
});

test('parseDataTransferCsv: 글로벌 무료 100GB + 리전 구간 시프트', async () => {
  const dtRow = (over: Record<string, string>) =>
    row({
      'Product Family': 'Data Transfer',
      'Transfer Type': 'AWS Outbound',
      'From Location': 'Asia Pacific (Seoul)',
      'To Location': 'External',
      Unit: 'GB',
      'Instance Type': '',
      ...over,
    });
  const lines = [
    HEADER,
    dtRow({ 'From Location': 'Global', StartingRange: '0', EndingRange: '100', PricePerUnit: '0' }), // 글로벌 무료분
    dtRow({ StartingRange: '0', EndingRange: '10240', PricePerUnit: '0.1260000000' }),
    dtRow({ StartingRange: '10240', EndingRange: 'Inf', PricePerUnit: '0.1220000000' }),
    dtRow({ 'Transfer Type': 'Accelerated AWS Outbound from close by location', PricePerUnit: '0.04' }), // ✘ 가속 전송
    dtRow({ 'From Location': 'US East (N. Virginia)', StartingRange: '0', EndingRange: 'Inf', PricePerUnit: '0.09' }), // ✘ 다른 리전
  ];
  const egress = await parseDataTransferCsv(lines, 'seoul');

  assert.ok(egress);
  assert.equal(egress.freeGb, 100);
  assert.deepEqual(egress.tiers, [
    { upToGb: 100, pricePerGb: 0 },
    { upToGb: 10340, pricePerGb: 0.126 }, // 10240 + 무료 100
    { upToGb: null, pricePerGb: 0.122 },
  ]);
});

test('parseS3OfferCsv: Standard 첫 구간 단가', async () => {
  const s3row = (over: Record<string, string>) =>
    row({ 'Product Family': 'Storage', Unit: 'GB-Mo', 'Instance Type': '', ...over });
  const lines = [
    HEADER,
    s3row({ 'Volume Type': 'Standard - Infrequent Access', PricePerUnit: '0.0138' }), // ✘ IA
    s3row({ 'Volume Type': 'Standard', StartingRange: '51200', PricePerUnit: '0.0245' }), // ✘ 두번째 구간
    s3row({ 'Volume Type': 'Standard', StartingRange: '0', PricePerUnit: '0.025' }), // ✔
  ];
  const sku = await parseS3OfferCsv(lines, 'seoul');
  assert.deepEqual(sku, { provider: 'aws', region: 'seoul', kind: 'object-standard', pricePerGbMonth: 0.025 });
});

test('parseEc2OfferCsv: 헤더가 없으면 형식 변경 의심 에러', async () => {
  await assert.rejects(() => parseEc2OfferCsv(['"FormatVersion","v1.0"'], 'seoul'), /형식 변경/);
});
