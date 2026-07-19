'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { HOURS_PER_MONTH, type EstimateLine, type ProviderEstimate } from '@/lib/estimator';
import { formatMoney, type Currency, type Period } from '@/lib/display';
import type { Arch, Provider } from '@/lib/schema';

const PROVIDER_LABEL: Record<Provider, string> = { aws: 'AWS', azure: 'Azure', gcp: 'GCP' };

/** (provider, vmIndex)의 인스턴스 선택 변경. isDefault(=최저가)면 override 해제 */
type SelectInstance = (provider: Provider, vmIndex: number, sku: string, isDefault: boolean) => void;

const PERIODS: Period[] = ['hour', 'day', 'week', 'month'];
const PERIOD_SUFFIX: Record<Period, string> = { hour: 'perHour', day: 'perDay', week: 'perWeek', month: 'perMonth' };

/** 아키텍처 식별 배지 — ARM은 보라, x86은 중립색 */
function ArchBadge({ arch }: { arch: Arch }) {
  const arm = arch === 'arm';
  return (
    <span
      className={`ml-1 rounded px-1 py-0.5 align-middle text-[10px] font-medium ${
        arm ? 'bg-violet-100 text-violet-700' : 'bg-slate-100 text-slate-600'
      }`}
    >
      {arm ? 'ARM' : 'x86'}
    </span>
  );
}

