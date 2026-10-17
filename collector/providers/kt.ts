/**
 * KT Cloud 수집기 — 공식 상품 페이지가 쓰는 API(인증 불필요)에서 상품별 요금 문서를 받아 표를 파싱한다.
 *   - 상품 ID: POST `api.cloud.kt.com/api/menu/ctgryProdList` (상품 이름 → prodId)
 *   - 요금: POST `api.cloud.kt.com/api/prod/prodDetail` {prodId} → prodChageList[].prodChageItemList[].chageItemSbst (편집기로 쓴 HTML)
 * 요금 문서는 사람이 편집한 HTML 표라 열 위치가 상품마다 다르다 — 표 머리글·행 라벨 패턴으로 찾고, 못 찾으면 수집 실패(조용히 0원 금지).
 *
 * 플랫폼: D1(DX-M1 존) — Managed KS 워커 노드·DBaaS가 D1 기준이라 VM도 D1 열로 맞춘다. 리전은 서울만.
 * 가격은 원화(VAT 별도) → 수집 시점 환율로 USD. VM·K8s 클러스터는 월 요금 ÷ 730(한 달 내내 쓰면 시간 요금 × 730보다 싸다).
 * 약정 = 온라인 VM 약정 할인율(1년·3년, Server VM 전용). NAT·캐시(오픈 베타 무료)·로그·서버리스 컨테이너는 공개 요금이 없어 미제공.
 *
 * 파이프라인: fetchKtDocs → buildKtSnapshot
 */

import type { CdnPrice, DbEnginePricing, DbPrice, EgressTier, PriceTier, Region, StorageSku, VmSku } from '../../src/lib/schema';
import type { Snapshot } from '../validate';

const API = 'https://api.cloud.kt.com/api';

/** 쓰는 상품 — 키 = 상품 목록의 이름(앞뒤 공백 제거) */
export const KT_PRODUCTS = {
  server: 'Server',
  object: 'Object Storage',
  lb: 'Load Balancer',
  ks: 'Managed KS',
  mysql: 'DBaaS for MySQL',
  postgres: 'DBaaS for PostgreSQL',
  cdn: 'CDN Standard',
} as const;

export type KtProduct = keyof typeof KT_PRODUCTS;

/** 상품별 요금 문서 HTML (요금 항목을 이어 붙인 것) */
export type KtDocs = Record<KtProduct, string>;

async function post<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json; charset=UTF-8', Origin: 'https://cloud.kt.com', Referer: 'https://cloud.kt.com/' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`KT ${path} 응답 ${res.status}`);
  return (await res.json()) as T;
}

export async function fetchKtDocs(): Promise<KtDocs> {
  const menu = await post<{ result: { prodList?: { prodId: string; prodNm: string }[] }[] }>('/menu/ctgryProdList', {});
  const idOf = new Map(menu.result.flatMap((c) => c.prodList ?? []).map((p) => [p.prodNm.trim(), p.prodId]));
  const out = {} as KtDocs;
  for (const [key, name] of Object.entries(KT_PRODUCTS) as [KtProduct, string][]) {
    const prodId = idOf.get(name);
    if (!prodId) throw new Error(`KT 상품 "${name}" ID 없음`);
    const detail = await post<{ result: { prodChageList: { prodChageItemList: { chageItemSbst: string | null }[] }[] } }>('/prod/prodDetail', { prodId });
    out[key] = detail.result.prodChageList.flatMap((c) => c.prodChageItemList.map((i) => i.chageItemSbst ?? '')).join('\n');
  }
  return out;
}

const text = (html: string) =>
  html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim();

/** 문서의 모든 표 — 표마다 행(셀 텍스트) */
export function ktTables(html: string): string[][][] {
  return [...html.matchAll(/<table[\s\S]*?<\/table>/g)].map((t) =>
    [...t[0].matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)].map((tr) => [...tr[1].matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/g)].map((c) => text(c[1]))),
  );
}

