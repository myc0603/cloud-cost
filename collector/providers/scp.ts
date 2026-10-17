/**
 * 삼성 SCP(Samsung Cloud Platform) 수집기 — 공식 요금 페이지가 import하는 정적 데이터 파일
 * `cloud.samsungsds.com/serviceportal/assets/js/data/price/{서비스}Price.js`(인증 불필요)를 받아 파싱한다.
 * 파일은 `export default { [REGION.X]: { [TABLE_NAME.Y.Z]: { [CURRENCY.KRW]: [[...행], ...] } } }` 형태의 JS 모듈이다 —
 * 원격 코드를 실행하지 않고 해당 리전·표·통화의 배열 리터럴만 잘라 파싱한다(문자열·숫자·null만 허용).
 *
 * 가격은 원화(VAT 별도)를 쓴다. USD 표도 있지만 고정 환율(약 1,150원)로 계산된 값이라 원화로 보면 실제보다 비싸게 나온다 →
 * 원화를 수집 시점 환율로 USD 환산(NCP와 같은 방식, 원화 표시는 SCP 금액 그대로).
 * 단위는 요금 페이지 문구(i18nPricing.js)로 확인: 서버·DB·캐시·NAT·LB·K8s는 원/시간, 약정(Planned Compute)은 원/월,
 * 블록·오브젝트는 원/GB·월, 트래픽·LB 처리·CDN·로그는 원/GB (2026-10-17).
 *
 * 파이프라인: fetchScpPriceFiles → buildScpSnapshot
 */

import type { CachePrice, CdnPrice, DbEnginePricing, DbPrice, EgressTier, LogPrice, PriceTier, Region, StorageSku, VmSku } from '../../src/lib/schema';
import { regionCodes } from '../../src/lib/regions';
import type { Snapshot } from '../validate';

export const SCP_REGION = regionCodes('scp');

const BASE = 'https://cloud.samsungsds.com/serviceportal/assets/js/data/price';

/** 받는 파일 — Planned Compute 파일은 무약정 시간 요금과 1·3년 약정 월 요금을 함께 담고 있어 VM·DB·캐시는 그것만 받는다 */
export const SCP_FILES = [
  'virtualServerPlannedCompute',
  'MysqlPlannedCompute',
  'PostgreSQLPlannedCompute',
  'cacheStorePlannedCompute',
  'blockStorage',
  'objStorage',
  'vpc',
  'k8sEngine',
  'loadBalancer',
  'gcdn',
  'serviceWatch',
] as const;

export type ScpFiles = Record<(typeof SCP_FILES)[number], string>;

export async function fetchScpPriceFiles(): Promise<ScpFiles> {
  const out = {} as ScpFiles;
  for (const name of SCP_FILES) {
    const res = await fetch(`${BASE}/${name}Price.js`);
    if (!res.ok) throw new Error(`SCP 요금 파일 ${name} 응답 ${res.status}`);
    out[name] = await res.text();
  }
  return out;
}

type Cell = string | number | null;

/** 배열 리터럴 파서 — `[` 위치부터 짝이 맞는 `]`까지. 문자열(' "), 숫자, null, 중첩 배열, 끝 쉼표만 허용 */
export function parseArrayLiteral(src: string, start: number): Cell[][] {
  let i = start;
  const ws = () => {
    while (i < src.length && /[\s,]/.test(src[i])) i++;
  };
  const value = (): unknown => {
    ws();
    const c = src[i];
    if (c === '[') {
      i++;
      const arr: unknown[] = [];
      for (;;) {
        ws();
        if (src[i] === ']') {
          i++;
          return arr;
        }
        arr.push(value());
      }
    }
    if (c === "'" || c === '"') {
      const end = src.indexOf(c, i + 1);
      const s = src.slice(i + 1, end);
      i = end + 1;
      return s;
    }
    const m = /^(null|-?\d+(?:\.\d+)?)/.exec(src.slice(i));
    if (!m) throw new Error(`SCP 요금 파일 파싱 실패: ${src.slice(i, i + 30)}`);
    i += m[0].length;
    return m[1] === 'null' ? null : Number(m[1]);
  };
  return value() as Cell[][];
}

