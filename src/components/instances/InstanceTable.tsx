'use client';

import { useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { HOURS_PER_MONTH } from '@/lib/estimator';
import type { Provider, Region, VmSku } from '@/lib/schema';

const PROVIDER_LABEL: Record<Provider, string> = { aws: 'AWS', azure: 'Azure', gcp: 'GCP' };
const REGIONS: Region[] = ['seoul', 'us-east'];

type SortKey = 'provider' | 'sku' | 'vcpu' | 'ramGb' | 'pricePerHour';

const usd = (x: number, digits: number) =>
  '$' + x.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits });

export default function InstanceTable({ skus }: { skus: VmSku[] }) {
  const t = useTranslations('instances');
  const [region, setRegion] = useState<Region>('seoul');
  const [providers, setProviders] = useState<Set<Provider>>(new Set(['aws', 'azure', 'gcp']));
  const [minVcpu, setMinVcpu] = useState(0);
  const [minRam, setMinRam] = useState(0);
  const [includeBurstable, setIncludeBurstable] = useState(true);
  const [sortKey, setSortKey] = useState<SortKey>('pricePerHour');
  const [sortAsc, setSortAsc] = useState(true);

  const rows = useMemo(() => {
    const filtered = skus.filter(
      (s) =>
        s.region === region &&
        providers.has(s.provider) &&
        s.vcpu >= minVcpu &&
        s.ramGb >= minRam &&
        (includeBurstable || !s.burstable),
    );
    return filtered.sort((a, b) => {
      const va = a[sortKey];
      const vb = b[sortKey];
      const cmp = typeof va === 'number' && typeof vb === 'number' ? va - vb : String(va).localeCompare(String(vb));
      return sortAsc ? cmp : -cmp;
    });
  }, [skus, region, providers, minVcpu, minRam, includeBurstable, sortKey, sortAsc]);

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
                <td className="px-3 py-1.5 tabular-nums">{usd(s.pricePerHour, 4)}</td>
                <td className="px-3 py-1.5 tabular-nums">{usd(s.pricePerHour * HOURS_PER_MONTH, 2)}</td>
                <td className="px-3 py-1.5">{s.burstable ? '○' : ''}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
