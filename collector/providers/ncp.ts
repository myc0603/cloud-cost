/**
 * NCP(네이버 클라우드) 수집기 — 공식 요금 계산기가 쓰는 요금 API(인증 불필요)에서 리전별 요금을 받는다.
 * `www.ncloud.com/api-usage/charge/price/{리전 번호}` — 문서화되지 않은 내부 경로라 바뀌면 검증이 막고 기존 데이터를 유지한다.
 * 막히면 공식 List Price API(billingapi, Access Key 서명 필요)로 옮긴다 (docs/PLATFORMS.md).
 *
 * 가격은 원화(VAT 별도). 스키마가 USD라 수집 시점 환율로 나눠 저장한다 — 화면은 같은 환율(meta.json)로 되돌리므로 원화 표시는 NCP 금액 그대로.
 * 단가 단위는 상품마다 다르다(원/시간, 원/GB, 원/GB·월) — 2026-10-17 리전별 요금 페이지(ncloud.com/charge/region/ko)와 대조해 확인.
 * 약정 상품 없음 → commit 없음.
 *
 * 파이프라인: fetchNcpPriceList(리전별) → buildNcpSnapshot
 */

import type {
  CachePrice,
  CdnPrice,
  DbEnginePricing,
  DbInstance,
  DbPrice,
  EgressTier,
  LogPrice,
  PriceTier,
  Region,
  StorageSku,
  VmSku,
} from '../../src/lib/schema';
import { regionCodes } from '../../src/lib/regions';
import type { Snapshot } from '../validate';

export const NCP_REGION = regionCodes('ncp');

/** 요금 API의 리전 번호 — 리전별 요금 페이지의 서버 요금과 대조해 확인 (KR 119원·SGN 125원·JPN 129원, Standard-g2 2vCPU/8GB HDD) */
const API_REGION_NO: Record<string, number> = { KR: 1, SGN: 7, JPN: 8 };

/** 요금 API 응답에서 쓰는 목록만 */
export interface NcpPriceList {
  serverSoftwareProductPriceList: NcpServerPrice[];
  serverAndSelectableSoftwareProductPriceList: NcpSelectablePrice[];
  additionalStorageProductPriceList: NcpStoragePrice[];
  otherProductPriceList: NcpOtherPrice[];
  regionalIntegratedProductPriceList: NcpOtherPrice[];
}

/** 일반 서버 — feeSystemTypeCode MTRAT = 시간 요금, FXSUM = 월 요금 */
export interface NcpServerPrice {
  infraResourceTypeCode: string;
  platformDetailTypeCode: string;
  serverProductCode: string;
  serverProductTypeCode: string;
  osTypeCode: string;
  generationCode: string | null;
  feeSystemTypeCode: string;
  serverProductPrice: number;
}

/** DB·캐시·NKS 서버 — 시간당/대 요금(문자열) */
export interface NcpSelectablePrice {
  infraResourceTypeCode: string;
  platformDetailTypeCode: string;
  serverProductCode: string;
  serverProductTypeCode: string;
  generationCode: string | null;
  vcpuCount: number;
  memorySizeInGb: number;
  serverProductPrice: string;
}

export interface NcpStoragePrice {
  productName: string;
  productRatingTypeCode: string;
  productPrice: string;
}

/** 서버 외 상품 — 구간 요금은 sectionStart/EndValueInGb (End null = 무제한) */
export interface NcpOtherPrice {
  infraResourceTypeCode: string;
  productName: string;
  productRatingTypeCode: string;
  productPrice: string;
  sectionStartValueInGb: string | null;
  sectionEndValueInGb: string | null;
}

export async function fetchNcpPriceList(ncpRegion: string): Promise<NcpPriceList> {
  const res = await fetch(`https://www.ncloud.com/api-usage/charge/price/${API_REGION_NO[ncpRegion]}`);
  if (!res.ok) throw new Error(`NCP 요금 API(${ncpRegion}) 응답 ${res.status}`);
  const body = (await res.json()) as NcpPriceList;
  if (!body.serverSoftwareProductPriceList?.length) throw new Error(`NCP 요금 API(${ncpRegion}) 서버 요금이 비어 있음`);
  return body;
}

const HOURS_PER_MONTH = 730;
const r6 = (x: number) => +x.toFixed(6);

/** 서버 외 상품 목록 (두 목록을 합쳐서 본다) */
const others = (p: NcpPriceList) => [...p.otherProductPriceList, ...p.regionalIntegratedProductPriceList];

