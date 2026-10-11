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
import type {
  Arch,
  DbEngine,
  DbEnginePricing,
  DbInstance,
  DbPrice,
  EgressTier,
  K8sClusterPrice,
  LbPrice,
  NatPrice,
  Region,
  StorageSku,
  VmSku,
} from '../../src/lib/schema';

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
  nat: NatPrice | null;
}

/**
 * EC2 오퍼 CSV 단일 패스 → VM + gp3 + NAT 게이트웨이.
 * NAT: 기존 NAT 게이트웨이 usageType("{리전접두}-NatGateway-Hours/Bytes"). Regional NAT 변형은 제외.
 * us-east-1은 usageType에 리전 접두사가 없다(예: "NatGateway-Hours") — 접두사는 선택, 형태는 "대문자+숫자-"로 한정.
 * VM 필터: Linux 온디맨드 / 공유 테넌시 / 실사용(Used) / 현세대 / 사전 설치 SW 없음
 *          / x86·ARM(Graviton) 모두 — arch 태깅 / GPU 없음 / 베어메탈 제외
 */
export async function parseEc2OfferCsv(
  lines: AsyncIterable<string> | Iterable<string>,
  region: Region,
): Promise<AwsEc2Offer> {
  const byType = new Map<string, VmSku>();
  let gp3PerGbMonth: number | null = null;
  let natPerHour: number | null = null;
  let natPerGb: number | null = null;

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

      const instanceType = get('Instance Type');
      if (!instanceType || instanceType.includes('.metal')) return;

      const price = Number(get('PricePerUnit'));
      const vcpu = Number(get('vCPU'));
      const ramGb = parseMemoryGb(get('Memory'));
      if (!(price > 0) || !(vcpu > 0) || ramGb === null) return;

      const arch: Arch =
        /graviton/i.test(get('Physical Processor')) || /arm/i.test(get('Processor Architecture')) ? 'arm' : 'x86';
      const fam = instanceType.split('.')[0];
      const sku: VmSku = {
        provider: 'aws',
        region,
        sku: instanceType,
        vcpu,
        ramGb,
        burstable: /^t\d/.test(fam),
        arch,
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
      return;
    }

    if (family === 'NAT Gateway') {
      if (get('Location') !== AWS_LOCATION[region]) return;
      const m = get('usageType').match(/^(?:[A-Z]+\d-)?NatGateway-(Hours|Bytes)$/);
      const price = Number(get('PricePerUnit'));
      if (!m || !(price > 0)) return;
      if (m[1] === 'Hours' && natPerHour === null) natPerHour = +price.toFixed(6);
      if (m[1] === 'Bytes' && natPerGb === null) natPerGb = +price.toFixed(6);
    }
  });

  return {
    vms: [...byType.values()].sort((a, b) => a.sku.localeCompare(b.sku)),
    storage:
      gp3PerGbMonth !== null
        ? [{ provider: 'aws', region, kind: 'block-ssd', pricePerGbMonth: gp3PerGbMonth }]
        : [],
    nat:
      natPerHour !== null && natPerGb !== null
        ? { provider: 'aws', region, hourly: { per: 'gateway', usd: natPerHour }, perGb: natPerGb }
        : null,
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

/**
 * AmazonEKS 오퍼 CSV → 표준 클러스터 시간당 요금 (usageType "{리전접두}-AmazonEKS-Hours:perCluster").
 * Outposts 로컬 클러스터·연장 지원·Provisioned 티어는 usageType이 달라 자연 제외.
 */
export async function parseEksCsv(
  lines: AsyncIterable<string> | Iterable<string>,
  region: Region,
): Promise<K8sClusterPrice | null> {
  let price: number | null = null;

  await scanOfferCsv(lines, (get) => {
    if (get('TermType') !== 'OnDemand' || get('Currency') !== 'USD') return;
    if (get('Location') !== AWS_LOCATION[region]) return;
    if (!/^[A-Z0-9]+-AmazonEKS-Hours:perCluster$/.test(get('usageType'))) return;
    const p = Number(get('PricePerUnit'));
    if (p > 0 && price === null) price = +p.toFixed(6);
  });

  return price !== null ? { provider: 'aws', region, clusterPerHour: price } : null;
}

/**
 * AWSELB 오퍼 CSV → ALB 시간당 + LCU-시간당. LCU는 "시간당 1GB 처리"라 GB당 단가로 쓴다.
 * Trust Store("TS-")·Outposts·예약 LCU는 usageType이 달라 자연 제외. us-east-1은 리전 접두사가 없다.
 */
export async function parseAlbCsv(
  lines: AsyncIterable<string> | Iterable<string>,
  region: Region,
): Promise<LbPrice | null> {
  let perHour: number | null = null;
  let perGb: number | null = null;

  await scanOfferCsv(lines, (get) => {
    if (get('TermType') !== 'OnDemand' || get('Currency') !== 'USD') return;
    if (get('Product Family') !== 'Load Balancer-Application') return;
    if (get('Location') !== AWS_LOCATION[region]) return;
    const m = get('usageType').match(/^(?:[A-Z]+\d-)?(LoadBalancerUsage|LCUUsage)$/);
    const price = Number(get('PricePerUnit'));
    if (!m || !(price > 0)) return;
    if (m[1] === 'LoadBalancerUsage' && perHour === null) perHour = +price.toFixed(6);
    if (m[1] === 'LCUUsage' && perGb === null) perGb = +price.toFixed(6);
  });

  return perHour !== null && perGb !== null ? { provider: 'aws', region, perHour, perGb } : null;
}

const RDS_ENGINES: Record<string, DbEngine> = { MySQL: 'mysql', PostgreSQL: 'postgres' };

/**
 * AmazonRDS 오퍼 CSV → 엔진별 인스턴스 클래스(단일·Multi-AZ 시간당) + gp3 스토리지(단일·Multi-AZ).
 * 필터: MySQL·PostgreSQL / 현세대 / Single-AZ·Multi-AZ(읽기 가능 대기 클러스터 제외) / 연장 지원 행 제외.
 * Multi-AZ 인스턴스 가격은 대기 서버를 포함한 값이다 (API가 별도 행으로 제공).
 */
export async function parseRdsCsv(
  lines: AsyncIterable<string> | Iterable<string>,
  region: Region,
): Promise<DbPrice | null> {
  type Acc = { instances: Map<string, DbInstance>; storage?: number; haStorage?: number };
  const acc: Record<DbEngine, Acc> = { mysql: { instances: new Map() }, postgres: { instances: new Map() } };

  await scanOfferCsv(lines, (get) => {
    if (get('TermType') !== 'OnDemand' || get('Currency') !== 'USD') return;
    if (get('Location') !== AWS_LOCATION[region]) return;
    const deploy = get('Deployment Option');
    if (deploy !== 'Single-AZ' && deploy !== 'Multi-AZ') return;
    const price = Number(get('PricePerUnit'));
    if (!(price > 0)) return;
    const family = get('Product Family');

    if (family === 'Database Instance') {
      const engine = RDS_ENGINES[get('Database Engine')];
      if (!engine || get('Current Generation') !== 'Yes' || get('Extended Support Pricing Year')) return;
      if (!/^(?:[A-Z]+\d-)?(InstanceUsage|Multi-AZUsage):db\./.test(get('usageType'))) return;
      const sku = get('Instance Type');
      const vcpu = Number(get('vCPU'));
      const ramGb = parseMemoryGb(get('Memory'));
      if (!(vcpu > 0) || ramGb === null) return;
      const inst = acc[engine].instances.get(sku) ?? {
        sku,
        vcpu,
        ramGb,
        burstable: /^db\.t\d/.test(sku),
        perHour: 0,
        haPerHour: null,
      };
      if (deploy === 'Single-AZ') inst.perHour = +price.toFixed(6);
      else inst.haPerHour = +price.toFixed(6);
      acc[engine].instances.set(sku, inst);
      return;
    }

    if (family === 'Database Storage' && get('Volume Type') === 'General Purpose-GP3' && get('Unit') === 'GB-Mo') {
      // 스토리지 행은 엔진별 또는 "Any" — 엔진별 값을 우선, 없으면 Any
      const engineName = get('Database Engine');
      const targets: DbEngine[] = engineName === 'Any' ? ['mysql', 'postgres'] : RDS_ENGINES[engineName] ? [RDS_ENGINES[engineName]] : [];
      for (const engine of targets) {
        const key = deploy === 'Single-AZ' ? 'storage' : 'haStorage';
        if (engineName !== 'Any' || acc[engine][key] === undefined) acc[engine][key] = +price.toFixed(6);
      }
    }
  });

  const build = (a: Acc): DbEnginePricing | null => {
    const instances = [...a.instances.values()].filter((i) => i.perHour > 0).sort((x, y) => x.sku.localeCompare(y.sku));
    if (instances.length === 0 || a.storage === undefined || a.haStorage === undefined) return null;
    return { instances, custom: null, storageGbMonth: a.storage, haStorageGbMonth: a.haStorage };
  };
  const engines = { mysql: build(acc.mysql), postgres: build(acc.postgres) };
  return engines.mysql || engines.postgres ? { provider: 'aws', region, engines } : null;
}

async function streamOffer(offer: string, awsRegion: string) {
  const res = await fetch(offerCsvUrl(offer, awsRegion));
  if (!res.ok || !res.body) throw new Error(`AWS Price List API 오류 ${res.status} (${offer}/${awsRegion})`);
  return createInterface({ input: Readable.fromWeb(res.body as never), crlfDelay: Infinity });
}

export async function collectAws(
  region: Region,
): Promise<{
  vms: VmSku[];
  storage: StorageSku[];
  egress: EgressTier | null;
  k8s: K8sClusterPrice | null;
  lb: LbPrice | null;
  nat: NatPrice | null;
  db: DbPrice | null;
}> {
  const awsRegion = AWS_REGION[region];
  const ec2 = await parseEc2OfferCsv(await streamOffer('AmazonEC2', awsRegion), region);
  const s3 = await parseS3OfferCsv(await streamOffer('AmazonS3', awsRegion), region);
  const egress = await parseDataTransferCsv(await streamOffer('AWSDataTransfer', awsRegion), region);
  const k8s = await parseEksCsv(await streamOffer('AmazonEKS', awsRegion), region);
  const lb = await parseAlbCsv(await streamOffer('AWSELB', awsRegion), region);
  const db = await parseRdsCsv(await streamOffer('AmazonRDS', awsRegion), region);
  return { vms: ec2.vms, storage: s3 ? [...ec2.storage, s3] : ec2.storage, egress, k8s, lb, nat: ec2.nat, db };
}