/** 머리글·내용에 문구가 들어 있는 첫 표. 없으면 수집 실패 */
function tableWith(html: string, needle: string): string[][] {
  const t = ktTables(html).find((rows) => rows.some((r) => r.some((c) => c.includes(needle))));
  if (!t) throw new Error(`KT 요금표 "${needle}" 없음`);
  return t;
}

/** 셀의 원화 금액 — '22,500원' · '₩ 99,125' · '42원 / 시간' → 숫자. 금액이 아니면 null */
export function won(cell: string): number | null {
  const m = cell.match(/₩\s*([\d,]+(?:\.\d+)?)|([\d,]+(?:\.\d+)?)\s*원/);
  const n = m?.[1] ?? m?.[2];
  return n ? Number(n.replace(/,/g, '')) : null;
}

const prices = (row: string[]) => row.map(won).filter((x): x is number => x !== null);
const ints = (row: string[]) => row.filter((c) => /^\d+$/.test(c)).map(Number);

/** 라벨 셀이 있는 행의 첫 원화 금액 */
function priceOfRow(rows: string[][], label: string): number {
  const row = rows.find((r) => r.some((c) => c.includes(label)));
  const p = row && prices(row)[0];
  if (p === undefined) throw new Error(`KT 요금표에 "${label}" 금액 없음`);
  return p;
}

const HOURS_PER_MONTH = 730;
const r6 = (x: number) => +x.toFixed(6);

/** 온라인 VM 약정 할인율 — "1 년 | 15%" 같은 행. Server VM 전용(DB·GPU 제외) */
function commitRates(html: string): { '1y': number; '3y': number } {
  const rows = tableWith(html, '약정 기간');
  const rate = (y: string) => {
    const row = rows.find((r) => r[0]?.replace(/\s/g, '') === y);
    const m = row?.[1]?.match(/(\d+)%/);
    if (!m) throw new Error(`KT ${y} 약정 할인율 없음`);
    return Number(m[1]) / 100;
  };
  return { '1y': rate('1년'), '3y': rate('3년') };
}

/**
 * VM — Server 요금표의 D1(DX-M1) 열. 행: [구분(표준·High Memory), vCore, Memory, D1 월, D1 시간, G2 월, G2 시간, G1 월, G1 시간], 미제공은 'X'.
 * 단가 = D1 월 요금 ÷ 730. 기본 디스크(Linux 20GB)는 서버 요금에 포함돼 있어 별도 블록 스토리지와 겹치지 않는다
 */
export function buildKtVmSkus(docs: KtDocs, region: Region, krwPerUsd: number): VmSku[] {
  const rows = tableWith(docs.server, 'D1 (DX-M1)');
  const rates = commitRates(docs.server);
  const out: VmSku[] = [];
  for (const r of rows) {
    if (r.length < 9 || !/^\d+$/.test(r[1]) || !/^\d+$/.test(r[2])) continue;
    const monthly = won(r[3]);
    if (monthly === null) continue; // D1 미제공 사양
    const highMem = r[0].includes('High');
    const perHour = monthly / HOURS_PER_MONTH;
    out.push({
      provider: 'kt',
      region,
      sku: `d1.${highMem ? 'hm' : 'std'}.${r[1]}c${r[2]}g`,
      vcpu: Number(r[1]),
      ramGb: Number(r[2]),
      burstable: false,
      arch: 'x86',
      generation: highMem ? 'high-memory' : 'standard',
      pricePerHour: r6(perHour / krwPerUsd),
      commit: { '1y': r6((perHour * (1 - rates['1y'])) / krwPerUsd), '3y': r6((perHour * (1 - rates['3y'])) / krwPerUsd) },
    });
  }
  if (out.length === 0) throw new Error('KT D1 서버 요금이 비어 있음');
  return out;
}

/** 서버 디스크 SSD — "SSD DISK | 10GB | 1,400원 | 2원" (월 요금 10GB당, D 플랫폼 전 존) → 원/GB·월 */
function ssdDiskKrwPerGbMonth(docs: KtDocs): number {
  const row = tableWith(docs.server, 'SSD DISK').find((r) => r[0]?.startsWith('SSD DISK'));
  const monthly = row && prices(row)[0];
  const per = row && Number(row[1]?.match(/(\d+)\s*GB/)?.[1]);
  if (!monthly || !per) throw new Error('KT SSD DISK 요금 없음');
  return monthly / per;
}

