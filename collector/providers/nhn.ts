/**
 * NHN Cloud 수집기 — 공식 요금 페이지가 서비스별로 불러오는 요금표 HTML 조각(인증 불필요)을 파싱한다.
 *   - 서비스 → 콘텐츠 ID: `homepage/v2/services/hierarchy`(서비스 이름 → productUiId) + `homepage/v2/content-maps`(productUiId → contentId)
 *   - 요금표: `xcms-api/v1/contents/{contentId}?...pricingRegionCode={KR1|JP1}` — `<strong>제목</strong>` 다음에 `<table>`이 오는 HTML
 * 표는 rowspan으로 칸이 밀리므로 위치가 아니라 내용 패턴(인스턴스 타입 `m2.c2m4`, 가격 `93원/시간`)으로 읽는다.
 *
 * 가격은 원화(VAT 별도) → 수집 시점 환율로 USD (NCP·SCP와 같은 방식). 공개된 약정 상품 없음(고객센터 문의) → commit 없음.
 * 리전: KR1(판교)·JP1(도쿄) — 리전 목록 API에 미국 리전 없음. 도쿄는 NKS·NAT·EasyCache·NCS·PostgreSQL 요금표가 비어 있다(providers.ts NOT_OFFERED_IN).
 *
 * 파이프라인: fetchNhnPages(리전별) → buildNhnSnapshot
 */

import type { CachePrice, CdnPrice, DbEnginePricing, DbPrice, EgressTier, LogPrice, PriceTier, Region, StorageSku, VmSku } from '../../src/lib/schema';
import { regionCodes } from '../../src/lib/regions';
import type { Snapshot } from '../validate';

export const NHN_REGION = regionCodes('nhn');

const BASE = 'https://www.nhncloud.com';

/** 쓰는 서비스 — 키 = 요금 페이지 서비스 이름(hierarchy의 name) */
export const NHN_SERVICES = {
  instance: 'Instance',
  block: 'Block Storage',
  object: 'Object Storage',
  nks: 'NHN Kubernetes Service(NKS)',
  lb: 'Load Balancer',
  nat: 'NAT Gateway',
  mysql: 'RDS for MySQL',
  postgres: 'RDS for PostgreSQL',
  cache: 'EasyCache',
  ncs: 'NHN Container Service(NCS)',
  cdn: 'CDN',
  logs: 'Log & Crash Search',
} as const;

export type NhnService = keyof typeof NHN_SERVICES;

/** 서비스별 요금표 HTML (도쿄처럼 요금표가 비어 있으면 표 없는 HTML) */
export type NhnPages = Record<NhnService, string>;

/** 서비스 이름 → 콘텐츠 ID — 이름이 겹치는 서비스(GPU Instance 등)와 섞이지 않게 정확히 같은 이름만 */
export async function fetchNhnContentIds(): Promise<Record<NhnService, string>> {
  const get = async <T>(path: string): Promise<T> => {
    const res = await fetch(`${BASE}${path}`);
    if (!res.ok) throw new Error(`NHN ${path} 응답 ${res.status}`);
    return (await res.json()) as T;
  };
  const maps = await get<{ homepageContentMapList: { targetId: string; contentId: string }[] }>('/homepage/v2/content-maps');
  const hierarchy = await get<{ hierarchy: unknown }>('/homepage/v2/services/hierarchy');
  const contentOf = new Map(maps.homepageContentMapList.map((m) => [m.targetId, m.contentId]));
  const byName = new Map<string, string>();
  const walk = (n: unknown): void => {
    if (Array.isArray(n)) return n.forEach(walk);
    if (!n || typeof n !== 'object') return;
    const o = n as Record<string, unknown>;
    const id = contentOf.get(String(o.productUiId));
    if (typeof o.name === 'string' && id && !byName.has(o.name)) byName.set(o.name, id);
    Object.values(o).forEach((v) => typeof v === 'object' && walk(v));
  };
  walk(hierarchy.hierarchy);
  const out = {} as Record<NhnService, string>;
  for (const [key, name] of Object.entries(NHN_SERVICES) as [NhnService, string][]) {
    const id = byName.get(name);
    if (!id) throw new Error(`NHN 서비스 "${name}"의 요금 콘텐츠 ID 없음`);
    out[key] = id;
  }
  return out;
}

export async function fetchNhnPages(ids: Record<NhnService, string>, nhnRegion: string): Promise<NhnPages> {
  const ctx = encodeURIComponent(JSON.stringify({ isPricingPage: true, tab: 'pricing', pricingRegionCode: nhnRegion }));
  const out = {} as NhnPages;
  for (const key of Object.keys(ids) as NhnService[]) {
    const res = await fetch(`${BASE}/xcms-api/v1/contents/${ids[key]}?languageCode=KO&countryCode=KR&templateContext=${ctx}`);
    if (!res.ok) throw new Error(`NHN 요금표 ${key}(${nhnRegion}) 응답 ${res.status}`);
    out[key] = await res.text();
  }
  return out;
}

