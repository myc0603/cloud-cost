/**
 * 로그 수집 리소스 — AWS CloudWatch Logs / Azure Log Analytics / GCP Cloud Logging.
 * 수집 = 월 GB × 단가 (Azure는 Commitment Tier 중 더 싼 쪽), 보관 = 정상 상태에서 쌓인 양 중 기본 포함 기간을 넘는 분.
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
    if (logs?.maxRetentionDays !== undefined && r.retentionDays > logs.maxRetentionDays) {
      return [{ resourceIndex: index, kind: 'not-offered', resourceType: 'logs', maxRetentionDays: logs.maxRetentionDays, monthlyUsd: null }];
    }
    const m = logs ? logsMonthly(logs, r.gb, r.retentionDays) : null;
    return [
      {
        resourceIndex: index,
        kind: 'logs',
        gb: r.gb,
        retentionDays: r.retentionDays,
        commitmentGbPerDay: m?.commitmentGbPerDay ?? null,
        monthlyUsd: m ? round2(m.usd) : null,
      },
    ];
  },
};
