/**
 * OCI 수집기 — 공개 가격 목록 API(인증 불필요) 한 번 호출로 전 리전 요금을 만든다.
 * OCI는 리전과 무관한 단일가라 리전별 차이는 인터넷 트래픽(지역 구간)뿐이다.
 *
 * 가격 목록엔 단가(OCPU·GB·ECPU 시간당 등)만 있고 셰이프 규칙은 없다 → Flex 셰이프 한도·DB/캐시 셰이프는 문서값 상수.
 * Flex 셰이프(크기 자유 선택)는 대표 사이즈 격자(vCPU × GB/vCPU 비율)로 펼쳐 기존 VM·DB 매칭을 그대로 쓴다.
 * 약정 상품 없음(계정 단위 크레딧뿐) → commit 없음. 버스트 셰이프(기준 사용률 할인)는 미수록 — methodology 고지.
 *
 * 파이프라인: fetchOciPriceList → buildOciSnapshot(리전별)
 */

import type {
  Arch,
  CachePrice,
  ContainerPrice,
  DbEnginePricing,
  DbInstance,
  DbPrice,
  EgressTier,
  K8sClusterPrice,
  LbPrice,
  LogPrice,
  NatPrice,
  Region,
  StorageSku,
  VmSku,
} from '../../src/lib/schema';
import type { Snapshot } from '../validate';

const PRICE_LIST_URL = 'https://apexapps.oracle.com/pls/apex/cetools/api/v1/products/?currencyCode=USD';

/** 가격 목록 품목 — 우리가 쓰는 필드만 */
export interface OciItem {
  partNumber: string;
  displayName: string;
  currencyCodeLocalizations: { currencyCode: string; prices: { model: string; value: number; rangeMin?: number; rangeMax?: number }[] }[];
}

export async function fetchOciPriceList(): Promise<OciItem[]> {
  const res = await fetch(PRICE_LIST_URL);
  if (!res.ok) throw new Error(`OCI 가격 목록 응답 ${res.status}`);
  const body = (await res.json()) as { items?: OciItem[] };
  if (!body.items?.length) throw new Error('OCI 가격 목록이 비어 있음');
  return body.items;
}

/** 품목 코드(partNumber) — 이름보다 안정적. 2026-10-17 가격 목록에서 확인 */
const PART = {
  e4Ocpu: 'B93113',
  e4Mem: 'B93114',
  e5Ocpu: 'B97384',
  e5Mem: 'B97385',
  x9Ocpu: 'B94176',
  x9Mem: 'B94177',
  a1Ocpu: 'B93297',
  a1Mem: 'B93298',
  blockStorage: 'B91961',
  blockVpu: 'B91962',
  objectStorage: 'B91628',
  egressAmericasEurope: 'B88327',
  egressApac: 'B93455',
  lbBase: 'B93030',
  lbBandwidth: 'B93031',
  okeEnhanced: 'B96545',
  mysqlEcpu: 'B108030',
  mysqlStorage: 'B92426',
  pgOcpu: 'B99060',
  pgStorage: 'B99062',
  cacheLow: 'B98217',
  cacheHigh: 'B99591',
  logStorage: 'B92593',
} as const;

type PriceTier = { value: number; rangeMin?: number; rangeMax?: number };

function tiersOf(items: OciItem[], part: string): PriceTier[] {
  const item = items.find((i) => i.partNumber === part);
  const tiers = item?.currencyCodeLocalizations.find((c) => c.currencyCode === 'USD')?.prices.filter((p) => p.model === 'PAY_AS_YOU_GO');
  if (!tiers?.length) throw new Error(`OCI 품목 ${part} 단가 없음`);
  return tiers;
}

/** 단가 — 무료 구간이 붙은 품목(A1·오브젝트·로그 등)은 마지막(유료) 구간. 계정당 무료분 미반영 원칙 */
function unitPrice(items: OciItem[], part: string): number {
  return tiersOf(items, part).at(-1)!.value;
}

const r6 = (x: number) => +x.toFixed(6);

/**
 * Flex VM 셰이프 — docs.oracle.com/iaas/Content/Compute/References/computeshapes.htm (2026-10-17 확인).
 * OCPU당 메모리 최대 64GB. x86은 1 OCPU = 2 vCPU, A1은 1 OCPU = 1 vCPU.
 * E6·A2·A4는 리전별 제공 여부를 공개 자료로 확인할 수 없어 제외 (가용성이 넓은 세대만).
 */