/** 품목 하나의 원화 단가 — 같은 품목이 여러 번 실려 있어도 값은 같다. 없으면 수집 실패(조용히 0원으로 만들지 않는다) */
function otherPrice(p: NcpPriceList, infra: string, rating: string, name?: string): number {
  const hit = others(p).find((x) => x.infraResourceTypeCode === infra && x.productRatingTypeCode === rating && (!name || x.productName === name));
  if (!hit) throw new Error(`NCP 품목 ${infra}/${rating}${name ? `(${name})` : ''} 없음`);
  return Number(hit.productPrice);
}

/** 구간 요금 — 중복 제거 후 시작점 순. 원화 → USD */
function otherTiers(p: NcpPriceList, infra: string, rating: string, krwPerUsd: number, name?: string): PriceTier[] {
  const seen = new Map<string, PriceTier & { from: number }>();
  for (const x of others(p)) {
    if (x.infraResourceTypeCode !== infra || x.productRatingTypeCode !== rating || (name && x.productName !== name)) continue;
    const from = Number(x.sectionStartValueInGb ?? 0);
    seen.set(String(from), { from, upTo: x.sectionEndValueInGb === null ? null : Number(x.sectionEndValueInGb), price: r6(Number(x.productPrice) / krwPerUsd) });
  }
  const tiers = [...seen.values()].sort((a, b) => a.from - b.from).map(({ upTo, price }) => ({ upTo, price }));
  if (tiers.length === 0) throw new Error(`NCP 구간 요금 ${infra}/${rating} 없음`);
  return tiers;
}

/**
 * VM — 3세대(G3) 일반 서버, Rocky Linux. Standard(1:4)·High CPU(1:2)·High Memory(1:8)·CPU 타입, Intel·AMD.
 * 2세대는 기본 디스크 50GB가 서버 요금에 묶여 있어 제외, Micro(계정당 1대)·GPU 제외. ARM·버스트 없음.
 * 단가 = 월 요금 ÷ 730 — 한 달 내내 쓰면 월 요금제가 시간 요금 × 730보다 약 2% 싸서 실제 청구에 맞춘다 (월 요금이 없으면 시간 요금).
 */
const VM_TYPES = new Set(['STAND', 'HICPU', 'HIMEM', 'CPU']);

export function buildNcpVmSkus(p: NcpPriceList, region: Region, krwPerUsd: number): VmSku[] {
  const byCode = new Map<string, { hourly?: number; monthly?: number }>();
  for (const x of p.serverSoftwareProductPriceList) {
    if (x.infraResourceTypeCode !== 'VSVR' || x.platformDetailTypeCode !== '-' || x.osTypeCode !== 'ROCKY' || x.generationCode !== 'G3') continue;
    if (!VM_TYPES.has(x.serverProductTypeCode)) continue;
    const e = byCode.get(x.serverProductCode) ?? {};
    if (x.feeSystemTypeCode === 'MTRAT') e.hourly = x.serverProductPrice;
    if (x.feeSystemTypeCode === 'FXSUM') e.monthly = x.serverProductPrice;
    byCode.set(x.serverProductCode, e);
  }
  const out: VmSku[] = [];
  for (const [code, { hourly, monthly }] of byCode) {
    const m = code.match(/\.C(\d+)\.M(\d+)\./);
    const krwPerHour = monthly !== undefined ? monthly / HOURS_PER_MONTH : hourly;
    if (!m || krwPerHour === undefined) continue;
    const type = code.includes('.AMD.') ? `${code.split('.')[3]}-amd` : code.split('.')[2];
    out.push({
      provider: 'ncp',
      region,
      sku: code.replace(/^SVR\.VSVR\./, ''),
      vcpu: Number(m[1]),
      ramGb: Number(m[2]),
      burstable: false,
      arch: 'x86',
      generation: type.toLowerCase(),
      pricePerHour: r6(krwPerHour / krwPerUsd),
    });
  }
  return out;
}

/** 블록 = 추가 블록 스토리지 SSD(원/GB·시간 × 730), 오브젝트 = Object Storage 1PB 이하 구간(원/GB·월) */
function blockSsdPerGbMonthKrw(p: NcpPriceList): number {
  const hit = p.additionalStorageProductPriceList.find((x) => x.productName === 'Additional Block Storage [NET] (SSD)' && x.productRatingTypeCode === 'BST');
  if (!hit) throw new Error('NCP 블록 스토리지 SSD 요금 없음');
  return Number(hit.productPrice) * HOURS_PER_MONTH;
}

export function buildNcpStorage(p: NcpPriceList, region: Region, krwPerUsd: number): StorageSku[] {
  return [
    { provider: 'ncp', region, kind: 'block-ssd', pricePerGbMonth: r6(blockSsdPerGbMonthKrw(p) / krwPerUsd) },
    { provider: 'ncp', region, kind: 'object-standard', pricePerGbMonth: r6(otherTiers(p, 'OBJST', 'OSSZ', krwPerUsd)[0].price) },
  ];
}