export function buildKtStorage(docs: KtDocs, region: Region, krwPerUsd: number): StorageSku[] {
  // 오브젝트: Standard 저장량 첫 구간(10TB 이하) "30원/1GB"
  const objRow = tableWith(docs.object, 'Economy').find((r) => r[0]?.includes('10TB 이하'));
  const obj = objRow && prices(objRow)[0];
  if (!obj) throw new Error('KT Object Storage Standard 요금 없음');
  return [
    { provider: 'kt', region, kind: 'block-ssd', pricePerGbMonth: r6(ssdDiskKrwPerGbMonth(docs) / krwPerUsd) },
    { provider: 'kt', region, kind: 'object-standard', pricePerGbMonth: r6(obj / krwPerUsd) },
  ];
}

/**
 * 인터넷 트래픽 — 서버 1대마다 무료량(메모리 16GB 미만 512GB, 이상 1TB), 계정 합산. 초과분 1~10TB 90원 · 10~20TB 80원 · 20TB~ 70원.
 * 표: [서버 스펙 | 0~512GB | 512GB~1TB | 1~10TB | 10~20TB | 20TB~]. 같은 페이지 예시 문장은 "1TB + 2TB"로 표와 어긋나 표 값을 쓴다
 */
export function buildKtEgress(docs: KtDocs, region: Region, krwPerUsd: number): EgressTier {
  const rows = tableWith(docs.server, 'Cloud 서버 스펙별');
  const small = rows.find((r) => r[0]?.includes('미만'));
  const large = rows.find((r) => r[0]?.includes('이상'));
  if (!small || !large || small[1] !== '무료' || small[2] === '무료' || large[2] !== '무료') throw new Error('KT 트래픽 요금표 형식이 예상과 다름');
  const [t1, t2, t3] = prices(large);
  if (t1 === undefined || t2 === undefined || t3 === undefined) throw new Error('KT 트래픽 구간 요금 없음');
  return {
    provider: 'kt',
    region,
    freeGb: 0,
    tiers: [
      { upToGb: 10240, pricePerGb: r6(t1 / krwPerUsd) },
      { upToGb: 20480, pricePerGb: r6(t2 / krwPerUsd) },
      { upToGb: null, pricePerGb: r6(t3 / krwPerUsd) },
    ],
    perServerFree: { gb: 512, largeGb: 1024, largeFromRamGb: 16 },
  };
}

/**
 * DBaaS for MySQL·PostgreSQL (D 플랫폼) — 표: [VM 구분, vCore, Memory, (Memory Type, Root Disk, Type), 월 요금, 시간 요금]. 단가 = 월 요금 ÷ 730.
 * 이중화: PostgreSQL Master/Replica = DB VM 2대 + Monitor VM 1대(문서 명시), MySQL Cluster = DB 노드 3대(최소 노드 수 미공개 — InnoDB Cluster 최소 구성으로 추정) + Router VM 2대.
 * 스토리지: Data Volume SSD + 인스턴스마다 백업용 볼륨(데이터의 2배, 문서 명시) → 단독 3배, 이중화는 노드 수 + 2배
 */
