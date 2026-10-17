'use client';

import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { estimate, RESOURCES, type ArchFilter, type Overrides, type Resource, type ResourceType, type Scenario } from '@/lib/estimator';
import type { Provider, ProviderPricing, Region, Term } from '@/lib/schema';
import {
  decodeHidden,
  decodeMatchOptions,
  decodeOverrides,
  decodeScenario,
  encodeHidden,
  encodeMatchOptions,
  encodeOverrides,
  encodeScenario,
} from '@/lib/scenario-url';
import { REGIONS } from '@/lib/regions';
import { TEMPLATES, type TemplateId } from '@/lib/templates';
import { useRegionPricing } from '@/lib/use-region-pricing';
import EstimateResult from './EstimateResult';
import ResourceCard from './ResourceCard';

const DEFAULT_SCENARIO: Scenario = {
  region: 'seoul',
  resources: [{ type: 'vm', vcpu: 2, ramGb: 4, count: 1 }],
};

/** VM 스펙이 바뀌면 후보 집합이 달라지므로 그 카드의 커스텀 선택을 초기화 */
function clearIndex(overrides: Overrides, i: number): Overrides {
  const out: Overrides = {};
  for (const [p, perVm] of Object.entries(overrides)) {
    const next = { ...perVm };
    delete next[i];
    out[p as Provider] = next;
  }
  return out;
}

/** 카드 삭제 시 뒤 인덱스를 당겨 엉뚱한 카드에 선택이 적용되는 것을 막는다 */
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
  /** 페이지에 미리 넣은 리전의 요금 데이터(기본 리전) — 나머지 리전은 고를 때 /pricing/{region}.json에서 받는다 */
  initialPricing: Partial<Record<Region, Record<Provider, ProviderPricing>>>;
  /** USD당 원 환율 — 표시 통화 전환용. 조회 실패 시 null */
  usdKrwRate: number | null;
}

