'use client';

import { useTranslations } from 'next-intl';
import type { EstimateLine, ProviderEstimate } from '@/lib/estimator';
import type { Provider } from '@/lib/schema';

const PROVIDER_LABEL: Record<Provider, string> = { aws: 'AWS', azure: 'Azure', gcp: 'GCP' };

const usd = (x: number) =>
  '$' + x.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function LineLabel({ line }: { line: EstimateLine }) {
  const t = useTranslations('estimate');
  if (line.kind === 'vm') {
    return (
      <span>
        VM {line.spec.vcpu}vCPU/{line.spec.ramGb}GB ×{line.spec.count}
        {line.matched ? (
          <span className="ml-1 font-mono text-slate-900">
            → {line.matched.sku} ({line.matched.vcpu}vCPU/{line.matched.ramGb}GB)
          </span>
        ) : (
          <span className="ml-1 text-red-500">{t('noMatch')}</span>
        )}
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

export default function EstimateResult({ estimates }: { estimates: ProviderEstimate[] }) {
  const t = useTranslations('estimate');
  const totals = estimates.map((e) => e.totalMonthlyUsd).filter((x): x is number => x !== null);
  const cheapest = totals.length > 0 ? Math.min(...totals) : null;

  return (
    <div className="flex flex-col gap-4">
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
                  <>{usd(e.totalMonthlyUsd)}<span className="text-xs font-normal text-slate-500">{t('perMonth')}</span></>
                )}
              </span>
            </div>

            {e.available && e.lines.length > 0 && (
              <ul className="mt-3 space-y-1 border-t border-slate-100 pt-3">
                {e.lines.map((line, i) => (
                  <li key={i} className="flex justify-between text-xs text-slate-600">
                    <LineLabel line={line} />
                    {line.monthlyUsd !== null && <span className="tabular-nums">{usd(line.monthlyUsd)}</span>}
                  </li>
                ))}
              </ul>
            )}
          </div>
        );
      })}
      <p className="text-xs text-slate-400">{t('footnote')}</p>
    </div>
  );
}
