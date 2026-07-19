'use client';

import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { estimate, type ArchFilter, type Overrides, type Scenario, type VmSpec } from '@/lib/estimator';
import type { Provider, ProviderPricing, Region } from '@/lib/schema';
import {
  decodeMatchOptions,
  decodeOverrides,
  decodeScenario,
  encodeMatchOptions,
  encodeOverrides,
  encodeScenario,
} from '@/lib/scenario-url';
import EstimateResult from './EstimateResult';
import ResourceCard from './ResourceCard';
import StorageTrafficCard from './StorageTrafficCard';

const DEFAULT_SCENARIO: Scenario = {
  region: 'seoul',
  vms: [{ vcpu: 2, ramGb: 4, count: 1 }],
  blockGb: 0,
  objectGb: 0,
  egressGb: 0,
};

const REGIONS: Region[] = ['seoul', 'us-east'];

/** VM 스펙이 바뀌면 후보 집합이 달라지므로 그 인덱스의 커스텀 선택을 초기화 */
function clearVmIndex(overrides: Overrides, i: number): Overrides {
  const out: Overrides = {};
  for (const [p, perVm] of Object.entries(overrides)) {
    const next = { ...perVm };
    delete next[i];
    out[p as Provider] = next;
  }
  return out;
}

/** VM 삭제 시 뒤 인덱스를 당겨 엉뚱한 VM에 선택이 적용되는 것을 막는다 */
function reindexAfterRemove(overrides: Overrides, removed: number): Overrides {
  const out: Overrides = {};
  for (const [p, perVm] of Object.entries(overrides)) {
    const next: Record<number, string> = {};
    for (const [k, sku] of Object.entries(perVm)) {
      const idx = Number(k);
      if (idx === removed) continue;
      next[idx > removed ? idx - 1 : idx] = sku;
    }
    out[p as Provider] = next;
  }
  return out;
}

interface Props {
  /** 리전별 × 플랫폼별 요금 데이터 — 서버(page.tsx)에서 로드해 내려준다 */
  pricing: Record<Region, Record<Provider, ProviderPricing>>;
  /** USD당 원 환율 — 표시 통화 전환용. 조회 실패 시 null */
  usdKrwRate: number | null;
}

export default function ScenarioBuilder({ pricing, usdKrwRate }: Props) {
  const t = useTranslations('scenario');
  const searchParams = useSearchParams();
  const [scenario, setScenario] = useState<Scenario>(
    () => decodeScenario(searchParams) ?? DEFAULT_SCENARIO,
  );
  const [overrides, setOverrides] = useState<Overrides>(() => decodeOverrides(searchParams));
  const [{ arch, includeBurstable }, setMatchOpts] = useState(() => decodeMatchOptions(searchParams));
  const [copied, setCopied] = useState(false);

  const setArch = (next: ArchFilter) => setMatchOpts((o) => ({ ...o, arch: next }));
  const setIncludeBurstable = (next: boolean) => setMatchOpts((o) => ({ ...o, includeBurstable: next }));

  // 현재 주소 = 현재 시나리오 + 커스텀 선택 + 매칭 옵션 유지 (주소 복사가 곧 공유)
  useEffect(() => {
    const params = new URLSearchParams(encodeScenario(scenario));
    const pick = encodeOverrides(overrides);
    if (pick) params.set('pick', pick);
    for (const [k, v] of new URLSearchParams(encodeMatchOptions({ arch, includeBurstable }))) params.set(k, v);
    window.history.replaceState(null, '', `?${params}`);
  }, [scenario, overrides, arch, includeBurstable]);

  const estimates = useMemo(
    () => estimate(scenario, pricing[scenario.region], { includeBurstable, arch }, overrides),
    [scenario, pricing, includeBurstable, arch, overrides],
  );

  const updateVm = (i: number, spec: VmSpec) => {
    const prev = scenario.vms[i];
    // vCPU·RAM이 바뀌면 후보가 달라지므로 선택 초기화 (대수만 바뀌면 유지)
    if (prev && (prev.vcpu !== spec.vcpu || prev.ramGb !== spec.ramGb)) {
      setOverrides((o) => clearVmIndex(o, i));
    }
    setScenario((s) => ({ ...s, vms: s.vms.map((v, j) => (j === i ? spec : v)) }));
  };
  const removeVm = (i: number) => {
    setScenario((s) => ({ ...s, vms: s.vms.filter((_, j) => j !== i) }));
    setOverrides((o) => reindexAfterRemove(o, i));
  };
  const addVm = () =>
    setScenario((s) => ({ ...s, vms: [...s.vms, { vcpu: 2, ramGb: 4, count: 1 }] }));

  const selectInstance = (provider: Provider, vmIndex: number, sku: string, isDefault: boolean) =>
    setOverrides((o) => {
      const perVm = { ...(o[provider] ?? {}) };
      if (isDefault) delete perVm[vmIndex];
      else perVm[vmIndex] = sku;
      return { ...o, [provider]: perVm };
    });

  const copyShareLink = async () => {
    await navigator.clipboard.writeText(window.location.href);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div className="grid gap-8 lg:grid-cols-2">
      <section className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center gap-4">
          <label className="flex items-center gap-2 text-sm">
            {t('region')}
            <select
              value={scenario.region}
              onChange={(e) => setScenario((s) => ({ ...s, region: e.target.value as Region }))}
              className="rounded border border-slate-300 bg-white px-2 py-1"
            >
              {REGIONS.map((r) => (
                <option key={r} value={r}>{t(`regionLabel.${r}`)}</option>
              ))}
            </select>
          </label>
          <label className="flex items-center gap-1.5 text-sm">
            <input
              type="checkbox"
              checked={includeBurstable}
              onChange={(e) => setIncludeBurstable(e.target.checked)}
            />
            {t('includeBurstable')}
          </label>
          <label className="flex items-center gap-2 text-sm">
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
        </div>

        {scenario.vms.map((spec, i) => (
          <ResourceCard
            key={i}
            index={i}
            spec={spec}
            onChange={(next) => updateVm(i, next)}
            onRemove={() => removeVm(i)}
          />
        ))}

        <StorageTrafficCard
          scenario={scenario}
          onChange={(next) => setScenario((s) => ({ ...s, ...next }))}
        />

        <div className="flex gap-2">
          <button
            onClick={addVm}
            className="rounded-lg border border-dashed border-slate-300 px-4 py-2 text-sm text-slate-600 hover:border-slate-400 hover:text-slate-900"
          >
            {t('addVm')}
          </button>
          <button
            onClick={copyShareLink}
            className="rounded-lg border border-slate-300 px-4 py-2 text-sm text-slate-600 hover:border-slate-400 hover:text-slate-900"
          >
            {copied ? t('copied') : t('copyShareLink')}
          </button>
        </div>
      </section>

      <section>
        <EstimateResult estimates={estimates} rate={usdKrwRate} onSelectInstance={selectInstance} />
      </section>
    </div>
  );
}