/** 리전·표의 원화 행 — 표 키는 `TABLE_NAME.` 뒤 경로(예: 'VIRTUAL_SERVER_PLANNED_COMPUTE.GENERAL_3'). 없으면 수집 실패 */
export function scpRows(file: string, region: string, table: string): Cell[][] {
  const regionAt = file.indexOf(`[REGION.${region}]`);
  if (regionAt < 0) throw new Error(`SCP 리전 ${region} 없음`);
  const nextRegion = file.indexOf('[REGION.', regionAt + 1);
  const regionSrc = file.slice(regionAt, nextRegion < 0 ? undefined : nextRegion);
  const tableAt = regionSrc.indexOf(`[TABLE_NAME.${table}]`);
  if (tableAt < 0) throw new Error(`SCP 표 ${table} 없음 (${region})`);
  const krwAt = regionSrc.indexOf('[CURRENCY.KRW]', tableAt);
  const arrayAt = regionSrc.indexOf('[', krwAt + '[CURRENCY.KRW]'.length);
  const rows = parseArrayLiteral(regionSrc, arrayAt);
  if (rows.length === 0) throw new Error(`SCP 표 ${table} 원화 행이 비어 있음 (${region})`);
  return rows;
}

/** 행에서 마지막 숫자 칸 — 단가 하나짜리 표(라벨, 단가) 용 */
const lastNumber = (row: Cell[]) => {
  const n = [...row].reverse().find((c) => typeof c === 'number' || (typeof c === 'string' && /^\d+(\.\d+)?$/.test(c)));
  if (n === undefined) throw new Error(`SCP 단가 칸 없음: ${JSON.stringify(row)}`);
  return Number(n);
};

const HOURS_PER_MONTH = 730;
const r6 = (x: number) => +x.toFixed(6);

/**
 * VM — 3세대 일반(GENERAL_3)·대용량(LARGE_3) Virtual Server, 오픈소스 OS 열.
 * 행: [타입, vCore, 메모리, 무약정(오픈소스·RHEL·Windows, 원/시간), 1년(…, 원/월), 3년(…, 원/월)].
 * 약정 = Planned Compute(인스턴스 타입 고정 1·3년 약정, 월 요금 ÷ 730) — 3사 고정형 예약과 대응. Cost Savings(시간당 금액 약정)는 유연형이라 미사용.
 * 1·2세대(Intel Ice Lake·Sapphire Rapids)는 구세대라 제외. ARM·버스트 없음.
 */
export function buildScpVmSkus(files: ScpFiles, region: Region, krwPerUsd: number): VmSku[] {
  const out: VmSku[] = [];
  for (const table of ['GENERAL_3', 'LARGE_3']) {
    for (const row of scpRows(files.virtualServerPlannedCompute, SCP_REGION[region], `VIRTUAL_SERVER_PLANNED_COMPUTE.${table}`)) {
      const [sku, vcpu, ram, od, , , y1, , , y3] = row;
      out.push({
        provider: 'scp',
        region,
        sku: String(sku),
        vcpu: Number(vcpu),
        ramGb: Number(ram),
        burstable: false,
        arch: 'x86',
        generation: table === 'GENERAL_3' ? 'general-g3' : 'large-g3',
        pricePerHour: r6(Number(od) / krwPerUsd),
        commit: { '1y': r6(Number(y1) / HOURS_PER_MONTH / krwPerUsd), '3y': r6(Number(y3) / HOURS_PER_MONTH / krwPerUsd) },
      });
    }
  }
  return out;
}

/** 블록 = SSD(원/GB·월, 5만GB 초과 구간 할인은 대규모라 미반영), 오브젝트 = Object Storage(원/GB·월) */
function blockSsdKrw(files: ScpFiles, region: Region): number {
  const ssd = scpRows(files.blockStorage, SCP_REGION[region], 'BLOCK_STORAGE.DEFAULT').find((r) => r[0] === 'SSD');
  if (!ssd) throw new Error('SCP 블록 스토리지 SSD 요금 없음');
  return lastNumber(ssd);
}

export function buildScpStorage(files: ScpFiles, region: Region, krwPerUsd: number): StorageSku[] {
  return [
    { provider: 'scp', region, kind: 'block-ssd', pricePerGbMonth: r6(blockSsdKrw(files, region) / krwPerUsd) },
    { provider: 'scp', region, kind: 'object-standard', pricePerGbMonth: r6(lastNumber(scpRows(files.objStorage, SCP_REGION[region], 'OBJ_STORAGE.DEFAULT')[0]) / krwPerUsd) },
  ];
}

