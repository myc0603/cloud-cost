'use client';

import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { ChevronDown, SlidersHorizontal } from 'lucide-react';
import Collapse from '@/components/Collapse';
import { estimate, findVmSku, RESOURCES, type ArchFilter, type Overrides, type Resource, type ResourceType, type Scenario } from '@/lib/estimator';
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
import { PROVIDER_LABEL, PROVIDERS } from '@/lib/providers';
import { REGIONS } from '@/lib/regions';
import { TEMPLATES, type TemplateId } from '@/lib/templates';
import { useRegionPricing } from '@/lib/use-region-pricing';
import AddResourceMenu from './AddResourceMenu';
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

  // 매칭 옵션이 기본값(버스트 포함·x86/ARM 모두)이 아니면 — 공유 링크로 들어온 경우 등 — 처음부터 펼쳐 보인다
  const matchCustomized = !includeBurstable || arch !== 'both';
  const [matchOpen, setMatchOpen] = useState(matchCustomized);

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
  /**
   * VM 카드를 인스턴스 이름으로 채운다 — 스펙(vCPU·RAM, 1 미만은 1로 올림)을 넣고 그 플랫폼은 그 타입으로 고정.
   * 다른 플랫폼은 같은 스펙 최저가로 매칭된다
   */
  const fillVmFromSku = (i: number, name: string) => {
    const sku = pricing ? findVmSku(pricing, name) : null;
    const prev = scenario.resources[i];
    if (!sku || prev?.type !== 'vm') return false;
    const vcpu = Math.max(1, Math.ceil(sku.vcpu));
    const ramGb = Math.max(1, Math.ceil(sku.ramGb));
    setScenario((s) => ({ ...s, resources: s.resources.map((r, j) => (j === i ? { ...prev, vcpu, ramGb } : r)) }));
    setOverrides((o) => {
      const cleared = prev.vcpu === vcpu && prev.ramGb === ramGb ? o : clearIndex(o, i);
      return { ...cleared, [sku.provider]: { ...(cleared[sku.provider] ?? {}), [i]: sku.sku } };
    });
    return true;
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
  const sameResources = (resources: Resource[]) => JSON.stringify(resources) === JSON.stringify(scenario.resources);
  const isStartScreen = sameResources(DEFAULT_SCENARIO.resources);

  const applyTemplate = (id: TemplateId) => {
    const untouched = isStartScreen || TEMPLATES.some((tpl) => sameResources(tpl.resources));
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

  return (
    <div className="grid grid-cols-1 gap-8 lg:grid-cols-2">
      <section className="flex flex-col gap-4">
        {/* 빈 화면 대신 바로 고를 수 있는 출발점 — 구성 요소를 보여줘 무엇이 들어있는지 알 수 있게.
            기본 화면을 벗어나면(템플릿 적용·편집·공유 링크) 이름만 있는 칩으로 줄인다 */}
        {isStartScreen ? (
          <div className="flex flex-col gap-2">
            <span className="text-sm text-slate-500 dark:text-slate-400">{t('templateStart')}</span>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-2">
              {TEMPLATES.map(({ id, resources }) => (
                <button
                  key={id}
                  onClick={() => applyTemplate(id)}
                  className="rounded-lg bg-slate-200/50 dark:bg-slate-800/60 p-3 text-left hover:bg-slate-200 dark:hover:bg-slate-800"
                >
                  <span className="block text-sm font-semibold text-slate-900 dark:text-slate-100">{t(`templateName.${id}`)}</span>
                  <span className="mt-1 line-clamp-2 text-xs text-slate-500 dark:text-slate-400">
                    {resources.map((r) => t(`resourceTitle.${r.type}`)).join(' · ')}
                  </span>
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm text-slate-500 dark:text-slate-400">{t('templateShort')}</span>
            {TEMPLATES.map(({ id, resources }) => {
              const active = sameResources(resources);
              return (
                <button
                  key={id}
                  onClick={() => applyTemplate(id)}
                  aria-pressed={active}
                  title={resources.map((r) => t(`resourceTitle.${r.type}`)).join(' · ')}
                  className={`rounded-full border px-3 py-1 text-xs font-medium ${
                    active
                      ? 'border-slate-900 dark:border-slate-100 bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900'
                      : 'border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-200 hover:border-slate-500 dark:hover:border-slate-400'
                  }`}
                >
                  {t(`templateName.${id}`)}
                </button>
              );
            })}
          </div>
        )}

        <div>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <label className="flex items-center gap-2 text-sm">
              {t('region')}
              <select
                value={scenario.region}
                onChange={(e) => setScenario((s) => ({ ...s, region: e.target.value as Region }))}
                className="rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-2 py-1"
              >
                {REGIONS.map((r) => (
                  <option key={r} value={r}>{t(`regionLabel.${r}`)}</option>
                ))}
              </select>
            </label>
            <label className="flex items-center gap-2 text-sm">
              {t('term')}
              <select
                value={term ?? 'od'}
                onChange={(e) => setTerm(e.target.value === 'od' ? undefined : (e.target.value as Term))}
                className="rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-2 py-1"
              >
                {(['od', '1y', '3y'] as const).map((v) => (
                  <option key={v} value={v}>{t(`termLabel.${v}`)}</option>
                ))}
              </select>
            </label>
            <button
              type="button"
              onClick={() => setMatchOpen((o) => !o)}
              aria-expanded={matchOpen}
              className="flex items-center gap-1.5 text-sm text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-slate-100"
            >
              <SlidersHorizontal aria-hidden className="size-4" />
              {t('matchOptions')}
              {matchCustomized && !matchOpen && (
                <span role="img" aria-label={t('matchOptionsChanged')} className="size-1.5 rounded-full bg-sky-500" />
              )}
              <ChevronDown aria-hidden className={`size-4 text-slate-400 transition-transform duration-200 ${matchOpen ? 'rotate-180' : ''}`} />
            </button>
          </div>
          {/* 대부분 안 건드리는 고급 옵션이라 접어둔다 — 결과 위 매칭 규칙 안내가 현재 값을 계속 보여준다 */}
          <Collapse open={matchOpen}>
            <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-2 rounded-md bg-slate-100 dark:bg-slate-800 px-3 py-2">
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
                  className="rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-2 py-1"
                >
                  {(['both', 'x86', 'arm'] as ArchFilter[]).map((a) => (
                    <option key={a} value={a}>{t(`archLabel.${a}`)}</option>
                  ))}
                </select>
              </label>
            </div>
          </Collapse>
        </div>

        <div className="divide-y divide-slate-200 dark:divide-slate-800 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
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
                {...(r.type === 'vm' && {
                  onFillSku: (name: string) => fillVmFromSku(i, name),
                  skuListId: 'vm-sku-names',
                  pinned: PROVIDERS.filter((p) => overrides[p]?.[i]).map((p) => `${PROVIDER_LABEL[p]} ${overrides[p]![i]}`),
                })}
              />
            );
          })}

          {/* VM 카드 인스턴스 이름 자동완성 — 이 리전 8개 플랫폼 VM 전체 */}
          <datalist id="vm-sku-names">
            {pricing &&
              PROVIDERS.flatMap((p) =>
                pricing[p].vm.map((s) => (
                  <option key={s.sku} value={s.sku}>{`${PROVIDER_LABEL[p]} · ${s.vcpu}vCPU/${s.ramGb}GB`}</option>
                )),
              )}
          </datalist>

          <AddResourceMenu onAdd={addResource} canAdd={canAdd} />
        </div>
      </section>

      {/* 데스크톱: 입력을 스크롤하며 고치는 동안 결과가 화면에 붙어 있게. 화면보다 길면 결과 칸 안에서 스크롤
          (-m-1 p-1 = 스크롤 영역이 카드 테두리·그림자를 자르지 않게) */}
      <section className="lg:sticky lg:top-4 lg:-m-1 lg:max-h-[calc(100vh-2rem)] lg:self-start lg:overflow-y-auto lg:p-1 lg:scrollbar-hover">
        {estimates ? (
          <EstimateResult
            estimates={estimates}
            region={scenario.region}
            rate={usdKrwRate}
            term={term}
            includeBurstable={includeBurstable}
            arch={arch}
            hidden={hidden}
            onToggleProvider={toggleProvider}
            onSelectInstance={selectInstance}
          />
        ) : (
          <p className="rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 text-sm text-slate-400">
            {t(pricingError ? 'pricingLoadError' : 'pricingLoading')}
          </p>
        )}
      </section>
    </div>
  );
}