/** 요금표 하나 — 제목(`<strong>`)과 행(셀 텍스트) */
interface Section {
  title: string;
  rows: string[][];
}

const text = (html: string) =>
  html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&gt;/g, '>')
    .replace(/&lt;/g, '<')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();

export function nhnSections(html: string): Section[] {
  const out: Section[] = [];
  const parts = html.split(/<strong\b[^>]*>/).slice(1);
  for (const part of parts) {
    const end = part.indexOf('</strong>');
    const title = text(part.slice(0, end));
    const table = part.slice(end).match(/<table[\s\S]*?<\/table>/)?.[0];
    if (!table) continue;
    const rows = [...table.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)].map((tr) => [...tr[1].matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/g)].map((c) => text(c[1])));
    out.push({ title, rows: rows.filter((r) => r.length > 0) });
  }
  return out;
}

/** 제목이 정확히 같은 첫 표. 없으면 수집 실패 */
function section(html: string, title: string): Section {
  const s = nhnSections(html).find((x) => x.title === title);
  if (!s) throw new Error(`NHN 요금표 "${title}" 없음`);
  return s;
}

/** 셀의 원화 금액 — '1,029원/시간' → 1029, '0.016원/초' → 0.016. 원 표기가 없으면 null */
export function krw(cell: string): number | null {
  const m = cell.match(/([\d,]+(?:\.\d+)?)원/);
  return m ? Number(m[1].replace(/,/g, '')) : null;
}

/** 행의 마지막 원화 금액 */
const rowPrice = (row: string[]) => {
  const p = [...row].reverse().map(krw).find((x) => x !== null);
  if (p === undefined || p === null) throw new Error(`NHN 금액 칸 없음: ${row.join(' | ')}`);
  return p;
};

/** 첫 칸(또는 어떤 칸)에 라벨이 있는 행의 금액 */
function priceOf(s: Section, label: string): number {
  const row = s.rows.find((r) => r.some((c) => c === label));
  if (!row) throw new Error(`NHN 요금표 "${s.title}"에 "${label}" 행 없음`);
  return rowPrice(row);
}

const TYPE = /^([a-z]\d)\.c(\d+)m(\d+)$/;

/** 인스턴스 타입 행 — [타입, vCPU, 메모리GB, 원/시간] */
function typeRows(s: Section): { type: string; family: string; vcpu: number; ramGb: number; krwPerHour: number }[] {
  return s.rows.flatMap((r) => {
    const type = r.find((c) => TYPE.test(c));
    if (!type) return [];
    const [, family, vcpu, ram] = type.match(TYPE)!;
    return [{ type, family, vcpu: Number(vcpu), ramGb: Number(ram), krwPerHour: rowPrice(r) }];
  });
}

const HOURS_PER_MONTH = 730;
const r6 = (x: number) => +x.toFixed(6);

/**
 * VM — Instance 요금표의 일반 타입(t2·m2·c2·r2·x1), Linux(OS 요금 0원). 약정·월 요금제 없음. 버스트 표시는 근거가 없어 없음.
 * u2(Basic, 도쿄)는 전용 로컬 스토리지가 루트 볼륨으로 묶여 있어 제외 — 디스크가 서버 요금에 포함된 상품은 비교에서 뺀다(NCP 2세대와 같은 기준)
 */
const EXCLUDED_FAMILIES = new Set(['u2']);

export function buildNhnVmSkus(pages: NhnPages, region: Region, krwPerUsd: number): VmSku[] {
  return typeRows(section(pages.instance, 'Instance')).filter((t) => !EXCLUDED_FAMILIES.has(t.family)).map((t) => ({
    provider: 'nhn',
    region,
    sku: t.type,
    vcpu: t.vcpu,
    ramGb: t.ramGb,
    burstable: false,
    arch: 'x86',
    generation: t.family,
    pricePerHour: r6(t.krwPerHour / krwPerUsd),
  }));
}

/** 블록 = SSD, 오브젝트 = Standard — 둘 다 "10GB당 사용 시간 누적" 원/시간 → GB·월 */
const per10GbHourToGbMonth = (krwPer10GbHour: number) => (krwPer10GbHour / 10) * HOURS_PER_MONTH;

function blockSsdKrw(pages: NhnPages): number {
  return per10GbHourToGbMonth(priceOf(section(pages.block, 'Block Storage'), 'SSD'));
}

