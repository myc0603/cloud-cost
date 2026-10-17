/**
 * 로그 수집 리소스 — AWS CloudWatch Logs / Azure Log Analytics / GCP Cloud Logging.
 * 수집 = 월 GB × 단가 (Azure는 Commitment Tier 중 더 싼 쪽), 보관 = 정상 상태에서 쌓인 양 중 기본 포함 기간을 넘는 분.
 * 요금제가 여러 개(NCP Standard·Premium)면 한도(보관 일수·하루 수집량·보관량) 안에 드는 것 중 가장 싼 쪽, 하나도 안 들면 "미제공".
 */

import type { LogPrice } from '../schema';
import { HOURS_PER_MONTH, parsePositiveInt, round2, type Resource, type ResourceDef } from './types';

/** 보관 기간 선택지(일) */
export const LOG_RETENTION_DAYS = [30, 90, 180, 365, 730];

const DAYS_PER_MONTH = HOURS_PER_MONTH / 24;

/** 월 비용과 적용한 Commitment Tier(GB/일, 종량제면 null) */
export function logsMonthly(price: LogPrice, gb: number, retentionDays: number): { usd: number; commitmentGbPerDay: number | null } {
  let ingest = gb * price.ingestPerGb;
  let commitmentGbPerDay: number | null = null;
  for (const t of price.commitmentTiers) {
    // 약정분은 사용과 무관하게 과금, 초과분은 등급 실효 단가(일 요금 ÷ 약정 GB)
    const cost = t.perDay * DAYS_PER_MONTH + Math.max(0, gb - t.gbPerDay * DAYS_PER_MONTH) * (t.perDay / t.gbPerDay);
    if (cost < ingest) [ingest, commitmentGbPerDay] = [cost, t.gbPerDay];
  }
  const billedMonths = Math.max(0, retentionDays - price.includedDays) / DAYS_PER_MONTH;
  const storage = gb * billedMonths * price.storedRatio * price.storagePerGbMonth;
  return { usd: ingest + storage, commitmentGbPerDay };
}

/**
 * 요금제 한도 안인지 — 최대 보관 일수, 하루 수집량(월 GB ÷ 월 일수), 정상 상태 보관량(월 GB × 보관 일수 ÷ 월 일수).
 * 한도가 없는 필드는 통과
 */
function fits(p: LogPrice, gb: number, retentionDays: number): boolean {
  return (
    (p.maxRetentionDays === undefined || retentionDays <= p.maxRetentionDays) &&
    (p.maxGbPerDay === undefined || gb / DAYS_PER_MONTH <= p.maxGbPerDay) &&
    (p.maxStoredGb === undefined || (gb * retentionDays) / DAYS_PER_MONTH <= p.maxStoredGb)
  );
}

/** URL 본문: 100:30 (월 수집 GB : 보관 일수) */
export const LOGS: ResourceDef<Extract<Resource, { type: 'logs' }>> = {
  token: 'log',
  singleton: true, // Commitment Tier가 전체 수집량 기준이라 카드를 나누면 등급 판단이 틀어진다
  create: () => ({ type: 'logs', gb: 100, retentionDays: 30 }),
  encode: (r) => `${r.gb}:${r.retentionDays}`,
  decode: (body) => {
    const m = body.match(/^(\d+):(\d+)$/);
    const gb = parsePositiveInt(m?.[1]);
    const retentionDays = Number(m?.[2]);
    return gb && LOG_RETENTION_DAYS.includes(retentionDays) ? { type: 'logs', gb, retentionDays } : null;
  },
  estimate: (r, { index, pricing: { logs } }) => {
    const plans = logs ? [logs, ...(logs.alternatives ?? [])] : [];
    const fitting = plans.filter((p) => fits(p, r.gb, r.retentionDays));
    if (plans.length > 0 && fitting.length === 0) {
      // 모든 요금제가 보관 기간 한도에 걸리면 그 이유(가장 긴 한도)로, 아니면 용량 한도
      const byRetention = plans.every((p) => p.maxRetentionDays !== undefined && r.retentionDays > p.maxRetentionDays);
      const maxDays = byRetention ? Math.max(...plans.map((p) => p.maxRetentionDays!)) : undefined;
      return [
        {
          resourceIndex: index,
          kind: 'not-offered',
          resourceType: 'logs',
          limit: maxDays !== undefined ? { kind: 'retention', maxDays } : { kind: 'volume' },
          monthlyUsd: null,
        },
      ];
    }
    const best = fitting
      .map((p) => ({ p, m: logsMonthly(p, r.gb, r.retentionDays) }))
      .sort((a, b) => a.m.usd - b.m.usd)[0];
    return [
      {
        resourceIndex: index,
        kind: 'logs',
        gb: r.gb,
        retentionDays: r.retentionDays,
        commitmentGbPerDay: best?.m.commitmentGbPerDay ?? null,
        plan: best?.p.plan ?? null,
        monthlyUsd: best ? round2(best.m.usd) : null,
      },
    ];
  },
};