export default function ScenarioBuilder({ initialPricing, usdKrwRate }: Props) {
  const t = useTranslations('scenario');
  const searchParams = useSearchParams();
  const [scenario, setScenario] = useState<Scenario>(
    () => decodeScenario(searchParams) ?? DEFAULT_SCENARIO,
  );
  const [overrides, setOverrides] = useState<Overrides>(() => decodeOverrides(searchParams));
  const [{ arch, includeBurstable, term }, setMatchOpts] = useState(() => decodeMatchOptions(searchParams));
  // 화면에서 숨긴 플랫폼 ("다른 플랫폼"만, 대표 3사는 고정) — 공유 링크에 저장
  const [hidden, setHidden] = useState<Provider[]>(() => decodeHidden(searchParams));
  const toggleProvider = (p: Provider) => setHidden((h) => (h.includes(p) ? h.filter((x) => x !== p) : [...h, p]));
  const [copied, setCopied] = useState(false);

  const setArch = (next: ArchFilter) => setMatchOpts((o) => ({ ...o, arch: next }));
  const setIncludeBurstable = (next: boolean) => setMatchOpts((o) => ({ ...o, includeBurstable: next }));
  const setTerm = (next: Term | undefined) => setMatchOpts((o) => ({ ...o, term: next }));

  // 현재 주소 = 현재 시나리오 + 커스텀 선택 + 매칭 옵션 유지 (주소 복사가 곧 공유)
  useEffect(() => {
    const params = new URLSearchParams(encodeScenario(scenario));
    const pick = encodeOverrides(overrides);
    if (pick) params.set('pick', pick);
    for (const [k, v] of new URLSearchParams(encodeMatchOptions({ arch, includeBurstable, term }))) params.set(k, v);
    const hide = encodeHidden(hidden);
    if (hide) params.set('hide', hide);
    window.history.replaceState(null, '', `?${params}`);
  }, [scenario, overrides, arch, includeBurstable, term, hidden]);

  const { pricing, error: pricingError } = useRegionPricing(scenario.region, initialPricing);
  const estimates = useMemo(
    () => (pricing ? estimate(scenario, pricing, { includeBurstable, arch, term }, overrides) : null),
    [scenario, pricing, includeBurstable, arch, term, overrides],
  );

  const updateResource = (i: number, next: Resource) => {
    const prev = scenario.resources[i];
    // VM·K8s 노드·DB·캐시의 스펙(DB·캐시는 이중화 포함)이 바뀌면 후보가 달라지므로 선택 초기화 (대수만 바뀌면 유지)
    const spec = (r?: Resource) =>
      r?.type === 'vm'
        ? `${r.vcpu}/${r.ramGb}`
        : r?.type === 'k8s'
          ? `${r.node.vcpu}/${r.node.ramGb}`
          : r?.type === 'db'
            ? `${r.engine}/${r.vcpu}/${r.ramGb}/${r.ha}`
            : r?.type === 'cache'
              ? `${r.memoryGb}/${r.ha}`
              : null;
    if (spec(prev) !== spec(next)) {
      setOverrides((o) => clearIndex(o, i));
    }
    setScenario((s) => ({ ...s, resources: s.resources.map((r, j) => (j === i ? next : r)) }));
  };
  const removeResource = (i: number) => {
    setScenario((s) => ({ ...s, resources: s.resources.filter((_, j) => j !== i) }));
    setOverrides((o) => reindexAfterRemove(o, i));
  };
  const addResource = (type: ResourceType) =>
    setScenario((s) => ({ ...s, resources: [...s.resources, RESOURCES[type].create()] }));
  /** singleton 타입은 이미 있으면 추가 불가 */
  const canAdd = (type: ResourceType) =>
    !RESOURCES[type].singleton || !scenario.resources.some((r) => r.type === type);

  /** 템플릿 적용 — 사용자가 편집한 구성(기본값·템플릿 그대로가 아닌 것)을 덮을 때만 확인 */
  const applyTemplate = (id: TemplateId) => {
    const same = (resources: Resource[]) => JSON.stringify(resources) === JSON.stringify(scenario.resources);
    const untouched = same(DEFAULT_SCENARIO.resources) || TEMPLATES.some((tpl) => same(tpl.resources));
    if (!untouched && !window.confirm(t('templateConfirm'))) return;
    const tpl = TEMPLATES.find((x) => x.id === id)!;
    setScenario((s) => ({ ...s, resources: structuredClone(tpl.resources) }));
    setOverrides({});
  };

  const selectInstance = (provider: Provider, resourceIndex: number, sku: string, isDefault: boolean) =>
    setOverrides((o) => {
      const perResource = { ...(o[provider] ?? {}) };
      if (isDefault) delete perResource[resourceIndex];
      else perResource[resourceIndex] = sku;
      return { ...o, [provider]: perResource };
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
          <label className="flex items-center gap-2 text-sm">
            {t('term')}
            <select
              value={term ?? 'od'}
              onChange={(e) => setTerm(e.target.value === 'od' ? undefined : (e.target.value as Term))}
              className="rounded border border-slate-300 bg-white px-2 py-1"
            >
              {(['od', '1y', '3y'] as const).map((v) => (
                <option key={v} value={v}>{t(`termLabel.${v}`)}</option>
              ))}
            </select>
          </label>
        </div>

        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="text-slate-500">{t('templateStart')}</span>
          {TEMPLATES.map(({ id }) => (
            <button
              key={id}
              onClick={() => applyTemplate(id)}
              className="rounded-full border border-slate-300 bg-white px-3 py-1 text-xs text-slate-600 hover:border-slate-400 hover:text-slate-900"
            >
              {t(`templateName.${id}`)}
            </button>
          ))}
        </div>

        {scenario.resources.map((r, i) => {
          const sameType = scenario.resources.filter((x) => x.type === r.type);
          return (
            <ResourceCard
              key={i}
              resource={r}
              ordinal={scenario.resources.slice(0, i + 1).filter((x) => x.type === r.type).length}
              numbered={r.type === 'vm' || sameType.length > 1}
              onChange={(next) => updateResource(i, next)}
              onRemove={() => removeResource(i)}
            />
          );
        })}

        <div className="flex flex-wrap gap-2">
          {(Object.keys(RESOURCES) as ResourceType[]).map((type) => (
            <button
              key={type}
              onClick={() => addResource(type)}
              disabled={!canAdd(type)}
              className="rounded-lg border border-dashed border-slate-300 px-4 py-2 text-sm text-slate-600 hover:border-slate-400 hover:text-slate-900 disabled:cursor-not-allowed disabled:opacity-40"
            >
              + {t(`resourceTitle.${type}`)}
            </button>
          ))}
          <button
            onClick={copyShareLink}
            className="rounded-lg border border-slate-300 px-4 py-2 text-sm text-slate-600 hover:border-slate-400 hover:text-slate-900"
          >
            {copied ? t('copied') : t('copyShareLink')}
          </button>
        </div>
      </section>

      <section>
        {estimates ? (
          <EstimateResult
            estimates={estimates}
            region={scenario.region}
            rate={usdKrwRate}
            term={term}
            hidden={hidden}
            onToggleProvider={toggleProvider}
            onSelectInstance={selectInstance}
          />
        ) : (
          <p className="rounded-lg border border-slate-200 bg-white p-4 text-sm text-slate-400">
            {t(pricingError ? 'pricingLoadError' : 'pricingLoading')}
          </p>
        )}
      </section>
    </div>
  );
}
