/**
 * 관리형 DB 리소스 (RDS · Azure Database Flexible Server · Cloud SQL Enterprise) — 컴퓨트 + 스토리지 두 줄.
 * - AWS·Azure: 정해진 사이즈 목록에서 스펙 만족 최저가 (VM과 같은 규칙, 드롭다운 선택 가능)
 * - GCP: 커스텀 사이즈를 요구 스펙에 맞게 계산 (규칙은 아래 상수, 공식 문서값)
 * 이중화(HA)는 3사 모두 대기 서버 포함 단가를 쓴다 (컴퓨트·스토리지 ≈ 2배). 아키텍처 토글은 적용 안 함 —
 * 관리형 DB는 앱 코드가 올라가지 않아 ARM 호환성 문제가 없다. 버스트 포함 옵션·약정 기간은 따른다.
 */

import type { DbEngine, DbInstance, DbRateSet } from '../schema';
import {
  HOURS_PER_MONTH,
  parsePositiveInt,
  priceAt,
  round2,
  type DbMatch,
  type MatchOptions,
  type NoMatchReason,
  type Resource,
  type ResourceDef,
  type VmSpec,
} from './types';
import { cheapestPerSize } from './vm';

/**
 * Cloud SQL Enterprise 커스텀 사이즈 규칙 — cloud.google.com/sql/docs/mysql/instance-settings (2026-10-11 확인).
 * vCPU: 1 또는 2~96 사이 짝수 / RAM: vCPU당 0.9~6.5GB, 256MB 단위, 최소 3.75GB. 공유 코어(SLA 없음)는 제외.
 */
const GCP_SQL = { maxVcpu: 96, minRamPerVcpu: 0.9, maxRamPerVcpu: 6.5, minRamGb: 3.75, ramStepGb: 0.25 };
const GCP_SQL_VCPUS = [1, ...Array.from({ length: GCP_SQL.maxVcpu / 2 }, (_, i) => (i + 1) * 2)];

/** 요구 스펙을 만족하는 가장 싼 커스텀 사이즈. 만들 수 없으면 null. committed = 약정 단가(rates)로 계산했는지 */
export function fitCloudSqlShape(spec: VmSpec, rates: DbRateSet, ha: boolean, committed = false): DbMatch | null {
  const [cpuRate, ramRate] = ha ? [rates.haVcpuPerHour, rates.haRamGbPerHour] : [rates.vcpuPerHour, rates.ramGbPerHour];
  let best: DbMatch | null = null;
  for (const vcpu of GCP_SQL_VCPUS) {
    if (vcpu < spec.vcpu) continue;
    const minRam = Math.max(spec.ramGb, GCP_SQL.minRamPerVcpu * vcpu, GCP_SQL.minRamGb);
    const ramGb = Math.ceil(minRam / GCP_SQL.ramStepGb) * GCP_SQL.ramStepGb;
    if (ramGb > GCP_SQL.maxRamPerVcpu * vcpu) continue;
    const perHour = +(vcpu * cpuRate + ramGb * ramRate).toFixed(6);
    if (!best || perHour < best.perHour) best = { sku: `db-custom-${vcpu}-${ramGb * 1024}`, vcpu, ramGb, perHour, committed };
  }
  return best;
}