const VM_SERIES = [
  { family: 'e4', shape: 'VM.Standard.E4.Flex', arch: 'x86', ocpu: PART.e4Ocpu, mem: PART.e4Mem, vcpuPerOcpu: 2, maxOcpu: 64, maxGb: 1024 },
  { family: 'e5', shape: 'VM.Standard.E5.Flex', arch: 'x86', ocpu: PART.e5Ocpu, mem: PART.e5Mem, vcpuPerOcpu: 2, maxOcpu: 126, maxGb: 1024 },
  { family: 'x9', shape: 'VM.Standard3.Flex', arch: 'x86', ocpu: PART.x9Ocpu, mem: PART.x9Mem, vcpuPerOcpu: 2, maxOcpu: 32, maxGb: 512 },
  { family: 'a1', shape: 'VM.Standard.A1.Flex', arch: 'arm', ocpu: PART.a1Ocpu, mem: PART.a1Mem, vcpuPerOcpu: 1, maxOcpu: 76, maxGb: 472 },
] as const;

/** 격자 — 다른 플랫폼 사이즈와 맞물리는 vCPU 수 × GB/vCPU 비율 (c·m·r 계열 1·2·4·8 + 고메모리 16) */
const GRID_VCPUS = [1, 2, 4, 8, 16, 32, 48, 64, 96, 128];
const GRID_GB_PER_VCPU = [1, 2, 4, 8, 16];
const OCPU_MAX_GB = 64;

export function buildOciVmSkus(items: OciItem[], region: Region): VmSku[] {
  const out: VmSku[] = [];
  for (const s of VM_SERIES) {
    const [ocpuRate, memRate] = [unitPrice(items, s.ocpu), unitPrice(items, s.mem)];
    for (const vcpu of GRID_VCPUS) {
      const ocpu = vcpu / s.vcpuPerOcpu;
      if (!Number.isInteger(ocpu) || ocpu > s.maxOcpu) continue;
      for (const ratio of GRID_GB_PER_VCPU) {
        const ramGb = vcpu * ratio;
        if (ramGb > ocpu * OCPU_MAX_GB || ramGb > s.maxGb) continue;
        out.push({
          provider: 'oci',
          region,
          sku: `${s.shape}.${ocpu}OCPU.${ramGb}GB`,
          vcpu,
          ramGb,
          burstable: false,
          arch: s.arch as Arch,
          generation: s.family,
          pricePerHour: r6(ocpu * ocpuRate + ramGb * memRate),
        });
      }
    }
  }
  return out;
}

/** 블록 = Balanced 성능(10 VPU/GB) 기준 용량 + 성능 단위 — gp3·Balanced PD와 대응 (가격 페이지 "10 VPUs for balanced") */
const BALANCED_VPU = 10;

export function buildOciStorage(items: OciItem[], region: Region): StorageSku[] {
  return [
    { provider: 'oci', region, kind: 'block-ssd', pricePerGbMonth: r6(unitPrice(items, PART.blockStorage) + BALANCED_VPU * unitPrice(items, PART.blockVpu)) },
    { provider: 'oci', region, kind: 'object-standard', pricePerGbMonth: unitPrice(items, PART.objectStorage) },
  ];
}

/** 트래픽 지역 구간 — 아시아(한국·일본·싱가포르) / 북미·유럽·영국. 월 10TB 무료 구간은 요금표에 내장돼 반영 */
const APAC: Region[] = ['seoul', 'tokyo', 'singapore'];

export function buildOciEgress(items: OciItem[], region: Region): EgressTier {
  const tiers = tiersOf(items, APAC.includes(region) ? PART.egressApac : PART.egressAmericasEurope);
  const freeGb = tiers[0].value === 0 ? (tiers[0].rangeMax ?? 0) : 0;
  return {
    provider: 'oci',
    region,
    freeGb,
    tiers: tiers.map((t, i) => ({ upToGb: i === tiers.length - 1 ? null : (t.rangeMax ?? null), pricePerGb: t.value })),
  };
}