function ktDbEngine(html: string, auxLabel: string, haNodes: number, auxVms: number, krwPerUsd: number): DbEnginePricing {
  const rows = tableWith(html, 'VM 구분');
  const auxRow = rows.find((r) => r[0]?.includes(auxLabel));
  const aux = auxRow && prices(auxRow)[0];
  if (!aux) throw new Error(`KT ${auxLabel} VM 요금 없음`);
  const auxPerHour = aux / HOURS_PER_MONTH;
  const instances = rows.flatMap((r) => {
    if (r[0]?.includes(auxLabel) || r.some((c) => c.includes('VM 구분'))) return [];
    const [vcpu, ram] = ints(r);
    const [monthly] = prices(r);
    if (!vcpu || !ram || !monthly) return [];
    const perHour = monthly / HOURS_PER_MONTH;
    return [{ sku: `${vcpu}c${ram}g`, vcpu, ramGb: ram, burstable: false, perHour: r6(perHour / krwPerUsd), haPerHour: r6((perHour * haNodes + auxPerHour * auxVms) / krwPerUsd) }];
  });
  if (instances.length === 0) throw new Error(`KT DB 요금이 비어 있음 (${auxLabel})`);
  const ssdRow = tableWith(html, 'Data Volume').find((r) => r.includes('SSD') && r.includes('10'));
  const ssd10 = ssdRow && prices(ssdRow)[0];
  if (!ssd10) throw new Error('KT DB Data Volume SSD 요금 없음');
  const perGb = ssd10 / 10;
  return { instances, custom: null, storageGbMonth: r6((perGb * 3) / krwPerUsd), haStorageGbMonth: r6((perGb * (haNodes + 2)) / krwPerUsd) };
}

export function buildKtDb(docs: KtDocs, region: Region, krwPerUsd: number): DbPrice {
  return {
    provider: 'kt',
    region,
    engines: {
      mysql: ktDbEngine(docs.mysql, 'Router', 3, 2, krwPerUsd),
      postgres: ktDbEngine(docs.postgres, 'Monitor', 2, 1, krwPerUsd),
    },
  };
}

/** CDN Standard — 인터넷 전송 구간(원/GB) + 요청 1만 건당. 구간 경계는 요금표 문구값(200GB·10TB·50TB·150TB·500TB) */
const CDN_BOUNDS: (number | null)[] = [200, 10240, 51200, 153600, 512000, null];

export function buildKtCdn(docs: KtDocs, region: Region, krwPerUsd: number): CdnPrice {
  const rows = tableWith(docs.cdn, '사용량 구간').filter((r) => prices(r).length > 0);
  const request = rows.find((r) => r.some((c) => c.includes('10,000')));
  const transfer = rows.filter((r) => r !== request);
  if (!request || transfer.length !== CDN_BOUNDS.length) throw new Error(`KT CDN 요금표 형식이 예상과 다름: 전송 ${transfer.length}구간`);
  const gbTiers: PriceTier[] = transfer.map((r, i) => ({ upTo: CDN_BOUNDS[i], price: r6(prices(r).at(-1)! / krwPerUsd) }));
  return { provider: 'kt', region, gbTiers, requestTiers: [{ upTo: null, price: r6(prices(request).at(-1)! / krwPerUsd) }], monthlyBase: 0, fillPerGb: 0, plans: [] };
}

/** 리전(서울) 스냅샷. NAT·캐시·로그·컨테이너는 미제공(providers.ts NOT_OFFERED) → null */
export function buildKtSnapshot(docs: KtDocs, region: Region, krwPerUsd: number): Snapshot {
  const usd = (k: number) => r6(k / krwPerUsd);
  const lb = tableWith(docs.lb, '로드밸런서 이용 요금');
  const ks = tableWith(docs.ks, '클러스터');
  return {
    vms: buildKtVmSkus(docs, region, krwPerUsd),
    storage: buildKtStorage(docs, region, krwPerUsd),
    egress: buildKtEgress(docs, region, krwPerUsd),
    // Managed KS 클러스터 — 월 요금 ÷ 730
    k8s: { provider: 'kt', region, clusterPerHour: usd(priceOfRow(ks, '클러스터') / HOURS_PER_MONTH) },
    // Load Balancer — 시간 요금 + 데이터 처리량 GB당
    lb: { provider: 'kt', region, perHour: usd(priceOfRow(lb, '로드밸런서 이용 요금')), perGb: usd(priceOfRow(lb, '데이터 처리량')) },
    nat: null,
    db: buildKtDb(docs, region, krwPerUsd),
    cache: null,
    container: null,
    cdn: buildKtCdn(docs, region, krwPerUsd),
    logs: null,
  };
}