function Segmented<T extends string>({
  value,
  options,
  onChange,
  ariaLabel,
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
  ariaLabel: string;
}) {
  return (
    <div role="group" aria-label={ariaLabel} className="inline-flex rounded-md border border-slate-200 p-0.5">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          aria-pressed={o.value === value}
          className={`rounded px-2.5 py-1 text-xs font-medium transition ${
            o.value === value ? 'bg-slate-900 text-white' : 'text-slate-500 hover:text-slate-900'
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function LineLabel({
  line,
  provider,
  money,
  onSelect,
}: {
  line: EstimateLine;
  provider: Provider;
  money: (monthlyUsd: number) => string;
  onSelect: SelectInstance;
}) {
  const t = useTranslations('estimate');
  if (line.kind === 'vm') {
    return (
      <span>
        VM {line.spec.vcpu}vCPU/{line.spec.ramGb}GB ×{line.spec.count}
        {!line.matched ? (
          <span className="ml-1 text-red-500">{t('noMatch')}</span>
        ) : line.candidates.length < 2 ? (
          <span className="ml-1 font-mono text-slate-900">
            → {line.matched.sku} ({line.matched.vcpu}vCPU/{line.matched.ramGb}GB)
          </span>
        ) : (
          <select
            aria-label={t('instanceSelect')}
            value={line.matched.sku}
            onChange={(e) =>
              onSelect(provider, line.vmIndex, e.target.value, e.target.value === line.candidates[0].sku)
            }
            className="ml-1 rounded border border-slate-300 bg-white px-1 py-0.5 font-mono text-xs text-slate-900"
          >
            {line.candidates.map((c) => (
              <option key={c.sku} value={c.sku}>
                {c.sku} · {c.vcpu}/{c.ramGb}GB · {money(c.pricePerHour * HOURS_PER_MONTH * line.spec.count)}
                {c.arch === 'arm' ? ' · ARM' : ''}
              </option>
            ))}
          </select>
        )}
        {line.matched && <ArchBadge arch={line.matched.arch} />}
      </span>
    );
  }
  if (line.kind === 'storage') {
    return (
      <span>
        {t(`storageLabel.${line.storageKind}`)} {line.sizeGb}GB
        {line.pricePerGbMonth === null && <span className="ml-1 text-red-500">{t('noData')}</span>}
      </span>
    );
  }
  return (
    <span>
      {t('egressLine', { gb: line.gb })}
      {line.freeGb !== null && line.freeGb > 0 && (
        <span className="ml-1 text-slate-400">{t('freeApplied', { gb: line.freeGb })}</span>
      )}
      {line.monthlyUsd === null && <span className="ml-1 text-red-500">{t('noData')}</span>}
    </span>
  );
}

/** rate = USD당 원. null이면 환율 조회 실패 → KRW 토글 숨김 */
export default function EstimateResult({
  estimates,
  rate,
  onSelectInstance,
}: {
  estimates: ProviderEstimate[];
  rate: number | null;
  onSelectInstance: SelectInstance;
}) {
  const t = useTranslations('estimate');
  const td = useTranslations('display');
  const [currency, setCurrency] = useState<Currency>('usd');
  const [period, setPeriod] = useState<Period>('month');

  const canKrw = rate !== null;
  const money = (x: number) => formatMoney(x, currency, period, rate ?? 1);

  const totals = estimates.map((e) => e.totalMonthlyUsd).filter((x): x is number => x !== null);
  const cheapest = totals.length > 0 ? Math.min(...totals) : null;
  // 매칭된 인스턴스 중 ARM이 하나라도 있으면 호환성 고지
  const hasArm = estimates.some((e) =>
    e.lines.some((l) => l.kind === 'vm' && l.matched?.arch === 'arm'),
  );

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        {canKrw && (
          <Segmented
            ariaLabel={td('currency')}
            value={currency}
            onChange={setCurrency}
            options={[
              { value: 'usd', label: td('usd') },
              { value: 'krw', label: td('krw') },
            ]}
          />
        )}
        <Segmented
          ariaLabel={td('period')}
          value={period}
          onChange={setPeriod}
          options={PERIODS.map((p) => ({ value: p, label: td(p) }))}
        />
      </div>

      {estimates.map((e) => {
        const isCheapest = e.totalMonthlyUsd !== null && e.totalMonthlyUsd === cheapest;
        return (
          <div
            key={e.provider}
            className={`rounded-lg border bg-white p-4 shadow-sm ${
              isCheapest ? 'border-emerald-500 ring-1 ring-emerald-500' : 'border-slate-200'
            }`}
          >
            <div className="flex items-baseline justify-between">
              <span className="text-sm font-bold">
                {PROVIDER_LABEL[e.provider]}
                {isCheapest && (
                  <span className="ml-2 rounded bg-emerald-100 px-1.5 py-0.5 text-xs font-medium text-emerald-700">
                    {t('cheapest')}
                  </span>
                )}
              </span>
              <span className="text-lg font-bold tabular-nums">
                {!e.available ? (
                  <span className="text-sm font-normal text-slate-400">{t('dataPending')}</span>
                ) : e.totalMonthlyUsd === null ? (
                  <span className="text-sm font-normal text-slate-400">{t('unavailable')}</span>
                ) : (
                  <>{money(e.totalMonthlyUsd)}<span className="text-xs font-normal text-slate-500">{td(PERIOD_SUFFIX[period])}</span></>
                )}
              </span>
            </div>

            {e.available && e.lines.length > 0 && (
              <ul className="mt-3 space-y-1 border-t border-slate-100 pt-3">
                {e.lines.map((line, i) => (
                  <li key={i} className="flex justify-between gap-2 text-xs text-slate-600">
                    <LineLabel line={line} provider={e.provider} money={money} onSelect={onSelectInstance} />
                    {line.monthlyUsd !== null && <span className="tabular-nums">{money(line.monthlyUsd)}</span>}
                  </li>
                ))}
              </ul>
            )}
          </div>
        );
      })}
      {hasArm && (
        <p className="rounded-md bg-violet-50 px-3 py-2 text-xs text-violet-700">{t('armNotice')}</p>
      )}
      {currency === 'krw' && rate !== null && (
        <p className="text-xs text-slate-400">
          {td('fxNote', { rate: rate.toLocaleString('ko-KR', { maximumFractionDigits: 2 }) })}
        </p>
      )}
      <p className="text-xs text-slate-400">{t('footnote')}</p>
    </div>
  );
}
