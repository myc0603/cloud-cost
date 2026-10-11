'use client';

import { useTranslations } from 'next-intl';
import type { Resource } from '@/lib/estimator';
import NumberField from './NumberField';

interface Props {
  resource: Resource;
  /** 같은 타입 카드 중 몇 번째인지(1부터) — 같은 타입이 여럿일 때 제목 구분용 */
  ordinal: number;
  /** 같은 타입 카드가 여럿인지 */
  numbered: boolean;
  onChange: (next: Resource) => void;
  onRemove: () => void;
}

/** 리소스 카드 — 공통 틀(제목·삭제) + 타입별 입력 필드 */
export default function ResourceCard({ resource: r, ordinal, numbered, onChange, onRemove }: Props) {
  const t = useTranslations('scenario');
  const title = t(`resourceTitle.${r.type}`) + (numbered ? ` #${ordinal}` : '');
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
      <div className="mb-3 flex items-center justify-between">
        <span className="text-sm font-semibold">{title}</span>
        <button
          onClick={onRemove}
          className="text-xs text-slate-400 hover:text-red-600"
          aria-label={t('removeAria')}
        >
          {t('remove')}
        </button>
      </div>
      <div className="flex flex-wrap gap-4">
        {r.type === 'vm' ? (
          <>
            <NumberField label={t('vcpu')} value={r.vcpu} min={1} onChange={(vcpu) => onChange({ ...r, vcpu })} />
            <NumberField label={t('ram')} value={r.ramGb} min={1} onChange={(ramGb) => onChange({ ...r, ramGb })} />
            <NumberField label={t('count')} value={r.count} min={1} onChange={(count) => onChange({ ...r, count })} />
          </>
        ) : r.type === 'k8s' ? (
          <>
            <NumberField label={t('clusters')} value={r.clusters} min={1} onChange={(clusters) => onChange({ ...r, clusters })} />
            <NumberField label={t('nodeVcpu')} value={r.node.vcpu} min={1} onChange={(vcpu) => onChange({ ...r, node: { ...r.node, vcpu } })} />
            <NumberField label={t('nodeRam')} value={r.node.ramGb} min={1} onChange={(ramGb) => onChange({ ...r, node: { ...r.node, ramGb } })} />
            <NumberField label={t('nodesPerCluster')} value={r.node.count} min={1} onChange={(count) => onChange({ ...r, node: { ...r.node, count } })} />
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