/** 인터넷 아웃바운드 트래픽 — 20GB 무료 구간이 요금표에 내장돼 반영 */
export function buildNcpEgress(p: NcpPriceList, region: Region, krwPerUsd: number): EgressTier {
  const tiers = otherTiers(p, 'NET', 'NETOT', krwPerUsd);
  return {
    provider: 'ncp',
    region,
    freeGb: tiers[0].price === 0 ? (tiers[0].upTo ?? 0) : 0,
    tiers: tiers.map((t) => ({ upToGb: t.upTo, pricePerGb: t.price })),
  };
}

/** DB·캐시 서버 — 리전에 있는 가장 최신 세대(한국 G3, 일본·싱가포르 G2). Intel·AMD는 같은 값이라 구분 없이 사이즈별 최저가 */
function latestGeneration(rows: NcpSelectablePrice[]): NcpSelectablePrice[] {
  const gens = [...new Set(rows.map((x) => x.generationCode).filter((g): g is string => !!g))].sort();
  const latest = gens.at(-1);
  return rows.filter((x) => x.generationCode === latest);
}

/**
 * Cloud DB for MySQL·PostgreSQL — 서버 시간당/대 요금(Standard·High CPU·High Memory). 고가용성 = 2대(요금 페이지 예시) → 2배.
 * 데이터 스토리지는 Block Storage 요금(문서 "요금 > Block Storage에서 확인")으로 SSD 단가, 고가용성은 서버마다 저장해 2배로 본다.
 * 서버 요금에 포함된 50GB 디스크는 OS용이라 데이터 스토리지와 별개.
 */
const DB_TYPES = new Set(['STAND', 'HICPU', 'HIMEM']);

function dbEngine(p: NcpPriceList, match: (x: NcpSelectablePrice) => boolean, storageKrw: number, krwPerUsd: number): DbEnginePricing | null {
  const rows = latestGeneration(p.serverAndSelectableSoftwareProductPriceList.filter((x) => match(x) && DB_TYPES.has(x.serverProductTypeCode)));
  if (rows.length === 0) return null;
  const instances = new Map<string, DbInstance>();
  for (const x of rows) {
    const perHour = r6(Number(x.serverProductPrice) / krwPerUsd);
    const sku = x.serverProductCode.replace(/^SVR\./, '');
    instances.set(sku, { sku, vcpu: x.vcpuCount, ramGb: x.memorySizeInGb, burstable: false, perHour, haPerHour: r6(perHour * 2) });
  }
  const storage = r6(storageKrw / krwPerUsd);
  return { instances: [...instances.values()], custom: null, storageGbMonth: storage, haStorageGbMonth: r6(storage * 2) };
}

export function buildNcpDb(p: NcpPriceList, region: Region, krwPerUsd: number): DbPrice {
  const storageKrw = blockSsdPerGbMonthKrw(p);
  return {
    provider: 'ncp',
    region,
    engines: {
      mysql: dbEngine(p, (x) => x.infraResourceTypeCode === 'VDBAS' && x.platformDetailTypeCode === 'MYSQL', storageKrw, krwPerUsd),
      postgres: dbEngine(p, (x) => x.infraResourceTypeCode === 'VPGSL' && x.platformDetailTypeCode === 'PGSQL', storageKrw, krwPerUsd),
    },
  };
}

/**
 * Cloud DB for Redis — 노드 시간당/대 요금. 상품 코드의 메모리(M001 등)는 정수로 잘린 값이라 요금 페이지의 실제 크기로 바꾼다
 * (1.5·3·6.4·12.8·25.6·51.2·102.4·153.6·204.8GB, 2026-10-17 요금 페이지 확인). 이중화 = 복제 노드 1대 → 2배
 */
const REDIS_GB: Record<string, number> = { M001: 1.5, M003: 3, M006: 6.4, M012: 12.8, M025: 25.6, M051: 51.2, M102: 102.4, M153: 153.6, M204: 204.8 };

