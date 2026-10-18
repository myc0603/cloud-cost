'use client';

import { useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Check, ChevronDown, Info, Link2 } from 'lucide-react';
import Collapse from '@/components/Collapse';
import { Link } from '@/i18n/navigation';
import { cheapestTotal, gcpSustainedUseMax, HOURS_PER_MONTH, type ArchFilter, type EstimateLine, type NoMatchReason, type ProviderEstimate } from '@/lib/estimator';
import { formatMoney, type Currency, type Period } from '@/lib/display';
import { PRIMARY_PROVIDERS, PROVIDER_LABEL } from '@/lib/providers';
import { offeredIn } from '@/lib/regions';
import type { Arch, Provider, Region, Term } from '@/lib/schema';

/** 로그 수집 상품명 — 비교 대상 고정 (estimator/logs.ts) */
const LOGS_PRODUCT: Partial<Record<Provider, string>> = { aws: 'CloudWatch Logs', azure: 'Log Analytics', gcp: 'Cloud Logging', oci: 'OCI Logging', ncp: 'Cloud Log Analytics', scp: 'ServiceWatch', nhn: 'Log & Crash Search' };

/** CDN 상품명 — 비교 대상 고정 (estimator/cdn.ts). 미제공 플랫폼은 없음 (providers.ts NOT_OFFERED) */
const CDN_PRODUCT: Partial<Record<Provider, string>> = { aws: 'CloudFront', azure: 'Front Door Standard', gcp: 'Cloud CDN', ncp: 'Global CDN', scp: 'Global CDN', nhn: 'CDN', kt: 'CDN Standard' };

/** 서버리스 컨테이너 상품명 — 비교 대상 고정 (estimator/container.ts). 미제공 플랫폼은 없음 */
const CONTAINER_PRODUCT: Partial<Record<Provider, string>> = { aws: 'Fargate', azure: 'Container Apps', gcp: 'Cloud Run', oci: 'Container Instances', nhn: 'NCS' };

/** (provider, 카드 인덱스)의 인스턴스 선택 변경. isDefault(=최저가)면 override 해제 */
type SelectInstance = (provider: Provider, resourceIndex: number, sku: string, isDefault: boolean) => void;

const PERIODS: Period[] = ['hour', 'day', 'week', 'month'];
const PERIOD_SUFFIX: Record<Period, string> = { hour: 'perHour', day: 'perDay', week: 'perWeek', month: 'perMonth' };

