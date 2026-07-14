/**
 * AWS 수집기 — Price List Bulk API의 리전별 오퍼 CSV를 스트리밍 파싱한다.
 *
 * JSON 오퍼 파일은 us-east-1 기준 457MB로 V8 문자열 한계에 근접해 통파싱이
 * 불가능하다 → CSV(288MB)를 라인 단위로 스트리밍해 상수 메모리로 처리.
 * EC2 CSV 한 번의 패스에서 VM + 블록 스토리지(gp3) + 인터넷 egress를 모두 추출하고,
 * 오브젝트 스토리지(S3 Standard)는 별도의 작은 AmazonS3 오퍼 CSV에서 읽는다.
 */

import { createInterface } from 'node:readline';
import { Readable } from 'node:stream';
import type { EgressTier, Region, StorageSku, VmSku } from '../../src/lib/schema';

export const AWS_REGION: Record<Region, string> = {
  seoul: 'ap-northeast-2',
  'us-east': 'us-east-1',
};

/** 오퍼 파일의 From/To Location에 쓰이는 리전 표기 */
const AWS_LOCATION: Record<Region, string> = {
  seoul: 'Asia Pacific (Seoul)',
  'us-east': 'US East (N. Virginia)',
};

const offerCsvUrl = (offer: string, awsRegion: string) =>
  `https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/${offer}/current/${awsRegion}/index.csv`;

/** 따옴표 규칙("" 이스케이프 포함)을 처리하는 CSV 한 줄 파서 */
export function parseCsvLine(line: string): string[] {
  const fields: string[] = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        cur += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      fields.push(cur);
      cur = '';
    } else {
      cur += ch;
    }
  }
  fields.push(cur);
  return fields;
}

/** "4 GiB" | "3,904 GiB" → 숫자(GB). 파싱 불가면 null */
function parseMemoryGb(raw: string): number | null {
  const m = raw.replace(/,/g, '').match(/^([\d.]+) GiB$/);
  return m ? Number(m[1]) : null;
}

type Getter = (name: string) => string;

/** 메타데이터 줄들을 지나 헤더("SKU"로 시작)를 찾고, 이후 각 데이터 행에 getter를 넘긴다 */
async function scanOfferCsv(
  lines: AsyncIterable<string> | Iterable<string>,
  onRow: (get: Getter, preInstalledKey: string | null) => void,
): Promise<void> {
  let col: Record<string, number> | null = null;
  let preInstalledKey: string | null = null;

  for await (const line of lines) {
    if (!line) continue;
    if (!col) {
      const fields = parseCsvLine(line);
      if (fields[0] === 'SKU') {
        col = Object.fromEntries(fields.map((name, i) => [name, i]));
        preInstalledKey = fields.find((f) => /installed/i.test(f)) ?? null;
      }
      continue;
    }
    const cols = col;
    const f = parseCsvLine(line);
    onRow((name) => f[cols[name]] ?? '', preInstalledKey);
  }

  if (!col) throw new Error('AWS CSV에서 헤더 행(SKU로 시작)을 찾지 못했습니다 — 형식 변경 의심');
}

export interface AwsEc2Offer {
  vms: VmSku[];
  storage: StorageSku[]; // gp3 (block-ssd)
}

/**
 * EC2 오퍼 CSV 단일 패스 → VM + gp3.
 * VM 필터: Linux 온디맨드 / 공유 테넌시 / 실사용(Used) / 현세대 / 사전 설치 SW 없음
 *          / x86만(ARM·Graviton 제외, 사용자 결정) / GPU 없음 / 베어메탈 제외
 */
export async function parseEc2OfferCsv(
  lines: AsyncIterable<string> | Iterable<string>,
  region: Region,
): Promise<AwsEc2Offer> {
  const byType = new Map<string, VmSku>();
  let gp3PerGbMonth: number | null = null;

  await scanOfferCsv(lines, (get, preInstalledKey) => {
    if (get('TermType') !== 'OnDemand' || get('Currency') !== 'USD') return;
    const family = get('Product Family');

    if (family === 'Compute Instance') {
      if (get('Operating System') !== 'Linux') return;
      if (get('Tenancy') !== 'Shared') return;
      if (get('CapacityStatus') !== 'Used') return;
      if (get('License Model') !== 'No License required') return;
      if (get('Current Generation') !== 'Yes') return;
      if (preInstalledKey && get(preInstalledKey) !== 'NA') return;
      if (get('Unit') !== 'Hrs') return;

      const gpu = get('GPU');
      if (gpu !== '' && gpu !== '0') return;
      if (/graviton/i.test(get('Physical Processor'))) return;
      if (/arm/i.test(get('Processor Architecture'))) return;

      const instanceType = get('Instance Type');
      if (!instanceType || instanceType.includes('.metal')) return;

      const price = Number(get('PricePerUnit'));
      const vcpu = Number(get('vCPU'));
      const ramGb = parseMemoryGb(get('Memory'));
      if (!(price > 0) || !(vcpu > 0) || ramGb === null) return;

      const fam = instanceType.split('.')[0];
      const sku: VmSku = {
        provider: 'aws',
        region,
        sku: instanceType,
        vcpu,
        ramGb,
        burstable: /^t\d/.test(fam),
        generation: fam,
        pricePerHour: +price.toFixed(6),
      };
      const dup = byType.get(instanceType);
      if (dup && dup.pricePerHour !== sku.pricePerHour) {
        console.warn(`⚠ aws ${instanceType} 가격 중복 (${dup.pricePerHour} vs ${sku.pricePerHour}) — 먼저 온 값 유지`);
        return;
      }
      byType.set(instanceType, sku);
      return;
    }

    if (family === 'Storage') {
      if (get('Volume API Name') !== 'gp3') return;
      if (get('Unit') !== 'GB-Mo') return;
      const price = Number(get('PricePerUnit'));
      if (price > 0 && gp3PerGbMonth === null) gp3PerGbMonth = +price.toFixed(6);
    }
  });

  return {
    vms: [...byType.values()].sort((a, b) => a.sku.localeCompare(b.sku)),
    storage:
      gp3PerGbMonth !== null
        ? [{ provider: 'aws', region, kind: 'block-ssd', pricePerGbMonth: gp3PerGbMonth }]
        : [],
  };
}