export function buildNhnStorage(pages: NhnPages, region: Region, krwPerUsd: number): StorageSku[] {
  return [
    { provider: 'nhn', region, kind: 'block-ssd', pricePerGbMonth: r6(blockSsdKrw(pages) / krwPerUsd) },
    { provider: 'nhn', region, kind: 'object-standard', pricePerGbMonth: r6(per10GbHourToGbMonth(objectStandardKrw(section(pages.object, 'Object Storage'))) / krwPerUsd) },
  ];
}

/** 오브젝트 Standard 등급 — 등급 구분이 없는 리전(도쿄)은 "스토리지 용량" 한 줄뿐 */
function objectStandardKrw(s: Section): number {
  const standard = s.rows.find((r) => r.includes('Standard'));
  if (standard) return rowPrice(standard);
  return priceOf(s, '스토리지 용량');
}

/** 인터넷 트래픽 — Instance 요금 페이지의 Network 표: "인터넷 트래픽" 1GB 이하 무료, 다음 행(1GB 초과) GB당 */
export function buildNhnEgress(pages: NhnPages, region: Region, krwPerUsd: number): EgressTier {
  const rows = section(pages.instance, 'Network').rows;
  const i = rows.findIndex((r) => r.includes('인터넷 트래픽'));
  if (i < 0 || !rows[i + 1]) throw new Error('NHN 인터넷 트래픽 요금 없음');
  const freeGb = Number(rows[i].find((c) => /GB 이하/.test(c))?.match(/(\d+)GB/)?.[1] ?? 0);
  return {
    provider: 'nhn',
    region,
    freeGb,
    tiers: [
      { upToGb: freeGb, pricePerGb: 0 },
      { upToGb: null, pricePerGb: r6(rowPrice(rows[i + 1]) / krwPerUsd) },
    ],
  };
}

/**
 * RDS for MySQL·PostgreSQL — 인스턴스 시간 요금, 고가용성 = 같은 인스턴스 추가(요금 페이지 "RDS HA 이용 시 동일한 인스턴스 추가 사용 요금") → 2배.
 * 데이터 스토리지 = Data Storage SSD(10GB당 원/시간), 고가용성은 인스턴스마다 스토리지를 가져 2배. 루트 볼륨 50GB·백업 볼륨은 제외
 */
function nhnDbEngine(html: string, krwPerUsd: number): DbEnginePricing | null {
  if (!html || nhnSections(html).length === 0) return null;
  const instances = typeRows(section(html, 'Instance')).map((t) => {
    const perHour = r6(t.krwPerHour / krwPerUsd);
    return { sku: t.type, vcpu: t.vcpu, ramGb: t.ramGb, burstable: false, perHour, haPerHour: r6(perHour * 2) };
  });
  const storage = r6(per10GbHourToGbMonth(priceOf(section(html, 'Data Storage'), 'SSD')) / krwPerUsd);
  return { instances, custom: null, storageGbMonth: storage, haStorageGbMonth: r6(storage * 2) };
}

export function buildNhnDb(pages: NhnPages, region: Region, krwPerUsd: number): DbPrice {
  return { provider: 'nhn', region, engines: { mysql: nhnDbEngine(pages.mysql, krwPerUsd), postgres: nhnDbEngine(pages.postgres, krwPerUsd) } };
}

/**
 * EasyCache(Redis 호환) — 메모리 크기별 인스턴스 시간 요금, HA = 노드 추가(요금 페이지 "동일한 리소스 추가 사용") → 2배.
 * 메모리에 비례해 붙는 Data Storage(HDD)는 비율이 공개돼 있지 않아 제외
 */
export function buildNhnCache(pages: NhnPages, region: Region, krwPerUsd: number): CachePrice | null {
  if (!pages.cache || nhnSections(pages.cache).length === 0) return null;
  const byGb = new Map<number, CachePrice['nodes'][number]>();
  for (const t of typeRows(section(pages.cache, 'Instance'))) {
    const perHour = r6(t.krwPerHour / krwPerUsd);
    const prev = byGb.get(t.ramGb);
    if (!prev || perHour < prev.perHour) byGb.set(t.ramGb, { sku: t.type, memoryGb: t.ramGb, burstable: false, perHour, haPerHour: r6(perHour * 2) });
  }
  return { provider: 'nhn', region, engine: 'Redis', nodes: [...byGb.values()], gbTiers: null };
}

/** CDN — 전송 GB 구간(국내외 구분 없음), 요청 요금 없음. 구간 경계는 요금표 문구값(10·30·50·100·300·500TB) */
const CDN_BOUNDS: (number | null)[] = [10240, 30720, 51200, 102400, 307200, 512000, null];