/**
 * Flexible LB — 시간당 기본료 + 대역폭(Mbps·시간당). 최소 대역폭 10Mbps(최소 셰이프)를 시간당에 넣고,
 * 처리 GB는 평균 대역폭으로 환산(1GB = 8000Mb ÷ 3600초 → Mbps·시간 2.22)해 GB당 단가로. 실제 과금은 설정한 최대 대역폭 기준이라
 * 트래픽이 몰리는 시간이 있으면 과소 추정 — methodology 고지
 */
const LB_MIN_MBPS = 10;
const MBPS_HOURS_PER_GB = 8000 / 3600;

export function buildOciLb(items: OciItem[], region: Region): LbPrice {
  const bandwidth = unitPrice(items, PART.lbBandwidth);
  return { provider: 'oci', region, perHour: r6(unitPrice(items, PART.lbBase) + LB_MIN_MBPS * bandwidth), perGb: r6(bandwidth * MBPS_HOURS_PER_GB) };
}

/**
 * NAT Gateway — 0원으로 본다. 근거: 과금 품목 전체가 담긴 공식 가격 목록에 NAT 품목이 없음 (2026-10-17 확인).
 * 문서에 요금 언급이 없고 일부 비공식 글은 시간당 요금을 주장 → methodology에 근거와 함께 고지
 */
export const buildOciNat = (region: Region): NatPrice => ({ provider: 'oci', region, hourly: { per: 'gateway', usd: 0 }, perGb: 0 });

/** OKE Enhanced 클러스터 — 재정 보증 SLA 99.95%. Basic 클러스터(무료, SLA 없음)는 비교 대상 아님 */
export const buildOciK8s = (items: OciItem[], region: Region): K8sClusterPrice => ({ provider: 'oci', region, clusterPerHour: unitPrice(items, PART.okeEnhanced) });

/**
 * MySQL HeatWave — ECPU 셰이프 MySQL.{n}: n ECPU · 8n GB (docs.oracle.com/iaas/mysql-database/doc/supported-shapes.html, 2026-10-17 확인).
 * ECPU = vCPU로 비교. 고가용성 = 인스턴스 3개(주 1 + 보조 2) → 컴퓨트·스토리지 3배. MySQL.192·256은 문서 메모리 값이 엇갈려 제외
 */
const MYSQL_ECPUS = [2, 4, 8, 16, 32, 48, 64, 96];
const MYSQL_HA_INSTANCES = 3;

/**
 * Database with PostgreSQL — 기반 컴퓨트(E5 Flex OCPU·메모리) 요금 + OCPU당 PostgreSQL 요금 (oracle.com/cloud/postgresql/pricing:
 * "adding a fee on top of your standard compute", 2026-10-17 확인). 셰이프 PostgreSQL.VM.Standard.E5.Flex: 1~64 OCPU,
 * 메모리 16GB 이상·OCPU당 64GB 이하·최대 1024GB. 고가용성 = 노드 2개(문서 권장 최소) → 컴퓨트 2배, 스토리지는 노드 공유라 1배
 */
const PG_OCPUS = [1, 2, 4, 8, 16, 32, 64];
const PG_GB_PER_OCPU = [8, 16, 32, 64];
const PG = { minGb: 16, maxGb: 1024, haNodes: 2 };

export function buildOciDb(items: OciItem[], region: Region): DbPrice {
  const ecpu = unitPrice(items, PART.mysqlEcpu);
  const mysqlStorage = unitPrice(items, PART.mysqlStorage);
  const mysql: DbEnginePricing = {
    instances: MYSQL_ECPUS.map((n) => ({ sku: `MySQL.${n}`, vcpu: n, ramGb: n * 8, burstable: false, perHour: r6(n * ecpu), haPerHour: r6(n * ecpu * MYSQL_HA_INSTANCES) })),
    custom: null,
    storageGbMonth: mysqlStorage,
    haStorageGbMonth: r6(mysqlStorage * MYSQL_HA_INSTANCES),
  };

  const [ocpuRate, memRate, pgFee] = [unitPrice(items, PART.e5Ocpu), unitPrice(items, PART.e5Mem), unitPrice(items, PART.pgOcpu)];
  const pgInstances = new Map<string, DbInstance>();
  for (const ocpu of PG_OCPUS) {
    for (const ratio of PG_GB_PER_OCPU) {
      const ramGb = Math.max(PG.minGb, ocpu * ratio);
      if (ramGb > PG.maxGb) continue;
      const sku = `PostgreSQL.VM.Standard.E5.Flex.${ocpu}OCPU.${ramGb}GB`;
      const perHour = r6(ocpu * (ocpuRate + pgFee) + ramGb * memRate);
      pgInstances.set(sku, { sku, vcpu: ocpu * 2, ramGb, burstable: false, perHour, haPerHour: r6(perHour * PG.haNodes) });
    }
  }
  const pgStorage = unitPrice(items, PART.pgStorage);
  const postgres: DbEnginePricing = { instances: [...pgInstances.values()], custom: null, storageGbMonth: pgStorage, haStorageGbMonth: pgStorage };

  return { provider: 'oci', region, engines: { mysql, postgres } };
}

