'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { CONTAINER_VCPUS, LOG_RETENTION_DAYS, type Resource } from '@/lib/estimator';
import type { DbEngine } from '@/lib/schema';
import NumberField from './NumberField';
import { RESOURCE_ICON } from './resource-icons';

interface Props {
  resource: Resource;
  /** 같은 타입 카드 중 몇 번째인지(1부터) — 같은 타입이 여럿일 때 제목 구분용 */
  ordinal: number;
  /** 같은 타입 카드가 여럿인지 */
  numbered: boolean;
  onChange: (next: Resource) => void;
  onRemove: () => void;
  /** VM 카드: 인스턴스 이름으로 채우기 — 찾으면 스펙을 채우고 true. 자동완성 목록은 datalist id */
  onFillSku?: (name: string) => boolean;
  skuListId?: string;
  /** VM 카드: 이 카드에 고정된 인스턴스 ("AWS t3.medium") */
  pinned?: string[];
}

/** 리소스 카드 — 공통 틀(제목·삭제) + 타입별 입력 필드 */
export default function ResourceCard({ resource: r, ordinal, numbered, onChange, onRemove, onFillSku, skuListId, pinned }: Props) {
  const t = useTranslations('scenario');
  const [skuName, setSkuName] = useState('');
  const [skuNotFound, setSkuNotFound] = useState(false);
  /** 찾으면 입력란을 비운다 — 결과는 카드 스펙과 고정 안내로 보인다 */
  const fillSku = (name: string) => {
    if (!onFillSku || !name.trim()) return;
    const found = onFillSku(name);
    setSkuNotFound(!found);
    if (found) setSkuName('');
  };
  const title = t(`resourceTitle.${r.type}`) + (numbered ? ` #${ordinal}` : '');
  const Icon = RESOURCE_ICON[r.type];
  return (
    <div className="p-4">
      <div className="flex items-center justify-between">
        <span className="flex items-center gap-2 text-sm font-semibold">
          <Icon aria-hidden className="size-4 text-slate-500 dark:text-slate-400" />
          {title}
        </span>
        <button
          onClick={onRemove}
          className="text-xs text-slate-400 hover:text-red-600 dark:hover:text-red-400"
          aria-label={t('removeAria')}
        >
          {t('remove')}
        </button>
      </div>
      {/* 용어를 처음 보는 사용자를 위한 한 줄 설명 */}
      <p className="mb-3 mt-0.5 text-xs text-slate-500 dark:text-slate-400">{t(`resourceHint.${r.type}`)}</p>
      <div className="flex flex-wrap gap-4">
        {r.type === 'vm' ? (
          <>
            <NumberField label={t('vcpu')} value={r.vcpu} min={1} onChange={(vcpu) => onChange({ ...r, vcpu })} />
            <NumberField label={t('ram')} value={r.ramGb} min={1} onChange={(ramGb) => onChange({ ...r, ramGb })} />
            <NumberField label={t('count')} value={r.count} min={1} onChange={(count) => onChange({ ...r, count })} />
            {onFillSku && (
              <label className="flex basis-full flex-col gap-1 text-xs text-slate-500 dark:text-slate-400">
                {t('vmSkuLabel')}
                <input
                  type="text"
                  list={skuListId}
                  value={skuName}
                  placeholder={t('vmSkuPlaceholder')}
                  onChange={(e) => {
                    setSkuName(e.target.value);
                    setSkuNotFound(false);
                    // 자동완성 목록에서 고르면 바로 적용 (직접 타이핑은 Enter·포커스 이동 때)
                    const ne = e.nativeEvent as InputEvent;
                    if (!(ne instanceof InputEvent) || ne.inputType === 'insertReplacementText') fillSku(e.target.value);
                  }}
                  onKeyDown={(e) => e.key === 'Enter' && fillSku(skuName)}
                  onBlur={() => fillSku(skuName)}
                  className="w-full max-w-xs rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-2 py-1 font-mono text-sm text-slate-900 dark:text-slate-100"
                />
                {skuNotFound ? (
                  <span className="text-amber-700 dark:text-amber-400">{t('vmSkuNotFound')}</span>
                ) : pinned && pinned.length > 0 ? (
                  <span className="text-slate-600 dark:text-slate-300">{t('vmSkuPinned', { list: pinned.join(', ') })}</span>
                ) : null}
              </label>
            )}
          </>
        ) : r.type === 'k8s' ? (
          <>
            <NumberField label={t('clusters')} value={r.clusters} min={1} onChange={(clusters) => onChange({ ...r, clusters })} />
            <NumberField label={t('nodeVcpu')} value={r.node.vcpu} min={1} onChange={(vcpu) => onChange({ ...r, node: { ...r.node, vcpu } })} />
            <NumberField label={t('nodeRam')} value={r.node.ramGb} min={1} onChange={(ramGb) => onChange({ ...r, node: { ...r.node, ramGb } })} />
            <NumberField label={t('nodesPerCluster')} value={r.node.count} min={1} onChange={(count) => onChange({ ...r, node: { ...r.node, count } })} />
          </>
        ) : r.type === 'db' ? (
          <>
            <label className="flex flex-col gap-1 text-xs text-slate-500 dark:text-slate-400">
              {t('dbEngine')}
              <select
                value={r.engine}
                onChange={(e) => onChange({ ...r, engine: e.target.value as DbEngine })}
                className="rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-2 py-1 text-sm text-slate-900 dark:text-slate-100"
              >
                <option value="postgres">PostgreSQL</option>
                <option value="mysql">MySQL</option>
              </select>
            </label>
            <NumberField label={t('vcpu')} value={r.vcpu} min={1} onChange={(vcpu) => onChange({ ...r, vcpu })} />
            <NumberField label={t('ram')} value={r.ramGb} min={1} onChange={(ramGb) => onChange({ ...r, ramGb })} />
            <NumberField label={t('dbStorageGb')} value={r.storageGb} min={1} onChange={(storageGb) => onChange({ ...r, storageGb })} />
            <NumberField label={t('count')} value={r.count} min={1} onChange={(count) => onChange({ ...r, count })} />
            <label className="flex items-center gap-1.5 self-end pb-1.5 text-xs text-slate-600 dark:text-slate-300" title={t('dbHaHint')}>
              <input type="checkbox" checked={r.ha} onChange={(e) => onChange({ ...r, ha: e.target.checked })} />
              {t('dbHa')}
            </label>
          </>
        ) : r.type === 'cache' ? (
          <>
            <NumberField label={t('cacheMemoryGb')} value={r.memoryGb} min={1} onChange={(memoryGb) => onChange({ ...r, memoryGb })} />
            <NumberField label={t('count')} value={r.count} min={1} onChange={(count) => onChange({ ...r, count })} />
            <label className="flex items-center gap-1.5 self-end pb-1.5 text-xs text-slate-600 dark:text-slate-300" title={t('cacheHaHint')}>
              <input type="checkbox" checked={r.ha} onChange={(e) => onChange({ ...r, ha: e.target.checked })} />
              {t('dbHa')}
            </label>
          </>
        ) : r.type === 'container' ? (
          <>
            <label className="flex flex-col gap-1 text-xs text-slate-500 dark:text-slate-400">
              {t('vcpu')}
              <select
                value={r.vcpu}
                onChange={(e) => onChange({ ...r, vcpu: Number(e.target.value) })}
                className="w-24 rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-2 py-1 text-sm text-slate-900 dark:text-slate-100"
              >
                {CONTAINER_VCPUS.map((v) => (
                  <option key={v} value={v}>{v}</option>
                ))}
              </select>
            </label>
            <NumberField label={t('ram')} value={r.ramGb} min={1} onChange={(ramGb) => onChange({ ...r, ramGb })} />
            <NumberField label={t('containerCount')} value={r.count} min={1} onChange={(count) => onChange({ ...r, count })} />
          </>
        ) : r.type === 'logs' ? (
          <>
            <NumberField label={t('logsGb')} value={r.gb} min={1} onChange={(gb) => onChange({ ...r, gb })} />
            <label className="flex flex-col gap-1 text-xs text-slate-500 dark:text-slate-400">
              {t('logsRetention')}
              <select
                value={r.retentionDays}
                onChange={(e) => onChange({ ...r, retentionDays: Number(e.target.value) })}
                className="w-24 rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-2 py-1 text-sm text-slate-900 dark:text-slate-100"
              >
                {LOG_RETENTION_DAYS.map((d) => (
                  <option key={d} value={d}>{t('logsDays', { days: d })}</option>
                ))}
              </select>
            </label>
          </>
        ) : r.type === 'cdn' ? (
          <>
            <NumberField label={t('cdnGb')} value={r.gb} min={1} onChange={(gb) => onChange({ ...r, gb })} />
            <NumberField label={t('cdnRequestsM')} value={r.requestsM} min={1} onChange={(requestsM) => onChange({ ...r, requestsM })} />
            <p className="basis-full text-xs text-slate-400">{t('cdnHint')}</p>
          </>
        ) : r.type === 'lb' || r.type === 'nat' ? (
          <>
            <NumberField label={t(r.type === 'lb' ? 'lbCount' : 'natCount')} value={r.count} min={1} onChange={(count) => onChange({ ...r, count })} />
            <NumberField label={t('processedGb')} value={r.gb} min={1} onChange={(gb) => onChange({ ...r, gb })} />
          </>
        ) : (
          <NumberField
            label={t(r.type === 'egress' ? 'egressGb' : 'sizeGb')}
            value={r.gb}
            min={1}
            onChange={(gb) => onChange({ ...r, gb })}
          />
        )}
      </div>
    </div>
  );
}