export function buildNhnCdn(pages: NhnPages, region: Region, krwPerUsd: number): CdnPrice {
  const rows = section(pages.cdn, 'CDN').rows.filter((r) => r.some((c) => krw(c) !== null));
  if (rows.length !== CDN_BOUNDS.length) throw new Error(`NHN CDN 구간 수가 예상과 다름: ${rows.length}`);
  const gbTiers: PriceTier[] = rows.map((r, i) => ({ upTo: CDN_BOUNDS[i], price: r6(rowPrice(r) / krwPerUsd) }));
  return { provider: 'nhn', region, gbTiers, requestTiers: [{ upTo: null, price: 0 }], monthlyBase: 0, fillPerGb: 0, plans: [] };
}

/**
 * Log & Crash Search(Log Search) — 수집 무료(API 호출 100만 건까지 무료, 초과분은 미반영), 보관 = 월 평균 저장량 GB당.
 * 보관 기간으로 요금제가 정해짐: Basic 30일 / Premium 60·90·120일 (요금 페이지 문구, 2026-10-17). 보관 1GB 무료는 계정 단위라 미반영
 */
export function buildNhnLogs(pages: NhnPages, region: Region, krwPerUsd: number): LogPrice {
  const prices = section(pages.logs, 'Log Search')
    .rows.filter((r) => r.some((c) => c.includes('월 평균 저장량')))
    .map(rowPrice);
  if (prices.length !== 2) throw new Error(`NHN Log Search 보관 요금 수가 예상과 다름: ${prices.length}`);
  const base = { provider: 'nhn' as const, region, ingestPerGb: 0, includedDays: 0, storedRatio: 1, commitmentTiers: [] };
  return {
    ...base,
    plan: 'Basic',
    storagePerGbMonth: r6(prices[0] / krwPerUsd),
    maxRetentionDays: 30,
    alternatives: [{ ...base, plan: 'Premium', storagePerGbMonth: r6(prices[1] / krwPerUsd), maxRetentionDays: 120 }],
  };
}

/** NCS 워크로드 — vCPU·메모리 원/초 → 시간 단가. GPU 제외. 허용 조합은 estimator/container.ts */
export function buildNhnContainer(pages: NhnPages, region: Region, krwPerUsd: number) {
  if (!pages.ncs || nhnSections(pages.ncs).length === 0) return null;
  const s = section(pages.ncs, 'Workload');
  const perSecond = (label: string) => {
    const row = s.rows.find((r) => r[0] === label || r.includes(label));
    if (!row) throw new Error(`NHN NCS "${label}" 요금 없음`);
    return rowPrice(row);
  };
  return {
    provider: 'nhn' as const,
    region,
    rates: { x86: { vcpuPerHour: r6((perSecond('CPU') * 3600) / krwPerUsd), gbPerHour: r6((perSecond('메모리') * 3600) / krwPerUsd) } },
  };
}

/** 리전 하나의 스냅샷 — 도쿄처럼 요금표가 비어 있는 서비스는 null (미제공 처리는 providers.ts NOT_OFFERED_IN) */
export function buildNhnSnapshot(pages: NhnPages, region: Region, krwPerUsd: number): Snapshot {
  const usd = (k: number) => r6(k / krwPerUsd);
  const has = (key: NhnService) => !!pages[key] && nhnSections(pages[key]).length > 0;
  return {
    vms: buildNhnVmSkus(pages, region, krwPerUsd),
    storage: buildNhnStorage(pages, region, krwPerUsd),
    egress: buildNhnEgress(pages, region, krwPerUsd),
    // NKS 클러스터 시간 요금 (워커 노드는 Instance 요금)
    k8s: has('nks') ? { provider: 'nhn', region, clusterPerHour: usd(priceOf(section(pages.nks, 'NHN Kubernetes Service(NKS)'), '클러스터')) } : null,
    // 일반 Load Balancer — 시간 요금만, 처리 요금 없음(트래픽은 인스턴스 네트워크 요금)
    lb: { provider: 'nhn', region, perHour: usd(priceOf(section(pages.lb, 'Load Balancer'), '일반 Load Balancer')), perGb: 0 },
    // NAT Gateway — 1개당 시간 요금만
    nat: has('nat') ? { provider: 'nhn', region, hourly: { per: 'gateway', usd: usd(priceOf(section(pages.nat, 'NAT Gateway'), 'NAT 게이트웨이 수')) }, perGb: 0 } : null,
    db: buildNhnDb(pages, region, krwPerUsd),
    cache: buildNhnCache(pages, region, krwPerUsd),
    container: buildNhnContainer(pages, region, krwPerUsd),
    cdn: buildNhnCdn(pages, region, krwPerUsd),
    logs: buildNhnLogs(pages, region, krwPerUsd),
  };
}