/**
 * 인터넷 아웃바운드 트래픽 — 구간: 20GB 이하('-', 무료) · ~5TB · ~10TB · ~30TB · 초과. 구간 경계는 요금 페이지 문구값
 * (요금 예시 "10TB = 5,100GB × 1구간 + 5,120GB × 2구간"으로 20GB 무료 확인)
 */
const EGRESS_BOUNDS: (number | null)[] = [20, 5120, 10240, 30720, null];

export function buildScpEgress(files: ScpFiles, region: Region, krwPerUsd: number): EgressTier {
  const rows = scpRows(files.vpc, SCP_REGION[region], 'VPC.OUTBOUND_TRAFFIC');
  if (rows.length !== EGRESS_BOUNDS.length) throw new Error(`SCP 트래픽 구간 수가 예상과 다름: ${rows.length}`);
  return {
    provider: 'scp',
    region,
    freeGb: 20,
    tiers: rows.map((r, i) => ({ upToGb: EGRESS_BOUNDS[i], pricePerGb: r[1] === '-' ? 0 : r6(lastNumber(r) / krwPerUsd) })),
  };
}

/**
 * DB(DBaaS) — 3세대 일반(STANDARD_3)·대용량(HIGH_CAPACITY_3). 행: [타입, vCore, 메모리, 무약정(원/시간), 1년(원/월), 3년(원/월)].
 * 고가용성 = Active-Standby 2대가 각자 스토리지를 가진 구조(samsungsds.com MySQL 페이지) → 컴퓨트·스토리지 2배.
 * 데이터 스토리지 요금은 DB 요금표에 없어 Block Storage SSD 단가로 본다(추정, methodology 고지).
 */
function scpDbEngine(file: string, prefix: string, region: Region, krwPerUsd: number, storageKrw: number): DbEnginePricing {
  const instances = ['STANDARD_3', 'HIGH_CAPACITY_3'].flatMap((t) =>
    scpRows(file, SCP_REGION[region], `${prefix}.${t}`).map(([sku, vcpu, ram, od, y1, y3]) => {
      const perHour = r6(Number(od) / krwPerUsd);
      const c1 = r6(Number(y1) / HOURS_PER_MONTH / krwPerUsd);
      const c3 = r6(Number(y3) / HOURS_PER_MONTH / krwPerUsd);
      return {
        sku: String(sku),
        vcpu: Number(vcpu),
        ramGb: Number(ram),
        burstable: false,
        perHour,
        haPerHour: r6(perHour * 2),
        commit: { '1y': { perHour: c1, haPerHour: r6(c1 * 2) }, '3y': { perHour: c3, haPerHour: r6(c3 * 2) } },
      };
    }),
  );
  const storage = r6(storageKrw / krwPerUsd);
  return { instances, custom: null, storageGbMonth: storage, haStorageGbMonth: r6(storage * 2) };
}

export function buildScpDb(files: ScpFiles, region: Region, krwPerUsd: number): DbPrice {
  const storageKrw = blockSsdKrw(files, region);
  return {
    provider: 'scp',
    region,
    engines: {
      mysql: scpDbEngine(files.MysqlPlannedCompute, 'MYSQL_PLANNED_COMPUTE', region, krwPerUsd, storageKrw),
      postgres: scpDbEngine(files.PostgreSQLPlannedCompute, 'POSTGRE_SQL_PLANNED_COMPUTE', region, krwPerUsd, storageKrw),
    },
  };
}

/**
 * CacheStore(DBaaS, Redis·Valkey) — 3세대 일반. 서버형이라 노드 메모리 = 서버 메모리로 본다(Redis가 쓸 수 있는 양은 그보다 약간 작음).
 * 이중화 = 복제 노드 1대 → 2배. 약정 = Planned Compute
 */
