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
  CacheNode,
  CommitPrices,
  CachePrice,
  CdnPrice,
  ContainerPrice,
  ContainerRate,
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
  Term,
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

const TERM_HOURS: Record<Term, number> = { '1y': 8760, '3y': 26280 };
const LEASE_TERM: Record<string, Term> = { '1yr': '1y', '3yr': '3y' };

/**
 * 예약(RI) 행 누적 → 기간별 시간당 실효가. Standard 클래스만(= EC2 Instance Savings Plans 요율과 같다).
 * 기간마다 "선결제 없음"을 쓰고, 없으면 "부분 선결제"(시간당 + 선결제액 ÷ 기간 시간)로 환산한다.
 * 키는 호출부가 정한다 (인스턴스 타입, RDS는 타입+배포 옵션 등).
 */
export class ReservedRates {
  private rows = new Map<string, Record<string, { hourly?: number; upfront?: number }>>();

  /** Reserved 행이면 누적하고 true, 아니면 false */
  add(key: string, get: Getter): boolean {
    if (get('TermType') !== 'Reserved') return false;
    const term = LEASE_TERM[get('LeaseContractLength')];
    const option = get('PurchaseOption');
    if (!term || get('OfferingClass') !== 'standard' || (option !== 'No Upfront' && option !== 'Partial Upfront')) return true;
    const byKey = this.rows.get(key) ?? {};
    const slot = (byKey[`${term}|${option}`] ??= {});
    const price = Number(get('PricePerUnit'));
    if (get('Unit') === 'Quantity') slot.upfront = price;
    else if (get('Unit') === 'Hrs') slot.hourly = price;
    this.rows.set(key, byKey);
    return true;
  }

  get(key: string): CommitPrices<number> | undefined {
    const byKey = this.rows.get(key);
    if (!byKey) return undefined;
    const out: CommitPrices<number> = {};
    for (const term of ['1y', '3y'] as const) {
      const none = byKey[`${term}|No Upfront`];
      const partial = byKey[`${term}|Partial Upfront`];
      const rate =
        none?.hourly !== undefined
          ? none.hourly
          : partial?.hourly !== undefined && partial.upfront !== undefined
            ? partial.hourly + partial.upfront / TERM_HOURS[term]
            : undefined;
      if (rate !== undefined && rate > 0) out[term] = +rate.toFixed(6);
    }
    return Object.keys(out).length > 0 ? out : undefined;
  }
}