/** 정해진 사이즈 목록에서 후보 — 버스트 옵션·HA 지원 여부 필터 후 스펙 만족, 가격 오름차순(동가면 vCPU 작은 것) */
function instanceCandidates(instances: DbInstance[], spec: VmSpec, opts: MatchOptions, ha: boolean) {
  const pool = instances.filter((i) => (opts.includeBurstable || !i.burstable) && (!ha || i.haPerHour !== null));
  const toMatch = (i: DbInstance): DbMatch => {
    // 약정가가 있어도 이중화 약정가가 없으면(RDS Multi-AZ 3년 일부) 정가
    const c = opts.term ? i.commit?.[opts.term] : undefined;
    const committedPrice = c && (ha ? c.haPerHour : c.perHour);
    return committedPrice
      ? { sku: i.sku, vcpu: i.vcpu, ramGb: i.ramGb, perHour: committedPrice, committed: true }
      : { sku: i.sku, vcpu: i.vcpu, ramGb: i.ramGb, perHour: ha ? i.haPerHour! : i.perHour, committed: false };
  };
  const candidates = cheapestPerSize(
    pool
      .filter((i) => i.vcpu >= spec.vcpu && i.ramGb >= spec.ramGb)
      .map(toMatch)
      .sort((a, b) => a.perHour - b.perHour || a.vcpu - b.vcpu),
  );
  const noMatch: NoMatchReason | null =
    candidates.length > 0 || pool.length === 0
      ? null
      : { reason: 'size', maxVcpu: Math.max(...pool.map((i) => i.vcpu)), maxRamGb: Math.max(...pool.map((i) => i.ramGb)) };
  return { candidates, noMatch };
}

const ENGINE_TOKEN: Record<DbEngine, string> = { mysql: 'mysql', postgres: 'pg' };

/** URL 본문: pg:2c8g:100:1:1 (엔진 : 스펙 : 인스턴스당 스토리지 GB : 이중화 0/1 : 인스턴스 수) */
export const DB: ResourceDef<Extract<Resource, { type: 'db' }>> = {
  token: 'db',
  create: () => ({ type: 'db', engine: 'postgres', vcpu: 2, ramGb: 8, storageGb: 100, ha: false, count: 1 }),
  encode: (r) => `${ENGINE_TOKEN[r.engine]}:${r.vcpu}c${r.ramGb}g:${r.storageGb}:${r.ha ? 1 : 0}:${r.count}`,
  decode: (body) => {
    const m = body.match(/^(mysql|pg):(\d+)c(\d+)g:(\d+):([01]):(\d+)$/);
    if (!m) return null;
    const [vcpu, ramGb, storageGb, count] = [m[2], m[3], m[4], m[6]].map(parsePositiveInt);
    if (!vcpu || !ramGb || !storageGb || !count) return null;
    return { type: 'db', engine: m[1] === 'pg' ? 'postgres' : 'mysql', vcpu, ramGb, storageGb, ha: m[5] === '1', count };
  },
  estimate: (r, { index, pricing, opts, pick }) => {
    const p = pricing.db?.engines[r.engine] ?? null;
    const spec: VmSpec = { vcpu: r.vcpu, ramGb: r.ramGb, count: r.count };

    let candidates: DbMatch[] = [];
    let noMatch: NoMatchReason | null = null;
    if (p?.custom) {
      const { price: rates, committed } = priceAt<DbRateSet>(p.custom, p.custom.commit, opts.term);
      const fit = fitCloudSqlShape(spec, rates, r.ha, committed);
      candidates = fit ? [fit] : [];
      if (!fit) noMatch = { reason: 'size', maxVcpu: GCP_SQL.maxVcpu, maxRamGb: GCP_SQL.maxVcpu * GCP_SQL.maxRamPerVcpu };
    } else if (p) {
      ({ candidates, noMatch } = instanceCandidates(p.instances, spec, opts, r.ha));
    }
    // 고른 SKU가 후보에 있으면 그걸, 아니면 최저가로 self-heal (VM과 동일)
    const matched = candidates.find((c) => c.sku === pick) ?? candidates[0] ?? null;
    const perGbMonth = p ? (r.ha ? p.haStorageGbMonth : p.storageGbMonth) : null;

    return [
      {
        resourceIndex: index,
        kind: 'db',
        engine: r.engine,
        ha: r.ha,
        spec,
        matched,
        candidates,
        noMatch,
        monthlyUsd: matched ? round2(matched.perHour * HOURS_PER_MONTH * r.count) : null,
      },
      {
        resourceIndex: index,
        kind: 'db-storage',
        storageGb: r.storageGb,
        count: r.count,
        ha: r.ha,
        perGbMonth,
        monthlyUsd: perGbMonth === null ? null : round2(perGbMonth * r.storageGb * r.count),
      },
    ];
  },
};