export function buildScpCache(files: ScpFiles, region: Region, krwPerUsd: number): CachePrice {
  const nodes = scpRows(files.cacheStorePlannedCompute, SCP_REGION[region], 'CACHE_STORE_PLANNED_COMPUTE.STANDARD_3').map(([sku, , ram, od, y1, y3]) => {
    const perHour = r6(Number(od) / krwPerUsd);
    const c1 = r6(Number(y1) / HOURS_PER_MONTH / krwPerUsd);
    const c3 = r6(Number(y3) / HOURS_PER_MONTH / krwPerUsd);
    return {
      sku: String(sku).split('/')[0],
      memoryGb: Number(ram),
      burstable: false,
      perHour,
      haPerHour: r6(perHour * 2),
      commit: { '1y': { perHour: c1, haPerHour: r6(c1 * 2) }, '3y': { perHour: c3, haPerHour: r6(c3 * 2) } },
    };
  });
  // 같은 메모리 크기는 최저가 1개만 (vCore만 다른 행)
  const byGb = new Map<number, (typeof nodes)[number]>();
  for (const n of nodes) if (!byGb.has(n.memoryGb) || n.perHour < byGb.get(n.memoryGb)!.perHour) byGb.set(n.memoryGb, n);
  return { provider: 'scp', region, engine: 'Redis', nodes: [...byGb.values()], gbTiers: null };
}

/** Global CDN — 월 전송량 구간(원/GB). 요청 요금은 요금표에 없음. 구간 경계는 요금 페이지 문구값(200GB·10TB·50TB·150TB·500TB) */
const CDN_BOUNDS: (number | null)[] = [200, 10240, 51200, 153600, 512000, null];

export function buildScpCdn(files: ScpFiles, region: Region, krwPerUsd: number): CdnPrice {
  const rows = scpRows(files.gcdn, SCP_REGION[region], 'GCDN.DEFAULT');
  if (rows.length !== CDN_BOUNDS.length) throw new Error(`SCP CDN 구간 수가 예상과 다름: ${rows.length}`);
  const gbTiers: PriceTier[] = rows.map((r, i) => ({ upTo: CDN_BOUNDS[i], price: r6(lastNumber(r) / krwPerUsd) }));
  return { provider: 'scp', region, gbTiers, requestTiers: [{ upTo: null, price: 0 }], monthlyBase: 0, fillPerGb: 0, plans: [] };
}

/** ServiceWatch 로그 — GB당(원). 보관 요금은 요금표에 없어 수집 요금만(methodology 고지). 월 5GB 무료는 계정 단위라 미반영 */
export function buildScpLogs(files: ScpFiles, region: Region, krwPerUsd: number): LogPrice {
  const row = scpRows(files.serviceWatch, SCP_REGION[region], 'SERVICE_WATCH.DEFAULT').find((r) => String(r[0]).includes('serviceWatch.type1'));
  if (!row) throw new Error('SCP ServiceWatch 로그 요금 없음');
  return { provider: 'scp', region, ingestPerGb: r6(lastNumber(row.slice(0, 3)) / krwPerUsd), storagePerGbMonth: 0, includedDays: 0, storedRatio: 1, commitmentTiers: [] };
}

/** 리전 하나의 스냅샷. 서버리스 컨테이너는 미제공(providers.ts NOT_OFFERED) → null */
export function buildScpSnapshot(files: ScpFiles, region: Region, krwPerUsd: number): Snapshot {
  const code = SCP_REGION[region];
  const usd = (krw: number) => r6(krw / krwPerUsd);
  const lb = scpRows(files.loadBalancer, code, 'LOAD_BALANCER.DEFAULT')[0];
  const lbTraffic = scpRows(files.loadBalancer, code, 'LOAD_BALANCER.TRAFFIC')[0];
  return {
    vms: buildScpVmSkus(files, region, krwPerUsd),
    storage: buildScpStorage(files, region, krwPerUsd),
    egress: buildScpEgress(files, region, krwPerUsd),
    // Kubernetes Engine — 클러스터당 시간 요금(Control plane 포함, 워커 노드 별도)
    k8s: { provider: 'scp', region, clusterPerHour: usd(lastNumber(scpRows(files.k8sEngine, code, 'K8S_ENGINE.DEFAULT')[0].slice(0, 2))) },
    // Load Balancer — LB당 시간 + 인입 트래픽 GB당
    lb: { provider: 'scp', region, perHour: usd(lastNumber(lb)), perGb: usd(lastNumber(lbTraffic)) },
    // NAT Gateway — 시간 요금만 (처리 GB 요금 없음)
    nat: { provider: 'scp', region, hourly: { per: 'gateway', usd: usd(lastNumber(scpRows(files.vpc, code, 'VPC.NAT_GATEWAY')[0])) }, perGb: 0 },
    db: buildScpDb(files, region, krwPerUsd),
    cache: buildScpCache(files, region, krwPerUsd),
    container: null,
    cdn: buildScpCdn(files, region, krwPerUsd),
    logs: buildScpLogs(files, region, krwPerUsd),
  };
}
