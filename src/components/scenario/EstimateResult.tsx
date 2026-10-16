'use client';

import { useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { gcpSustainedUseMax, HOURS_PER_MONTH, type EstimateLine, type NoMatchReason, type ProviderEstimate } from '@/lib/estimator';
import { formatMoney, type Currency, type Period } from '@/lib/display';
import type { Arch, Provider, Term } from '@/lib/schema';

const PROVIDER_LABEL: Record<Provider, string> = { aws: 'AWS', azure: 'Azure', gcp: 'GCP' };

/** 로그 수집 상품명 — 비교 대상 고정 (estimator/logs.ts) */
const LOGS_PRODUCT: Record<Provider, string> = { aws: 'CloudWatch Logs', azure: 'Log Analytics', gcp: 'Cloud Logging' };

/** CDN 상품명 — 비교 대상 고정 (estimator/cdn.ts) */
const CDN_PRODUCT: Record<Provider, string> = { aws: 'CloudFront', azure: 'Front Door Standard', gcp: 'Cloud CDN' };

/** 서버리스 컨테이너 상품명 — 비교 대상 고정 (estimator/container.ts) */
const CONTAINER_PRODUCT: Record<Provider, string> = { aws: 'Fargate', azure: 'Container Apps', gcp: 'Cloud Run' };

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
              ? t('noMatchArchPlatform', { product: CONTAINER_PRODUCT[provider], arch: archLabel(noMatch.arch) })
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
  /** 드롭다운 후보 라벨 접미사 — 약정 기준에서 약정가 없는 후보 */
  const odSuffix = (c: { committed: boolean }) => (term && !c.committed ? ` · ${t('onDemandShort')}` : '');
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
            className="ml-1 rounded border border-slate-300 bg-white px-1 py-0.5 font-mono text-xs text-slate-900"
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
            className="ml-1 rounded border border-slate-300 bg-white px-1 py-0.5 font-mono text-xs text-slate-900"
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
            className="ml-1 rounded border border-slate-300 bg-white px-1 py-0.5 font-mono text-xs text-slate-900"
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
  rate,
  term,
  onSelectInstance,
}: {
  estimates: ProviderEstimate[];
  rate: number | null;
  /** 약정 기간 — 생략 = 정가 */
  term?: Term;
  onSelectInstance: SelectInstance;
}) {
  const t = useTranslations('estimate');
  const td = useTranslations('display');
  // 한국어 화면은 원화가 기본 (환율이 없으면 원화 선택지가 없으므로 USD)
  const locale = useLocale();
  const [currency, setCurrency] = useState<Currency>(locale === 'ko' && rate !== null ? 'krw' : 'usd');
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
                    <LineLabel line={line} provider={e.provider} term={term} money={money} onSelect={onSelectInstance} />
                    {line.monthlyUsd !== null && <span className="tabular-nums">{money(line.monthlyUsd)}</span>}
                  </li>
                ))}
              </ul>
            )}
          </div>
        );
      })}
      {term && (
        <p className="rounded-md bg-sky-50 px-3 py-2 text-xs text-sky-800">{t('commitNotice', { years: term === '1y' ? 1 : 3 })}</p>
      )}
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
