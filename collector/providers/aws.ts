/**
 * AWS 수집기 — Price List Bulk API의 리전별 오퍼 CSV를 스트리밍 파싱한다.
 *
 * JSON 오퍼 파일은 us-east-1 기준 457MB로 V8 문자열 한계에 근접해 통파싱이
 * 불가능하다 → CSV(288MB)를 라인 단위로 스트리밍해 상수 메모리로 처리.
 * AWS는 GCP와 달리 인스턴스 통가격 + vCPU/RAM 스펙이 모두 들어있어
 * 정적 카탈로그가 필요 없다.
 */

import { createInterface } from 'node:readline';
import { Readable } from 'node:stream';
import type { Region, VmSku } from '../../src/lib/schema';

export const AWS_REGION: Record<Region, string> = {
  seoul: 'ap-northeast-2',
  'us-east': 'us-east-1',
};

const offerCsvUrl = (awsRegion: string) =>
  `https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonEC2/current/${awsRegion}/index.csv`;

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

/**
 * CSV 라인 이터러블 → VmSku[].
 * 필터: Linux 온디맨드 / 공유 테넌시 / 실사용(Used) / 현세대 / 사전 설치 SW 없음
 *       / x86만(ARM·Graviton 제외, 사용자 결정) / GPU 없음 / 베어메탈 제외
 */
export async function parseAwsVmCsv(
  lines: AsyncIterable<string> | Iterable<string>,
  region: Region,
): Promise<VmSku[]> {
  let col: Record<string, number> | null = null;
  let preInstalledKey: string | null = null;
  const byType = new Map<string, VmSku>();

  for await (const line of lines) {
    if (!line) continue;
    if (!col) {
      // 메타데이터 줄들("FormatVersion",... )을 지나 "SKU"로 시작하는 헤더를 찾는다
      const fields = parseCsvLine(line);
      if (fields[0] === 'SKU') {
        col = Object.fromEntries(fields.map((name, i) => [name, i]));
        preInstalledKey = fields.find((f) => /installed/i.test(f)) ?? null;
      }
      continue;
    }

    const cols = col;
    const f = parseCsvLine(line);
    const get = (name: string) => f[cols[name]] ?? '';

    if (get('TermType') !== 'OnDemand') continue;
    if (get('Product Family') !== 'Compute Instance') continue;
    if (get('Operating System') !== 'Linux') continue;
    if (get('Tenancy') !== 'Shared') continue;
    if (get('CapacityStatus') !== 'Used') continue;
    if (get('License Model') !== 'No License required') continue;
    if (get('Current Generation') !== 'Yes') continue;
    if (preInstalledKey && get(preInstalledKey) !== 'NA') continue;
    if (get('Unit') !== 'Hrs' || get('Currency') !== 'USD') continue;

    const gpu = get('GPU');
    if (gpu !== '' && gpu !== '0') continue;
    if (/graviton/i.test(get('Physical Processor'))) continue;
    if (/arm/i.test(get('Processor Architecture'))) continue;

    const instanceType = get('Instance Type');
    if (!instanceType || instanceType.includes('.metal')) continue;

    const price = Number(get('PricePerUnit'));
    const vcpu = Number(get('vCPU'));
    const ramGb = parseMemoryGb(get('Memory'));
    if (!(price > 0) || !(vcpu > 0) || ramGb === null) continue;

    const family = instanceType.split('.')[0];
    const sku: VmSku = {
      provider: 'aws',
      region,
      sku: instanceType,
      vcpu,
      ramGb,
      burstable: /^t\d/.test(family),
      generation: family,
      pricePerHour: +price.toFixed(6),
    };

    const dup = byType.get(instanceType);
    if (dup && dup.pricePerHour !== sku.pricePerHour) {
      console.warn(`⚠ aws ${instanceType} 가격 중복 (${dup.pricePerHour} vs ${sku.pricePerHour}) — 먼저 온 값 유지`);
      continue;
    }
    byType.set(instanceType, sku);
  }

  if (!col) throw new Error('AWS CSV에서 헤더 행(SKU로 시작)을 찾지 못했습니다 — 형식 변경 의심');
  return [...byType.values()].sort((a, b) => a.sku.localeCompare(b.sku));
}

export async function collectAwsVm(region: Region): Promise<VmSku[]> {
  const res = await fetch(offerCsvUrl(AWS_REGION[region]));
  if (!res.ok || !res.body) {
    throw new Error(`AWS Price List API 오류 ${res.status}`);
  }
  const lines = createInterface({ input: Readable.fromWeb(res.body as never), crlfDelay: Infinity });
  return parseAwsVmCsv(lines, region);
}
