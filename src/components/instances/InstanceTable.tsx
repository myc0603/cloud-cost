'use client';

import { useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { ArchBadge } from '@/components/scenario/EstimateResult';
import { HOURS_PER_MONTH, type ArchFilter } from '@/lib/estimator';
import { formatMoney, type Currency } from '@/lib/display';
import type { Provider, Region, VmSku } from '@/lib/schema';

const PROVIDER_LABEL: Record<Provider, string> = { aws: 'AWS', azure: 'Azure', gcp: 'GCP' };
const REGIONS: Region[] = ['seoul', 'us-east'];

type SortKey = 'provider' | 'sku' | 'vcpu' | 'ramGb' | 'pricePerHour';

const usd = (x: number, digits: number) =>
  '$' + x.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits });

/** rate = USD당 원. null이면 환율 조회 실패 → 통화 선택 숨김 */
export default function InstanceTable({ skus, usdKrwRate }: { skus: VmSku[]; usdKrwRate: number | null }) {
  const t = useTranslations('instances');
  const [region, setRegion] = useState<Region>('seoul');
  const [providers, setProviders] = useState<Set<Provider>>(new Set(['aws', 'azure', 'gcp']));
  const [minVcpu, setMinVcpu] = useState(0);
  const [minRam, setMinRam] = useState(0);
  const [includeBurstable, setIncludeBurstable] = useState(true);
  const [arch, setArch] = useState<ArchFilter>('both');
  const [currency, setCurrency] = useState<Currency>('usd');
  const [sortKey, setSortKey] = useState<SortKey>('pricePerHour');
  const [sortAsc, setSortAsc] = useState(true);

  const rows = useMemo(() => {
    const filtered = skus.filter(
      (s) =>
        s.region === region &&
        providers.has(s.provider) &&
        s.vcpu >= minVcpu &&
        s.ramGb >= minRam &&
        (includeBurstable || !s.burstable) &&
        (arch === 'both' || s.arch === arch),
    );
    return filtered.sort((a, b) => {
      const va = a[sortKey];
      const vb = b[sortKey];
      const cmp = typeof va === 'number' && typeof vb === 'number' ? va - vb : String(va).localeCompare(String(vb));
      return sortAsc ? cmp : -cmp;
    });
  }, [skus, region, providers, minVcpu, minRam, includeBurstable, arch, sortKey, sortAsc]);

  // USD는 기존 고정 자릿수 유지, KRW만 표시 계층(display.ts)으로 환산
  const hourly = (s: VmSku) =>
    currency === 'krw' && usdKrwRate !== null
      ? formatMoney(s.pricePerHour * HOURS_PER_MONTH, 'krw', 'hour', usdKrwRate)
      : usd(s.pricePerHour, 4);
  const monthly = (s: VmSku) =>
    currency === 'krw' && usdKrwRate !== null
      ? formatMoney(s.pricePerHour * HOURS_PER_MONTH, 'krw', 'month', usdKrwRate)
      : usd(s.pricePerHour * HOURS_PER_MONTH, 2);

  const toggleProvider = (p: Provider) =>
    setProviders((prev) => {
      const next = new Set(prev);
      if (next.has(p)) next.delete(p);
      else next.add(p);
      return next;
    });

  const sortBy = (key: SortKey) => {
    if (sortKey === key) setSortAsc((v) => !v);
    else {
      setSortKey(key);
      setSortAsc(true);
    }
  };

  const arrow = (key: SortKey) => (sortKey === key ? (sortAsc ? ' ▲' : ' ▼') : '');

  const th = 'cursor-pointer select-none px-3 py-2 text-left font-semibold hover:text-slate-900';

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end gap-4 text-sm">
        <label className="flex items-center gap-2">
          {t('region')}
          <select
            value={region}
            onChange={(e) => setRegion(e.target.value as Region)}
            className="rounded border border-slate-300 bg-white px-2 py-1"
          >
            {REGIONS.map((r) => (
              <option key={r} value={r}>{t(`regionLabel.${r}`)}</option>
            ))}
          </select>
        </label>
        {(Object.keys(PROVIDER_LABEL) as Provider[]).map((p) => (
          <label key={p} className="flex items-center gap-1.5">
            <input type="checkbox" checked={providers.has(p)} onChange={() => toggleProvider(p)} />
            {PROVIDER_LABEL[p]}
          </label>
        ))}
        <label className="flex items-center gap-2">
          {t('vcpuMin')}
          <input
            type="number"
            min={0}
            value={minVcpu}
            onChange={(e) => setMinVcpu(Math.max(0, parseInt(e.target.value, 10) || 0))}
            className="w-16 rounded border border-slate-300 bg-white px-2 py-1"
          />
        </label>
        <label className="flex items-center gap-2">
          {t('ramMin')}
          <input
            type="number"
            min={0}
            value={minRam}
            onChange={(e) => setMinRam(Math.max(0, parseInt(e.target.value, 10) || 0))}
            className="w-16 rounded border border-slate-300 bg-white px-2 py-1"
          />
        </label>
        <label className="flex items-center gap-1.5">
          <input type="checkbox" checked={includeBurstable} onChange={(e) => setIncludeBurstable(e.target.checked)} />
          {t('includeBurstable')}
        </label>
        <label className="flex items-center gap-2">
          {t('arch')}
          <select
            value={arch}
            onChange={(e) => setArch(e.target.value as ArchFilter)}
            className="rounded border border-slate-300 bg-white px-2 py-1"
          >
            {(['both', 'x86', 'arm'] as ArchFilter[]).map((a) => (
              <option key={a} value={a}>{t(`archLabel.${a}`)}</option>
            ))}
          </select>
        </label>
        {usdKrwRate !== null && (
          <label className="flex items-center gap-2">
            {t('currency')}
            <select
              value={currency}
              onChange={(e) => setCurrency(e.target.value as Currency)}
              className="rounded border border-slate-300 bg-white px-2 py-1"
            >
              <option value="usd">USD</option>
              <option value="krw">{t('krw')}</option>
            </select>
          </label>
        )}
        <span className="text-xs text-slate-400">{t('shown', { count: rows.length })}</span>
      </div>

      <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white shadow-sm">
        <table className="w-full text-sm">
          <thead className="border-b border-slate-200 text-xs text-slate-500">
            <tr>
              <th className={th} onClick={() => sortBy('provider')}>{t('colProvider')}{arrow('provider')}</th>
              <th className={th} onClick={() => sortBy('sku')}>{t('colSku')}{arrow('sku')}</th>
              <th className={th} onClick={() => sortBy('vcpu')}>{t('colVcpu')}{arrow('vcpu')}</th>
              <th className={th} onClick={() => sortBy('ramGb')}>{t('colRam')}{arrow('ramGb')}</th>
              <th className={th} onClick={() => sortBy('pricePerHour')}>{t('colHourly')}{arrow('pricePerHour')}</th>
              <th className="px-3 py-2 text-left font-semibold">{t('colMonthly')}</th>
              <th className="px-3 py-2 text-left font-semibold">{t('colArch')}</th>
              <th className="px-3 py-2 text-left font-semibold">{t('colBurstable')}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((s) => (
              <tr key={`${s.provider}-${s.region}-${s.sku}`} className="border-b border-slate-50 hover:bg-slate-50">
                <td className="px-3 py-1.5">{PROVIDER_LABEL[s.provider]}</td>
                <td className="px-3 py-1.5 font-mono text-xs">{s.sku}</td>
                <td className="px-3 py-1.5 tabular-nums">{s.vcpu}</td>
                <td className="px-3 py-1.5 tabular-nums">{s.ramGb}</td>
                <td className="px-3 py-1.5 tabular-nums">{hourly(s)}</td>
                <td className="px-3 py-1.5 tabular-nums">{monthly(s)}</td>
                <td className="px-3 py-1.5"><ArchBadge arch={s.arch} /></td>
                <td className="px-3 py-1.5">{s.burstable ? '○' : ''}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {currency === 'krw' && usdKrwRate !== null && (
        <p className="text-xs text-slate-400">
          {t('fxNote', { rate: usdKrwRate.toLocaleString('ko-KR', { maximumFractionDigits: 2 }) })}
        </p>
      )}
    </div>
  );
}