/** 약정가가 정가보다 싸지 않으면 버린다 (데이터 이상 방어) */
function cheaperThan(onDemand: number, commit: CommitPrices<number> | undefined): CommitPrices<number> | undefined {
  if (!commit) return undefined;
  const out = Object.fromEntries(Object.entries(commit).filter(([, v]) => v < onDemand)) as CommitPrices<number>;
  return Object.keys(out).length > 0 ? out : undefined;
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

const SP_TERM: Record<string, Term> = { '1 year': '1y', '3 year': '3y' };

/** Fargate 단가 usageType → (아키텍처, 항목). Windows·임시 스토리지 제외. us-east-1은 리전 접두사 없음 */
function fargateKey(usageType: string): [Arch, keyof ContainerRate] | null {
  const m = usageType.match(/^(?:[A-Z]+\d-)?Fargate-(ARM-)?(vCPU-Hours:perCPU|GB-Hours)$/);
  return m ? [m[1] ? 'arm' : 'x86', m[2] === 'GB-Hours' ? 'gbPerHour' : 'vcpuPerHour'] : null;
}

export interface SavingsPlanRates {
  /** 인스턴스 타입 → EC2 Instance SP 요율 */
  ec2: Map<string, CommitPrices<number>>;
  /** Fargate — Compute SP 요율 (Fargate는 EC2 Instance SP 대상이 아니라 유연형 Compute SP뿐) */
  fargate: Partial<Record<Arch, CommitPrices<Partial<ContainerRate>>>>;
}

/**
 * Savings Plans 오퍼 CSV(리전당 ~190MB, 한 번만 스트리밍) → 선결제 없음 시간당 요율.
 * - EC2: EC2 Instance Savings Plans, Linux 공유 테넌시. Standard RI와 같은 요율이고 8세대 등 RI가 없는 신형까지 덮는다
 * - Fargate: Compute Savings Plans (Fargate에 적용되는 유일한 약정)
 * 요율은 이미 시간당 실효가라 선결제 환산이 필요 없다. us-east-1은 usageType에 리전 접두사가 없다.
 */
export async function parseSavingsPlanCsv(lines: AsyncIterable<string> | Iterable<string>): Promise<SavingsPlanRates> {
  const out: SavingsPlanRates = { ec2: new Map(), fargate: {} };
  await scanOfferCsv(lines, (get) => {
    if (get('PurchaseOption') !== 'No Upfront' || get('Currency') !== 'USD') return;
    const term = SP_TERM[`${get('LeaseContractLength')} ${get('LeaseContractLengthUnit')}`];
    const price = Number(get('DiscountedRate'));
    if (!term || !(price > 0)) return;
    const family = get('Product Family');

    if (family === 'EC2InstanceSavingsPlans') {
      if (get('DiscountedOperation') !== 'RunInstances' || !/^(?:[A-Z]+\d-)?BoxUsage:/.test(get('DiscountedUsageType'))) return;
      const entry = out.ec2.get(get('DiscountedInstanceType')) ?? {};
      entry[term] ??= +price.toFixed(6);
      out.ec2.set(get('DiscountedInstanceType'), entry);
      return;
    }
    if (family === 'ComputeSavingsPlans') {
      const key = fargateKey(get('DiscountedUsageType'));
      if (!key) return;
      ((out.fargate[key[0]] ??= {})[term] ??= {})[key[1]] ??= +price.toFixed(6);
    }
  });
  return out;
}

/**
 * AmazonECS 오퍼 CSV → Fargate Linux vCPU·GB 시간 단가 (x86·ARM). 약정은 SP 파일에서 붙인다.
 * ECS Managed Instances·Windows·임시 스토리지(20GB 기본 포함분 초과 시) 행은 제외.
 */
export async function parseFargateCsv(
  lines: AsyncIterable<string> | Iterable<string>,
  region: Region,
): Promise<ContainerPrice | null> {
  const acc: Partial<Record<Arch, Partial<ContainerRate>>> = {};
  await scanOfferCsv(lines, (get) => {
    if (get('TermType') !== 'OnDemand' || get('Currency') !== 'USD') return;
    if (get('Location') !== AWS_LOCATION[region]) return;
    const key = fargateKey(get('usageType'));
    const price = Number(get('PricePerUnit'));
    if (key && price > 0) (acc[key[0]] ??= {})[key[1]] ??= +price.toFixed(6);
  });
  const rates: ContainerPrice['rates'] = {};
  for (const arch of ['x86', 'arm'] as const) {
    const r = acc[arch];
    if (r?.vcpuPerHour !== undefined && r.gbPerHour !== undefined) rates[arch] = { vcpuPerHour: r.vcpuPerHour, gbPerHour: r.gbPerHour };
  }
  return rates.x86 ? { provider: 'aws', region, rates } : null;
}

/** SP 요율을 Fargate 단가에 붙인다 — vCPU·GB 둘 다 있고 정가보다 싼 기간만 */
export function attachFargateCommit(price: ContainerPrice | null, sp: SavingsPlanRates['fargate']): void {
  if (!price) return;
  for (const [arch, rate] of Object.entries(price.rates) as [Arch, NonNullable<ContainerPrice['rates']['x86']>][]) {
    const commit: CommitPrices<ContainerRate> = {};
    for (const term of ['1y', '3y'] as const) {
      const c = sp[arch]?.[term];
      if (c?.vcpuPerHour !== undefined && c.gbPerHour !== undefined && c.vcpuPerHour < rate.vcpuPerHour && c.gbPerHour < rate.gbPerHour) {
        commit[term] = { vcpuPerHour: c.vcpuPerHour, gbPerHour: c.gbPerHour };
      }
    }
    if (Object.keys(commit).length > 0) rate.commit = commit;
  }
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
 * 약정가: 같은 필터의 Reserved 행 — 배포 옵션별 RI가 따로 있다 (ReservedRates).
 */
export async function parseRdsCsv(
  lines: AsyncIterable<string> | Iterable<string>,
  region: Region,
): Promise<DbPrice | null> {
  type Acc = { instances: Map<string, DbInstance>; storage?: number; haStorage?: number };
  const acc: Record<DbEngine, Acc> = { mysql: { instances: new Map() }, postgres: { instances: new Map() } };
  const reserved = new ReservedRates();

  await scanOfferCsv(lines, (get) => {
    if (get('Currency') !== 'USD') return;
    if (get('Location') !== AWS_LOCATION[region]) return;
    const deploy = get('Deployment Option');
    if (deploy !== 'Single-AZ' && deploy !== 'Multi-AZ') return;
    const family = get('Product Family');
    if (get('TermType') !== 'OnDemand' && !(family === 'Database Instance' && get('TermType') === 'Reserved')) return;
    const price = Number(get('PricePerUnit'));

    if (family === 'Database Instance') {
      const engine = RDS_ENGINES[get('Database Engine')];
      if (!engine || get('Current Generation') !== 'Yes' || get('Extended Support Pricing Year')) return;
      if (!/^(?:[A-Z]+\d-)?(InstanceUsage|Multi-AZUsage):db\./.test(get('usageType'))) return;
      const sku = get('Instance Type');
      if (reserved.add(`${engine}|${sku}|${deploy}`, get)) return;
      if (!(price > 0)) return;
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

    if (!(price > 0)) return;
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

  const build = (engine: DbEngine): DbEnginePricing | null => {
    const a = acc[engine];
    const instances = [...a.instances.values()].filter((i) => i.perHour > 0).sort((x, y) => x.sku.localeCompare(y.sku));
    for (const inst of instances) {
      const single = cheaperThan(inst.perHour, reserved.get(`${engine}|${inst.sku}|Single-AZ`));
      const ha = inst.haPerHour === null ? undefined : cheaperThan(inst.haPerHour, reserved.get(`${engine}|${inst.sku}|Multi-AZ`));
      const commit: DbInstance['commit'] = {};
      for (const term of ['1y', '3y'] as const) {
        if (single?.[term] !== undefined) commit[term] = { perHour: single[term]!, haPerHour: ha?.[term] ?? null };
      }
      if (Object.keys(commit).length > 0) inst.commit = commit;
    }
    if (instances.length === 0 || a.storage === undefined || a.haStorage === undefined) return null;
    return { instances, custom: null, storageGbMonth: a.storage, haStorageGbMonth: a.haStorage };
  };
  const engines = { mysql: build('mysql'), postgres: build('postgres') };
  return engines.mysql || engines.postgres ? { provider: 'aws', region, engines } : null;
}

/**
 * AmazonElastiCache 오퍼 CSV → Valkey 노드 시간당. 이중화 = 주 + 복제 노드(같은 타입) 2개.
 * Valkey: Redis 호환이고 Redis OSS보다 저렴한 AWS 기본 엔진 (methodology에 고지).
 * 연장 지원·SyncDurability 행은 usageType이 달라 자연 제외. us-east-1은 리전 접두사 없음.
 * 약정가: Valkey 예약 노드(ReservedRates), 이중화는 노드 2개분.
 */
export async function parseElastiCacheCsv(
  lines: AsyncIterable<string> | Iterable<string>,
  region: Region,
): Promise<CachePrice | null> {
  const nodes = new Map<string, CacheNode>();
  const reserved = new ReservedRates();

  await scanOfferCsv(lines, (get) => {
    if (get('Currency') !== 'USD') return;
    if (get('Product Family') !== 'Cache Instance' || get('Cache Engine') !== 'Valkey') return;
    if (get('Location') !== AWS_LOCATION[region]) return;
    if (!/^(?:[A-Z]+\d-)?NodeUsage:cache\./.test(get('usageType'))) return;
    const sku = get('Instance Type');
    if (reserved.add(sku, get)) return;
    if (get('TermType') !== 'OnDemand') return;
    const price = Number(get('PricePerUnit'));
    const memoryGb = parseMemoryGb(get('Memory'));
    if (!(price > 0) || memoryGb === null || nodes.has(sku)) return;
    nodes.set(sku, {
      sku,
      memoryGb,
      burstable: /^cache\.t\d/.test(sku),
      perHour: +price.toFixed(6),
      haPerHour: +(price * 2).toFixed(6),
    });
  });

  if (nodes.size === 0) return null;
  for (const node of nodes.values()) {
    const rates = cheaperThan(node.perHour, reserved.get(node.sku));
    if (!rates) continue;
    node.commit = Object.fromEntries(
      Object.entries(rates).map(([term, perHour]) => [term, { perHour, haPerHour: +(perHour * 2).toFixed(6) }]),
    );
  }
  return {
    provider: 'aws',
    region,
    engine: 'Valkey',
    nodes: [...nodes.values()].sort((a, b) => a.sku.localeCompare(b.sku)),
    gbTiers: null,
  };
}

/** CloudFront 시청자 지역 요금 접두사 — 리전과 같은 지역 가정 (한국은 Asia Pacific 구간) */
const CLOUDFRONT_ZONE: Record<Region, string> = { seoul: 'AP', 'us-east': 'US' };

/**
 * CloudFront 정액 요금제 — 가격 API에 없어 공식 문서값
 * (docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/flat-rate-pricing-plan.html, 2026-10-17 확인).
 * 배포당 월정액, 한도 초과 요금은 없지만 지속 초과 시 성능 조정 → 한도 안 요금제만 고른다.
 */
const CLOUDFRONT_PLANS: CdnPrice['plans'] = [
  { name: 'Free', monthlyUsd: 0, maxGb: 100, maxRequests: 1_000_000 },
  { name: 'Pro', monthlyUsd: 15, maxGb: 50 * 1024, maxRequests: 10_000_000 },
  { name: 'Business', monthlyUsd: 200, maxGb: 50 * 1024, maxRequests: 125_000_000 },
  { name: 'Premium', monthlyUsd: 1000, maxGb: 50 * 1024, maxRequests: 500_000_000 },
];

/**
 * AmazonCloudFront 글로벌 오퍼 CSV → 시청자 지역(리전과 같은 지역)의 인터넷 전송 GB 구간 + HTTPS 요청 단가 + 정액 요금제.
 * 오리진 방향 전송(OBytes)·Proxy·FLE 요청은 제외. AWS 오리진 → CloudFront 전송은 무료라 캐시 채움 0.
 */
export async function parseCloudFrontCsv(lines: AsyncIterable<string> | Iterable<string>, region: Region): Promise<CdnPrice | null> {
  const zone = CLOUDFRONT_ZONE[region];
  const tiers: { start: number; end: number | null; price: number }[] = [];
  let perRequest: number | null = null;
  await scanOfferCsv(lines, (get) => {
    if (get('TermType') !== 'OnDemand' || get('Currency') !== 'USD') return;
    const price = Number(get('PricePerUnit'));
    if (get('usageType') === `${zone}-DataTransfer-Out-Bytes` && get('Unit') === 'GB') {
      tiers.push({ start: Number(get('StartingRange')), end: get('EndingRange') === 'Inf' ? null : Number(get('EndingRange')), price: +price.toFixed(6) });
    } else if (get('usageType') === `${zone}-Requests-Tier2-HTTPS` && price > 0) {
      perRequest ??= price;
    }
  });
  if (tiers.length === 0 || perRequest === null) return null;
  tiers.sort((a, b) => a.start - b.start);
  return {
    provider: 'aws',
    region,
    gbTiers: tiers.map((t) => ({ upTo: t.end, price: t.price })),
    requestTiers: [{ upTo: null, price: +(perRequest * 10_000).toFixed(6) }],
    monthlyBase: 0,
    fillPerGb: 0,
    plans: CLOUDFRONT_PLANS,
  };
}

async function streamCsv(url: string) {
  const res = await fetch(url);
  if (!res.ok || !res.body) throw new Error(`AWS Price List API 오류 ${res.status} (${url})`);
  return createInterface({ input: Readable.fromWeb(res.body as never), crlfDelay: Infinity });
}

const streamOffer = (offer: string, awsRegion: string) => streamCsv(offerCsvUrl(offer, awsRegion));

/** 리전 구분이 없는 글로벌 오퍼 (CloudFront) */
const streamGlobalOffer = (offer: string) => streamCsv(`https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/${offer}/current/index.csv`);

/** Savings Plans 오퍼는 "current" 경로가 없어 리전 인덱스에서 버전 경로(.json)를 찾아 .csv로 바꾼다 */
async function streamSavingsPlans(awsRegion: string) {
  const base = 'https://pricing.us-east-1.amazonaws.com';
  const res = await fetch(`${base}/savingsPlan/v1.0/aws/AWSComputeSavingsPlan/current/region_index.json`);
  if (!res.ok) throw new Error(`AWS Savings Plans 인덱스 오류 ${res.status}`);
  const { regions } = (await res.json()) as { regions: { regionCode: string; versionUrl: string }[] };
  const versionUrl = regions.find((r) => r.regionCode === awsRegion)?.versionUrl;
  if (!versionUrl) throw new Error(`AWS Savings Plans 인덱스에 ${awsRegion} 없음`);
  return streamCsv(base + versionUrl.replace(/\.json$/, '.csv'));
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
  cache: CachePrice | null;
  container: ContainerPrice | null;
  cdn: CdnPrice | null;
}> {
  const awsRegion = AWS_REGION[region];
  const ec2 = await parseEc2OfferCsv(await streamOffer('AmazonEC2', awsRegion), region);
  const sp = await parseSavingsPlanCsv(await streamSavingsPlans(awsRegion));
  for (const vm of ec2.vms) {
    const commit = cheaperThan(vm.pricePerHour, sp.ec2.get(vm.sku));
    if (commit) vm.commit = commit;
  }
  const container = await parseFargateCsv(await streamOffer('AmazonECS', awsRegion), region);
  attachFargateCommit(container, sp.fargate);
  const cdn = await parseCloudFrontCsv(await streamGlobalOffer('AmazonCloudFront'), region);
  const s3 = await parseS3OfferCsv(await streamOffer('AmazonS3', awsRegion), region);
  const egress = await parseDataTransferCsv(await streamOffer('AWSDataTransfer', awsRegion), region);
  const k8s = await parseEksCsv(await streamOffer('AmazonEKS', awsRegion), region);
  const lb = await parseAlbCsv(await streamOffer('AWSELB', awsRegion), region);
  const db = await parseRdsCsv(await streamOffer('AmazonRDS', awsRegion), region);
  const cache = await parseElastiCacheCsv(await streamOffer('AmazonElastiCache', awsRegion), region);
  return { vms: ec2.vms, storage: s3 ? [...ec2.storage, s3] : ec2.storage, egress, k8s, lb, nat: ec2.nat, db, cache, container, cdn };
}