/**
 * OCI Cache(Valkey·Redis 호환) — 노드 메모리 GB·시간당. 노드가 10GB 이하면 저메모리 단가, 넘으면 고메모리 단가가 노드 전체에 적용.
 * 노드 메모리 2~500GB (docs.oracle.com/iaas/Content/ocicache, 2026-10-17 확인) — 대표 크기로 펼친다. 이중화 = 복제 노드 1개 → 2배
 */
const CACHE_GBS = [2, 4, 6, 8, 10, 12, 16, 24, 32, 48, 64, 96, 128, 192, 256, 384, 500];
const CACHE_LOW_MAX_GB = 10;

export function buildOciCache(items: OciItem[], region: Region): CachePrice {
  const [low, high] = [unitPrice(items, PART.cacheLow), unitPrice(items, PART.cacheHigh)];
  return {
    provider: 'oci',
    region,
    engine: 'Valkey',
    nodes: CACHE_GBS.map((gb) => {
      const perHour = r6(gb * (gb <= CACHE_LOW_MAX_GB ? low : high));
      return { sku: `OCI Cache ${gb}GB`, memoryGb: gb, burstable: false, perHour, haPerHour: r6(perHour * 2) };
    }),
    gbTiers: null,
  };
}

/**
 * Container Instances — 같은 셰이프의 Compute 요금 그대로, 추가 요금 없음 (oracle.com/cloud/cloud-native/container-instances/faq, 2026-10-17 확인).
 * x86 = CI.Standard.E4.Flex(OCPU 단가 ÷ 2 = vCPU 단가), ARM = CI.Standard.A1.Flex. 허용 조합은 estimator/container.ts
 */
export function buildOciContainer(items: OciItem[], region: Region): ContainerPrice {
  return {
    provider: 'oci',
    region,
    rates: {
      x86: { vcpuPerHour: r6(unitPrice(items, PART.e4Ocpu) / 2), gbPerHour: unitPrice(items, PART.e4Mem) },
      arm: { vcpuPerHour: unitPrice(items, PART.a1Ocpu), gbPerHour: unitPrice(items, PART.a1Mem) },
    },
  };
}

/** OCI Logging — 수집 무료, 저장 GB·월. 보관 기간 30일 단위 최대 180일 (docs.oracle.com/iaas/Content/Logging/Task/update-logging-log.htm, 2026-10-17 확인) */
export const buildOciLogs = (items: OciItem[], region: Region): LogPrice => ({
  provider: 'oci',
  region,
  ingestPerGb: 0,
  storagePerGbMonth: unitPrice(items, PART.logStorage),
  includedDays: 0,
  storedRatio: 1,
  commitmentTiers: [],
  maxRetentionDays: 180,
});

/** 리전 하나의 스냅샷. CDN은 OCI 미제공(providers.ts NOT_OFFERED) → null */
export function buildOciSnapshot(items: OciItem[], region: Region): Snapshot {
  return {
    vms: buildOciVmSkus(items, region),
    storage: buildOciStorage(items, region),
    egress: buildOciEgress(items, region),
    k8s: buildOciK8s(items, region),
    lb: buildOciLb(items, region),
    nat: buildOciNat(region),
    db: buildOciDb(items, region),
    cache: buildOciCache(items, region),
    container: buildOciContainer(items, region),
    cdn: null,
    logs: buildOciLogs(items, region),
  };
}