export function buildNcpCache(p: NcpPriceList, region: Region, krwPerUsd: number): CachePrice | null {
  const rows = latestGeneration(p.serverAndSelectableSoftwareProductPriceList.filter((x) => x.serverProductCode.startsWith('SVR.VRDS.') && x.platformDetailTypeCode === 'REDIS'));
  const nodes = new Map<number, CachePrice['nodes'][number]>();
  for (const x of rows) {
    const gb = REDIS_GB[x.serverProductCode.match(/\.(M\d+)\./)?.[1] ?? ''];
    if (gb === undefined) throw new Error(`NCP Redis 메모리 코드 모름: ${x.serverProductCode}`);
    const perHour = r6(Number(x.serverProductPrice) / krwPerUsd);
    const prev = nodes.get(gb);
    if (!prev || perHour < prev.perHour) nodes.set(gb, { sku: `Redis ${gb}GB`, memoryGb: gb, burstable: false, perHour, haPerHour: r6(perHour * 2) });
  }
  return nodes.size > 0 ? { provider: 'ncp', region, engine: 'Redis', nodes: [...nodes.values()], gbTiers: null } : null;
}

/** Global CDN — 전송 GB 구간 + 요청 1만 건당. CDN+는 요금 페이지에 Deprecated 표시라 제외. 시청자 지역 구분 없는 단일 요금 */
export function buildNcpCdn(p: NcpPriceList, region: Region, krwPerUsd: number): CdnPrice {
  return {
    provider: 'ncp',
    region,
    gbTiers: otherTiers(p, 'GCDN', 'CDNDN', krwPerUsd),
    requestTiers: [{ upTo: null, price: r6(otherPrice(p, 'GCDN', 'CDNRQ') / krwPerUsd) }],
    monthlyBase: 0,
    fillPerGb: 0,
    plans: [],
  };
}

/**
 * Cloud Log Analytics — Standard(수집 무료·보관 GB·월, 하루 20GB·보관 100GB 한도) / Premium(수집 GB당·보관 무료, 하루 100GB·보관 1TB 한도).
 * 한도는 API에 없어 요금 페이지 문서값(2026-10-17 확인). 보관 1GB 무료는 계정 단위라 미반영
 */
export function buildNcpLogs(p: NcpPriceList, region: Region, krwPerUsd: number): LogPrice {
  const base = { provider: 'ncp' as const, region, includedDays: 0, storedRatio: 1, commitmentTiers: [] };
  const standardStorage = otherTiers(p, 'CLA', 'CLASZ', krwPerUsd, 'Cloud Log Analytics').at(-1)!.price;
  const premiumIngest = otherPrice(p, 'CLA', 'CLA_LOG_COLLECT', 'Cloud Log Analytics Premium');
  return {
    ...base,
    plan: 'Standard',
    ingestPerGb: 0,
    storagePerGbMonth: standardStorage,
    maxGbPerDay: 20,
    maxStoredGb: 100,
    alternatives: [{ ...base, plan: 'Premium', ingestPerGb: r6(premiumIngest / krwPerUsd), storagePerGbMonth: 0, maxGbPerDay: 100, maxStoredGb: 1024 }],
  };
}

/** 리전 하나의 스냅샷. 서버리스 컨테이너는 미제공(providers.ts NOT_OFFERED) → null */
export function buildNcpSnapshot(p: NcpPriceList, region: Region, krwPerUsd: number): Snapshot {
  const usd = (krw: number) => r6(krw / krwPerUsd);
  const nks = p.serverAndSelectableSoftwareProductPriceList.find((x) => x.infraResourceTypeCode === 'VNKS');
  if (!nks) throw new Error('NCP NKS 클러스터 요금 없음');
  return {
    vms: buildNcpVmSkus(p, region, krwPerUsd),
    storage: buildNcpStorage(p, region, krwPerUsd),
    egress: buildNcpEgress(p, region, krwPerUsd),
    // NKS 클러스터 시간 요금 — VNKS 항목마다 같은 값(100원, 요금 페이지 "클러스터 100원/시간")
    k8s: { provider: 'ncp', region, clusterPerHour: usd(Number(nks.serverProductPrice)) },
    // 애플리케이션 로드밸런서 Small(시간) + 처리 데이터(GB). 규칙은 5개까지 무료라 제외
    lb: { provider: 'ncp', region, perHour: usd(otherPrice(p, 'VLB', 'PF_SM', '어플리케이션 로드밸런서(VPC)')), perGb: usd(otherPrice(p, 'VLB', 'DTIN', '어플리케이션 로드밸런서(VPC)')) },
    // NAT Gateway — 1개당 보유 시간 + 처리 GB
    nat: { provider: 'ncp', region, hourly: { per: 'gateway', usd: usd(otherPrice(p, 'NATGW', 'NATMN')) }, perGb: usd(otherPrice(p, 'NATGW', 'NATNW')) },
    db: buildNcpDb(p, region, krwPerUsd),
    cache: buildNcpCache(p, region, krwPerUsd),
    container: null,
    cdn: buildNcpCdn(p, region, krwPerUsd),
    logs: buildNcpLogs(p, region, krwPerUsd),
  };
}
