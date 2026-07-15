'use client';

import { useTranslations } from 'next-intl';
import type { VmSpec } from '@/lib/estimator';
import NumberField from './NumberField';

interface Props {
  index: number;
  spec: VmSpec;
  onChange: (spec: VmSpec) => void;
  onRemove: () => void;
}

export default function ResourceCard({ index, spec, onChange, onRemove }: Props) {
  const t = useTranslations('scenario');
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
      <div className="mb-3 flex items-center justify-between">
        <span className="text-sm font-semibold">{t('vmTitle', { index: index + 1 })}</span>
        <button
          onClick={onRemove}
          className="text-xs text-slate-400 hover:text-red-600"
          aria-label={t('removeAria')}
        >
          {t('remove')}
        </button>
      </div>
      <div className="flex gap-4">
        <NumberField label={t('vcpu')} value={spec.vcpu} min={1} onChange={(vcpu) => onChange({ ...spec, vcpu })} />
        <NumberField label={t('ram')} value={spec.ramGb} min={1} onChange={(ramGb) => onChange({ ...spec, ramGb })} />
        <NumberField label={t('count')} value={spec.count} min={1} onChange={(count) => onChange({ ...spec, count })} />
      </div>
    </div>
  );
}