/**
 * AWSDataTransfer 오퍼 CSV → 인터넷 egress 구간 요금.
 * - 리전 행: From=리전, To=External, Transfer Type='AWS Outbound' (Accelerated 변형은 다른 값이라 자연 제외)
 * - 무료 행: From='Global' 0~100GB $0 (전 서비스 합산 글로벌 무료분)
 * 리전 구간은 "무료분 초과 후" 사용량 기준이므로 절대 사용량으로 +freeGb 시프트해 정규화한다.
 */
export async function parseDataTransferCsv(
  lines: AsyncIterable<string> | Iterable<string>,
  region: Region,
): Promise<EgressTier | null> {
  const ranges: { start: number; end: number | null; pricePerGb: number }[] = [];
  let freeGb = 0;

  await scanOfferCsv(lines, (get) => {
    if (get('TermType') !== 'OnDemand' || get('Currency') !== 'USD') return;
    if (get('Product Family') !== 'Data Transfer') return;
    if (get('Transfer Type') !== 'AWS Outbound') return;
    if (get('To Location') !== 'External') return;
    if (get('Unit') !== 'GB') return;

    const from = get('From Location');
    const price = Number(get('PricePerUnit'));
    const endRaw = get('EndingRange');
    const end = endRaw === 'Inf' ? null : Number(endRaw);

    if (from === 'Global' && price === 0 && end !== null) {
      freeGb = Math.max(freeGb, end);
      return;
    }
    if (from !== AWS_LOCATION[region]) return;
    ranges.push({ start: Number(get('StartingRange')), end, pricePerGb: +price.toFixed(6) });
  });

  if (ranges.length === 0) return null;
  ranges.sort((a, b) => a.start - b.start);

  const tiers = [
    { upToGb: freeGb, pricePerGb: 0 },
    ...ranges.map((r) => ({ upToGb: r.end === null ? null : r.end + freeGb, pricePerGb: r.pricePerGb })),
  ];
  return { provider: 'aws', region, freeGb, tiers };
}

/** S3 오퍼 CSV → Standard 스토리지 첫 구간(0~50TB) 단가 */
export async function parseS3OfferCsv(
  lines: AsyncIterable<string> | Iterable<string>,
  region: Region,
): Promise<StorageSku | null> {
  let price: number | null = null;

  await scanOfferCsv(lines, (get) => {
    if (get('TermType') !== 'OnDemand' || get('Currency') !== 'USD') return;
    if (get('Product Family') !== 'Storage') return;
    if (get('Volume Type') !== 'Standard') return;
    if (get('Unit') !== 'GB-Mo') return;
    if (Number(get('StartingRange')) !== 0) return;
    const p = Number(get('PricePerUnit'));
    if (p > 0 && price === null) price = +p.toFixed(6);
  });

  return price !== null ? { provider: 'aws', region, kind: 'object-standard', pricePerGbMonth: price } : null;
}

async function streamOffer(offer: string, awsRegion: string) {
  const res = await fetch(offerCsvUrl(offer, awsRegion));
  if (!res.ok || !res.body) throw new Error(`AWS Price List API 오류 ${res.status} (${offer}/${awsRegion})`);
  return createInterface({ input: Readable.fromWeb(res.body as never), crlfDelay: Infinity });
}

export async function collectAws(
  region: Region,
): Promise<{ vms: VmSku[]; storage: StorageSku[]; egress: EgressTier | null }> {
  const awsRegion = AWS_REGION[region];
  const ec2 = await parseEc2OfferCsv(await streamOffer('AmazonEC2', awsRegion), region);
  const s3 = await parseS3OfferCsv(await streamOffer('AmazonS3', awsRegion), region);
  const egress = await parseDataTransferCsv(await streamOffer('AWSDataTransfer', awsRegion), region);
  return { vms: ec2.vms, storage: s3 ? [...ec2.storage, s3] : ec2.storage, egress };
}