/** 아키텍처 식별 배지 — ARM은 보라, x86은 중립색 */
export function ArchBadge({ arch }: { arch: Arch }) {
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

/** 약정 기준인데 이 SKU엔 약정가가 없어 정가로 계산했음을 표시 (VM·K8s 노드·DB·캐시 공통) */
function NoCommitBadge({ term, matched }: { term?: Term; matched: { committed: boolean } | null }) {
  const t = useTranslations('estimate');
  if (!term || !matched || matched.committed) return null;
  return <span className="ml-1 rounded bg-amber-100 px-1 py-0.5 align-middle text-[10px] font-medium text-amber-700">{t('noCommit')}</span>;
}

/** 매칭 실패 표시 + 이유 (VM·K8s 노드·DB·캐시·컨테이너 공통). 아키텍처 실패는 플랫폼 이름과 해결 방법까지 */
function NoMatchNote({ noMatch, provider }: { noMatch: NoMatchReason | null; provider: Provider }) {
  const t = useTranslations('estimate');
  const archLabel = (arch: Arch) => (arch === 'arm' ? 'ARM' : 'x86');
  return (
    <span className="ml-1 text-red-500">
      {t('noMatch')}
      {noMatch && (
        <span className="ml-1 text-slate-400">
          (
          {noMatch.reason === 'arch'
            ? noMatch.scope === 'platform'
              ? t('noMatchArchPlatform', { product: CONTAINER_PRODUCT[provider] ?? PROVIDER_LABEL[provider], arch: archLabel(noMatch.arch) })
              : t('noMatchArch', { provider: PROVIDER_LABEL[provider], arch: archLabel(noMatch.arch) })
            : noMatch.reason === 'memory'
              ? t('noMatchMemory', { gb: noMatch.maxGb })
              : t('noMatchSize', { vcpu: noMatch.maxVcpu, ramGb: noMatch.maxRamGb })}
          )
        </span>
      )}
    </span>
  );
}

function LineLabel({
  line,
  provider,
  term,
  money,
  onSelect,
}: {
  line: EstimateLine;
  provider: Provider;
  term?: Term;
  money: (monthlyUsd: number) => string;
  onSelect: SelectInstance;
}) {
  const t = useTranslations('estimate');
  const ts = useTranslations('scenario');
  /** 드롭다운 후보 라벨 접미사 — 약정 기준에서 약정가 없는 후보 */
  const odSuffix = (c: { committed: boolean }) => (term && !c.committed ? ` · ${t('onDemandShort')}` : '');
  if (line.kind === 'not-offered') {
    return (
      <span>
        {ts(`resourceTitle.${line.resourceType}`)}
        <span className="ml-1 text-slate-400">
          —{' '}
          {line.limit?.kind === 'retention'
            ? t('notOfferedRetention', { provider: PROVIDER_LABEL[provider], days: line.limit.maxDays })
            : line.limit?.kind === 'volume'
              ? t('notOfferedVolume', { provider: PROVIDER_LABEL[provider] })
              : line.limit?.kind === 'engine'
                ? t('notOfferedEngine', { provider: PROVIDER_LABEL[provider], engine: t(`dbEngine.${line.limit.engine}`) })
                : t('notOfferedLine', { provider: PROVIDER_LABEL[provider] })}
        </span>
      </span>
    );
  }
  if (line.kind === 'vm') {
    return (
      <span>
        {line.role === 'k8s-node' ? t('k8sNode') : 'VM'} {line.spec.vcpu}vCPU/{line.spec.ramGb}GB ×{line.spec.count}
        {!line.matched ? (
          <NoMatchNote noMatch={line.noMatch} provider={provider} />
        ) : line.candidates.length < 2 ? (
          <span className="ml-1 font-mono text-slate-900">
            → {line.matched.sku} ({line.matched.vcpu}vCPU/{line.matched.ramGb}GB)
          </span>
        ) : (
          <select
            aria-label={t('instanceSelect')}
            value={line.matched.sku}
            onChange={(e) =>
              onSelect(provider, line.resourceIndex, e.target.value, e.target.value === line.candidates[0].sku)
            }
            className="ml-1 max-w-full rounded border border-slate-300 bg-white px-1 py-0.5 font-mono text-xs text-slate-900"
          >
            {line.candidates.map((c) => (
              <option key={c.sku} value={c.sku}>
                {c.sku} · {c.vcpu}/{c.ramGb}GB · {money(c.perHour * HOURS_PER_MONTH * line.spec.count)}
                {c.arch === 'arm' ? ' · ARM' : ''}
                {odSuffix(c)}
              </option>
            ))}
          </select>
        )}
        {line.matched && <ArchBadge arch={line.matched.arch} />}
        <NoCommitBadge term={term} matched={line.matched} />
        {!term && line.matched && gcpSustainedUseMax(line.matched) !== null && (
          <span className="ml-1 text-slate-400">{t('sudNote', { pct: gcpSustainedUseMax(line.matched)! * 100 })}</span>
        )}
      </span>
    );
  }
  if (line.kind === 'db') {
    const label = `${t('dbLine', { engine: t(`dbEngine.${line.engine}`) })}${line.ha ? ` · ${t('dbHa')}` : ''}`;
    return (
      <span>
        {label} {line.spec.vcpu}vCPU/{line.spec.ramGb}GB ×{line.spec.count}
        {!line.matched ? (
          line.noMatch ? <NoMatchNote noMatch={line.noMatch} provider={provider} /> : <span className="ml-1 text-red-500">{t('noData')}</span>
        ) : line.candidates.length < 2 ? (
          <span className="ml-1 font-mono text-slate-900">
            → {line.matched.sku} ({line.matched.vcpu}vCPU/{line.matched.ramGb}GB)
          </span>
        ) : (
          <select
            aria-label={t('instanceSelect')}
            value={line.matched.sku}
            onChange={(e) =>
              onSelect(provider, line.resourceIndex, e.target.value, e.target.value === line.candidates[0].sku)
            }
            className="ml-1 max-w-full rounded border border-slate-300 bg-white px-1 py-0.5 font-mono text-xs text-slate-900"
          >
            {line.candidates.map((c) => (
              <option key={c.sku} value={c.sku}>
                {c.sku} · {c.vcpu}/{c.ramGb}GB · {money(c.perHour * HOURS_PER_MONTH * line.spec.count)}
                {odSuffix(c)}
              </option>
            ))}
          </select>
        )}
        <NoCommitBadge term={term} matched={line.matched} />
      </span>
    );
  }
  if (line.kind === 'cache') {
    return (
      <span>
        {t('cacheLine', { engine: line.engine ?? '', gb: line.memoryGb, count: line.count })}
        {line.ha && <span className="ml-1 text-slate-400">({t('dbHa')})</span>}
        {!line.matched ? (
          line.noMatch ? <NoMatchNote noMatch={line.noMatch} provider={provider} /> : <span className="ml-1 text-red-500">{t('noData')}</span>
        ) : line.candidates.length < 2 ? (
          <span className="ml-1 font-mono text-slate-900">→ {line.matched.sku} ({line.matched.memoryGb}GB)</span>
        ) : (
          <select
            aria-label={t('instanceSelect')}
            value={line.matched.sku}
            onChange={(e) =>
              onSelect(provider, line.resourceIndex, e.target.value, e.target.value === line.candidates[0].sku)
            }
            className="ml-1 max-w-full rounded border border-slate-300 bg-white px-1 py-0.5 font-mono text-xs text-slate-900"
          >
            {line.candidates.map((c) => (
              <option key={c.sku} value={c.sku}>
                {c.sku} · {c.memoryGb}GB · {money(c.perHour * HOURS_PER_MONTH * line.count)}
                {odSuffix(c)}
              </option>
            ))}
          </select>
        )}
        <NoCommitBadge term={term} matched={line.matched} />
      </span>
    );
  }
  if (line.kind === 'container') {
    return (
      <span>
        {t('containerLine', { vcpu: line.spec.vcpu, gb: line.spec.ramGb, count: line.spec.count })}
        {!line.matched ? (
          line.noMatch ? <NoMatchNote noMatch={line.noMatch} provider={provider} /> : <span className="ml-1 text-red-500">{t('noData')}</span>
        ) : (
          <span className="ml-1 font-mono text-slate-900">
            → {CONTAINER_PRODUCT[provider]} {line.matched.vcpu}vCPU/{line.matched.ramGb}GB
          </span>
        )}
        {line.matched && <ArchBadge arch={line.matched.arch} />}
        <NoCommitBadge term={term} matched={line.matched} />
      </span>
    );
  }
  if (line.kind === 'logs') {
    return (
      <span>
        {t('logsLine', { gb: line.gb, days: line.retentionDays })}
        {line.monthlyUsd === null ? (
          <span className="ml-1 text-red-500">{t('noData')}</span>
        ) : (
          <span className="ml-1 text-slate-400">
            → {LOGS_PRODUCT[provider]}
            {line.plan !== null && ` ${line.plan}`}
            {line.commitmentGbPerDay !== null && ` ${t('logsCommitment', { gb: line.commitmentGbPerDay })}`}
          </span>
        )}
      </span>
    );
  }
  if (line.kind === 'cdn') {
    return (
      <span>
        {t('cdnLine', { gb: line.gb, requests: line.requestsM, man: (line.requestsM * 100).toLocaleString('ko-KR') })}
        {line.monthlyUsd === null ? (
          <span className="ml-1 text-red-500">{t('noData')}</span>
        ) : (
          <span className="ml-1 text-slate-400">
            → {CDN_PRODUCT[provider]} {line.plan ? t('cdnPlan', { plan: line.plan }) : t('cdnPayg')}
          </span>
        )}
      </span>
    );
  }
  if (line.kind === 'db-storage') {
    return (
      <span>
        {t('dbStorageLine', { gb: line.storageGb, count: line.count })}
        {line.ha && <span className="ml-1 text-slate-400">({t('dbHa')})</span>}
        {line.perGbMonth === null && <span className="ml-1 text-red-500">{t('noData')}</span>}
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
  if (line.kind === 'lb') {
    return (
      <span>
        {t('lbLine', { count: line.count, gb: line.gb })}
        {line.monthlyUsd === null && <span className="ml-1 text-red-500">{t('noData')}</span>}
      </span>
    );
  }
  if (line.kind === 'nat') {
    return (
      <span>
        {t('natLine', { count: line.count, gb: line.gb })}
        {line.billedVms !== null && <span className="ml-1 text-slate-400">{t('natBilledVms', { vms: line.billedVms })}</span>}
        {line.monthlyUsd === 0 && <span className="ml-1 text-slate-400">{t('natFree', { provider: PROVIDER_LABEL[provider] })}</span>}
        {line.monthlyUsd === null && <span className="ml-1 text-red-500">{t('noData')}</span>}
      </span>
    );
  }
  if (line.kind === 'k8s-control') {
    return (
      <span>
        {t('k8sControl', { clusters: line.clusters })}
        {line.clusterPerHour === null && <span className="ml-1 text-red-500">{t('noData')}</span>}
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
  region,
  rate,
  term,
  includeBurstable,
  arch,
  hidden,
  onToggleProvider,
  onSelectInstance,
}: {
  estimates: ProviderEstimate[];
  region: Region;
  rate: number | null;
  /** 약정 기간 — 생략 = 정가 */
  term?: Term;
  /** 매칭 옵션 — 매칭 규칙 안내 문구용 */
  includeBurstable: boolean;
  arch: ArchFilter;
  /** 화면에서 숨긴 플랫폼 ("다른 플랫폼"만) — 카드와 최저가 비교에서 빠진다 */
  hidden: Provider[];
  onToggleProvider: (provider: Provider) => void;
  onSelectInstance: SelectInstance;
}) {
  const t = useTranslations('estimate');
  const td = useTranslations('display');
  // 한국어 화면은 원화가 기본 (환율이 없으면 원화 선택지가 없으므로 USD)
  const locale = useLocale();
  const [currency, setCurrency] = useState<Currency>(locale === 'ko' && rate !== null ? 'krw' : 'usd');
  const [period, setPeriod] = useState<Period>('month');
  // 주소에 현재 시나리오가 들어 있으므로 주소 복사가 곧 공유 (ScenarioBuilder가 주소를 갱신)
  const ts = useTranslations('scenario');
  const [copied, setCopied] = useState(false);
  const [basisOpen, setBasisOpen] = useState(false);
  const copyShareLink = async () => {
    await navigator.clipboard.writeText(window.location.href);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const canKrw = rate !== null;
  const money = (x: number) => formatMoney(x, currency, period, rate ?? 1);

  const visible = estimates.filter((e) => !hidden.includes(e.provider));
  // 최저가는 화면에 보이는 플랫폼 중 구성 요소를 전부 제공하는 것끼리만 (미제공 줄을 뺀 합계끼리 비교하면 오해)
  const cheapest = cheapestTotal(visible);
  const comparable = visible.filter((e) => !e.partial && e.totalMonthlyUsd !== null);
  const winner = comparable.find((e) => e.totalMonthlyUsd === cheapest) ?? null;
  // 매칭된 인스턴스 중 ARM이 하나라도 있으면 호환성 고지
  const hasArm = visible.some((e) =>
    e.lines.some((l) => l.kind === 'vm' && l.matched?.arch === 'arm'),
  );
  // 자동 매칭되는 줄(VM·K8s 노드·DB·캐시·컨테이너)이 있으면 매칭 규칙 안내
  const hasMatching = visible.some((e) =>
    e.lines.some((l) => l.kind === 'vm' || l.kind === 'db' || l.kind === 'cache' || l.kind === 'container'),
  );

  // 그룹 안에서 가격순 — 전부 제공 → 일부 미제공(합계 비교 불가) → 금액 없음 순
  const rank = (e: ProviderEstimate) => (!e.available || e.totalMonthlyUsd === null ? 2 : e.partial ? 1 : 0);
  const byPrice = (a: ProviderEstimate, b: ProviderEstimate) =>
    rank(a) - rank(b) || (a.totalMonthlyUsd ?? 0) - (b.totalMonthlyUsd ?? 0);
  const primary = visible.filter((e) => PRIMARY_PROVIDERS.includes(e.provider)).sort(byPrice);
  const otherProviders = estimates.filter((e) => !PRIMARY_PROVIDERS.includes(e.provider)).map((e) => e.provider);
  const others = visible.filter((e) => !PRIMARY_PROVIDERS.includes(e.provider)).sort(byPrice);
  const cardId = (p: Provider) => `estimate-${p}`;
  // 막대 길이 기준 = 보이는 플랫폼 중 최고 합계
  const maxTotal = Math.max(0, ...visible.map((e) => (e.available ? (e.totalMonthlyUsd ?? 0) : 0)));

  // 펼친 카드 — null이면 기본값(최저가만). 사용자가 한 번 접거나 펼치면 그때부터 직접 관리
  const [expanded, setExpanded] = useState<Provider[] | null>(null);
  const openList = expanded ?? (winner ? [winner.provider] : []);
  const toggleOpen = (p: Provider) =>
    setExpanded(openList.includes(p) ? openList.filter((x) => x !== p) : [...openList, p]);

  const card = (e: ProviderEstimate) => {
    const isCheapest = !e.partial && e.totalMonthlyUsd !== null && e.totalMonthlyUsd === cheapest;
    const expandable = e.available && e.lines.length > 0;
    const open = expandable && openList.includes(e.provider);
    const total = e.available ? e.totalMonthlyUsd : null;
    // 최저가 대비 % — 합계 비교가 가능한 플랫폼끼리만
    const diffPct =
      !isCheapest && !e.partial && total !== null && cheapest !== null && cheapest > 0
        ? Math.round((total / cheapest - 1) * 100)
        : null;
    return (
      <div
        key={e.provider}
        id={cardId(e.provider)}
        className={`scroll-mt-4 rounded-lg border bg-white shadow-sm ${
          isCheapest ? 'border-emerald-500 ring-1 ring-emerald-500' : 'border-slate-200'
        }`}
      >
        <button
          type="button"
          onClick={() => toggleOpen(e.provider)}
          disabled={!expandable}
          aria-expanded={expandable ? open : undefined}
          className="flex w-full flex-wrap items-center gap-x-3 gap-y-2 rounded-lg px-4 py-3 text-left sm:flex-nowrap hover:bg-slate-50 disabled:cursor-default disabled:hover:bg-transparent"
        >
          <span className="w-28 shrink-0 text-sm font-bold sm:w-32">
            {PROVIDER_LABEL[e.provider]}
            {isCheapest && (
              <span className="mt-0.5 block w-fit rounded bg-emerald-100 px-1.5 py-0.5 text-xs font-medium text-emerald-700">
                {t('cheapest')}
              </span>
            )}
          </span>
          {/* 좁은 화면에선 막대를 둘째 줄로 내려 폭을 확보 */}
          <span className="order-last flex min-w-0 basis-full items-center gap-2 sm:order-none sm:flex-1 sm:basis-auto">
            {total !== null && maxTotal > 0 && (
              <>
                <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-slate-100">
                  <span
                    className={`block h-full rounded-full ${isCheapest ? 'bg-emerald-500' : e.partial ? 'bg-amber-300' : 'bg-slate-300'}`}
                    style={{ width: `${(total / maxTotal) * 100}%` }}
                  />
                </span>
                <span className="w-11 shrink-0 text-right text-xs tabular-nums text-slate-500">{diffPct !== null && `+${diffPct}%`}</span>
              </>
            )}
          </span>
          <span className="ml-auto shrink-0 text-right text-base font-bold tabular-nums sm:text-lg">
            {!e.available ? (
              <span className="text-sm font-normal text-slate-400">{t(offeredIn(region, e.provider) ? 'dataPending' : 'notOffered')}</span>
            ) : e.totalMonthlyUsd === null ? (
              <span className="text-sm font-normal text-slate-400">{t('unavailable')}</span>
            ) : (
              <>
                {money(e.totalMonthlyUsd)}
                <span className="text-xs font-normal text-slate-500">{td(PERIOD_SUFFIX[period])}</span>
                {e.partial && <span className="block text-xs font-normal text-amber-700">{t('partialTotal')}</span>}
              </>
            )}
          </span>
          <span aria-hidden className={`w-3 shrink-0 text-slate-400 transition-transform ${open ? 'rotate-90' : ''} ${expandable ? '' : 'invisible'}`}>
            ›
          </span>
        </button>

        {open && (
          <ul className="mx-4 mb-4 space-y-1 border-t border-slate-100 pt-3">
            {e.lines.map((line, i) => (
              <li key={i} className="flex justify-between gap-2 text-xs text-slate-600">
                <span className="min-w-0">
                  <LineLabel line={line} provider={e.provider} term={term} money={money} onSelect={onSelectInstance} />
                </span>
                {line.monthlyUsd !== null && (
                  <span className="shrink-0 tabular-nums">
                    {line.kind === 'nat' && line.monthlyUsd === 0 ? t('free') : money(line.monthlyUsd)}
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    );
  };

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
        <button
          type="button"
          onClick={copyShareLink}
          className={`ml-auto flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs font-medium ${
            copied ? 'border-emerald-300 text-emerald-700' : 'border-slate-200 text-slate-600 hover:border-slate-400 hover:text-slate-900'
          }`}
        >
          {copied ? <Check aria-hidden className="size-3.5" /> : <Link2 aria-hidden className="size-3.5" />}
          {copied ? ts('copied') : ts('copyShareLink')}
        </button>
      </div>

      {winner && winner.totalMonthlyUsd !== null && (
        <button
          type="button"
          onClick={() => {
            if (!openList.includes(winner.provider)) setExpanded([...openList, winner.provider]);
            document.getElementById(cardId(winner.provider))?.scrollIntoView({ behavior: 'smooth', block: 'start' });
          }}
          className="flex items-center justify-between gap-3 rounded-lg border-2 border-emerald-500 bg-emerald-50 p-4 text-left shadow-sm transition hover:bg-emerald-100"
        >
          <span className="min-w-0">
            <span className="block text-xs font-medium text-emerald-700">{t('cheapestSummary', { count: comparable.length })}</span>
            <span className="block text-lg font-bold text-slate-900">{PROVIDER_LABEL[winner.provider]}</span>
          </span>
          <span className="shrink-0 text-right">
            <span className="block text-xl font-bold tabular-nums text-slate-900">
              {money(winner.totalMonthlyUsd)}
              <span className="text-xs font-normal text-slate-500">{td(PERIOD_SUFFIX[period])}</span>
            </span>
            <span className="block text-xs font-medium text-emerald-700">{t('cheapestJump')} ↓</span>
          </span>
        </button>
      )}
      {hasMatching && (
        <p className="text-xs text-slate-500">
          {t('matchRule', { burst: t(`matchBurst.${includeBurstable ? 'in' : 'out'}`), arch: t(`matchArch.${arch}`) })}{' '}
          <Link href="/methodology" className="underline hover:text-slate-700">{t('matchRuleLink')}</Link>
        </p>
      )}

      <div className="flex flex-col gap-2">{primary.map(card)}</div>
      {otherProviders.length > 0 && (
        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-slate-200 pt-4">
          <h3 className="text-xs font-semibold text-slate-500">{t('otherPlatforms')}</h3>
          <div role="group" aria-label={t('platformFilter')} className="flex flex-wrap gap-x-3 gap-y-1">
            {otherProviders.map((p) => (
              <label key={p} className="flex items-center gap-1 text-xs text-slate-600">
                <input type="checkbox" checked={!hidden.includes(p)} onChange={() => onToggleProvider(p)} />
                {PROVIDER_LABEL[p]}
              </label>
            ))}
          </div>
        </div>
      )}
      {others.length > 0 && <div className="flex flex-col gap-2">{others.map(card)}</div>}
      {term && (
        <p className="rounded-md bg-sky-50 px-3 py-2 text-xs text-sky-800">{t('commitNotice', { years: term === '1y' ? 1 : 3 })}</p>
      )}
      {hasArm && (
        <p className="rounded-md bg-violet-50 px-3 py-2 text-xs text-violet-700">{t('armNotice')}</p>
      )}
      {/* 항상 같은 계산 전제는 접어둔다 — 결과에 직접 영향 주는 경고(약정·ARM)는 위에 그대로 */}
      <div>
        <button
          type="button"
          onClick={() => setBasisOpen((o) => !o)}
          aria-expanded={basisOpen}
          className="flex items-center gap-1.5 text-xs text-slate-500 hover:text-slate-900"
        >
          <Info aria-hidden className="size-3.5" />
          {t('calcBasis')}
          <ChevronDown aria-hidden className={`size-3.5 text-slate-400 transition-transform duration-200 ${basisOpen ? 'rotate-180' : ''}`} />
        </button>
        <Collapse open={basisOpen}>
          <div className="mt-2 space-y-1.5 text-xs text-slate-500">
            <p>{t('footnote')}</p>
            {currency === 'krw' && rate !== null && (
              <p>{td('fxNote', { rate: rate.toLocaleString('ko-KR', { maximumFractionDigits: 2 }) })}</p>
            )}
            <Link href="/methodology" className="inline-block underline hover:text-slate-700">{t('matchRuleLink')}</Link>
          </div>
        </Collapse>
      </div>
    </div>
  );
}
