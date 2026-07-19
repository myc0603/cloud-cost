/**
 * 표시 변환 — 순수 함수. 견적은 항상 "월 USD"로 나오므로,
 * 통화(USD/KRW)·기간(시간/일/주/월)은 이 계층에서 곱셈만으로 환산한다.
 * UI 의존 없음: 입력이 같으면 출력이 항상 같다 (display.test.ts로 보장).
 */

import { HOURS_PER_MONTH } from './estimator';

export type Currency = 'usd' | 'krw';
export type Period = 'hour' | 'day' | 'week' | 'month';

/** 월(730h) 기준값을 각 기간으로 환산할 때 쓰는 시간 수 — estimator의 730h/월 관례와 일관 */
const PERIOD_HOURS: Record<Period, number> = { hour: 1, day: 24, week: 168, month: HOURS_PER_MONTH };

/** 월 USD → 선택한 통화·기간 값. rate는 USD당 원(예: 1490.48) */
export function convert(monthlyUsd: number, currency: Currency, period: Period, rate: number): number {
  const perPeriodUsd = (monthlyUsd * PERIOD_HOURS[period]) / HOURS_PER_MONTH;
  return currency === 'krw' ? perPeriodUsd * rate : perPeriodUsd;
}

/** 값 크기에 따라 소수 자리 결정 — 시간 단위에선 값이 작아져 자리수를 늘려야 의미가 남는다 */
function fractionDigits(abs: number, currency: Currency): number {
  if (currency === 'krw') return abs >= 100 ? 0 : abs >= 1 ? 1 : 2;
  return abs >= 1 ? 2 : abs >= 0.01 ? 3 : 4;
}

/** 월 USD 값을 통화 기호·자릿수·자릿점까지 붙여 표시 문자열로 */
export function formatMoney(monthlyUsd: number, currency: Currency, period: Period, rate: number): string {
  const value = convert(monthlyUsd, currency, period, rate);
  const digits = fractionDigits(Math.abs(value), currency);
  return new Intl.NumberFormat(currency === 'krw' ? 'ko-KR' : 'en-US', {
    style: 'currency',
    currency: currency === 'krw' ? 'KRW' : 'USD',
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(value);
}
